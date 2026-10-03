import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';
import { renderPagination } from '../../../../web/templates/pagination.js';

function formatDate(epochMs: number): string {
  try {
    const d = new Date(epochMs);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch {
    return '';
  }
}

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function handle(ctx: PageContext): Promise<PageResult> {
  const statusFilter = ctx.query['status'] || '';
  const propertyFilter = ctx.query['property_id'] || '';
  const page = Math.max(1, parseInt(ctx.query['page'] || '1', 10) || 1);
  const limit = 10;
  const csrfToken = ctx.session.getCsrfToken();
  let error: string | null = null;

  if (ctx.method === 'POST' && ctx.body['action'] === 'create_lease') {
    if (!validateCsrf(csrfToken, ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF token validation failed.</div>`
      };
    }

    try {
      const startDate = new Date(ctx.body['start_date'] ?? '').getTime();
      const endDate = new Date(ctx.body['end_date'] ?? '').getTime();
      const rentCents = Math.round(parseFloat(ctx.body['rent_amount'] ?? '0') * 100);
      const depositCents = Math.round(parseFloat(ctx.body['security_deposit'] ?? '0') * 100);

      const contactsPayload: any[] = [];
      if (ctx.body['contact_id']) {
        contactsPayload.push({
          contact_id: ctx.body['contact_id'],
          role: 'primary_tenant',
          is_financially_responsible: true
        });
      }

      await ctx.api.post('/api/v1/leases', {
        unit_id: ctx.body['unit_id'] ?? '',
        status: ctx.body['status'] ?? 'active',
        start_date: startDate,
        end_date: endDate,
        rent_amount_cents: rentCents,
        security_deposit_cents: depositCents,
        deposit_held_cents: depositCents,
        rent_due_day: parseInt(ctx.body['rent_due_day'] ?? '1', 10),
        late_fee_grace_days: parseInt(ctx.body['late_fee_grace_days'] ?? '5', 10),
        late_fee_amount_cents: Math.round(parseFloat(ctx.body['late_fee_amount'] ?? '50') * 100),
        contacts: contactsPayload
      });

      ctx.session.addFlash('success', 'Lease agreement created successfully');
      return { redirect: '/leases', content: '' };
    } catch (err: any) {
      error = err.message;
    }
  }

  let leases: any[] = [];
  let units: any[] = [];
  let contacts: any[] = [];
  let properties: any[] = [];

  try {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    const queryStr = params.toString() ? `?${params.toString()}` : '';

    const res = await ctx.api.get(`/api/v1/leases${queryStr}`);
    leases = res?.data?.leases || [];

    const propRes = await ctx.api.get('/api/v1/properties/units');
    units = propRes?.data?.units || [];

    const propListRes = await ctx.api.get('/api/v1/properties');
    properties = propListRes?.data?.properties || [];

    const contRes = await ctx.api.get('/api/v1/contacts?type=tenant');
    contacts = contRes?.data?.contacts || [];
  } catch (err: any) {
    error = error || err.message;
  }

  const leasesByProperty = new Map<string, number>();
  for (const l of leases) {
    if (l.property_id) {
      leasesByProperty.set(l.property_id, (leasesByProperty.get(l.property_id) || 0) + 1);
    }
  }

  // Filter leases by property if specified
  const filteredLeases = propertyFilter
    ? leases.filter((l) => l.property_id === propertyFilter || l.property_name === propertyFilter)
    : leases;

  const total = filteredLeases.length;
  const paginatedLeases = filteredLeases.slice((page - 1) * limit, page * limit);

  const errorAlert = error
    ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>`
    : raw('');

  const leaseRows = paginatedLeases.length > 0
    ? paginatedLeases.map((l) => {
        let statusClass = 'badge-info';
        if (l.status === 'active') statusClass = 'badge-success';
        else if (l.status === 'expiring') statusClass = 'badge-warning';
        else if (l.status === 'terminated') statusClass = 'badge-danger';

        const statusFormatted = (l.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

        return html`
          <tr data-entity="lease" data-id="${l.id}" data-status="${l.status}" data-amount-cents="${l.rent_amount_cents}">
            <td>
              <strong><a href="/leases/show?id=${encodeURIComponent(l.id)}" data-entity-id="${l.id}" data-entity-type="lease">${l.property_name || 'Property'}</a></strong>
              <button class="btn-icon" data-action="copy-id" data-copy-value="${l.id}" title="Copy Lease ID" style="margin-left: 0.35rem; font-size: 0.75rem; background: transparent; border: none; cursor: pointer;">📋</button>
              <div class="text-muted text-sm">Unit ${l.unit_number || '—'}</div>
            </td>
            <td><span class="badge ${statusClass}">${statusFormatted}</span></td>
            <td>${formatDate(l.start_date)} – ${formatDate(l.end_date)}</td>
            <td><strong>$${formatCurrency(l.rent_amount_cents)}</strong>/mo</td>
            <td>$${formatCurrency(l.deposit_held_cents || 0)}</td>
            <td><a href="/leases/show?id=${encodeURIComponent(l.id)}" data-entity-id="${l.id}" data-entity-type="lease" class="btn btn-sm btn-secondary">View Details</a></td>
          </tr>
        `;
      })
    : [html`
        <tr>
          <td colspan="6" class="text-center text-muted">No leases matching the selected criteria.</td>
        </tr>
      `];

  const unitOptions = units.map((u) => html`<option value="${u.id}">Unit ${u.unit_number} (${u.status})</option>`);
  const contactOptions = contacts.map((c) => html`<option value="${c.id}">${c.last_name}, ${c.first_name}</option>`);

  const now = new Date();
  const defaultStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const nextYear = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), 0));
  const defaultEnd = `${nextYear.getUTCFullYear()}-${String(nextYear.getUTCMonth() + 1).padStart(2, '0')}-${String(nextYear.getUTCDate()).padStart(2, '0')}`;

  const buildStatusUrl = (status: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (propertyFilter) params.set('property_id', propertyFilter);
    const qs = params.toString();
    return `/leases${qs ? `?${qs}` : ''}`;
  };

  const content = html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Lease Agreements</h1>
        <p class="page-subtitle">Track lease contracts, rent amounts, terms, and occupants.</p>
      </div>
      <button class="btn btn-primary" onclick="document.getElementById('addLeaseModal').showModal()">+ New Lease</button>
    </div>

    ${errorAlert}

    <!-- Filters Bar -->
    <div class="filter-bar card" style="display: flex; gap: 1rem; align-items: center; justify-content: space-between; flex-wrap: wrap;">
      <div class="filter-pills">
        <a href="${buildStatusUrl('')}" class="filter-pill ${!statusFilter ? 'active' : ''}">All</a>
        <a href="${buildStatusUrl('active')}" class="filter-pill ${statusFilter === 'active' ? 'active' : ''}">Active</a>
        <a href="${buildStatusUrl('draft')}" class="filter-pill ${statusFilter === 'draft' ? 'active' : ''}">Draft</a>
        <a href="${buildStatusUrl('month_to_month')}" class="filter-pill ${statusFilter === 'month_to_month' ? 'active' : ''}">Month-to-Month</a>
        <a href="${buildStatusUrl('expiring')}" class="filter-pill ${statusFilter === 'expiring' ? 'active' : ''}">Expiring</a>
        <a href="${buildStatusUrl('terminated')}" class="filter-pill ${statusFilter === 'terminated' ? 'active' : ''}">Terminated</a>
      </div>

      <form method="GET" action="/leases" style="display: flex; gap: 0.5rem; align-items: center; margin: 0;">
        ${statusFilter ? html`<input type="hidden" name="status" value="${statusFilter}">` : raw('')}
        <select class="form-select form-input-sm" name="property_id" onchange="this.form.submit()" style="max-width: 260px;">
          <option value="">All Properties (${leases.length})</option>
          ${properties.map((p) => html`
            <option value="${p.id}" ${propertyFilter === p.id ? 'selected' : ''}>${p.name} (${leasesByProperty.get(p.id) || 0})</option>
          `)}
        </select>
        ${propertyFilter ? html`<a href="${buildStatusUrl('')}" class="btn btn-sm btn-secondary">Clear</a>` : raw('')}
      </form>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Leases (${total})</h2>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Property / Unit</th>
              <th>Status</th>
              <th>Term Dates</th>
              <th>Monthly Rent</th>
              <th>Deposit Held</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${leaseRows}
          </tbody>
        </table>
      </div>
      ${renderPagination({
        page,
        limit,
        total,
        baseUrl: '/leases',
        queryParams: { status: statusFilter, property_id: propertyFilter }
      })}
    </div>

    <!-- Modal: New Lease -->
    <dialog id="addLeaseModal" class="modal">
      <form method="POST" action="/leases" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="create_lease">
        <div class="modal-header">
          <h3>Create Lease Agreement</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('addLeaseModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="unit_id">Select Unit *</label>
              <select class="form-select" id="unit_id" name="unit_id" required>
                <option value="">-- Choose Unit --</option>
                ${unitOptions}
              </select>
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="contact_id">Primary Tenant</label>
              <select class="form-select" id="contact_id" name="contact_id">
                <option value="">-- Select Contact --</option>
                ${contactOptions}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="start_date">Start Date *</label>
              <input class="form-input" type="date" id="start_date" name="start_date" required value="${defaultStart}">
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="end_date">End Date *</label>
              <input class="form-input" type="date" id="end_date" name="end_date" required value="${defaultEnd}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="rent_amount">Monthly Rent ($) *</label>
              <input class="form-input" type="number" id="rent_amount" name="rent_amount" step="0.01" required placeholder="1500.00">
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="security_deposit">Security Deposit ($)</label>
              <input class="form-input" type="number" id="security_deposit" name="security_deposit" step="0.01" placeholder="1500.00">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group col-4">
              <label class="form-label" for="rent_due_day">Rent Due Day</label>
              <input class="form-input" type="number" id="rent_due_day" name="rent_due_day" value="1" min="1" max="28">
            </div>
            <div class="form-group col-4">
              <label class="form-label" for="late_fee_grace_days">Grace Days</label>
              <input class="form-input" type="number" id="late_fee_grace_days" name="late_fee_grace_days" value="5">
            </div>
            <div class="form-group col-4">
              <label class="form-label" for="late_fee_amount">Late Fee ($)</label>
              <input class="form-input" type="number" id="late_fee_amount" name="late_fee_amount" value="50.00" step="0.01">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('addLeaseModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Agreement</button>
        </div>
      </form>
    </dialog>
  `;

  return {
    title: 'Lease Agreements',
    content
  };
}
