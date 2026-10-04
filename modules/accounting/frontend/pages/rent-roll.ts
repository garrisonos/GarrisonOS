import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';
import { renderPagination } from '../../../../web/templates/pagination.js';

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function handle(ctx: PageContext): Promise<PageResult> {
  const csrfToken = ctx.session.getCsrfToken();
  let error: string | null = null;
  const propertyFilter = ctx.query['property_id'] || '';
  const page = Math.max(1, parseInt(ctx.query['page'] || '1', 10) || 1);
  const pageSize = 10;

  if (ctx.method === 'POST' && ctx.body['action'] === 'generate_rent') {
    if (!validateCsrf(csrfToken, ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF token validation failed.</div>`
      };
    }

    try {
      const now = new Date();
      const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const genRes = await ctx.api.post('/api/v1/accounting/generate-rent-charges', {
        month: ctx.body['target_month'] || defaultMonth
      });
      const created = genRes?.data?.result?.chargesCreated ?? 0;
      ctx.session.addFlash('success', `Generated ${created} rent charge(s) for the billing cycle`);
      return { redirect: '/accounting/rent-roll', content: '' };
    } catch (err: any) {
      error = err.message;
    }
  }

  let rentRoll: any[] = [];
  let summary: any = null;
  let properties: any[] = [];

  try {
    const [res, propRes] = await Promise.all([
      ctx.api.get('/api/v1/accounting/rent-roll'),
      ctx.api.get('/api/v1/properties').catch(() => ({ data: { properties: [] } }))
    ]);
    rentRoll = res?.data?.rentRoll || [];
    summary = res?.data?.summary || null;
    properties = propRes?.data?.properties || propRes?.data || [];
  } catch (err: any) {
    error = error || err.message;
  }

  const rollByProperty = new Map<string, number>();
  for (const r of rentRoll) {
    if (r.property_id) {
      rollByProperty.set(r.property_id, (rollByProperty.get(r.property_id) || 0) + 1);
    }
  }

  // Filter by property if selected
  const filteredRoll = propertyFilter
    ? rentRoll.filter((r) => r.property_id === propertyFilter || r.property_name === propertyFilter)
    : rentRoll;

  const displaySummary = propertyFilter
    ? {
        totalUnits: filteredRoll.length,
        totalScheduledRentCents: filteredRoll.reduce((acc, r) => acc + (r.monthly_rent_cents || 0), 0),
        totalDelinquencyCents: filteredRoll.reduce((acc, r) => acc + Math.max(0, r.balance_cents || 0), 0)
      }
    : summary;

  const totalFiltered = filteredRoll.length;
  const totalPages = Math.ceil(totalFiltered / pageSize) || 1;
  const paginatedRoll = filteredRoll.slice((page - 1) * pageSize, page * pageSize);

  const errorAlert = error
    ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>`
    : raw('');

  const summaryMetrics = displaySummary
    ? html`
      <div class="metrics-grid">
        <div class="card metric-card">
          <div class="metric-label">Active Leases</div>
          <div class="metric-value">${displaySummary.totalUnits ?? 0}</div>
        </div>
        <div class="card metric-card">
          <div class="metric-label">Scheduled Monthly Rent</div>
          <div class="metric-value text-success">$${formatCurrency(displaySummary.totalScheduledRentCents || 0)}</div>
        </div>
        <div class="card metric-card">
          <div class="metric-label">Total Outstanding Delinquency</div>
          <div class="metric-value ${(displaySummary.totalDelinquencyCents || 0) > 0 ? 'text-danger' : 'text-success'}">
            $${formatCurrency(displaySummary.totalDelinquencyCents || 0)}
          </div>
        </div>
      </div>
    `
    : raw('');

  const rentRollRows = paginatedRoll.length > 0
    ? paginatedRoll.map((row) => {
        let balanceHtml: SafeHtml;
        if (row.balance_cents > 0) {
          balanceHtml = html`<span class="text-danger font-bold">$${formatCurrency(row.balance_cents)} Owed</span>`;
        } else if (row.balance_cents < 0) {
          balanceHtml = html`<span class="text-success font-bold">$${formatCurrency(Math.abs(row.balance_cents))} Credit</span>`;
        } else {
          balanceHtml = html`<span class="text-muted">$0.00 Paid</span>`;
        }

        const statusFormatted = row.status ? row.status.charAt(0).toUpperCase() + row.status.slice(1) : '';

        return html`
          <tr data-entity="lease" data-id="${row.lease_id || ''}">
            <td>
              ${row.property_id
                ? html`<a href="/properties/show?id=${encodeURIComponent(row.property_id)}" data-entity-id="${row.property_id}" data-entity-type="property"><strong>${row.property_name}</strong></a>`
                : html`<strong>${row.property_name}</strong>`}
            </td>
            <td>
              ${row.unit_id
                ? html`<a href="/properties/units/show?id=${encodeURIComponent(row.unit_id)}" data-entity-id="${row.unit_id}" data-entity-type="unit">Unit ${row.unit_number}</a>`
                : html`Unit ${row.unit_number}`}
            </td>
            <td>
              ${row.tenant_contact_id
                ? html`<a href="/contacts/show?id=${encodeURIComponent(row.tenant_contact_id)}" data-entity-id="${row.tenant_contact_id}" data-entity-type="contact">${row.tenant_name}</a>`
                : row.tenant_name}
            </td>
            <td><span class="badge badge-success">${statusFormatted}</span></td>
            <td>$${formatCurrency(row.monthly_rent_cents || 0)}</td>
            <td>$${formatCurrency(row.deposit_held_cents || 0)}</td>
            <td>${balanceHtml}</td>
            <td>
              <a href="/accounting/ledger-detail?lease_id=${encodeURIComponent(row.lease_id)}" data-entity-id="${row.lease_id}" data-entity-type="lease" class="btn btn-sm btn-secondary">Ledger</a>
            </td>
          </tr>
        `;
      })
    : [html`
        <tr>
          <td colspan="8" class="text-center text-muted">No active leases on rent roll${propertyFilter ? ' for this property' : ''}.</td>
        </tr>
      `];

  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const content = html`
    <div class="page-header">
      <div>
        <a href="/accounting" class="text-muted">← Back to Accounting</a>
        <h1 class="page-title">Portfolio Rent Roll</h1>
        <p class="page-subtitle">Itemized unit occupancy, monthly scheduled rent, and live tenant ledger balances.</p>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="document.getElementById('generateRentModal').showModal()">⚡ Run Monthly Billing</button>
        <a href="/api/v1/accounting/export/rent-roll.csv" class="btn btn-secondary" target="_blank">Export CSV</a>
      </div>
    </div>

    ${errorAlert}
    ${summaryMetrics}

    <!-- Property Filter Bar -->
    <div class="filter-bar card">
      <form method="GET" action="/accounting/rent-roll" style="display:flex; gap:1rem; align-items:center; flex-wrap:wrap; width: 100%;">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" style="display:inline-block; margin-right:0.5rem;" for="property_id">Filter by Property:</label>
          <select class="form-select form-input-sm" id="property_id" name="property_id" onchange="this.form.submit()">
            <option value="">-- All Properties Combined (${rentRoll.length}) --</option>
            ${properties.map((p) => html`
              <option value="${p.id}" ${propertyFilter === p.id ? raw('selected') : raw('')}>${p.name} (${rollByProperty.get(p.id) || 0})</option>
            `)}
          </select>
        </div>
        ${propertyFilter
          ? html`<a href="/accounting/rent-roll" class="btn btn-sm btn-subtle" style="margin-left: auto;">Clear Filter</a>`
          : raw('')}
      </form>
    </div>

    <div class="card" style="padding: 0; overflow-x: auto;">
      <div class="table-responsive">
        <table class="data-table" style="margin-bottom: 0;">
          <thead>
            <tr>
              <th>Property</th>
              <th>Unit</th>
              <th>Tenant</th>
              <th>Status</th>
              <th>Scheduled Rent</th>
              <th>Deposit Held</th>
              <th>Tenant Balance</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rentRollRows}
          </tbody>
        </table>
      </div>
    </div>
    ${renderPagination({
      page,
      limit: pageSize,
      total: totalFiltered,
      baseUrl: '/accounting/rent-roll',
      queryParams: { property_id: propertyFilter }
    })}

    <!-- Modal: Run Monthly Billing -->
    <dialog id="generateRentModal" class="modal modal-box" style="background: var(--bg-surface); color: var(--text-main);">
      <form method="POST" action="/accounting/rent-roll" class="modal-box" style="background: var(--bg-surface); color: var(--text-main);">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="generate_rent">
        <div class="modal-header" style="border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem; margin-bottom: 1rem;">
          <h3 style="color: var(--text-main); margin: 0;">Generate Monthly Rent Charges</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('generateRentModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <p style="color: var(--text-main); margin-bottom: 1rem;">This will post monthly rent charges to the ledgers of all active leases for the selected billing month. Leases starting mid-month will have rent prorated automatically.</p>
          <div class="form-group" style="margin-top: 1rem;">
            <label class="form-label" for="target_month" style="color: var(--text-main);">Billing Month (YYYY-MM)</label>
            <input class="form-input" type="month" id="target_month" name="target_month" required value="${currentMonth}">
          </div>
        </div>
        <div class="modal-footer" style="border-top: 1px solid var(--border-color); padding-top: 1rem; margin-top: 1.5rem; display: flex; justify-content: flex-end; gap: 0.75rem;">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('generateRentModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Generate Charges</button>
        </div>
      </form>
    </dialog>
  `;

  return {
    title: 'Portfolio Rent Roll',
    content
  };
}
