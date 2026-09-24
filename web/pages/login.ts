import { html, raw, SafeHtml } from '../lib/html.js';
import { csrfField, validateCsrf } from '../lib/csrf.js';
import { FlashMessage } from '../lib/session.js';
import { PageContext, PageResult } from '../lib/page-context.js';

/**
 * Template rendering options for the user login page.
 */
export interface LoginPageOptions {
  /**
   * Cryptographic CSRF token string.
   */
  csrfToken: string;

  /**
   * Pending flash messages to display.
   */
  flashMessages?: FlashMessage[];

  /**
   * Error message to display, if authentication failed.
   */
  error?: string | null;

  /**
   * Pre-filled email address.
   */
  email?: string;

  /**
   * Pre-filled operator isolation ID.
   */
  operatorId?: string;
}

/**
 * Renders the standalone sign-in page document.
 *
 * @param options - Template parameters and form defaults.
 * @returns Complete HTML document string.
 */
export function renderLoginPage(options: LoginPageOptions): string {
  const flashes = (options.flashMessages || []).map(
    (f) =>
      html`<div class="alert alert-${f.type === 'error' ? 'danger' : f.type}" style="margin-bottom: 1.5rem;">
        ${f.message}
      </div>`
  );

  const errorAlert = options.error
    ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${options.error}</div>`
    : raw('');

  const doc = html`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign In – GarrisonOS</title>
    <link rel="icon" type="image/x-icon" href="/public/favicon.ico">
    <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/public/favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/public/apple-touch-icon.png">
    <meta property="og:title" content="Sign In – GarrisonOS">
    <meta property="og:description" content="Zero-dependency Property Management">
    <meta property="og:image" content="/public/og-image.png">
    <link rel="stylesheet" href="/public/css/variables.css">
    <link rel="stylesheet" href="/public/css/style.css">
</head>
<body style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background-color: #0f172a;">
    <div class="card" style="width: 100%; max-width: 420px; padding: 2.5rem; box-shadow: var(--shadow-lg);">
        <div style="text-align: center; margin-bottom: 2rem;">
            <a href="/" style="display: inline-block; text-decoration: none; margin-bottom: 0.75rem;">
                <img src="/public/logo.png" alt="GarrisonOS" style="max-height: 80px; width: auto;">
            </a>
            <h1 style="font-size: 1.75rem; font-weight: 800; color: var(--text-main); letter-spacing: -0.02em;">GarrisonOS</h1>
            <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 0.25rem;">Zero-dependency Property Management</p>
        </div>

        ${flashes}
        ${errorAlert}

        <form method="POST" action="/login">
            ${csrfField(options.csrfToken)}
            <div class="form-group">
                <label class="form-label" for="email">Email Address</label>
                <input class="form-input" type="email" id="email" name="email" required placeholder="operator@garrisonos.local" value="${options.email || ''}">
            </div>

            <div class="form-group">
                <label class="form-label" for="password">Password</label>
                <input class="form-input" type="password" id="password" name="password" required placeholder="••••••••••••">
            </div>

            <div class="form-group">
                <label class="form-label" for="operator_id">Operator ID (Optional)</label>
                <input class="form-input" type="text" id="operator_id" name="operator_id" placeholder="e.g. operator-demo" value="${options.operatorId || ''}">
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%; padding: 0.75rem; font-size: 1rem; margin-top: 1rem;">
                Sign In to Platform
            </button>
        </form>
    </div>
</body>
</html>`;

  return doc.toString();
}

/**
 * Dispatches GET rendering or POST credentials verification for user authentication.
 *
 * @param ctx - Page execution context containing session, API client, and request body.
 * @returns PageResult with redirect or rendered login page.
 */
export async function handle(ctx: PageContext): Promise<PageResult> {
  if (ctx.session.user) {
    return { redirect: '/dashboard', content: '' };
  }

  const csrfToken = ctx.session.getCsrfToken();
  let error: string | null = null;
  let email = '';
  let operatorId = '';

  if (ctx.method === 'POST') {
    if (!validateCsrf(csrfToken, ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF token validation failed.</div>`
      };
    }

    email = typeof ctx.body['email'] === 'string' ? ctx.body['email'].trim() : '';
    const password = typeof ctx.body['password'] === 'string' ? ctx.body['password'] : '';
    operatorId = typeof ctx.body['operator_id'] === 'string' ? ctx.body['operator_id'].trim() : '';

    try {
      const res = await ctx.api.post('/api/v1/auth/login', {
        email,
        password,
        operator_id: operatorId ? operatorId : undefined,
      });

      const token = res.data?.token;
      const user = res.data?.user;

      if (user && token) {
        ctx.session.user = user;
        ctx.session.authToken = token;
        if (res.data.operator_id) {
          ctx.session.operatorId = res.data.operator_id;
        }
        ctx.session.addFlash('success', `Welcome back, ${user.first_name || 'User'}!`);
        return { redirect: '/dashboard', content: '' };
      } else {
        error = 'Invalid credentials or login response.';
      }
    } catch (err: any) {
      error = err.message || 'Authentication failed.';
    }
  }

  const content = renderLoginPage({
    csrfToken,
    flashMessages: ctx.session.getFlash(),
    error,
    email,
    operatorId,
  });

  return {
    title: 'Sign In',
    content,
    isFullDocument: true,
  };
}
