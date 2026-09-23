import { html, raw, SafeHtml } from '../lib/html.js';
import { SessionUser } from '../lib/session.js';
import { hasPermission } from '../../core/rbac.js';

/**
 * Renders the top navigation header containing operator badge, dark mode toggle, and user authentication controls.
 *
 * @param user - Active authenticated user, or null if anonymous.
 * @param operatorId - Active operator context identifier string.
 * @param brandName - Dynamic operator brand name.
 * @returns SafeHtml template component.
 */
export function renderHeader(user: SessionUser | null, operatorId: string, brandName: string = 'GarrisonOS'): SafeHtml {
  const canAdmin = user ? (user.role === 'owner' || hasPermission(user.role, 'system:admin')) : false;

  return html`
    <header class="topbar">
      <div class="operator-selector">
        <span class="brand-badge">🏢 ${brandName}</span>
        <small class="text-muted font-mono" style="font-size: 0.75rem;">${operatorId}</small>
      </div>
      <div class="topbar-right">
        <button type="button" class="theme-toggle-btn" title="Toggle theme (Alt+D)">🌙 Dark</button>
        <div class="user-profile">
          ${user
            ? html`
                ${canAdmin ? html`<a href="/admin" class="btn btn-sm btn-secondary">⚙️ Admin</a>` : raw('')}
                <span>${user.first_name} ${user.last_name} <small class="text-muted">(${user.role})</small></span>
                <a href="/logout" class="btn btn-sm btn-secondary">Sign Out</a>
              `
            : html`
                <a href="/login" class="btn btn-sm btn-primary">Sign In</a>
              `}
        </div>
      </div>
    </header>
  `;
}
