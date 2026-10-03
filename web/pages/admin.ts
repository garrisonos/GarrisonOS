import { html, raw, SafeHtml } from '../lib/html.js';
import { PageContext, PageResult } from '../lib/page-context.js';
import { getDatabase } from '../../database/client.js';
import { getLoadedModules } from '../../core/module-loader.js';
import { eventBus, DeadLetterFailure } from '../../core/events.js';
import { getRateLimitStats, RateLimitStats } from '../../api/middleware.js';
import { hasPermission, loadOperatorRoleOverrides } from '../../core/rbac.js';
import { BrandingService, THEME_PRESETS, OperatorBranding, ThemePresetKey } from '../../core/branding.js';
import {
  CustomFieldsService,
  CustomFieldSectionRecord,
  CustomFieldDefinitionRecord,
  CustomFieldEntityType,
  CustomFieldDataType
} from '../../core/custom-fields.js';
import { csrfField, validateCsrf } from '../lib/csrf.js';

/**
 * Telemetry data model compiled for the Admin Management Dashboard.
 */
export interface AdminDashboardData {
  activeTab?: 'telemetry' | 'branding' | 'custom_fields' | 'backups' | 'modules' | 'users';
  branding?: OperatorBranding;
  customFieldSections?: CustomFieldSectionRecord[];
  customFieldDefinitions?: CustomFieldDefinitionRecord[];
  allBackups?: Array<{
    id: string;
    filename: string;
    size_bytes: number;
    sha256_checksum: string;
    status: string;
    created_at: number;
  }>;
  usersList?: Array<{
    id: string;
    operator_id: string;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    is_system_user: number;
    allowed_portfolios?: string[];
    allowed_modules?: string[];
    created_at: number;
    updated_at: number;
  }>;
  allPortfolios?: Array<{ id: string; name: string }>;
  auditedUser?: {
    user: { id: string; email: string; first_name: string; last_name: string; role: string };
    activity: Array<{
      id: string;
      operator_id: string;
      user_id: string;
      entity_type: string;
      entity_id: string;
      action: string;
      changes: any;
      ip_address: string;
      created_at: number;
    }>;
    total: number;
  } | null;
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

function renderCustomFieldsTab(
  sections: CustomFieldSectionRecord[],
  definitions: CustomFieldDefinitionRecord[],
  csrfToken: string
): SafeHtml {
  const entityTypes: Array<{ id: CustomFieldEntityType; label: string; icon: string }> = [
    { id: 'property', label: 'Properties', icon: '🏢' },
    { id: 'unit', label: 'Units', icon: '🚪' },
    { id: 'lease', label: 'Leases', icon: '📝' },
    { id: 'contact', label: 'Contacts', icon: '👥' },
    { id: 'work_order', label: 'Work Orders', icon: '🔧' },
    { id: 'bill', label: 'Bills & AP', icon: '🧾' }
  ];

  return html`
    <div class="row g-4 mb-4">
      <!-- Create Section Card -->
      <div class="col-md-5">
        <div class="card shadow-sm">
          <div class="card-header bg-light">
            <h2 class="card-title h6 mb-0">Create Custom Section</h2>
            <small class="text-muted">Group fields into categorized cards on entity view pages</small>
          </div>
          <div class="card-body">
            <form method="POST" action="/admin?tab=custom_fields">
              ${csrfField(csrfToken)}
              <input type="hidden" name="action" value="create_custom_section">

              <div class="mb-3">
                <label class="form-label fw-bold">Target Entity *</label>
                <select name="entity_type" class="form-select" required>
                  ${entityTypes.map((e) => html`<option value="${e.id}">${e.icon} ${e.label}</option>`)}
                </select>
              </div>

              <div class="mb-3">
                <label class="form-label fw-bold">Section Title *</label>
                <input type="text" name="title" class="form-control" placeholder="e.g. Utility Meters or Compliance" required>
              </div>

              <div class="mb-3">
                <label class="form-label fw-bold">Display Order</label>
                <input type="number" name="sort_order" class="form-control" value="0">
              </div>

              <button type="submit" class="btn btn-outline-primary w-100" id="btn-create-section">
                ➕ Create Section
              </button>
            </form>
          </div>
        </div>
      </div>

      <!-- Create Field Definition Card -->
      <div class="col-md-7">
        <div class="card shadow-sm">
          <div class="card-header bg-light">
            <h2 class="card-title h6 mb-0">Define Custom Field</h2>
            <small class="text-muted">Add typed attributes to schemas with validation & search indexing</small>
          </div>
          <div class="card-body">
            <form method="POST" action="/admin?tab=custom_fields">
              ${csrfField(csrfToken)}
              <input type="hidden" name="action" value="create_custom_definition">

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label fw-bold">Target Entity *</label>
                  <select name="entity_type" class="form-select" id="def_entity_type" required>
                    ${entityTypes.map((e) => html`<option value="${e.id}">${e.icon} ${e.label}</option>`)}
                  </select>
                </div>
                <div class="col-6">
                  <label class="form-label fw-bold">Section Card</label>
                  <select name="section_id" class="form-select">
                    <option value="">-- No Section (Default) --</option>
                    ${sections.map((s) => html`<option value="${s.id}">[${s.entity_type}] ${s.title}</option>`)}
                  </select>
                </div>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label fw-bold">Display Label *</label>
                  <input type="text" name="field_label" class="form-control" placeholder="e.g. Electric Meter ID" required>
                </div>
                <div class="col-6">
                  <label class="form-label fw-bold">Field Key (Machine Name)</label>
                  <input type="text" name="field_name" class="form-control" placeholder="e.g. electric_meter_id (auto if empty)">
                </div>
              </div>

              <div class="row g-2 mb-3">
                <div class="col-6">
                  <label class="form-label fw-bold">Data Type *</label>
                  <select name="data_type" class="form-select" required>
                    <option value="string">Text String</option>
                    <option value="number">Numeric (Float/Int)</option>
                    <option value="currency">Currency ($ Cents)</option>
                    <option value="date">Calendar Date</option>
                    <option value="boolean">Checkbox (Yes/No)</option>
                    <option value="select">Dropdown Select List</option>
                  </select>
                </div>
                <div class="col-6">
                  <label class="form-label fw-bold">Default Value</label>
                  <input type="text" name="default_value" class="form-control" placeholder="Optional fallback">
                </div>
              </div>

              <div class="mb-3">
                <label class="form-label fw-bold">Dropdown Options (Comma-separated, for Select)</label>
                <input type="text" name="options" class="form-control" placeholder="e.g. Option A, Option B, Option C">
              </div>

              <div class="d-flex justify-content-between align-items-center mb-3">
                <div class="form-check">
                  <input type="checkbox" name="is_required" value="1" id="def_is_required" class="form-check-input">
                  <label class="form-check-label fw-semibold" for="def_is_required">Mandatory Required Field</label>
                </div>
                <div style="width: 120px;">
                  <input type="number" name="sort_order" class="form-control" placeholder="Sort order" value="0">
                </div>
              </div>

              <button type="submit" class="btn btn-primary w-100" id="btn-create-definition">
                Save Custom Field Definition
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>

    <!-- Active Schema Definitions Table -->
    <div class="card shadow-sm">
      <div class="card-header bg-light d-flex justify-content-between align-items-center">
        <h2 class="card-title h6 mb-0">Active Custom Field Definitions (${String(definitions.length)})</h2>
        <span class="badge bg-secondary">${String(sections.length)} section cards configured</span>
      </div>
      <div class="table-responsive">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Entity</th>
              <th>Section</th>
              <th>Label & Key</th>
              <th>Type</th>
              <th>Required</th>
              <th>Options / Default</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${definitions.length === 0 ? html`
              <tr>
                <td colspan="7" class="text-center py-4 text-muted">
                  No custom field definitions created yet. Use the form above to add customized attributes to any entity.
                </td>
              </tr>
            ` : definitions.map((d) => html`
              <tr data-definition-id="${d.id}" data-entity-type="${d.entity_type}">
                <td>
                  <span class="badge bg-light text-dark border text-uppercase">${d.entity_type}</span>
                </td>
                <td>
                  <span class="text-muted">${d.section_title || '—'}</span>
                </td>
                <td>
                  <strong>${d.field_label}</strong>
                  <div class="small text-muted font-mono"><code>${d.field_name}</code></div>
                </td>
                <td>
                  <span class="badge bg-info text-dark">${d.data_type}</span>
                </td>
                <td>
                  ${d.is_required ? html`<span class="badge bg-danger">Required</span>` : html`<span class="text-muted small">Optional</span>`}
                </td>
                <td class="small text-muted">
                  ${d.options && d.options.length > 0 ? html`Options: ${d.options.join(', ')}` : d.default_value ? html`Default: ${d.default_value}` : '—'}
                </td>
                <td class="text-end">
                  <form method="POST" action="/admin?tab=custom_fields" class="d-inline" onsubmit="return confirm('Are you sure you want to delete this custom field definition? Existing values will be retained in history.');">
                    ${csrfField(csrfToken)}
                    <input type="hidden" name="action" value="delete_custom_definition">
                    <input type="hidden" name="definition_id" value="${d.id}">
                    <button type="submit" class="btn btn-sm btn-outline-danger">🗑️</button>
                  </form>
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Render database backups and disaster recovery tab.
 *
 * @param backups Array of backup snapshot records.
 * @param csrfToken Cryptographic CSRF token.
 * @returns SafeHtml content for backups tab.
 */
function renderBackupsTab(backups: any[], csrfToken: string): SafeHtml {
  const completedBackups = backups.filter((b) => b.status === 'completed');
  const totalSizeBytes = backups.reduce((sum, b) => sum + (b.size_bytes || 0), 0);

  return html`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
      <div>
        <h2 style="margin: 0; font-size: 1.25rem; font-weight: 700;">Database Backups & Disaster Recovery</h2>
        <p class="text-muted" style="margin: 0.25rem 0 0 0;">Automated point-in-time SQLite snapshots with SHA-256 cryptographic verification.</p>
      </div>
      <div>
        <a href="/backups" class="btn btn-primary">+ Create Snapshot</a>
      </div>
    </div>

    <!-- Backup Metrics -->
    <div class="metrics-grid" style="margin-bottom: 2rem;">
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Total Backups</span>
          <span class="kpi-icon">💾</span>
        </div>
        <div class="kpi-value font-bold" style="color: var(--primary);">${String(backups.length)}</div>
        <div class="kpi-trend neutral">${String(completedBackups.length)} verified completed</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Backup Storage</span>
          <span class="kpi-icon">📦</span>
        </div>
        <div class="kpi-value font-bold" style="color: #059669;">${formatBytes(totalSizeBytes)}</div>
        <div class="kpi-trend neutral">Compressed gzip archives</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Backup Cadence</span>
          <span class="kpi-icon">⏱️</span>
        </div>
        <div class="kpi-value font-bold" style="color: #7c3aed;">Every 24h</div>
        <div class="kpi-trend neutral">Retention policy: 30 days</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Scheduler Status</span>
          <span class="kpi-icon">⚡</span>
        </div>
        <div class="kpi-value font-bold" style="color: #16a34a;">Online</div>
        <div class="kpi-trend neutral">Background WAL checkpoint active</div>
      </div>
    </div>

    <!-- Backups Table -->
    <div class="card" style="padding: 0; overflow-x: auto;">
      <table class="table" style="margin-bottom: 0;">
        <thead>
          <tr>
            <th>Date & Time</th>
            <th>Archive Filename</th>
            <th>Size</th>
            <th>SHA-256 Checksum</th>
            <th>Status</th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${backups.length > 0
            ? backups.map((b) => html`
                <tr>
                  <td>${formatTimestamp(b.created_at)}</td>
                  <td style="font-weight: 600; font-family: var(--font-mono);">${b.filename}</td>
                  <td>${formatBytes(b.size_bytes)}</td>
                  <td style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted);">
                    ${b.sha256_checksum ? b.sha256_checksum.slice(0, 16) + '...' : '—'}
                    ${b.sha256_checksum
                      ? html`
                          <button
                            type="button"
                            class="btn-copy-id"
                            data-action="copy-id"
                            data-target-id="${b.sha256_checksum}"
                            title="Copy SHA-256 Checksum"
                            style="background: none; border: none; cursor: pointer; opacity: 0.6; padding: 0 4px;"
                          >
                            📋
                          </button>
                        `
                      : raw('')}
                  </td>
                  <td>
                    <span class="badge ${b.status === 'completed' ? 'badge-success' : 'badge-danger'}">
                      ${b.status.toUpperCase()}
                    </span>
                  </td>
                  <td style="text-align: right; white-space: nowrap;">
                    <a href="/api/v1/backups/${encodeURIComponent(b.id)}/download" class="btn btn-sm btn-secondary" style="padding: 0.25rem 0.6rem;">
                      ⬇️ Download
                    </a>
                  </td>
                </tr>
              `)
            : html`
                <tr>
                  <td colspan="6" class="text-center text-muted" style="padding: 2.5rem;">
                    No database snapshots recorded yet.
                  </td>
                </tr>
              `}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Render loaded system modules tab.
 *
 * @param modules Array of registered module metadata.
 * @returns SafeHtml content for modules tab.
 */
function renderModulesTab(modules: any[]): SafeHtml {
  return html`
    <div style="margin-bottom: 1.5rem;">
      <h2 style="margin: 0; font-size: 1.25rem; font-weight: 700;">Loaded Modules & System Extensions</h2>
      <p class="text-muted" style="margin: 0.25rem 0 0 0;">Zero-dependency modular domain architecture with decoupled event messaging.</p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem;">
      ${modules.map((m) => html`
        <div class="card" style="padding: 1.25rem; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
              <h3 style="margin: 0; font-size: 1.1rem; font-weight: 700;">${m.name}</h3>
              <span class="badge badge-primary">v${m.version}</span>
            </div>
            <p class="text-muted" style="font-size: 0.85rem; margin-bottom: 1rem;">${m.description || 'Core domain capability module.'}</p>
          </div>
          <div style="border-top: 1px solid var(--border-color); padding-top: 0.75rem; font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.35rem;">
            <div>
              <span class="text-muted">Module ID:</span> <code class="font-mono">${m.id}</code>
            </div>
            <div>
              <span class="text-muted">Dependencies:</span>
              ${m.dependencies.length > 0
                ? m.dependencies.map((d: string) => html`<span class="badge badge-secondary" style="margin-right: 0.25rem;">${d}</span>`)
                : html`<span class="text-muted">None (Standalone)</span>`}
            </div>
            <div>
              <span class="text-muted">Extension Slots:</span>
              ${m.slots && m.slots.length > 0
                ? m.slots.map((s: string) => html`<span class="badge badge-subtle" style="margin-right: 0.25rem;">${s}</span>`)
                : html`<span class="text-muted">None</span>`}
            </div>
          </div>
        </div>
      `)}
    </div>
  `;
}

/**
 * Render User Directory & Permissions Governance tab with Audit Activity trail.
 *
 * @param users - Operator user list.
 * @param allPortfolios - Available property portfolios for scoping.
 * @param auditedUser - Target user audit records if active.
 * @param csrfToken - Active CSRF token.
 * @returns SafeHtml content for Users tab.
 */
function renderUsersTab(
  users: any[],
  allPortfolios: Array<{ id: string; name: string }>,
  auditedUser: any,
  csrfToken: string
): SafeHtml {
  const availableModules = [
    { id: 'properties', label: 'Properties & Units' },
    { id: 'leases', label: 'Leases & Tenancy' },
    { id: 'maintenance', label: 'Work Orders & Repairs' },
    { id: 'accounting', label: 'Accounts & Ledgers' },
    { id: 'contacts', label: 'Contacts & Vendors' },
    { id: 'backup', label: 'Backups & Snapshots' }
  ];

  return html`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 0.75rem;">
      <div>
        <h2 style="margin: 0; font-size: 1.25rem; font-weight: 700;">Team Members & Access Governance</h2>
        <p class="text-muted" style="margin: 0.25rem 0 0 0;">Manage operator users, role permissions, portfolio access, and audit chronological activity trails.</p>
      </div>
      <div>
        <button type="button" class="btn btn-primary" onclick="document.getElementById('createUserModal').showModal()">
          ➕ Add Team Member
        </button>
      </div>
    </div>

    ${auditedUser ? html`
      <!-- Activity Audit Trail Panel -->
      <div class="card" style="margin-bottom: 2rem; border-left: 4px solid var(--primary, #0284c7); background: var(--bg-surface-raised, rgba(0,0,0,0.01));">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <span class="badge badge-primary" style="margin-right: 0.5rem;">AUDIT TRAIL</span>
            <strong style="font-size: 1.1rem;">${auditedUser.user.first_name} ${auditedUser.user.last_name}</strong>
            <span class="text-muted" style="margin-left: 0.4rem;">(${auditedUser.user.email})</span>
            <span class="badge badge-secondary" style="margin-left: 0.5rem; text-transform: uppercase;">${auditedUser.user.role}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span class="text-muted" style="font-size: 0.85rem;">${auditedUser.total} recorded event(s)</span>
            <a href="/admin?tab=users" class="btn btn-sm btn-secondary" style="padding: 0.25rem 0.6rem;">✕ Close Audit View</a>
          </div>
        </div>

        <div class="table-responsive" style="max-height: 450px; overflow-y: auto;">
          <table class="data-table" style="font-size: 0.85rem; margin-bottom: 0;">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Entity Type</th>
                <th>Entity ID</th>
                <th>Change Details / Summary</th>
                <th>IP Address</th>
              </tr>
            </thead>
            <tbody>
              ${auditedUser.activity.length > 0
                ? auditedUser.activity.map((l: any) => {
                    const actionClass = l.action === 'create' ? 'badge-success' : l.action === 'delete' ? 'badge-danger' : l.action === 'update' ? 'badge-primary' : 'badge-secondary';
                    const detailsStr = l.changes ? JSON.stringify(l.changes) : '—';
                    return html`
                      <tr>
                        <td style="white-space: nowrap;">${formatTimestamp(l.created_at)}</td>
                        <td><span class="badge ${actionClass}">${l.action.toUpperCase()}</span></td>
                        <td><code>${l.entity_type}</code></td>
                        <td style="font-family: var(--font-mono); font-size: 0.75rem;">
                          ${l.entity_id ? l.entity_id.slice(0, 12) + '...' : '—'}
                        </td>
                        <td style="max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${detailsStr}">
                          <code style="font-size: 0.75rem;">${detailsStr}</code>
                        </td>
                        <td style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted);">${l.ip_address}</td>
                      </tr>
                    `;
                  })
                : html`
                    <tr>
                      <td colspan="6" class="text-center text-muted" style="padding: 2rem;">
                        No audit events recorded for this user yet.
                      </td>
                    </tr>
                  `}
            </tbody>
          </table>
        </div>
      </div>
    ` : raw('')}

