import { html, raw, SafeHtml } from '../lib/html.js';
import { PageContext, PageResult } from '../lib/page-context.js';
import { getDatabase } from '../../database/client.js';
import { getLoadedModules } from '../../core/module-loader.js';
import { eventBus, DeadLetterFailure } from '../../core/events.js';
import { getRateLimitStats, RateLimitStats } from '../../api/middleware.js';
import { hasPermission, loadOperatorRoleOverrides } from '../../core/rbac.js';
import { BrandingService, THEME_PRESETS, OperatorBranding, ThemePresetKey } from '../../core/branding.js';
import { csrfField, validateCsrf } from '../lib/csrf.js';

/**
 * Telemetry data model compiled for the Admin Management Dashboard.
 */
export interface AdminDashboardData {
  activeTab?: 'telemetry' | 'branding';
  branding?: OperatorBranding;
  csrfToken?: string;
  activeOperatorsCount: number;
  activeUsersCount: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  uptimeSeconds: number;
  nodeVersion: string;
  cpuUsageMs: {
    user: number;
    system: number;
  };
  dbStatus: 'healthy' | 'degraded';
  memoryUsageMb: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
  rateLimitStats: RateLimitStats;
  deadLetterFailures: DeadLetterFailure[];
  failedBackups: Array<{
    id: string;
    filename: string;
    error_message: string;
    created_at: number;
  }>;
  loadedModules: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    dependencies: string[];
    slots?: string[];
  }>;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = (bytes / Math.pow(1024, i)).toFixed(1);
  return `${val} ${units[i]}`;
}

function formatUptime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0s';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function formatTimestamp(epochMs: number): string {
  if (!epochMs || !Number.isFinite(epochMs)) return '—';
  const d = new Date(epochMs);
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

