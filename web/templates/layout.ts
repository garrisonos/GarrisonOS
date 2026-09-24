import { html, raw, SafeHtml } from '../lib/html.js';
import { SessionUser, FlashMessage } from '../lib/session.js';
import { NavigationItem } from '../lib/hooks.js';
import { renderSidebar } from './sidebar.js';
import { renderHeader } from './header.js';
import { renderFlash } from './flash.js';
import { OperatorBranding, BrandingService } from '../../core/branding.js';
import { ogImageUrl } from '../lib/public-url.js';

/**
 * Configuration options for rendering the primary application layout wrapper.
 */
export interface LayoutOptions {
  /**
   * Canonical public origin for absolute social preview metadata.
   */
  publicOrigin: string;

  /**
   * Title of the page.
   */
  title?: string;

  /**
   * Inner HTML page body content.
   */
  content: SafeHtml | string;

  /**
   * Authenticated user session profile, or null.
   */
  user: SessionUser | null;

  /**
   * Active operator isolation identifier.
   */
  operatorId?: string;

  /**
   * Operator branding and appearance profile.
   */
  branding?: OperatorBranding;

  /**
   * Registered navigation items to render in the sidebar.
   */
  navItems: NavigationItem[];

  /**
   * Ephemeral flash alert messages to display.
   */
  flashMessages?: FlashMessage[];

  /**
   * Current URL path for active link highlighting.
   */
  currentPath: string;
}

/**
 * Renders the primary outer HTML document shell containing sidebar, header, flash alerts, and content.
 *
 * @param options - Layout parameters and view contents.
 * @returns Complete HTML document string.
 */
export function renderLayout(options: LayoutOptions): string {
  const previewImageUrl = ogImageUrl(options.publicOrigin);
  const operatorId = options.operatorId || 'operator-demo';
  const branding = options.branding || BrandingService.getBranding(operatorId);
  const brandName = branding.brand_name || 'GarrisonOS';

  const pageTitle = options.title ? `${options.title} – ${brandName}` : `${brandName} Property Management`;
  const sidebar = renderSidebar(options.navItems, options.currentPath, branding, options.user);
  const header = renderHeader(options.user, operatorId, brandName);
  const flash = renderFlash(options.flashMessages || []);
  const bodyContent = typeof options.content === 'string' ? raw(options.content) : options.content;
  const brandingStyles = raw(BrandingService.renderBrandingCss(branding));
  const faviconLink = branding.favicon_url
    ? html`<link rel="icon" href="${branding.favicon_url}">`
    : html`<link rel="icon" type="image/x-icon" href="/public/favicon.ico">
    <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/public/favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/public/apple-touch-icon.png">`;

  const doc = html`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pageTitle}</title>
    ${faviconLink}
    <meta property="og:title" content="${pageTitle}">
    <meta property="og:description" content="Zero-dependency property management framework.">
    <meta property="og:image" content="${previewImageUrl}">
    <link rel="stylesheet" href="/public/css/variables.css">
    <link rel="stylesheet" href="/public/css/style.css">
    ${brandingStyles}
    <script>
      (function() {
        try {
          var saved = localStorage.getItem('garrison_theme');
          var defaultDark = ${branding.default_dark_mode === 1 ? 'true' : 'false'};
          var theme = saved || (defaultDark ? 'dark' : 'light');
          document.documentElement.setAttribute('data-theme', theme);
        } catch(e) {}
      })();
    </script>
    <script src="/public/js/app.js" defer></script>
</head>
<body>
    <div class="app-container">
        ${sidebar}
        <div class="main-content">
            ${header}
            <main class="page-body">
                ${flash}
                ${bodyContent}
            </main>
        </div>
    </div>
</body>
</html>`;

  return doc.toString();
}