    <!-- Team Members Table -->
    <div class="table-responsive card">
      <table class="data-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Module Access</th>
            <th>Portfolio Access</th>
            <th>Created</th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${users.length > 0
            ? users.map((u: any) => {
                const modules = u.allowed_modules || [];
                const portfolios = u.allowed_portfolios || [];
                const roleBadge = u.role === 'owner' ? 'badge-primary' : u.role === 'manager' ? 'badge-success' : u.role === 'maintenance' ? 'badge-warning' : 'badge-secondary';
                const portfolioNames = portfolios.map((pid: string) => {
                  const p = allPortfolios.find((port) => port.id === pid);
                  return p ? p.name : pid.slice(0, 8);
                });

                return html`
                  <tr>
                    <td>
                      <div style="font-weight: 600;">${u.first_name} ${u.last_name}</div>
                      <div class="text-muted" style="font-size: 0.8rem;">${u.email}</div>
                    </td>
                    <td>
                      <span class="badge ${roleBadge}" style="text-transform: capitalize;">${u.role.replace(/_/g, ' ')}</span>
                      ${u.is_system_user === 1 ? html`<span class="badge badge-subtle" style="margin-left: 0.25rem;">System</span>` : raw('')}
                    </td>
                    <td>
                      ${modules.length > 0
                        ? modules.map((m: string) => html`<span class="badge badge-secondary" style="margin-right: 0.25rem; font-size: 0.75rem;">${m}</span>`)
                        : html`<span class="text-muted" style="font-size: 0.8rem;">All Modules (Global)</span>`}
                    </td>
                    <td>
                      ${portfolios.length > 0
                        ? portfolioNames.map((pName: string) => html`<span class="badge badge-subtle" style="margin-right: 0.25rem; font-size: 0.75rem;">${pName}</span>`)
                        : html`<span class="text-muted" style="font-size: 0.8rem;">All Portfolios (Global)</span>`}
                    </td>
                    <td style="font-size: 0.8rem; color: var(--text-muted);">${formatTimestamp(u.created_at)}</td>
                    <td style="text-align: right; white-space: nowrap;">
                      <a href="/admin?tab=users&audit_user_id=${encodeURIComponent(u.id)}" class="btn btn-sm btn-secondary" style="padding: 0.25rem 0.5rem; margin-right: 0.25rem;" title="Audit all activity by this user">
                        🔍 Audit Activity
                      </a>
                      <button
                        type="button"
                        class="btn btn-sm btn-subtle"
                        style="padding: 0.25rem 0.5rem; margin-right: 0.25rem;"
                        onclick="openEditUserModal('${u.id}', '${u.email}', '${u.first_name}', '${u.last_name}', '${u.role}', ${JSON.stringify(JSON.stringify(modules))}, ${JSON.stringify(JSON.stringify(portfolios))})"
                        title="Edit User & Permissions"
                      >
                        ✏️ Edit
                      </button>
                      ${u.role !== 'owner'
                        ? html`
                            <form method="POST" action="/admin?tab=users" style="display: inline;" onsubmit="return confirm('Are you sure you want to deactivate and remove ${u.first_name} ${u.last_name}?');">
                              ${csrfField(csrfToken)}
                              <input type="hidden" name="action" value="delete_user">
                              <input type="hidden" name="user_id" value="${u.id}">
                              <button type="submit" class="btn btn-sm btn-subtle" style="color: var(--danger); padding: 0.2rem 0.4rem;" title="Remove User">
                                🗑️
                              </button>
                            </form>
                          `
                        : raw('')}
                    </td>
                  </tr>
                `;
              })
            : html`
                <tr>
                  <td colspan="6" class="text-center text-muted" style="padding: 2.5rem;">
                    No team members found.
                  </td>
                </tr>
              `}
        </tbody>
      </table>
    </div>

