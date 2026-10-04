import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const screenshotsDir = path.join(rootDir, 'docs', 'assets', 'screenshots');

if (!existsSync(screenshotsDir)) {
  mkdirSync(screenshotsDir, { recursive: true });
}

/**
 * Discovers the local Chrome or Edge executable using environment paths.
 * Adheres to portable path hygiene.
 */
function findBrowserExecutable() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env['LOCALAPPDATA'] || '';

  const candidates = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  throw new Error('No supported browser executable (Chrome or Edge) found.');
}

/**
 * Polls for the Chrome DevTools debugging endpoint to become ready.
 */
function pollForDevToolsEndpoint(port = 9222, maxAttempts = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          clearInterval(interval);
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', () => {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          reject(new Error('Timed out waiting for DevTools endpoint to become available.'));
        }
      });
    }, 500);
  });
}

/**
 * Retrieves the first page target from the DevTools endpoint.
 */
function getPageTarget(port = 9222) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const list = JSON.parse(data);
          const page = list.find(t => t.type === 'page');
          if (page) resolve(page);
          else reject(new Error('No page target found'));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Creates a minimal CDP client over native WebSocket.
 */
class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.callbacks = new Map();

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          resolve(msg.result);
        }
      }
    };
  }

  waitForOpen() {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    this.events.set(method, handler);
  }

  close() {
    try {
      this.ws.close();
    } catch (_) {}
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function safeWriteFileSync(filepath, data, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      writeFileSync(filepath, data);
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      const start = Date.now();
      while (Date.now() - start < 300) {}
    }
  }
}