function renderBrandingTab(branding: OperatorBranding, csrfToken: string): SafeHtml {
  const presetKeys = Object.keys(THEME_PRESETS) as ThemePresetKey[];

  const presetCards = presetKeys.map((key) => {
    const p = THEME_PRESETS[key];
    const isSelected = branding.theme_preset === key;

    return html`
      <div class="preset-card ${isSelected ? 'active' : ''}"
           data-preset="${p.id}"
           data-primary="${p.primary}"
           data-hover="${p.primaryHover}"
           data-accent="${p.accent}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 0.9rem;">${p.name}</strong>
          <input type="radio" name="theme_preset" value="${p.id}" ${isSelected ? 'checked' : ''} style="margin: 0;">
        </div>
        <p class="text-muted" style="font-size: 0.75rem; margin: 0.25rem 0 0.5rem; line-height: 1.3;">
          ${p.description}
        </p>
        <div class="preset-swatch">
          <div class="preset-swatch-part" style="background: ${p.primary};" title="Primary: ${p.primary}"></div>
          <div class="preset-swatch-part" style="background: ${p.primaryHover};" title="Hover: ${p.primaryHover}"></div>
          <div class="preset-swatch-part" style="background: ${p.accent};" title="Accent: ${p.accent}"></div>
        </div>
      </div>
    `;
  });

  return html`
    <form method="POST" action="/admin?tab=branding">
      ${csrfField(csrfToken)}
      <input type="hidden" name="action" value="update_branding">

      <!-- Identity & Logos -->
      <div class="card">
        <div class="card-header">
          <h2 class="card-title" style="margin: 0;">Organization & Brand Identity</h2>
          <small class="text-muted">Customize logos, company name, and icons displayed across navigation headers and portal shells</small>
        </div>
        <div class="card-body">
          <div class="form-row">
            <div class="col-6">
              <div class="form-group">
                <label class="form-label">Brand Name *</label>
                <input type="text" name="brand_name" class="form-input" value="${branding.brand_name}" required placeholder="e.g. Apex Property Trust">
              </div>
            </div>
            <div class="col-6">
              <div class="form-group">
                <label class="form-label">Tagline / Subtitle</label>
                <input type="text" name="tagline" class="form-input" value="${branding.tagline || ''}" placeholder="e.g. Commercial & Residential Real Estate">
              </div>
            </div>
          </div>

          <div class="form-row">
            <div class="col-6">
              <div class="form-group">
                <label class="form-label">Company Logo Image URL</label>
                <input type="url" name="logo_url" class="form-input" value="${branding.logo_url || ''}" placeholder="https://example.com/logo.png">
                <small class="text-muted">Replaces the default text monogram in the sidebar navigation header.</small>
              </div>
            </div>
            <div class="col-6">
              <div class="form-group">
                <label class="form-label">Browser Favicon URL</label>
                <input type="url" name="favicon_url" class="form-input" value="${branding.favicon_url || ''}" placeholder="https://example.com/favicon.ico">
                <small class="text-muted">Custom shortcut icon displayed in browser tabs.</small>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Color Palette & Themes -->
      <div class="card">
        <div class="card-header">
          <h2 class="card-title" style="margin: 0;">Institutional Color Palette & Presets</h2>
          <small class="text-muted">Select an institutional financial palette or specify custom brand hex codes</small>
        </div>
        <div class="card-body">
          <label class="form-label" style="margin-bottom: 0.75rem;">Theme Presets</label>
          <div class="theme-presets-grid">
            ${presetCards}
          </div>

          <div style="border-top: 1px solid var(--border-color); padding-top: 1.5rem; margin-top: 1.5rem;">
            <label class="form-label" style="margin-bottom: 0.75rem;">Custom Color Picker</label>
            <div class="form-row">
              <div class="col-4">
                <div class="form-group">
                  <label class="form-label">Primary Color</label>
                  <div class="color-picker-row">
                    <input type="color" id="primary_color" name="primary_color" value="${branding.primary_color}" class="color-picker-input">
                    <span class="font-mono text-muted" style="font-size: 0.85rem;">Main buttons & active accents</span>
                  </div>
                </div>
              </div>
              <div class="col-4">
                <div class="form-group">
                  <label class="form-label">Primary Hover Shade</label>
                  <div class="color-picker-row">
                    <input type="color" id="primary_hover" name="primary_hover" value="${branding.primary_hover}" class="color-picker-input">
                    <span class="font-mono text-muted" style="font-size: 0.85rem;">Interaction state shade</span>
                  </div>
                </div>
              </div>
              <div class="col-4">
                <div class="form-group">
                  <label class="form-label">Accent Highlight</label>
                  <div class="color-picker-row">
                    <input type="color" id="accent_color" name="accent_color" value="${branding.accent_color}" class="color-picker-input">
                    <span class="font-mono text-muted" style="font-size: 0.85rem;">Focus rings & notifications</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style="border-top: 1px solid var(--border-color); padding-top: 1.25rem; margin-top: 1.25rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-weight: 600;">
              <input type="checkbox" name="default_dark_mode" value="1" ${branding.default_dark_mode ? 'checked' : ''}>
              <span>🌙 Enable Dark Mode as default theme for new users</span>
            </label>
            <small class="text-muted" style="display: block; margin-top: 0.25rem;">
              Users can toggle between Light and Dark mode at any time using the header toggle or Alt+D shortcut.
            </small>
          </div>
        </div>
        <div class="card-footer" style="padding: 1rem 1.5rem; background: var(--bg-subtle); display: flex; justify-content: flex-end;">
          <button type="submit" class="btn btn-primary">Save Branding & Appearance</button>
        </div>
      </div>
    </form>
  `;
}

