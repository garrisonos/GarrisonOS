import { html, raw, SafeHtml } from '../lib/html.js';
import { csrfField, validateCsrf } from '../lib/csrf.js';
import { PageContext, PageResult } from '../lib/page-context.js';

/**
 * Rendering options for the first-launch setup wizard page.
 */
export interface SetupPageOptions {
  /**
   * Cryptographic CSRF token.
   */
  csrfToken: string;

  /**
   * Error message to display, if setup failed.
   */
  error?: string | null;

  /**
   * Active tab: 'fresh' for initial provisioning, 'restore' for snapshot upload.
   */
  activeTab?: 'fresh' | 'restore';

  /**
   * Whether the backup and restore module is enabled in core.
   */
  backupModuleEnabled?: boolean;

  /**
   * Pre-filled form values for redisplay on validation error.
   */
  formValues?: {
    organization_name?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    seed_demo_data?: boolean;
    setup_mode?: 'single' | 'multi';
  };
}

/**
 * Renders the HTML document for the initial first-launch setup wizard.
 *
 * @param options - Setup page template parameters and form states.
 * @returns Complete HTML document string.
 */
export function renderSetupPage(options: SetupPageOptions): string {
  const activeTab = options.activeTab || 'fresh';
  const backupModuleEnabled = options.backupModuleEnabled ?? false;
  const formValues = options.formValues || {};
  const setupMode = formValues.setup_mode || 'single';

  const errorAlert = options.error
    ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${options.error}</div>`
    : raw('');

  const tabSwitcher = backupModuleEnabled
    ? html`
        <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem;">
            <a href="/setup?tab=fresh" class="btn ${activeTab === 'fresh' ? 'btn-primary' : 'btn-secondary'}" style="flex: 1; text-align: center; text-decoration: none;">
                New Setup
            </a>
            <a href="/setup?tab=restore" class="btn ${activeTab === 'restore' ? 'btn-primary' : 'btn-secondary'}" style="flex: 1; text-align: center; text-decoration: none;">
                Restore from Backup
            </a>
        </div>
      `
    : raw('');

  let formContent: SafeHtml;

  if (activeTab === 'restore' && backupModuleEnabled) {
    formContent = html`
      <form method="POST" action="/setup" enctype="multipart/form-data">
          ${csrfField(options.csrfToken)}
          <input type="hidden" name="form_action" value="restore">

          <div style="margin-bottom: 1.5rem;">
              <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.5rem;">Restore from Previous Backup</h3>
              <p style="font-size: 0.875rem; color: var(--text-muted); line-height: 1.4;">
                  Upload a GarrisonOS SQLite snapshot (<code>.sqlite</code> or <code>.sqlite.gz</code>) to restore your database, accounts, and portfolio settings.
              </p>
          </div>

          <div class="form-group" style="margin-bottom: 1.5rem;">
              <label class="form-label" for="backup_file">Backup Archive File</label>
              <input class="form-input" type="file" id="backup_file" name="backup_file" required accept=".sqlite,.gz,.json">
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; padding: 0.75rem; font-size: 1rem;">
              Restore Platform & Database
          </button>
      </form>
    `;
  } else {
    formContent = html`
      <form method="POST" action="/setup">
          ${csrfField(options.csrfToken)}
          <input type="hidden" name="form_action" value="fresh">

          <div style="margin-bottom: 1.25rem;">
              <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem;">Deployment Architecture</h3>
              <p style="font-size: 0.85rem; color: var(--text-muted);">Choose whether this instance operates for a single company or hosts multiple operators.</p>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1.25rem;">
              <label style="border: 1px solid var(--border-color); border-radius: 6px; padding: 0.75rem; cursor: pointer; display: flex; flex-direction: column; gap: 0.25rem; background: var(--surface-secondary, rgba(255,255,255,0.03));">
                  <div style="display: flex; align-items: center; gap: 0.5rem;">
                      <input type="radio" name="setup_mode" value="single" ${setupMode === 'single' ? raw('checked') : raw('')}>
                      <strong style="font-size: 0.9rem;">Single-Operator</strong>
                  </div>
                  <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 1.4rem;">Dedicated instance for one property management company.</span>
              </label>
              <label style="border: 1px solid var(--border-color); border-radius: 6px; padding: 0.75rem; cursor: pointer; display: flex; flex-direction: column; gap: 0.25rem; background: var(--surface-secondary, rgba(255,255,255,0.03));">
                  <div style="display: flex; align-items: center; gap: 0.5rem;">
                      <input type="radio" name="setup_mode" value="multi" ${setupMode === 'multi' ? raw('checked') : raw('')}>
                      <strong style="font-size: 0.9rem;">Multi-Operator</strong>
                  </div>
                  <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 1.4rem;">Platform hosting multiple independent property management firms.</span>
              </label>
          </div>

          <div style="margin-bottom: 1.25rem; border-top: 1px solid var(--border-color); padding-top: 1.25rem;">
              <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem;">Organization Profile</h3>
              <p style="font-size: 0.85rem; color: var(--text-muted);">The primary entity or property management company name.</p>
          </div>

          <div class="form-group">
              <label class="form-label" for="organization_name">Organization / Company Name</label>
              <input class="form-input" type="text" id="organization_name" name="organization_name" required placeholder="e.g. Blue Ridge Property Management" value="${formValues.organization_name || ''}">
          </div>

          <div style="margin: 1.5rem 0 1rem 0; border-top: 1px solid var(--border-color); padding-top: 1.25rem;">
              <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem;">Administrator Credentials</h3>
              <p style="font-size: 0.85rem; color: var(--text-muted);">Your master owner login account for GarrisonOS.</p>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
              <div class="form-group">
                  <label class="form-label" for="first_name">First Name</label>
                  <input class="form-input" type="text" id="first_name" name="first_name" required placeholder="Jane" value="${formValues.first_name || ''}">
              </div>
              <div class="form-group">
                  <label class="form-label" for="last_name">Last Name</label>
                  <input class="form-input" type="text" id="last_name" name="last_name" required placeholder="Doe" value="${formValues.last_name || ''}">
              </div>
          </div>

          <div class="form-group">
              <label class="form-label" for="email">Admin Email (Login Username)</label>
              <input class="form-input" type="email" id="email" name="email" required placeholder="jane@example.com" value="${formValues.email || ''}">
          </div>

          <div class="form-group">
              <label class="form-label" for="password">Password (min 8 characters)</label>
              <input class="form-input" type="password" id="password" name="password" required placeholder="••••••••••••" minlength="8">
          </div>

          <div class="form-group">
              <label class="form-label" for="password_confirm">Confirm Password</label>
              <input class="form-input" type="password" id="password_confirm" name="password_confirm" required placeholder="••••••••••••" minlength="8">
          </div>

          <div class="form-group" style="margin-top: 1rem; display: flex; align-items: center; gap: 0.5rem;">
              <input type="checkbox" id="seed_demo_data" name="seed_demo_data" value="1" ${formValues.seed_demo_data ? raw('checked') : raw('')} style="width: 1.1rem; height: 1.1rem; cursor: pointer;">
              <label for="seed_demo_data" style="font-size: 0.875rem; color: var(--text-main); cursor: pointer;">
                  Seed sample properties, units, and chart of accounts (Demo Data)
              </label>
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%; padding: 0.75rem; font-size: 1rem; margin-top: 1.5rem;">
              Complete Setup & Launch Dashboard
          </button>
      </form>
    `;
  }

  const doc = html`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>First-Launch Setup – GarrisonOS</title>
    <link rel="icon" type="image/x-icon" href="/public/favicon.ico">
    <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/public/favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/public/apple-touch-icon.png">
    <meta property="og:title" content="First-Launch Setup – GarrisonOS">
    <meta property="og:description" content="Zero-dependency Property Management">
    <meta property="og:image" content="/public/og-image.png">
    <link rel="stylesheet" href="/public/css/variables.css">
    <link rel="stylesheet" href="/public/css/style.css">
</head>
<body style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background-color: #0f172a; padding: 2rem 1rem;">
    <div class="card" style="width: 100%; max-width: 540px; padding: 2.5rem; box-shadow: var(--shadow-lg);">
        <div style="text-align: center; margin-bottom: 1.75rem;">
            <a href="/" style="display: inline-block; text-decoration: none; margin-bottom: 0.75rem;">
                <img src="/public/logo.png" alt="GarrisonOS" style="max-height: 80px; width: auto;">
            </a>
            <h1 style="font-size: 1.85rem; font-weight: 800; color: var(--text-main); letter-spacing: -0.02em;">GarrisonOS</h1>
            <p style="color: var(--text-muted); font-size: 0.95rem; margin-top: 0.25rem;">Initial Platform Setup & Onboarding</p>
        </div>

        ${tabSwitcher}
        ${errorAlert}
        ${formContent}
    </div>
</body>
</html>`;

  return doc.toString();
}

/**
 * Processes initial setup initialization (fresh provisioning or snapshot restore).
 *
 * @param ctx - Page execution context containing session, API client, and request body.
 * @returns PageResult redirecting on success or rendering the setup wizard on GET/error.
 */
export async function handle(ctx: PageContext): Promise<PageResult> {
  let isConfigured = false;
  let backupModuleEnabled = false;

  try {
    const statusRes = await ctx.api.get('/api/v1/system/status');
    isConfigured = !!statusRes?.data?.is_configured;
    backupModuleEnabled = !!statusRes?.data?.backup_module_enabled;
  } catch {
    // If status check fails, proceed with setup
  }

  if (isConfigured) {
    return { redirect: '/login', content: '' };
  }

  const csrfToken = ctx.session.getCsrfToken();
  const rawTab = ctx.query['tab'];
  const activeTab: 'fresh' | 'restore' = rawTab === 'restore' ? 'restore' : 'fresh';

  let error: string | null = null;
  const formValues: any = {};

  if (ctx.method === 'POST') {
    if (!validateCsrf(csrfToken, ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF token validation failed.</div>`
      };
    }

    const formAction = ctx.body['form_action'] ?? 'fresh';

    if (formAction === 'restore') {
      const backupData = ctx.body['backup_data'];
      const filename = ctx.body['filename'] || 'backup.sqlite.gz';

      if (!backupData) {
        error = 'Please provide a valid backup archive payload.';
      } else {
        try {
          await ctx.api.post('/api/v1/system/restore', {
            backup_data: backupData,
            filename: filename,
          });
          ctx.session.addFlash('success', 'Database successfully restored! You may now sign in with your credentials.');
          return { redirect: '/login', content: '' };
        } catch (err: any) {
          error = err.message || 'Failed to restore backup.';
        }
      }
    } else {
      const orgName = typeof ctx.body['organization_name'] === 'string' ? ctx.body['organization_name'].trim() : '';
      const firstName = typeof ctx.body['first_name'] === 'string' ? ctx.body['first_name'].trim() : '';
      const lastName = typeof ctx.body['last_name'] === 'string' ? ctx.body['last_name'].trim() : '';
      const email = typeof ctx.body['email'] === 'string' ? ctx.body['email'].trim() : '';
      const password = typeof ctx.body['password'] === 'string' ? ctx.body['password'] : '';
      const passwordConfirm = typeof ctx.body['password_confirm'] === 'string' ? ctx.body['password_confirm'] : '';
      const seedDemoData = !!ctx.body['seed_demo_data'];
      const setupMode: 'single' | 'multi' = ctx.body['setup_mode'] === 'multi' ? 'multi' : 'single';

      formValues.organization_name = orgName;
      formValues.first_name = firstName;
      formValues.last_name = lastName;
      formValues.email = email;
      formValues.seed_demo_data = seedDemoData;
      formValues.setup_mode = setupMode;

      if (!orgName || !firstName || !lastName || !email || !password) {
        error = 'All fields are required.';
      } else if (password !== passwordConfirm) {
        error = 'Passwords do not match.';
      } else if (password.length < 8) {
        error = 'Password must be at least 8 characters in length.';
      } else {
        try {
          const res = await ctx.api.post('/api/v1/system/setup', {
            organization_name: orgName,
            first_name: firstName,
            last_name: lastName,
            email: email,
            password: password,
            seed_demo_data: seedDemoData,
            setup_mode: setupMode,
          });

          const token = res.data?.token;
          const user = res.data?.user;

          if (user && token) {
            ctx.session.user = user;
            ctx.session.authToken = token;
            if (res.data.operator_id) {
              ctx.session.operatorId = res.data.operator_id;
            }
            ctx.session.addFlash('success', `Welcome to GarrisonOS, ${user.first_name || 'Admin'}! Your organization has been initialized.`);
            return { redirect: '/dashboard', content: '' };
          } else {
            error = 'System initialized, but automatic login could not be completed.';
          }
        } catch (err: any) {
          error = err.message || 'Setup failed.';
        }
      }
    }
  }

  const content = renderSetupPage({
    csrfToken,
    error,
    activeTab,
    backupModuleEnabled,
    formValues,
  });

  return {
    title: 'First-Launch Setup',
    content,
    isFullDocument: true,
  };
}