    <!-- Modal: Create / Add Team Member -->
    <dialog id="createUserModal" class="modal">
      <form method="POST" action="/admin?tab=users" class="modal-box" style="max-width: 620px; width: 95%;">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="create_user">
        <div class="modal-header">
          <h3>Add Team Member</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('createUserModal').close()">✕</button>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; gap: 1rem;">
          <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">
            Provision an account for a team member and configure role hierarchy and scoped module/portfolio access.
          </p>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="form-group">
              <label class="form-label" for="create_first_name">First Name *</label>
              <input class="form-input" type="text" id="create_first_name" name="first_name" required placeholder="Jane">
            </div>
            <div class="form-group">
              <label class="form-label" for="create_last_name">Last Name *</label>
              <input class="form-input" type="text" id="create_last_name" name="last_name" required placeholder="Doe">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="form-group">
              <label class="form-label" for="create_email">Email Address *</label>
              <input class="form-input" type="email" id="create_email" name="email" required placeholder="jane@propertycorp.com">
            </div>
            <div class="form-group">
              <label class="form-label" for="create_password">Initial Password (min 8 chars) *</label>
              <input class="form-input" type="password" id="create_password" name="password" required minlength="8" placeholder="••••••••">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="create_role">Assigned Role *</label>
            <select class="form-select" id="create_role" name="role" required>
              <option value="manager">Manager (Full Operational Access)</option>
              <option value="leasing_agent">Leasing Agent (Leases & Contacts)</option>
              <option value="maintenance">Maintenance Tech (Work Orders & Vendors)</option>
              <option value="auditor">Auditor (Financial & Compliance Read-Only)</option>
              <option value="viewer">Viewer (Read-Only across all modules)</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" style="margin-bottom: 0.4rem;">Module Whitelist (Leave empty for All Modules)</label>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.5rem; background: var(--bg-surface-raised, rgba(0,0,0,0.02)); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
              ${availableModules.map((m) => html`
                <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; cursor: pointer;">
                  <input type="checkbox" name="module_ids" value="${m.id}">
                  <span>${m.label}</span>
                </label>
              `)}
            </div>
          </div>