export function renderAdminPage(data: AdminDashboardData): SafeHtml {
  const quotaPercentage = data.storageQuotaBytes > 0
    ? Math.min(100, Math.round((data.storageUsedBytes / data.storageQuotaBytes) * 100))
    : 0;

  const moduleCards = data.loadedModules.map((mod) => html`
    <div class="card" style="margin-bottom: 1rem;">
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
        <h3 class="card-title" style="margin: 0; font-size: 1.1rem;">${mod.name}</h3>
        <span class="badge" style="background: #e2e8f0; color: #334155; font-family: monospace;">v${mod.version}</span>
      </div>
      <p class="text-muted" style="margin: 0.5rem 0; font-size: 0.9rem;">${mod.description}</p>
      <div style="font-size: 0.8rem; color: #64748b;">
        <strong>ID:</strong> <code>${mod.id}</code>
        ${mod.dependencies && mod.dependencies.length > 0
          ? html` | <strong>Dependencies:</strong> ${mod.dependencies.join(', ')}`
          : raw('')}
      </div>
    </div>
  `);

  const errorRows = data.deadLetterFailures.map((failure) => html`
    <tr>
      <td>${formatTimestamp(failure.timestamp)}</td>
      <td><span class="badge" style="background: #fee2e2; color: #991b1b;">${failure.event}</span></td>
      <td>
        <div style="font-weight: 600; color: #dc2626;">${failure.error}</div>
        ${failure.stack ? html`<pre style="font-size: 0.75rem; margin-top: 0.25rem; max-height: 80px; overflow-y: auto; background: var(--bg-subtle); padding: 0.25rem;">${failure.stack}</pre>` : raw('')}
      </td>
      <td style="font-family: monospace; font-size: 0.8rem;">${failure.operatorId || 'system'}</td>
    </tr>
  `);

  const backupRows = data.failedBackups.map((backup) => html`
    <tr>
      <td>${formatTimestamp(backup.created_at)}</td>
      <td><span class="badge" style="background: #fee2e2; color: #991b1b;">Failed Snapshot</span></td>
      <td>
        <div style="font-weight: 600; color: #dc2626;">${backup.error_message || 'Snapshot error'}</div>
        <div style="font-size: 0.75rem; color: #64748b;">${backup.filename}</div>
      </td>
      <td style="font-family: monospace; font-size: 0.8rem;">system</td>
    </tr>
  `);

  const rateLimitEvents = data.rateLimitStats.recentEvents.map((evt) => html`
    <tr>
      <td>${formatTimestamp(evt.timestamp)}</td>
      <td><code>${evt.key}</code></td>
      <td>${evt.path || '/'}</td>
      <td>${evt.ip || '127.0.0.1'}</td>
    </tr>
  `);

  const activeTab = data.activeTab || 'telemetry';
  const branding = data.branding || BrandingService.getBranding('operator-demo');
  const csrfToken = data.csrfToken || '';

  return html`
    <div class="admin-dashboard-container" style="max-width: 1200px; margin: 0 auto; padding-bottom: 3rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <div>
          <h1 style="margin: 0; font-size: 1.75rem; font-weight: 700;">System Administration & Governance</h1>
          <p class="text-muted" style="margin: 0.25rem 0 0 0;">Platform health, resource utilization telemetry, and brand appearance.</p>
        </div>
        <div>
          <span class="badge" style="background: ${data.dbStatus === 'degraded' ? '#fee2e2' : '#dcfce7'}; color: ${data.dbStatus === 'degraded' ? '#991b1b' : '#166534'}; font-size: 0.9rem; padding: 0.4rem 0.8rem;">
            ● Engine Online (${data.nodeVersion}) ${data.dbStatus === 'degraded' ? '| DB Degraded' : ''}
          </span>
        </div>
      </div>

      <!-- Admin Section Tabs -->
      <div class="tabs-bar">
        <a href="/admin?tab=telemetry" class="tab-link ${activeTab !== 'branding' ? 'active' : ''}">
          📊 Telemetry & System Health
        </a>
        <a href="/admin?tab=branding" class="tab-link ${activeTab === 'branding' ? 'active' : ''}">
          🎨 Branding & Appearance
        </a>
      </div>

      ${activeTab === 'branding'
        ? renderBrandingTab(branding, csrfToken)
        : html`
            <!-- Overview Metric Cards -->
            <div class="metrics-grid">
              <div class="kpi-card">
                <div class="kpi-header">
                  <span class="kpi-title">Active Operators</span>
                  <span class="kpi-icon">🏢</span>
                </div>
                <div class="kpi-value font-bold" style="color: #0284c7;">${String(data.activeOperatorsCount)}</div>
                <div class="kpi-trend neutral">${String(data.activeUsersCount)} active users</div>
              </div>

              <div class="kpi-card">
                <div class="kpi-header">
                  <span class="kpi-title">Storage Consumption</span>
                  <span class="kpi-icon">💾</span>
                </div>
                <div class="kpi-value font-bold" style="color: #059669;">${formatBytes(data.storageUsedBytes)}</div>
                <div class="kpi-trend neutral">${String(quotaPercentage)}% of ${formatBytes(data.storageQuotaBytes)} allocated</div>
              </div>

              <div class="kpi-card">
                <div class="kpi-header">
                  <span class="kpi-title">System Uptime & CPU</span>
                  <span class="kpi-icon">⚡</span>
                </div>
                <div class="kpi-value font-bold" style="color: #7c3aed;">${formatUptime(data.uptimeSeconds)}</div>
                <div class="kpi-trend neutral">CPU: ${String(data.cpuUsageMs.user + data.cpuUsageMs.system)}ms | RSS: ${String(data.memoryUsageMb.rss)} MB</div>
              </div>

              <div class="kpi-card">
                <div class="kpi-header">
                  <span class="kpi-title">Rate Limiter Activity</span>
                  <span class="kpi-icon">🛡️</span>
                </div>
                <div class="kpi-value font-bold" style="color: #d97706;">${String(data.rateLimitStats.totalBlocks)}</div>
                <div class="kpi-trend neutral">${String(data.rateLimitStats.activeBuckets)} active windows</div>
              </div>
            </div>

            <!-- Diagnostic & Error Logs -->
            <div class="card" style="margin-bottom: 2rem;">
              <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h2 class="card-title" style="margin: 0; font-size: 1.25rem;">System Error & Dead-Letter Log</h2>
                <span class="badge" style="background: var(--bg-subtle); color: var(--text-muted);">
                  ${String(data.deadLetterFailures.length + data.failedBackups.length)} logged event(s)
                </span>
              </div>
              <div class="table-responsive">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="width: 180px;">Timestamp (UTC)</th>
                      <th style="width: 160px;">Event / Action</th>
                      <th>Error Details</th>
                      <th style="width: 140px;">Operator</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${data.deadLetterFailures.length === 0 && data.failedBackups.length === 0
                      ? html`<tr><td colspan="4" class="text-center text-muted" style="padding: 2rem;">No system errors or dead-letter events recorded. Everything running smoothly!</td></tr>`
                      : raw('')}
                    ${errorRows}
                    ${backupRows}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Rate Limiting Events -->
            <div class="card" style="margin-bottom: 2rem;">
              <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h2 class="card-title" style="margin: 0; font-size: 1.25rem;">Recent Security & Rate-Limit Events</h2>
                <span class="badge" style="background: var(--bg-subtle); color: var(--text-muted);">
                  ${String(data.rateLimitStats.recentEvents.length)} event(s)
                </span>
              </div>
              <div class="table-responsive">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="width: 180px;">Timestamp (UTC)</th>
                      <th>Bucket Key</th>
                      <th>Request Path</th>
                      <th>IP Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${data.rateLimitStats.recentEvents.length === 0
                      ? html`<tr><td colspan="4" class="text-center text-muted" style="padding: 2rem;">No rate limit violations detected in current memory cycle.</td></tr>`
                      : rateLimitEvents}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Dynamically Loaded Modules -->
            <div class="card">
              <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h2 class="card-title" style="margin: 0; font-size: 1.25rem;">Dynamic Module Inspector</h2>
                <span class="badge" style="background: #e0f2fe; color: #0369a1;">
                  ${String(data.loadedModules.length)} modules loaded
                </span>
              </div>
              <div class="card-body">
                <div class="modules-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
                  ${moduleCards}
                </div>
              </div>
            </div>
          `}
    </div>
  `;
}

