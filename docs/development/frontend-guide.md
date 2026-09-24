# Frontend Presentation Layer Guide

GarrisonOS presentation layer is engineered as a **zero-dependency Server-Side Rendered (SSR) TypeScript system** with semantic HTML5, tagged template XSS auto-escaping, and vanilla CSS Custom Properties.

---

## 1. Zero-External-Dependency Philosophy

* **Pure TypeScript on Node.js**: The presentation layer executes natively on Node.js standard libraries (`node:http`, `node:crypto`, `node:fs`, `node:path`) with zero external runtime npm packages or bundlers.
* **XSS-Safe Tagged Template HTML**: Views use the `html` tagged template function from `web/lib/html.ts`, which automatically HTML-escapes interpolated strings and variables while preserving trusted `raw()` SafeHtml markup.
* **No CSS Preprocessors**: Standard CSS Custom Properties (`web/public/css/variables.css`, `web/public/css/style.css`) provide dark/light theme switching, spacing tokens, and responsive typography.
* **No Client JS Frameworks**: Modals, tabs, and interactive components utilize native HTML `<dialog>` and standard browser APIs with progressive enhancement.
* **Front Controller Hardening**: `web/server.ts` and `web/router.ts` provide static asset serving with MIME mapping and directory traversal guards, HMAC-SHA256 cookie session management, and CSRF enforcement.

---

## 2. Dynamic Hook Registry

Modules register navigation links and composite dashboard cards via `frontend/hooks.ts`:

```typescript
// Example: modules/properties/frontend/hooks.ts
import { HookRegistry } from '../../../web/lib/hooks.js';

HookRegistry.registerNavigation({
  label: 'Properties',
  route: '/properties',
  icon: 'building',
  order: 10,
  section: 'portfolio'
});

HookRegistry.registerDashboardCard('/api/v1/properties/metrics/occupancy', (res: any) => {
  if (!res || res.success !== true) return null;
  const metrics = res.data?.metrics || {};
  return {
    id: 'occupancy_metric',
    title: 'Portfolio Occupancy',
    value: `${Number(metrics.occupancyRatePercentage ?? 0).toFixed(1)}%`,
    subtitle: `${metrics.occupiedUnits ?? 0} of ${metrics.totalUnits ?? 0} units occupied`,
    order: 10
  };
});
```

---

## 3. Page Handler Contract

Every module page handler conforms to the standard `handle` signature:

```typescript
import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';

export async function handle(ctx: PageContext): Promise<PageResult> {
  const csrfToken = ctx.session.getCsrfToken();

  if (ctx.method === 'POST') {
    if (!validateCsrf(csrfToken, ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF token validation failed.</div>`
      };
    }
    // Process mutation...
    ctx.session.addFlash('success', 'Saved successfully');
    return { redirect: '/properties', content: '' };
  }

  return {
    title: 'Properties',
    content: html`<h1>Properties</h1>`
  };
}
```

---

## 4. Session & CSRF Security

### Cookie Session Hygiene

Sessions are stored in client cookies signed with HMAC-SHA256 using the server's cryptographic `APP_SECRET`:

* `HttpOnly`: Mitigates script access to session tokens.
* `SameSite=Strict`: Blocks cross-site cookie transmission.
* `Secure`: Transmitted over HTTPS in production deployments.
* Constant-time comparison prevents timing oracle attacks against the signature.

### CSRF Protection

Every state-modifying form must include the CSRF token using `csrfField()`:

```typescript
html`
  <form method="POST" action="/properties/create">
    ${csrfField(ctx.session.getCsrfToken())}
    <div class="form-group">
      <label for="name">Property Name</label>
      <input type="text" id="name" name="name" required class="form-control">
    </div>
    <button type="submit" class="btn btn-primary">Save Property</button>
  </form>
`
```

All state-modifying requests are validated with `node:crypto.timingSafeEqual`.

---

## 5. Brand Identity & Static Assets

GarrisonOS presentation assets are hosted under `web/public/` (and archived for documentation under `docs/assets/`). Static assets are served via `web/static.ts` with strict directory traversal prevention and MIME mapping.

### Asset Manifest

* **Logo Assets**:
  * `/public/logo.png` (`docs/assets/logo.png`): High-resolution (2420 × 1760) brand logo and emblem used on authentication cards, setup wizards, and splash interfaces.
  * `/public/logo-nav.png` (`docs/assets/logo-nav.png`): Compact mark (111 × 88) formatted for application sidebar headers and responsive mobile navigation.
* **Social & Meta Card**:
  * `/public/og-image.png` (`docs/assets/og-image.png`): OpenGraph card (1200 × 630) injected as an absolute URL into `<head>` meta tags (`og:image`) across the layout, login, and setup documents using `PUBLIC_ORIGIN` (or the local web port by default).
* **Favicons & Touch Icons**:
  * `/public/favicon.ico` (`docs/assets/favicon.ico`): Standard multi-size ICO favicon served automatically at `/favicon.ico`.
  * `/public/favicon-32x32.png` & `/public/favicon-16x16.png`: Modern PNG tab favicons.
  * `/public/apple-touch-icon.png`: 180 × 180 PNG icon for iOS home screen clips and mobile bookmarks.

### Operator Customization

While GarrisonOS ships with built-in default assets, individual property management operators can override logos, brand names, and favicons per operator via the `OperatorBranding` service (`core/branding.ts`) or the `/admin` branding GUI:

```typescript
// Custom operator branding override
BrandingService.updateBranding(operatorId, {
  brand_name: 'Highland Asset Management',
  logo_url: 'https://example.com/assets/highland-logo.png',
  favicon_url: 'https://example.com/assets/highland-favicon.ico',
  theme_preset: 'emerald_asset'
});
```
