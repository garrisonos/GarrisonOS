import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const screenshotsDir = path.join(rootDir, 'docs', 'assets', 'screenshots');


function isServerRunning(port = 8080) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/login`, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 302);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(port = 8080, maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isServerRunning(port)) return true;
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for server on port ${port}`);
}

/**
 * Discovers the local Chrome or Edge executable.
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
    if (existsSync(c)) return c;
  }
  throw new Error('No supported browser executable found.');
}

function pollForDevToolsEndpoint(port = 9333, maxAttempts = 40) {
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
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', () => {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          reject(new Error('Timed out waiting for DevTools endpoint.'));
        }
      });
    }, 400);
  });
}

function getPageTarget(port = 9333) {
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

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.callbacks = new Map();
    this.events = new Map();

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) {
          reject(new Error(`CDP Error: ${msg.error.message}`));
        } else {
          resolve(msg.result);
        }
      } else if (msg.method && this.events.has(msg.method)) {
        this.events.get(msg.method)(msg.params);
      }
    };
  }

  waitForOpen() {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
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

async function runLiveTour() {
  const cdpPort = 9333;
  const browserPath = findBrowserExecutable();
  const tempUserDataDir = path.join(os.tmpdir(), `garrison-live-${Date.now()}`);
  mkdirSync(tempUserDataDir, { recursive: true });

  let serverProc = null;
  const isUp = await isServerRunning(8080);
  if (!isUp) {
    console.log('[tour] Web server not running on port 8080. Spawning node scripts/serve.js...');
    serverProc = spawn(process.execPath, [path.join(rootDir, 'scripts', 'serve.js')], {
      cwd: rootDir,
      stdio: 'ignore'
    });
    await waitForServer(8080);
    console.log('[tour] Web server is up and listening on port 8080.');
  }

  console.log(`[tour] Launching visible desktop browser from: ${browserPath}`);
  console.log('[tour] You can watch the tour navigate live in the browser window!');

  // Launch VISIBLE browser (no --headless) with window dimensions suitable for viewing
  const browserProc = spawn(browserPath, [
    `--remote-debugging-port=${cdpPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1540,960',
    '--window-position=50,50',
    `--user-data-dir=${tempUserDataDir}`
  ], { stdio: 'ignore' });

  try {
    await pollForDevToolsEndpoint(cdpPort);
    const target = await getPageTarget(cdpPort);
    const cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.waitForOpen();
    console.log('[tour] Connected to live browser session.');
    const tempScreenshotsDir = path.join(os.tmpdir(), `garrison-tour-screenshots-${Date.now()}`);
    mkdirSync(tempScreenshotsDir, { recursive: true });
    const capturedFilenames = [];

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCookies');

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

    const capture = async (name, fullPage = false) => {
      await sleep(700);
      const dateStr = '2026-10-02';
      const filename = `${dateStr}_${name}.png`;
      const filepath = path.join(tempScreenshotsDir, filename);

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
      capturedFilenames.push(filename);
      console.log(`[tour] Screen captured to staging: ${filename}`);
    };

    const navigateAndWait = async (url, pauseMs = 1500) => {
      console.log(`[tour] >>> Navigating to ${url}...`);
      await cdp.send('Page.navigate', { url });
      await sleep(pauseMs);
      const title = await evalScript('document.title');
      console.log(`[tour] Viewed: "${title}"`);
    };

    // 1. Login Page
    await navigateAndWait('http://localhost:8080/login', 1200);
    await capture('01_login_page');

    // 2. Perform Login
    console.log('[tour] Entering operator credentials...');
    await evalScript(`
      (() => {
        const emailInput = document.querySelector('input[name="email"]');
        const passInput = document.querySelector('input[name="password"]');
        const opInput = document.querySelector('input[name="operator_id"]');
        if (emailInput) emailInput.value = 'operator@garrisonos.local';
        if (passInput) passInput.value = 'Password123!';
        if (opInput) opInput.value = 'operator-demo';
        const submitBtn = document.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.click();
        else document.querySelector('form')?.submit();
      })()
    `);
    await sleep(2000);
    await capture('02_dashboard');

    // 2b. Dashboard Occupancy Focus & Filtering
    console.log('[tour] Switching dashboard to Occupancy Focus view...');
    await navigateAndWait('http://localhost:8080/?focus=occupancy', 1500);
    await capture('02b_dashboard_occupancy_focus');

    // Return to main overview
    await navigateAndWait('http://localhost:8080/', 1000);

    // 2c. Universal Entity Preview Modal
    console.log('[tour] Demonstrating Universal Entity Preview Modal on dashboard...');
    await evalScript(`
      const target = document.querySelector('.entity-clickable') || document.querySelector('tbody tr a') || document.querySelector('[data-entity]');
      if (target) target.click();
    `);
    await sleep(1500);
    await capture('02c_entity_preview_modal');
    console.log('[tour] Closing entity preview modal and resuming tour...');
    await evalScript(`
      const dlg = document.querySelector('#universal-entity-preview-modal');
      if (dlg && typeof dlg.close === 'function') dlg.close();
    `);
    await sleep(600);

    // 3. Universal Search live preview dropdown
    console.log('[tour] Live typing in Universal Search bar...');
    await evalScript(`
      const searchInput = document.querySelector('input[name="q"]') || document.querySelector('#header-search-input') || document.querySelector('.search-input');
      if (searchInput) {
        searchInput.focus();
        searchInput.value = 'Magnolia';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `);
    await sleep(1500);
    await capture('03_universal_search_dropdown');

    // 4. Universal Search full page
    await navigateAndWait('http://localhost:8080/search?q=Magnolia', 1500);
    await capture('04_universal_search_full_results');

    // 5. Properties Index
    await navigateAndWait('http://localhost:8080/properties', 1500);
    // Smooth scroll down to showcase the 10 items/page pagination controls
    await evalScript(`window.scrollTo({ top: 400, behavior: 'smooth' });`);
    await sleep(800);
    await capture('05_properties_index');

    // 6. Property Detail View
    const propId = await evalScript(`
      const row = document.querySelector('[data-entity="property"]') || document.querySelector('tbody tr');
      row ? (row.getAttribute('data-id') || (row.querySelector('a[href*="/properties/show"]') ? row.querySelector('a[href*="/properties/show"]').href.split('id=')[1] : null)) : null;
    `);
    if (propId) {
      await navigateAndWait(`http://localhost:8080/properties/show?id=${propId}`, 1500);
      await capture('06_property_detail');
    }

    // 7. Amenities Catalog & Marketing Editor
    await navigateAndWait('http://localhost:8080/properties/amenities', 1500);
    await capture('07_amenities_catalog');

    // 8. Leases Index
    await navigateAndWait('http://localhost:8080/leases', 1500);
    await evalScript(`window.scrollTo({ top: 400, behavior: 'smooth' });`);
    await sleep(800);
    await capture('08_leases_index');

    // 9. Lease Detail View
    const leaseId = await evalScript(`
      const row = document.querySelector('[data-entity="lease"]') || document.querySelector('tbody tr');
      row ? (row.getAttribute('data-id') || (row.querySelector('a[href*="/leases/show"]') ? row.querySelector('a[href*="/leases/show"]').href.split('id=')[1] : null)) : null;
    `);
    if (leaseId) {
      await navigateAndWait(`http://localhost:8080/leases/show?id=${leaseId}`, 1500);
      await capture('09_lease_detail');
    }

    // 10. Contacts Directory
    await navigateAndWait('http://localhost:8080/contacts', 1500);
    await evalScript(`window.scrollTo({ top: 400, behavior: 'smooth' });`);
    await sleep(800);
    await capture('10_contacts_directory');

    // 11. Contact Detail View
    const contactId = await evalScript(`
      const row = document.querySelector('[data-entity="contact"]') || document.querySelector('tbody tr');
      row ? (row.getAttribute('data-id') || (row.querySelector('a[href*="/contacts/show"]') ? row.querySelector('a[href*="/contacts/show"]').href.split('id=')[1] : null)) : null;
    `);
    if (contactId) {
      await navigateAndWait(`http://localhost:8080/contacts/show?id=${contactId}`, 1500);
      await capture('11_contact_detail');
    }

    // 12. Maintenance Work Orders
    await navigateAndWait('http://localhost:8080/maintenance', 1500);
    await evalScript(`window.scrollTo({ top: 400, behavior: 'smooth' });`);
    await sleep(800);
    await capture('12_maintenance_work_orders');

    // 13. Maintenance Detail View
    const ticketId = await evalScript(`
      const row = document.querySelector('[data-entity="work_order"]') || document.querySelector('[data-entity="maintenance"]') || document.querySelector('tbody tr');
      row ? (row.getAttribute('data-id') || (row.querySelector('a[href*="/maintenance/show"]') ? row.querySelector('a[href*="/maintenance/show"]').href.split('id=')[1] : null)) : null;
    `);
    if (ticketId) {
      await navigateAndWait(`http://localhost:8080/maintenance/show?id=${ticketId}`, 1500);
      await capture('13_maintenance_detail');
    }

    // 13b. Maintenance Detail View (Auto-Held Spend Policy Guardrail)
    console.log('[tour] Finding and capturing auto-held maintenance ticket...');
    await navigateAndWait('http://localhost:8080/maintenance', 1200);
    const holdTicketId = await evalScript(`
      (() => {
        const rows = Array.from(document.querySelectorAll('tbody tr'));
        const holdRow = rows.find(r => r.textContent.includes('Chiller') || r.textContent.includes('Hold') || r.textContent.includes('on_hold'));
        if (holdRow) {
          const link = holdRow.querySelector('a[href*="/maintenance/show"]');
          if (link) return link.href.split('id=')[1];
        }
        return null;
      })()
    `);
    if (holdTicketId) {
      await navigateAndWait(`http://localhost:8080/maintenance/show?id=${holdTicketId}`, 1500);
      await capture('13b_maintenance_detail_on_hold');
    }

    // 14. Preventative Maintenance Schedules
    await navigateAndWait('http://localhost:8080/maintenance/preventative', 1500);
    await capture('14_preventative_maintenance');

    // 15. Accounting Dashboard
    await navigateAndWait('http://localhost:8080/accounting', 1500);
    await evalScript(`window.scrollTo({ top: 350, behavior: 'smooth' });`);
    await sleep(800);
    await capture('15_accounting_dashboard');

    // 16. AP Bills Payable Queue
    await navigateAndWait('http://localhost:8080/accounting/bills', 1500);
    await evalScript(`window.scrollTo({ top: 300, behavior: 'smooth' });`);
    await sleep(800);
    await capture('16_bills_payable_queue');

    // 17. Open Bill Creation Modal with Multi-Row Allocation Splits
    console.log('[tour] Opening bill creation modal dialog...');
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
      await sleep(1200);
      await capture('17_bill_creation_modal');

      // Demonstrate high-contrast dark mode dialog
      console.log('[tour] Demonstrating dark mode modal styling and contrast...');
      await evalScript(`document.documentElement.setAttribute('data-theme', 'dark');`);
      await sleep(1500);
      await capture('17b_bill_creation_modal_dark');
      await evalScript(`document.documentElement.setAttribute('data-theme', 'light');`);
      await sleep(800);

      // Close modal
      await evalScript(`
        const dlg = document.getElementById('new-bill-dialog');
        if (dlg) dlg.close();
      `);
      await sleep(500);
    }

    // 18. Check Register & PDF Batch Preview
    await navigateAndWait('http://localhost:8080/accounting/checks', 1500);
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
      await sleep(1200);
      await capture('18b_check_issuance_modal');
      await evalScript(`
        const dlg = document.getElementById('issue-check-dialog');
        if (dlg) dlg.close();
      `);
      await sleep(500);
    }

    // 19. Bank Deposits & Batch Reconciliation
    await navigateAndWait('http://localhost:8080/accounting/deposits', 1500);
    // Click a checkbox to showcase live running deposit total calculation
    console.log('[tour] Selecting receipt to demonstrate live deposit calculator...');
    await evalScript(`
      const box = document.querySelector('.receipt-select-box');
      if (box) {
        box.click();
      }
    `);
    await sleep(1200);
    await capture('19_bank_deposits');

    // 20. General Ledger
    await navigateAndWait('http://localhost:8080/accounting/general-ledger', 1500);
    await capture('20_general_ledger');

    // 21. Trial Balance
    await navigateAndWait('http://localhost:8080/accounting/trial-balance', 1500);
    await capture('21_trial_balance');

    // 22. Rent Roll
    await navigateAndWait('http://localhost:8080/accounting/rent-roll', 1500);
    await evalScript(`window.scrollTo({ top: 350, behavior: 'smooth' });`);
    await sleep(800);
    await capture('22_rent_roll');

    // 23. Schedule E Tax Report
    await navigateAndWait('http://localhost:8080/accounting/schedule-e', 1500);
    await capture('23_schedule_e');

    // 24. QuickBooks Desktop IIF Sync
    await navigateAndWait('http://localhost:8080/accounting/quickbooks', 1500);
    await capture('24_quickbooks_sync');

    // 25. Client Accounting / Owner Reporting
    await navigateAndWait('http://localhost:8080/accounting/client-accounting', 1500);
    await capture('25_client_accounting');

    // 26. Admin Panel - Custom Fields Manager
    await navigateAndWait('http://localhost:8080/admin?tab=custom_fields', 1500);
    await capture('26_admin_custom_fields');

    // 27. Admin Panel - System Health
    await navigateAndWait('http://localhost:8080/admin?tab=system', 1500);
    await capture('27_admin_system_health');

    // 28. Admin Panel - Database Backups
    await navigateAndWait('http://localhost:8080/admin?tab=backups', 1500);
    await capture('28_admin_backups');

    // 29. Admin Panel - Users & Access Control
    await navigateAndWait('http://localhost:8080/admin?tab=users', 1500);
    await capture('29_admin_users_and_permissions');

    // 30. Admin Panel - User Activity Audit Trail
    console.log('[tour] Opening user activity audit trail...');
    const auditLink = await evalScript(`
      (() => {
        const link = document.querySelector('a[href*="audit_user_id"]');
        return link ? link.href : null;
      })()
    `);
    if (auditLink) {
      await navigateAndWait(auditLink, 1500);
      await capture('30_admin_user_activity_audit');
    }

    // 31. Admin Panel - Loaded System Modules
    await navigateAndWait('http://localhost:8080/admin?tab=modules', 1500);
    await capture('31_admin_modules');

    console.log('[tour] Full visual UI tour completed successfully! Promoting staged screenshots...');
    mkdirSync(screenshotsDir, { recursive: true });
    for (const filename of capturedFilenames) {
      const src = path.join(tempScreenshotsDir, filename);
      const dest = path.join(screenshotsDir, filename);
      safeWriteFileSync(dest, readFileSync(src));
      console.log(`[tour] Published: ${filename}`);
    }

    await sleep(3000);
    cdp.close();
  } finally {
    try {
      rmSync(tempScreenshotsDir, { recursive: true, force: true });
    } catch (_) {}
    try {
      browserProc.kill();
    } catch (_) {}
    if (serverProc) {
      try {
        serverProc.kill();
      } catch (_) {}
    }
  }
}

runLiveTour().catch(err => {
  console.error('[tour] Error during live tour:', err);
  process.exit(1);
});