/**
 * Web front-controller handler for the /admin dashboard route.
 */
export async function handle(ctx: PageContext): Promise<PageResult> {
  const db = getDatabase();
  const userRole = ctx.session.user?.role || '';
  const operatorId = ctx.session.user?.operator_id || ctx.session.operatorId || 'operator-demo';
  const overrides = operatorId ? loadOperatorRoleOverrides(operatorId, db) : undefined;
  const isAuthorized = hasPermission(userRole, 'system:admin', overrides);

  if (!isAuthorized) {
    return {
      title: '403 Forbidden',
      status: 403,
      content: html`
        <div class="card" style="text-align: center; padding: 4rem 2rem; max-width: 600px; margin: 2rem auto;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🛡️</div>
          <h2 style="margin-bottom: 0.5rem; color: #dc2626;">403 Forbidden</h2>
          <p class="text-muted" style="margin-bottom: 1.5rem; line-height: 1.6;">
            Access to the Platform Administration & Governance dashboard requires the <strong>owner</strong> system role or <code>system:admin</code> administrative permission.
          </p>
          <div>
            <a href="/dashboard" class="btn btn-primary">Return to Dashboard</a>
          </div>
        </div>
      `
    };
  }

  // Handle POST actions (such as update_branding)
  if (ctx.method === 'POST') {
    if (!validateCsrf(ctx.session.getCsrfToken(), ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF token validation failed.</div>`
      };
    }

    if (ctx.body['action'] === 'update_branding') {
      try {
        BrandingService.updateBranding(operatorId, {
          brand_name: ctx.body['brand_name'],
          tagline: ctx.body['tagline'],
          logo_url: ctx.body['logo_url'],
          favicon_url: ctx.body['favicon_url'],
          theme_preset: ctx.body['theme_preset'],
          primary_color: ctx.body['primary_color'],
          primary_hover: ctx.body['primary_hover'],
          accent_color: ctx.body['accent_color'],
          default_dark_mode: ctx.body['default_dark_mode'] === '1' ? 1 : 0
        }, db);
        ctx.session.addFlash('success', 'Branding, visual identity, and theme preferences saved.');
        return { redirect: '/admin?tab=branding', content: '' };
      } catch (err: any) {
        ctx.session.addFlash('error', `Failed to update branding: ${err.message}`);
        return { redirect: '/admin?tab=branding', content: '' };
      }
    }
  }

  const activeTab = ctx.query['tab'] === 'branding' ? 'branding' : 'telemetry';
  const branding = BrandingService.getBranding(operatorId, db);

  let dbStatus: 'healthy' | 'degraded' = 'healthy';

  // 1. Operator and User counts
  let activeOperatorsCount = 0;
  let activeUsersCount = 0;
  let storageQuotaBytes = 0;
  try {
    const opRow = db.prepare(
      'SELECT COUNT(*) as cnt, COALESCE(SUM(storage_quota_bytes), 0) as quota FROM operators WHERE deleted_at IS NULL'
    ).get() as { cnt: number; quota: number };
    activeOperatorsCount = opRow ? opRow.cnt : 0;
    storageQuotaBytes = opRow ? opRow.quota : 0;

    const userRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM users WHERE deleted_at IS NULL'
    ).get() as { cnt: number };
    activeUsersCount = userRow ? userRow.cnt : 0;
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (!msg.includes('no such table')) {
      dbStatus = 'degraded';
    }
  }

  // 2. Storage used by attachments
  let storageUsedBytes = 0;
  try {
    const attachRow = db.prepare(
      'SELECT COALESCE(SUM(file_size_bytes), 0) as total FROM attachments WHERE deleted_at IS NULL'
    ).get() as { total: number };
    storageUsedBytes = attachRow ? attachRow.total : 0;
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (!msg.includes('no such table')) {
      dbStatus = 'degraded';
    }
  }

  // 3. Failed backups
  let failedBackups: any[] = [];
  try {
    failedBackups = db.prepare(`
      SELECT id, filename, error_message, created_at
      FROM backups
      WHERE status = 'failed'
      ORDER BY created_at DESC
      LIMIT 10
    `).all() as any[];
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (!msg.includes('no such table')) {
      dbStatus = 'degraded';
    }
  }

  // 4. Memory, CPU & Uptime
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const uptimeSeconds = Math.floor(process.uptime());
  const cpuUsageMs = {
    user: Math.round(cpu.user / 1000),
    system: Math.round(cpu.system / 1000)
  };

  // 5. Rate limit telemetry
  const rateLimitStats = getRateLimitStats();

  // 6. Dead-letter failure log
  const deadLetterFailures = eventBus.getDeadLetterFailures();

  // 7. Loaded modules
  const loadedModules = getLoadedModules().map((m) => ({
    id: m.manifest.id,
    name: m.manifest.name,
    version: m.manifest.version,
    description: m.manifest.description,
    dependencies: m.manifest.dependencies || [],
    slots: m.manifest.slots || []
  }));

  const content = renderAdminPage({
    activeTab,
    branding,
    csrfToken: ctx.session.getCsrfToken(),
    activeOperatorsCount,
    activeUsersCount,
    storageUsedBytes,
    storageQuotaBytes,
    uptimeSeconds,
    nodeVersion: process.version,
    cpuUsageMs,
    dbStatus,
    memoryUsageMb: {
      rss: Math.round(mem.rss / (1024 * 1024)),
      heapTotal: Math.round(mem.heapTotal / (1024 * 1024)),
      heapUsed: Math.round(mem.heapUsed / (1024 * 1024))
    },
    rateLimitStats,
    deadLetterFailures,
    failedBackups,
    loadedModules
  });

  return {
    title: 'Platform Administration',
    content
  };
}