async function run() {
  const cdpPort = 9333;
  const browserPath = findBrowserExecutable();
  const tempUserDataDir = path.join(os.tmpdir(), `garrison-browser-${Date.now()}`);
  mkdirSync(tempUserDataDir, { recursive: true });

  console.log(`[tour] Launching headless browser from: ${browserPath}`);
  const browserProc = spawn(browserPath, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,900',
    `--user-data-dir=${tempUserDataDir}`
  ], { stdio: 'ignore' });

  try {
    console.log('[tour] Connecting to DevTools protocol...');
    await pollForDevToolsEndpoint(cdpPort);
    const target = await getPageTarget(cdpPort);
    const cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.waitForOpen();
    console.log('[tour] Connected to page target.');

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCookies');

    // Set viewport: 1440x900, DPR 2
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false
    });

    const capture = async (name, fullPage = false) => {
      await sleep(600); // Allow render/animation to settle
      const dateStr = '2026-10-02';
      const filename = `${dateStr}_${name}.png`;
      const filepath = path.join(screenshotsDir, filename);

      let params = { format: 'png', quality: 90 };
      if (fullPage) {
        const layout = await cdp.send('Page.getLayoutMetrics');
        const contentSize = layout.contentSize || layout.cssContentSize;
        params = {
          format: 'png',
          clip: {
            x: 0,
            y: 0,
            width: 1440,
            height: Math.min(Math.max(contentSize.height, 900), 2400),
            scale: 1
          }
        };
      }
      const res = await cdp.send('Page.captureScreenshot', params);
      safeWriteFileSync(filepath, Buffer.from(res.data, 'base64'));
      console.log(`[tour] Captured: ${filename}`);
    };

    const navigateAndWait = async (url) => {
      console.log(`[tour] Navigating to ${url}...`);
      await cdp.send('Page.navigate', { url });
      await sleep(1200);
      const title = await evalScript('document.title');
      const h1 = await evalScript('document.querySelector("h1")?.innerText || ""');
      console.log(`[tour] Landed on "${title}" (Heading: "${h1}")`);
    };

    const evalScript = async (expression) => {
      const res = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (res.exceptionDetails) {
        const detail = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
        throw new Error(`Eval error: ${detail}`);
      }
      return res.result?.value;
    };

    // 1. Login Page
    await navigateAndWait('http://localhost:8080/login');
    await capture('01_login_page');

    // 2. Perform Login
    console.log('[tour] Filling login credentials...');
    await evalScript(`
      (() => {
        const emailInput = document.querySelector('input[name="email"]');
        const passInput = document.querySelector('input[name="password"]');
        const opInput = document.querySelector('input[name="operator_id"]');
        if (emailInput) emailInput.value = 'operator@garrisonos.local';
        if (passInput) passInput.value = 'Password123!';
        if (opInput) opInput.value = 'operator-demo';
        const submitBtn = document.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.click();
        } else {
          document.querySelector('form').submit();
        }
      })()
    `);
    await sleep(2000); // Wait for redirect to /dashboard
    await capture('02_dashboard');

    // 3. Universal Search live preview dropdown
    console.log('[tour] Testing universal search dropdown...');
    await evalScript(`
      const searchInput = document.querySelector('input[name="q"]') || document.querySelector('#header-search-input') || document.querySelector('.search-input');
      if (searchInput) {
        searchInput.focus();
        searchInput.value = 'Magnolia';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `);
    await sleep(1000);
    await capture('03_universal_search_dropdown');

    // 4. Universal Search full page
    await navigateAndWait('http://localhost:8080/search?q=Magnolia');
    await capture('04_universal_search_full_results');

    // 5. Properties Index
    await navigateAndWait('http://localhost:8080/properties');
    await capture('05_properties_index');

    // 6. Property Detail View
    const propId = await evalScript(`
      const row = document.querySelector('[data-entity="property"]') || document.querySelector('tbody tr');
      row ? (row.getAttribute('data-id') || (row.querySelector('a[href*="/properties/show"]') ? row.querySelector('a[href*="/properties/show"]').href.split('id=')[1] : null)) : null;
    `);
    console.log(`[tour] Discovered property ID: ${propId}`);
    if (propId) {
      await navigateAndWait(`http://localhost:8080/properties/show?id=${propId}`);
      await capture('06_property_detail');
    }

    // 7. Amenities Catalog & Marketing Editor
    await navigateAndWait('http://localhost:8080/properties/amenities');
    await capture('07_amenities_catalog');

    // 8. Leases Index
    await navigateAndWait('http://localhost:8080/leases');
    await capture('08_leases_index');

    // 9. Lease Detail View
    const leaseId = await evalScript(`
      const row = document.querySelector('[data-entity="lease"]') || document.querySelector('tbody tr');
      row ? (row.getAttribute('data-id') || (row.querySelector('a[href*="/leases/show"]') ? row.querySelector('a[href*="/leases/show"]').href.split('id=')[1] : null)) : null;
    `);
    console.log(`[tour] Discovered lease ID: ${leaseId}`);
    if (leaseId) {
      await navigateAndWait(`http://localhost:8080/leases/show?id=${leaseId}`);
      await capture('09_lease_detail');
    }

    // 10. Contacts Directory
    await navigateAndWait('http://localhost:8080/contacts');
    await capture('10_contacts_directory');

    // 11. Contact Detail View
    const contactId = await evalScript(`
      const row = document.querySelector('[data-entity="contact"]') || document.querySelector('tbody tr');
      row ? (row.getAttribute('data-id') || (row.querySelector('a[href*="/contacts/show"]') ? row.querySelector('a[href*="/contacts/show"]').href.split('id=')[1] : null)) : null;
    `);
    console.log(`[tour] Discovered contact ID: ${contactId}`);
    if (contactId) {
      await navigateAndWait(`http://localhost:8080/contacts/show?id=${contactId}`);
      await capture('11_contact_detail');
    }

    // 12. Maintenance Work Orders
    await navigateAndWait('http://localhost:8080/maintenance');
    await capture('12_maintenance_work_orders');

    // 13. Maintenance Detail View
    const ticketId = await evalScript(`
      const row = document.querySelector('[data-entity="work_order"]') || document.querySelector('[data-entity="maintenance"]') || document.querySelector('tbody tr');
      row ? (row.getAttribute('data-id') || (row.querySelector('a[href*="/maintenance/show"]') ? row.querySelector('a[href*="/maintenance/show"]').href.split('id=')[1] : null)) : null;
    `);
    console.log(`[tour] Discovered maintenance ticket ID: ${ticketId}`);
    if (ticketId) {
      await navigateAndWait(`http://localhost:8080/maintenance/show?id=${ticketId}`);
      await capture('13_maintenance_detail');
    }

    // 14. Preventative Maintenance Schedules
    await navigateAndWait('http://localhost:8080/maintenance/preventative');
    await capture('14_preventative_maintenance');

    // 15. Accounting Dashboard
    await navigateAndWait('http://localhost:8080/accounting');
    await capture('15_accounting_dashboard');

    // 16. AP Bills Payable Queue
    await navigateAndWait('http://localhost:8080/accounting/bills');
    await capture('16_bills_payable_queue');

    // 17. Open Bill Creation Modal with Multi-Row Allocation Splits
    console.log('[tour] Opening bill creation modal...');
    const modalOpened = await evalScript(`
      (() => {
        const dlg = document.getElementById('new-bill-dialog');
        if (dlg && typeof dlg.showModal === 'function') {
          dlg.showModal();
          return true;
        }
        return false;
      })()
    `);
    if (modalOpened) {
      await sleep(500);
      await capture('17_bill_creation_modal');
      // Capture modal in Dark Mode to verify high contrast and opaque background styling
      await evalScript(`document.documentElement.setAttribute('data-theme', 'dark');`);
      await sleep(400);
      await capture('17b_bill_creation_modal_dark');
      await evalScript(`document.documentElement.setAttribute('data-theme', 'light');`);
      await sleep(200);
      // Close modal
      await evalScript(`
        const dlg = document.getElementById('new-bill-dialog');
        if (dlg) dlg.close();
      `);
      await sleep(300);
    }

    // 18. Check Register & PDF Batch Preview
    await navigateAndWait('http://localhost:8080/accounting/checks');
    await capture('18_check_register');

    // 18b. Check Issuance Modal
    console.log('[tour] Opening check issuance modal...');
    const checkModalOpened = await evalScript(`
      (() => {
        const dlg = document.getElementById('issue-check-dialog');
        if (dlg && typeof dlg.showModal === 'function') {
          dlg.showModal();
          return true;
        }
        return false;
      })()
    `);
    if (checkModalOpened) {
      await sleep(500);
      await capture('18b_check_issuance_modal');
      await evalScript(`
        const dlg = document.getElementById('issue-check-dialog');
        if (dlg) dlg.close();
      `);
      await sleep(300);
    }

    // 19. Bank Deposits & Batch Reconciliation
    await navigateAndWait('http://localhost:8080/accounting/deposits');
    await capture('19_bank_deposits');

    // 20. General Ledger
    await navigateAndWait('http://localhost:8080/accounting/general-ledger');
    await capture('20_general_ledger');

    // 21. Trial Balance
    await navigateAndWait('http://localhost:8080/accounting/trial-balance');
    await capture('21_trial_balance');

    // 22. Rent Roll
    await navigateAndWait('http://localhost:8080/accounting/rent-roll');
    await capture('22_rent_roll');

    // 23. Schedule E Tax Report
    await navigateAndWait('http://localhost:8080/accounting/schedule-e');
    await capture('23_schedule_e');

    // 24. QuickBooks Desktop IIF Sync
    await navigateAndWait('http://localhost:8080/accounting/quickbooks');
    await capture('24_quickbooks_sync');

    // 25. Client Accounting / Owner Reporting
    await navigateAndWait('http://localhost:8080/accounting/client-accounting');
    await capture('25_client_accounting');

    // 26. Admin Panel - Custom Fields Manager
    await navigateAndWait('http://localhost:8080/admin?tab=custom_fields');
    await capture('26_admin_custom_fields');

    // 27. Admin Panel - System Health
    await navigateAndWait('http://localhost:8080/admin?tab=system');
    await capture('27_admin_system_health');

    // 28. Admin Panel - Database Backups
    await navigateAndWait('http://localhost:8080/admin?tab=backups');
    await capture('28_admin_backups');

    cdp.close();
    console.log('[tour] Completed capturing all 28 UI views successfully!');
  } finally {
    try {
      browserProc.kill();
    } catch (_) {}
  }
}

run().catch(err => {
  console.error('[tour] Error during UI tour:', err);
  process.exit(1);
});
