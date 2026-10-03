import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';
import { renderPagination } from '../../../../web/templates/pagination.js';

/**
 * Handles presentation requests for listing contacts with type filtering,
 * full-text search, and creating new contacts.
 *
 * @param ctx - The active web page request context.
 * @returns A promise resolving to the rendered PageResult or redirect.
 */
export async function handle(ctx: PageContext): Promise<PageResult> {
  const typeFilter = ctx.query['type'] || '';
  const searchQuery = ctx.query['q'] || '';
  const page = Math.max(1, parseInt(ctx.query['page'] || '1', 10) || 1);
  const limit = 10;
  const csrfToken = ctx.session.getCsrfToken();
  let error: string | null = null;

  if (ctx.method === 'POST' && ctx.body['action'] === 'create_contact') {
    if (!validateCsrf(csrfToken, ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF token validation failed.</div>`
      };
    }

    try {
      await ctx.api.post('/api/v1/contacts', {
        contact_type: ctx.body['contact_type'] ?? 'tenant',
        first_name: ctx.body['first_name'] ?? '',
        last_name: ctx.body['last_name'] ?? '',
        company_name: ctx.body['company_name'] || null,
        email: ctx.body['email'] || null,
        phone: ctx.body['phone'] || null,
        secondary_phone: ctx.body['secondary_phone'] || null,
        vendor_specialty: ctx.body['vendor_specialty'] || null,
        w9_received: ctx.body['w9_received'] === '1' || ctx.body['w9_received'] === 'on' ? 1 : 0,
        tax_classification: ctx.body['tax_classification'] || null,
        notes: ctx.body['notes'] || null
      });
      ctx.session.addFlash('success', 'Contact created successfully');
      return { redirect: '/contacts', content: '' };
    } catch (err: any) {
      error = err.message;
    }
  }

  let contacts: any[] = [];
  try {
    const params = new URLSearchParams();
    if (typeFilter) params.set('contact_type', typeFilter);
    if (searchQuery) params.set('q', searchQuery);

    const queryStr = params.toString() ? `?${params.toString()}` : '';
    const res = await ctx.api.get(`/api/v1/contacts${queryStr}`);
    contacts = res?.data?.contacts || [];
  } catch (err: any) {
    error = error || err.message;
  }

  const total = contacts.length;
  const paginatedContacts = contacts.slice((page - 1) * limit, page * limit);

  const errorAlert = error
    ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>`
    : raw('');

  const contactRows = paginatedContacts.length > 0
    ? paginatedContacts.map((c) => {
        const typeFormatted = c.contact_type ? c.contact_type.charAt(0).toUpperCase() + c.contact_type.slice(1) : '';
        const isVendor = c.contact_type === 'vendor';
        const w9Badge = isVendor
          ? c.w9_received
            ? html`<span class="badge badge-success" title="W-9 On File">W-9 Verified</span> `
            : html`<span class="badge badge-warning" title="W-9 Not On File">W-9 Pending</span> `
          : raw('');

        return html`
          <tr data-entity="contact" data-id="${c.id}">
            <td>
              <strong><a href="/contacts/show?id=${encodeURIComponent(c.id)}">${c.last_name}, ${c.first_name}</a></strong>
              <button class="btn-icon" data-action="copy-id" data-copy-value="${c.id}" title="Copy Contact ID" style="margin-left: 0.35rem; font-size: 0.75rem; background: transparent; border: none; cursor: pointer;">📋</button>
              ${c.company_name ? html`<div class="text-muted text-sm">${c.company_name}</div>` : raw('')}
            </td>
            <td>
              <span class="badge">${typeFormatted}</span>
              ${w9Badge}
            </td>
            <td>${c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : '—'}</td>
            <td>${c.phone || '—'}</td>
            <td>
              ${c.vendor_specialty ? html`<span class="badge badge-info">${c.vendor_specialty}</span> ` : raw('')}
              <a href="/contacts/show?id=${encodeURIComponent(c.id)}" class="btn btn-sm btn-secondary">View</a>
            </td>
          </tr>
        `;
      })
    : [html`
        <tr>
          <td colspan="5" class="text-center text-muted">No contacts found.</td>
        </tr>
      `];

  const content = html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Contacts Directory</h1>
        <p class="page-subtitle">Tenants, owners, vendors, and emergency contacts.</p>
      </div>
      <button class="btn btn-primary" onclick="document.getElementById('addContactModal').showModal()">+ Add Contact</button>
    </div>

    ${errorAlert}

    <!-- Filters Bar -->
    <div class="filter-bar card">
      <div class="filter-pills">
        <a href="/contacts" class="filter-pill ${!typeFilter ? 'active' : ''}">All</a>
        <a href="/contacts?type=tenant" class="filter-pill ${typeFilter === 'tenant' ? 'active' : ''}">Tenants</a>
        <a href="/contacts?type=owner" class="filter-pill ${typeFilter === 'owner' ? 'active' : ''}">Owners</a>
        <a href="/contacts?type=vendor" class="filter-pill ${typeFilter === 'vendor' ? 'active' : ''}">Vendors</a>
        <a href="/contacts?type=guarantor" class="filter-pill ${typeFilter === 'guarantor' ? 'active' : ''}">Guarantors</a>
      </div>
      <form method="GET" action="/contacts" class="search-form">
        ${typeFilter ? html`<input type="hidden" name="type" value="${typeFilter}">` : raw('')}
        <input class="form-input form-input-sm" type="search" name="q" value="${searchQuery}" placeholder="Search name, phone, email...">
        <button type="submit" class="btn btn-sm btn-secondary">Search</button>
      </form>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Contacts (${total})</h2>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name / Organization</th>
              <th>Type</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${contactRows}
          </tbody>
        </table>
      </div>
      ${renderPagination({
        page,
        limit,
        total,
        baseUrl: '/contacts',
        queryParams: { type: typeFilter, q: searchQuery }
      })}
    </div>

    <!-- Modal: Add Contact -->
    <dialog id="addContactModal" class="modal">
      <form method="POST" action="/contacts" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="create_contact">
        <div class="modal-header">
          <h3>Add New Contact</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('addContactModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label" for="contact_type">Contact Type *</label>
            <select class="form-select" id="contact_type" name="contact_type" required>
              <option value="tenant">Tenant</option>
              <option value="owner">Property Owner</option>
              <option value="vendor">Vendor / Contractor</option>
              <option value="guarantor">Guarantor / Co-Signer</option>
              <option value="prospect">Prospect</option>
              <option value="emergency">Emergency Contact</option>
            </select>
          </div>
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="first_name">First Name *</label>
              <input class="form-input" type="text" id="first_name" name="first_name" required placeholder="Jane">
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="last_name">Last Name *</label>
              <input class="form-input" type="text" id="last_name" name="last_name" required placeholder="Doe">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="company_name">Company Name</label>
            <input class="form-input" type="text" id="company_name" name="company_name" placeholder="e.g. Apex Plumbing LLC">
          </div>
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="email">Email</label>
              <input class="form-input" type="email" id="email" name="email" placeholder="jane@example.com">
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="phone">Primary Phone</label>
              <input class="form-input" type="tel" id="phone" name="phone" placeholder="(555) 234-5678">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="vendor_specialty">Vendor Specialty (Trade)</label>
              <input class="form-input" type="text" id="vendor_specialty" name="vendor_specialty" placeholder="e.g. Plumbing, HVAC, Electrical">
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="tax_classification">Tax Classification</label>
              <select class="form-select" id="tax_classification" name="tax_classification">
                <option value="">— Select Classification —</option>
                <option value="individual">Individual / Sole Proprietor</option>
                <option value="llc">LLC</option>
                <option value="corporation">Corporation</option>
                <option value="partnership">Partnership</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div class="form-group" style="padding: 0.5rem 0;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
              <input type="checkbox" name="w9_received" value="1">
              <span><strong>W-9 Form Verified & On File</strong> (Required for 1099-NEC reporting)</span>
            </label>
          </div>
          <div class="form-group">
            <label class="form-label" for="notes">Notes</label>
            <textarea class="form-input" id="notes" name="notes" rows="2"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('addContactModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Contact</button>
        </div>
      </form>
    </dialog>
  `;

  return {
    title: 'Contacts Directory',
    content
  };
}