          ${allPortfolios.length > 0 ? html`
            <div class="form-group">
              <label class="form-label" style="margin-bottom: 0.4rem;">Portfolio Scope (Leave empty for All Portfolios)</label>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.5rem; background: var(--bg-surface-raised, rgba(0,0,0,0.02)); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); max-height: 140px; overflow-y: auto;">
                ${allPortfolios.map((p) => html`
                  <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; cursor: pointer;">
                    <input type="checkbox" name="portfolio_ids" value="${p.id}">
                    <span>${p.name}</span>
                  </label>
                `)}
              </div>
            </div>
          ` : raw('')}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('createUserModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create User Account</button>
        </div>
      </form>
    </dialog>

    <!-- Modal: Edit User & Permissions -->
    <dialog id="editUserModal" class="modal">
      <form method="POST" action="/admin?tab=users" class="modal-box" style="max-width: 620px; width: 95%;">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="update_user">
        <input type="hidden" id="edit_user_id" name="user_id">
        <div class="modal-header">
          <h3>Edit User & Permissions</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('editUserModal').close()">✕</button>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; gap: 1rem;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="form-group">
              <label class="form-label" for="edit_first_name">First Name</label>
              <input class="form-input" type="text" id="edit_first_name" name="first_name">
            </div>
            <div class="form-group">
              <label class="form-label" for="edit_last_name">Last Name</label>
              <input class="form-input" type="text" id="edit_last_name" name="last_name">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="form-group">
              <label class="form-label" for="edit_role">Assigned Role</label>
              <select class="form-select" id="edit_role" name="role">
                <option value="owner">Owner (Full Instance Control)</option>
                <option value="manager">Manager (Operational Admin)</option>
                <option value="leasing_agent">Leasing Agent</option>
                <option value="maintenance">Maintenance Tech</option>
                <option value="auditor">Auditor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="edit_password">Reset Password (Optional)</label>
              <input class="form-input" type="password" id="edit_password" name="password" minlength="8" placeholder="Leave blank to preserve">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" style="margin-bottom: 0.4rem;">Module Whitelist (Uncheck all for Global Access)</label>
            <div id="edit_modules_container" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.5rem; background: var(--bg-surface-raised, rgba(0,0,0,0.02)); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
              ${availableModules.map((m) => html`
                <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; cursor: pointer;">
                  <input type="checkbox" name="module_ids" value="${m.id}" id="edit_mod_${m.id}">
                  <span>${m.label}</span>
                </label>
              `)}
            </div>
          </div>

          ${allPortfolios.length > 0 ? html`
            <div class="form-group">
              <label class="form-label" style="margin-bottom: 0.4rem;">Portfolio Scope (Uncheck all for Global Access)</label>
              <div id="edit_portfolios_container" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.5rem; background: var(--bg-surface-raised, rgba(0,0,0,0.02)); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); max-height: 140px; overflow-y: auto;">
                ${allPortfolios.map((p) => html`
                  <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; cursor: pointer;">
                    <input type="checkbox" name="portfolio_ids" value="${p.id}" id="edit_port_${p.id}">
                    <span>${p.name}</span>
                  </label>
                `)}
              </div>
            </div>
          ` : raw('')}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('editUserModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Permissions</button>
        </div>
      </form>
    </dialog>

    <script>
      function openEditUserModal(id, email, firstName, lastName, role, rawModules, rawPortfolios) {
        document.getElementById('edit_user_id').value = id;
        document.getElementById('edit_first_name').value = firstName || '';
        document.getElementById('edit_last_name').value = lastName || '';
        document.getElementById('edit_role').value = role || 'manager';
        document.getElementById('edit_password').value = '';

        var modules = [];
        try { modules = typeof rawModules === 'string' ? JSON.parse(rawModules) : rawModules; } catch(e) {}
        document.querySelectorAll('#edit_modules_container input[type="checkbox"]').forEach(function(cb) {
          cb.checked = Array.isArray(modules) && modules.indexOf(cb.value) !== -1;
        });

        var portfolios = [];
        try { portfolios = typeof rawPortfolios === 'string' ? JSON.parse(rawPortfolios) : rawPortfolios; } catch(e) {}
        document.querySelectorAll('#edit_portfolios_container input[type="checkbox"]').forEach(function(cb) {
          cb.checked = Array.isArray(portfolios) && portfolios.indexOf(cb.value) !== -1;
        });

        document.getElementById('editUserModal').showModal();
      }
    </script>
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
        <a href="/admin?tab=telemetry" class="tab-link ${activeTab === 'telemetry' ? 'active' : ''}">
          📊 Telemetry & System Health
        </a>
        <a href="/admin?tab=branding" class="tab-link ${activeTab === 'branding' ? 'active' : ''}">
          🎨 Branding & Appearance
        </a>
        <a href="/admin?tab=custom_fields" class="tab-link ${activeTab === 'custom_fields' ? 'active' : ''}">
          🎛️ Custom Fields Schema
        </a>
        <a href="/admin?tab=backups" class="tab-link ${activeTab === 'backups' ? 'active' : ''}">
          💾 Database Backups
        </a>
        <a href="/admin?tab=modules" class="tab-link ${activeTab === 'modules' ? 'active' : ''}">
          🧩 System Modules
        </a>
        <a href="/admin?tab=users" class="tab-link ${activeTab === 'users' ? 'active' : ''}">
          👥 Team & Permissions
        </a>
      </div>

      ${activeTab === 'branding'
        ? renderBrandingTab(branding, csrfToken)
        : activeTab === 'custom_fields'
        ? renderCustomFieldsTab(data.customFieldSections || [], data.customFieldDefinitions || [], csrfToken)
        : activeTab === 'backups'
        ? renderBackupsTab(data.allBackups || [], csrfToken)
        : activeTab === 'modules'
        ? renderModulesTab(data.loadedModules || [])
        : activeTab === 'users'
        ? renderUsersTab(data.usersList || [], data.allPortfolios || [], data.auditedUser || null, csrfToken)
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
    } else if (ctx.body['action'] === 'create_custom_section') {
      try {
        const entityType = ctx.body['entity_type'] as CustomFieldEntityType;
        const title = (ctx.body['title'] || '').trim();
        const sortOrder = parseInt(ctx.body['sort_order'] || '0', 10) || 0;
        if (!title) {
          ctx.session.addFlash('error', 'Section title is required.');
        } else {
          CustomFieldsService.createSection({ entity_type: entityType, title, sort_order: sortOrder }, operatorId);
          ctx.session.addFlash('success', `Created custom field section "${title}".`);
        }
      } catch (err: any) {
        ctx.session.addFlash('error', `Failed to create section: ${err.message}`);
      }
      return { redirect: '/admin?tab=custom_fields', content: '' };
    } else if (ctx.body['action'] === 'delete_custom_section') {
      try {
        const sectionId = ctx.body['section_id'] || '';
        CustomFieldsService.deleteSection(sectionId, operatorId);
        ctx.session.addFlash('success', 'Section deleted.');
      } catch (err: any) {
        ctx.session.addFlash('error', `Failed to delete section: ${err.message}`);
      }
      return { redirect: '/admin?tab=custom_fields', content: '' };
    } else if (ctx.body['action'] === 'create_custom_definition') {
      try {
        const entityType = ctx.body['entity_type'] as CustomFieldEntityType;
        const sectionId = ctx.body['section_id'] || null;
        const fieldLabel = (ctx.body['field_label'] || '').trim();
        const fieldName = (ctx.body['field_name'] || fieldLabel.toLowerCase().replace(/[^a-z0-9_]/g, '_')).trim();
        const dataType = (ctx.body['data_type'] || 'string') as CustomFieldDataType;
        const isRequired = ctx.body['is_required'] === '1';
        const defaultValue = ctx.body['default_value'] || null;
        const optionsRaw = (ctx.body['options'] || '').trim();
        const options = optionsRaw ? optionsRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
        const sortOrder = parseInt(ctx.body['sort_order'] || '0', 10) || 0;

        if (!fieldLabel || !fieldName) {
          ctx.session.addFlash('error', 'Field label and name are required.');
        } else {
          CustomFieldsService.createDefinition({
            entity_type: entityType,
            section_id: sectionId,
            field_name: fieldName,
            field_label: fieldLabel,
            data_type: dataType,
            is_required: isRequired,
            default_value: defaultValue,
            options,
            sort_order: sortOrder
          }, operatorId);
          ctx.session.addFlash('success', `Created custom field definition "${fieldLabel}".`);
        }
      } catch (err: any) {
        ctx.session.addFlash('error', `Failed to create field definition: ${err.message}`);
      }
      return { redirect: '/admin?tab=custom_fields', content: '' };
    } else if (ctx.body['action'] === 'delete_custom_definition') {
      try {
        const defId = ctx.body['definition_id'] || '';
        CustomFieldsService.deleteDefinition(defId, operatorId);
        ctx.session.addFlash('success', 'Field definition deleted.');
      } catch (err: any) {
        ctx.session.addFlash('error', `Failed to delete field definition: ${err.message}`);
      }
      return { redirect: '/admin?tab=custom_fields', content: '' };
    } else if (ctx.body['action'] === 'create_user') {
      try {
        const email = (ctx.body['email'] || '').trim().toLowerCase();
        const password = ctx.body['password'] || '';
        const firstName = (ctx.body['first_name'] || '').trim();
        const lastName = (ctx.body['last_name'] || '').trim();
        const role = (ctx.body['role'] || 'leasing_agent').trim().toLowerCase();

        const rawPortfolios = ctx.body['portfolio_ids'];
        const portfolioIds = Array.isArray(rawPortfolios) ? rawPortfolios : (rawPortfolios ? [rawPortfolios] : []);

        const rawModules = ctx.body['module_ids'];
        const moduleIds = Array.isArray(rawModules) ? rawModules : (rawModules ? [rawModules] : []);

        await ctx.api.post('/api/v1/users', {
          email,
          password,
          first_name: firstName,
          last_name: lastName,
          role,
          portfolio_ids: portfolioIds,
          module_ids: moduleIds
        });
        ctx.session.addFlash('success', `User account for ${firstName} ${lastName} (${email}) created successfully.`);
      } catch (err: any) {
        ctx.session.addFlash('error', `Failed to create user: ${err.message}`);
      }
      return { redirect: '/admin?tab=users', content: '' };
    } else if (ctx.body['action'] === 'update_user') {
      try {
        const userId = ctx.body['user_id'];
        const firstName = (ctx.body['first_name'] || '').trim();
        const lastName = (ctx.body['last_name'] || '').trim();
        const role = (ctx.body['role'] || '').trim().toLowerCase();
        const password = ctx.body['password'] || undefined;

        const rawPortfolios = ctx.body['portfolio_ids'];
        const portfolioIds = Array.isArray(rawPortfolios) ? rawPortfolios : (rawPortfolios ? [rawPortfolios] : []);

        const rawModules = ctx.body['module_ids'];
        const moduleIds = Array.isArray(rawModules) ? rawModules : (rawModules ? [rawModules] : []);

        await ctx.api.put(`/api/v1/users/${encodeURIComponent(userId)}`, {
          first_name: firstName || undefined,
          last_name: lastName || undefined,
          role: role || undefined,
          password: password && password.length >= 8 ? password : undefined,
          portfolio_ids: portfolioIds,
          module_ids: moduleIds
        });
        ctx.session.addFlash('success', 'User profile and permissions updated successfully.');
      } catch (err: any) {
        ctx.session.addFlash('error', `Failed to update user: ${err.message}`);
      }
      return { redirect: '/admin?tab=users', content: '' };
    } else if (ctx.body['action'] === 'delete_user') {
      try {
        const userId = ctx.body['user_id'];
        await ctx.api.delete(`/api/v1/users/${encodeURIComponent(userId)}`);
        ctx.session.addFlash('success', 'User removed successfully.');
      } catch (err: any) {
        ctx.session.addFlash('error', `Failed to delete user: ${err.message}`);
      }
      return { redirect: '/admin?tab=users', content: '' };
    }
  }

  const rawTab = String(ctx.query['tab'] || 'telemetry').toLowerCase();
  const validTabs = ['telemetry', 'branding', 'custom_fields', 'backups', 'modules', 'users'];
  const activeTab: 'telemetry' | 'branding' | 'custom_fields' | 'backups' | 'modules' | 'users' = validTabs.includes(rawTab)
    ? (rawTab as any)
    : 'telemetry';
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

  const customFieldSections = CustomFieldsService.listSections(undefined, operatorId);
  const customFieldDefinitions = CustomFieldsService.listDefinitions(undefined, operatorId);

  let allBackups: any[] = [];
  try {
    allBackups = db.prepare(`
      SELECT id, filename, size_bytes, sha256_checksum, status, created_at
      FROM backups
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 25
    `).all() as any[];
  } catch (_) {}

  let usersList: any[] = [];
  let allPortfolios: any[] = [];
  let auditedUser: any = null;

  if (activeTab === 'users') {
    try {
      const uRes = await ctx.api.get('/api/v1/users');
      usersList = uRes?.data?.users || [];

      const pRows = db.prepare('SELECT id, name FROM portfolios WHERE operator_id = ? AND deleted_at IS NULL ORDER BY name ASC').all(operatorId) as any[];
      allPortfolios = pRows || [];

      const auditUserId = ctx.query['audit_user_id'] as string | undefined;
      if (auditUserId) {
        const actRes = await ctx.api.get(`/api/v1/users/${encodeURIComponent(auditUserId)}/activity`);
        if (actRes?.data) {
          auditedUser = actRes.data;
        }
      }
    } catch (err: any) {
      ctx.session.addFlash('error', `Failed to load user administration data: ${err.message}`);
    }
  }

  const content = renderAdminPage({
    activeTab,
    branding,
    customFieldSections,
    customFieldDefinitions,
    allBackups,
    usersList,
    allPortfolios,
    auditedUser,
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
