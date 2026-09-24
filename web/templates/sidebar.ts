import { html, raw, SafeHtml } from '../lib/html.js';
import { NavigationItem } from '../lib/hooks.js';
import { SessionUser } from '../lib/session.js';
import { getApplicationVersion } from '../../core/version.js';

const ICON_MAP: Record<string, string> = {
  'building': '🏢',
  'users': '👥',
  'file-text': '📄',
  'dollar-sign': '💵',
  'list': '📋',
  'file-bar-chart': '📈',
  'tool': '🔧',
  'database': '💾',
  'message-square': '💬',
  'archive': '📦',
  'book': '📖',
  'calendar': '📅',
  'settings': '⚙️',
  'shield': '🛡️'
};

/**
 * Categorize navigation items into visual sections.
 */
function getSectionForRoute(route: string): string {
  if (route.startsWith('/properties')) return 'Portfolio';
  if (route.startsWith('/contacts') || route.startsWith('/leases') || route.startsWith('/maintenance')) return 'Operations';
  if (route.startsWith('/accounting')) return 'Financials';
  if (route.startsWith('/backup') || route.startsWith('/admin') || route.startsWith('/system')) return 'System';
  return 'General';
}

function normalizeSection(rawSec?: string): string {
  if (!rawSec) return 'General';
  const lower = rawSec.toLowerCase().trim();
  if (lower.startsWith('port')) return 'Portfolio';
  if (lower.startsWith('oper')) return 'Operations';
  if (lower.startsWith('fin')) return 'Financials';
  if (lower.startsWith('sys') || lower.startsWith('admin')) return 'System';
  return rawSec.charAt(0).toUpperCase() + rawSec.slice(1);
}

/**
 * Server-side renders the primary application navigation sidebar.
 * Organizes registered module hooks into categorical sections (Portfolio, Operations, Financials, System).
 *
 * @param navItems - List of navigation items registered across core and modular subsystems.
 * @param currentPath - Active request URL path for highlighting the selected item.
 * @param branding - Optional operator branding parameters (logo, brand name).
 * @param user - Active session user profile, or null.
 * @returns SafeHtml template component.
 */
export function renderSidebar(
  navItems: NavigationItem[],
  currentPath: string,
  branding?: { brand_name?: string; logo_url?: string | null },
  user?: SessionUser | null
): SafeHtml {
  const isDashboardActive = currentPath === '/' || currentPath === '/dashboard';
  let appVersion = '0.1.0-dev';
  try {
    appVersion = getApplicationVersion();
  } catch {
    // Graceful fallback if VERSION file lookup fails
  }

  const brandName = branding?.brand_name?.trim() || 'GarrisonOS';
  const logoUrl = branding?.logo_url?.trim() || null;
  const monogram = brandName.slice(0, 2).toUpperCase() || 'GS';

  // Group items by section
  const sections: Record<string, NavigationItem[]> = {
    'Portfolio': [],
    'Operations': [],
    'Financials': [],
    'System': []
  };

  for (const item of navItems) {
    const rawSec = item.section || getSectionForRoute(item.route);
    const sec = normalizeSection(rawSec);
    if (!sections[sec]) {
      sections[sec] = [];
    }
    sections[sec].push(item);
  }

  // Include admin panel link for owner roles if not already present
  if (user?.role === 'owner' || user?.role === 'system_owner') {
    if (!sections['System']) {
      sections['System'] = [];
    }
    const systemItems = sections['System'];
    const hasAdmin = systemItems.some((it) => it.route === '/admin');
    if (!hasAdmin) {
      systemItems.push({
        label: 'Administration',
        route: '/admin',
        icon: 'settings',
        order: 99,
        section: 'System'
      });
    }
  }

  // Sort items within each section by defined order
  for (const items of Object.values(sections)) {
    items.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  const renderedSections: SafeHtml[] = [];

  for (const [sectionName, items] of Object.entries(sections)) {
    if (items.length === 0) continue;
    const itemsHtml = items.map((item) => {
      const isActive = currentPath === item.route || currentPath.startsWith(item.route + '/');
      const icon = ICON_MAP[item.icon ?? ''] ?? '📁';
      const activeClass = isActive ? 'active' : '';

      return html`
        <a href="${item.route}" class="nav-link ${activeClass}">
          <span>${icon}</span> ${item.label}
        </a>
      `;
    });

    renderedSections.push(html`
      <div class="nav-section-title">${sectionName}</div>
      ${itemsHtml}
    `);
  }

  return html`
    <aside class="sidebar">
      <div class="sidebar-header">
        <a href="/dashboard">
          ${logoUrl
            ? html`<img src="${logoUrl}" alt="${brandName}" class="brand-logo-img">`
            : html`<span class="brand-monogram">${monogram}</span>`}
          <span>${brandName}</span>
        </a>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-section-title">Overview</div>
        <a href="/dashboard" class="nav-link ${isDashboardActive ? 'active' : ''}">
          <span>📊</span> Dashboard
        </a>
        ${renderedSections}
      </nav>
      <div class="sidebar-footer">
        <small>GarrisonOS v${appVersion}</small>
      </div>
    </aside>
  `;
}
