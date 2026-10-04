import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';
import { renderPagination } from '../../../../web/templates/pagination.js';

export async function handle(ctx: PageContext): Promise<PageResult> {
  const csrfToken = ctx.session.getCsrfToken();
  let error: string | null = null;
  const activeTab = (ctx.query['tab'] || 'queue').toLowerCase();
  const propertyFilter = ctx.query['property_id'] || '';
  const statusFilter = (ctx.query['status'] || '').toLowerCase();
  const page = Math.max(1, parseInt(ctx.query['page'] || '1', 10) || 1);
  const pageSize = 10;

  // POST Actions: Create Bill, Approve Bill, Void Bill
  if (ctx.method === 'POST') {
    if (!validateCsrf(csrfToken, ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF token validation failed.</div>`
      };
    }

    const action = ctx.body['action'] || '';
    try {
      if (action === 'create_bill') {
        const rawAmount = parseFloat(ctx.body['total_amount'] || '0') || 0;
        const totalAmountCents = Math.round(rawAmount * 100);

        // Parse allocation items from dynamic inputs
        const allocations: any[] = [];
        const propIds = Array.isArray(ctx.body['alloc_property_id']) ? ctx.body['alloc_property_id'] : [ctx.body['alloc_property_id']].filter(Boolean);
        const unitIds = Array.isArray(ctx.body['alloc_unit_id']) ? ctx.body['alloc_unit_id'] : [ctx.body['alloc_unit_id']];
        const leaseIds = Array.isArray(ctx.body['alloc_lease_id']) ? ctx.body['alloc_lease_id'] : [ctx.body['alloc_lease_id']];
        const accountIds = Array.isArray(ctx.body['alloc_account_id']) ? ctx.body['alloc_account_id'] : [ctx.body['alloc_account_id']].filter(Boolean);
        const amounts = Array.isArray(ctx.body['alloc_amount']) ? ctx.body['alloc_amount'] : [ctx.body['alloc_amount']].filter(Boolean);
        const descriptions = Array.isArray(ctx.body['alloc_desc']) ? ctx.body['alloc_desc'] : [ctx.body['alloc_desc']];

        for (let i = 0; i < propIds.length; i++) {
          const itemAmount = Math.round((parseFloat(amounts[i] || '0') || 0) * 100);
          allocations.push({
            property_id: propIds[i],
            unit_id: unitIds[i] || null,
            lease_id: leaseIds[i] || null,
            account_id: accountIds[i],
            amount_cents: itemAmount,
            description: descriptions[i] || null
          });
        }

        const dueDateMs = ctx.body['due_date'] ? new Date(ctx.body['due_date']).getTime() : Date.now() + 30 * 86400000;
        const invoiceDateMs = ctx.body['invoice_date'] ? new Date(ctx.body['invoice_date']).getTime() : Date.now();

        await ctx.api.post('/api/v1/accounting/bills', {
          vendor_id: ctx.body['vendor_id'],
          invoice_number: ctx.body['invoice_number'],
          invoice_date: invoiceDateMs,
          due_date: dueDateMs,
          total_amount_cents: totalAmountCents,
          work_order_id: ctx.body['work_order_id'] || undefined,
          notes: ctx.body['notes'] || null,
          allocations: allocations.length > 0 ? allocations : undefined
        });

        ctx.session.addFlash('success', `Bill #${ctx.body['invoice_number']} created successfully`);
        return { redirect: '/accounting/bills', content: '' };
      } else if (action === 'approve_bill') {
        const billId = ctx.body['bill_id'];
        await ctx.api.post(`/api/v1/accounting/bills/${encodeURIComponent(billId)}/approve`, {});
        ctx.session.addFlash('success', 'Bill approved for payment');
        return { redirect: '/accounting/bills', content: '' };
      } else if (action === 'void_bill') {
        const billId = ctx.body['bill_id'];
        await ctx.api.post(`/api/v1/accounting/bills/${encodeURIComponent(billId)}/void`, {
          reason: ctx.body['void_reason'] || 'Operator requested void'
        });
        ctx.session.addFlash('success', 'Bill voided');
        return { redirect: '/accounting/bills', content: '' };
      }
    } catch (err: any) {
      error = err.message;
    }
  }

  // Load bills list
  let bills: any[] = [];
  try {
    const res = await ctx.api.get('/api/v1/accounting/bills?limit=100');
    bills = res?.data || [];
  } catch (err: any) {
    error = error || err.message;
  }

  // Load properties, registered vendors, work orders, leases, and expense accounts for modal
  let properties: any[] = [];
  let expenseAccounts: any[] = [];
  let vendors: any[] = [];
  let workOrders: any[] = [];
  let leases: any[] = [];
  try {
    const propRes = await ctx.api.get('/api/v1/properties');
    properties = propRes?.data?.properties || propRes?.data || [];
  } catch (_) {}
  try {
    const coaRes = await ctx.api.get('/api/v1/accounting/chart-of-accounts');
    expenseAccounts = (coaRes?.data?.accounts || coaRes?.data || []).filter((a: any) => a.account_type === 'Expense');
  } catch (_) {}
  try {
    const vendRes = await ctx.api.get('/api/v1/contacts?contact_type=vendor');
    vendors = vendRes?.data?.contacts || vendRes?.data || [];
  } catch (_) {}
  try {
    const woRes = await ctx.api.get('/api/v1/maintenance/work-orders');
    workOrders = woRes?.data?.workOrders || woRes?.data || [];
  } catch (_) {}
  try {
    const leaseRes = await ctx.api.get('/api/v1/leases?status=active');
    leases = leaseRes?.data?.leases || leaseRes?.data || [];
  } catch (_) {}

  // Calculate status pie analytics
  let draftCount = 0, draftCents = 0;
  let approvedCount = 0, approvedCents = 0;
  let paidCount = 0, paidCents = 0;
  let voidCount = 0, voidCents = 0;
  let totalOpenCents = 0;

  const now = Date.now();
  const dayBuckets: Record<string, number> = {};

  for (const b of bills) {
    if (b.status === 'draft') {
      draftCount++;
      draftCents += b.total_amount_cents;
    } else if (b.status === 'approved') {
      approvedCount++;
      approvedCents += b.total_amount_cents;
      totalOpenCents += (b.total_amount_cents - (b.amount_paid_cents || 0));

      // 30-day outflow projection
      if (b.due_date >= now - 86400000 && b.due_date <= now + 30 * 86400000) {
        const dateKey = new Date(b.due_date).toISOString().slice(5, 10); // MM-DD
        dayBuckets[dateKey] = (dayBuckets[dateKey] || 0) + (b.total_amount_cents - (b.amount_paid_cents || 0));
      }
    } else if (b.status === 'paid') {
      paidCount++;
      paidCents += b.total_amount_cents;
    } else if (b.status === 'voided') {
      voidCount++;
      voidCents += b.total_amount_cents;
    }
  }

  const billsByProperty = new Map<string, number>();
  for (const b of bills) {
    if (b.property_id) {
      billsByProperty.set(b.property_id, (billsByProperty.get(b.property_id) || 0) + 1);
    }
    if (Array.isArray(b.allocations)) {
      for (const a of b.allocations) {
        if (a.property_id && a.property_id !== b.property_id) {
          billsByProperty.set(a.property_id, (billsByProperty.get(a.property_id) || 0) + 1);
        }
      }
    }
  }

  const sortedOutflowDays = Object.keys(dayBuckets).sort().slice(0, 14);
  const maxDayCents = Math.max(...Object.values(dayBuckets), 10000);

  // Filter bills
  const filteredBills = bills.filter((b: any) => {
    if (statusFilter && b.status !== statusFilter) return false;
    if (propertyFilter) {
      const matchAlloc = Array.isArray(b.allocations) && b.allocations.some((a: any) => a.property_id === propertyFilter);
      const matchProp = b.property_id === propertyFilter;
      if (!matchAlloc && !matchProp) return false;
    }
    return true;
  });

  const totalFiltered = filteredBills.length;
  const totalPages = Math.ceil(totalFiltered / pageSize) || 1;
  const paginatedBills = filteredBills.slice((page - 1) * pageSize, page * pageSize);

  const content = html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Accounts Payable Bills</h1>
        <p class="page-subtitle text-muted">
          Manage vendor invoices, multi-property allocation splits, and payment authorization.
        </p>
      </div>
      <div style="display: flex; gap: 0.75rem;">
        <button type="button" class="btn btn-primary" onclick="document.getElementById('new-bill-dialog').showModal()">
          + Enter New Bill
        </button>
      </div>
    </div>

    ${error ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>` : raw('')}

    <!-- Visual Status & 30-Day Cash Outflow Projections -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
      <!-- Status Breakdown Card -->
      <div class="card" style="padding: 1.25rem;">
        <h3 style="font-size: 0.95rem; font-weight: 600; margin-bottom: 1rem; color: var(--text-muted); text-transform: uppercase;">
          Bill Status Distribution
        </h3>
        <div style="display: flex; gap: 1.5rem; align-items: center;">
          <!-- SVG Pie Chart -->
          <svg width="110" height="110" viewBox="0 0 36 36" style="transform: rotate(-90deg); flex-shrink: 0;">
            <circle cx="18" cy="18" r="15.915" fill="#f1f5f9" />
            ${bills.length > 0
              ? html`
                  <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#3b82f6" stroke-width="3.8"
                    stroke-dasharray="${(draftCount / bills.length) * 100} 100" stroke-dashoffset="0" />
                  <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#16a34a" stroke-width="3.8"
                    stroke-dasharray="${(approvedCount / bills.length) * 100} 100" stroke-dashoffset="-${(draftCount / bills.length) * 100}" />
                  <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#64748b" stroke-width="3.8"
                    stroke-dasharray="${(paidCount / bills.length) * 100} 100" stroke-dashoffset="-${((draftCount + approvedCount) / bills.length) * 100}" />
                `
              : raw('')}
          </svg>
          <div style="flex: 1; font-size: 0.85rem; display: flex; flex-direction: column; gap: 0.35rem;">
            <div style="display: flex; justify-content: space-between;">
              <span><strong style="color: #3b82f6;">●</strong> Draft (${draftCount})</span>
              <span>$${(draftCents / 100).toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><strong style="color: #16a34a;">●</strong> Approved (${approvedCount})</span>
              <span>$${(approvedCents / 100).toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span><strong style="color: #64748b;">●</strong> Paid (${paidCount})</span>
              <span>$${(paidCents / 100).toFixed(2)}</span>
            </div>
            <div style="border-top: 1px solid var(--border-color); padding-top: 0.35rem; display: flex; justify-content: space-between; font-weight: 700;">
              <span>Total Open</span>
              <span>$${(totalOpenCents / 100).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 30-Day Cash Outflow Calendar Projection -->
      <div class="card" style="padding: 1.25rem;">
        <h3 style="font-size: 0.95rem; font-weight: 600; margin-bottom: 1rem; color: var(--text-muted); text-transform: uppercase;">
          Upcoming Cash Requirements (Next 14 Days)
        </h3>
        ${sortedOutflowDays.length > 0
          ? html`
              <div style="display: flex; align-items: flex-end; gap: 0.5rem; height: 100px; padding-top: 10px;">
                ${sortedOutflowDays.map((day) => {
                  const dayCents = dayBuckets[day] || 0;
                  const heightPercent = Math.max(10, Math.round((dayCents / maxDayCents) * 100));
                  return html`
                    <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.25rem;">
                      <span style="font-size: 0.65rem; color: var(--text-muted);">$${Math.round(dayCents / 100)}</span>
                      <div style="width: 100%; background: var(--primary); border-radius: 3px 3px 0 0; height: ${heightPercent}px;" title="${day}: $${(dayCents / 100).toFixed(2)}"></div>
                      <span style="font-size: 0.65rem; font-family: var(--font-mono);">${day}</span>
                    </div>
                  `;
                })}
              </div>
            `
          : html`
              <div style="display: flex; align-items: center; justify-content: center; height: 100px; color: var(--text-muted); font-size: 0.85rem;">
                No upcoming bills due in the next 14 days.
              </div>
            `}
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="search-tabs" style="display: flex; border-bottom: 1px solid var(--border-color); margin-bottom: 1.5rem; gap: 0.5rem;">
      <a href="/accounting/bills?tab=queue" class="tab-btn ${activeTab === 'queue' ? 'active' : ''}">
        Bills Queue <span class="badge badge-secondary">${bills.length}</span>
      </a>
      <a href="/accounting/bills?tab=recurring" class="tab-btn ${activeTab === 'recurring' ? 'active' : ''}">
        Recurring Schedules & Missing Invoices
      </a>
    </div>

    <!-- Tab 1: AP Bills Queue Table -->
    ${activeTab === 'queue'
      ? html`
          <!-- Filter Bar: Property & Status Filters -->
          <div class="filter-bar card">
            <form method="GET" action="/accounting/bills" style="display:flex; gap:1rem; align-items:center; flex-wrap:wrap; width: 100%;">
              <input type="hidden" name="tab" value="queue" />
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="display:inline-block; margin-right:0.5rem;" for="property_id">Property:</label>
                <select class="form-select form-input-sm" id="property_id" name="property_id" onchange="this.form.submit()">
                  <option value="">-- All Properties (${bills.length}) --</option>
                  ${properties.map((p) => html`
                    <option value="${p.id}" ${propertyFilter === p.id ? raw('selected') : raw('')}>${p.name} (${billsByProperty.get(p.id) || 0})</option>
                  `)}
                </select>
              </div>
              <div class="filter-pills" style="margin-left: auto;">
                <a href="/accounting/bills?tab=queue${propertyFilter ? `&property_id=${encodeURIComponent(propertyFilter)}` : ''}" class="filter-pill ${!statusFilter ? 'active' : ''}">All (${bills.length})</a>
                <a href="/accounting/bills?tab=queue&status=draft${propertyFilter ? `&property_id=${encodeURIComponent(propertyFilter)}` : ''}" class="filter-pill ${statusFilter === 'draft' ? 'active' : ''}">Draft (${draftCount})</a>
                <a href="/accounting/bills?tab=queue&status=approved${propertyFilter ? `&property_id=${encodeURIComponent(propertyFilter)}` : ''}" class="filter-pill ${statusFilter === 'approved' ? 'active' : ''}">Approved (${approvedCount})</a>
                <a href="/accounting/bills?tab=queue&status=paid${propertyFilter ? `&property_id=${encodeURIComponent(propertyFilter)}` : ''}" class="filter-pill ${statusFilter === 'paid' ? 'active' : ''}">Paid (${paidCount})</a>
                <a href="/accounting/bills?tab=queue&status=voided${propertyFilter ? `&property_id=${encodeURIComponent(propertyFilter)}` : ''}" class="filter-pill ${statusFilter === 'voided' ? 'active' : ''}">Voided (${voidCount})</a>
              </div>
            </form>
          </div>

          <div class="card" style="padding: 0; overflow-x: auto;">
            <table class="table" style="margin-bottom: 0;">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Vendor</th>
                  <th>Work Order</th>
                  <th>Invoice Date</th>
                  <th>Due Date</th>
                  <th>Total Amount</th>
                  <th>Amount Paid</th>
                  <th>Balance Due</th>
                  <th>Status</th>
                  <th style="text-align: right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${paginatedBills.length > 0
                  ? paginatedBills.map((b) => {
                      const isOverdue = b.due_date < now && b.status !== 'paid' && b.status !== 'voided';
                      const daysOverdue = isOverdue ? Math.floor((now - b.due_date) / 86400000) : 0;
                      const balanceCents = b.total_amount_cents - (b.amount_paid_cents || 0);

                      return html`
                        <tr
                          class="bill-row ${isOverdue ? 'row-overdue' : ''}"
                          id="bill-${b.id}"
                          data-entity-type="bill"
                          data-entity-id="${b.id}"
                          data-status="${b.status}"
                          data-amount-cents="${b.total_amount_cents}"
                          data-is-overdue="${isOverdue ? 'true' : 'false'}"
                          style="${isOverdue ? 'background-color: var(--danger-light);' : ''}"
                        >
                          <td style="font-weight: 600; font-family: var(--font-mono);">
                            ${b.invoice_number}
                            <button
                              type="button"
                              class="btn-copy-id"
                              data-action="copy-id"
                              data-target-id="${b.id}"
                              title="Copy Bill UUID"
                              style="background: none; border: none; cursor: pointer; opacity: 0.6; padding: 0 4px;"
                            >
                              📋
                            </button>
                          </td>
                          <td>${b.vendor_name || b.vendor_id?.slice(0, 8)}</td>
                          <td>
                            ${b.work_order_id
                              ? html`<a href="/maintenance/show?id=${encodeURIComponent(b.work_order_id)}" class="badge badge-info" title="View Linked Work Order">WO #${b.work_order_id.replace(/-/g, '').slice(0, 8).toUpperCase()}</a>`
                              : html`<span style="color: var(--text-muted); font-size: 0.8rem;">—</span>`}
                          </td>
                          <td>${new Date(b.invoice_date).toISOString().slice(0, 10)}</td>
                          <td>
                            ${new Date(b.due_date).toISOString().slice(0, 10)}
                            ${isOverdue
                              ? html`<span class="badge badge-danger" style="margin-left: 0.4rem;">${daysOverdue}d Overdue</span>`
                              : raw('')}
                          </td>
                          <td style="font-weight: 600;">$${(b.total_amount_cents / 100).toFixed(2)}</td>
                          <td class="text-muted">$${((b.amount_paid_cents || 0) / 100).toFixed(2)}</td>
                          <td style="font-weight: 700; color: ${balanceCents > 0 ? 'var(--danger)' : 'var(--success)'};">
                            $${(balanceCents / 100).toFixed(2)}
                          </td>
                          <td>
                            <span class="badge ${b.status === 'paid' ? 'badge-success' : b.status === 'approved' ? 'badge-primary' : 'badge-secondary'}">
                              ${b.status.toUpperCase()}
                            </span>
                          </td>
                          <td style="text-align: right; white-space: nowrap;">
                            ${b.status === 'draft'
                              ? html`
                                  <form method="POST" action="/accounting/bills" style="display: inline;">
                                    ${csrfField(csrfToken)}
                                    <input type="hidden" name="action" value="approve_bill" />
                                    <input type="hidden" name="bill_id" value="${b.id}" />
                                    <button type="submit" class="btn btn-sm btn-success">✓ Approve</button>
                                  </form>
                                `
                              : raw('')}
                            ${b.status === 'approved'
                              ? html`
                                  <a href="/accounting/checks" class="btn btn-sm btn-primary">Pay via Check</a>
                                `
                              : raw('')}
                            ${b.status !== 'voided' && b.status !== 'paid'
                              ? html`
                                  <form method="POST" action="/accounting/bills" style="display: inline; margin-left: 0.25rem;">
                                    ${csrfField(csrfToken)}
                                    <input type="hidden" name="action" value="void_bill" />
                                    <input type="hidden" name="bill_id" value="${b.id}" />
                                    <button type="submit" class="btn btn-sm btn-subtle" onclick="return confirm('Void this bill?')">
                                      Void
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
                        <td colspan="9" style="text-align: center; padding: 3rem 1.5rem;">
                          <div class="empty-state">
                            <span style="font-size: 2.5rem; display: block; margin-bottom: 0.5rem;">🧾</span>
                            <h4>No Bills in Queue</h4>
                            <p class="text-muted" style="max-width: 450px; margin: 0 auto 1rem;">
                              Vendor invoices and contractor bills entered into GarrisonOS will appear here for multi-property allocation, approval, and disbursement.
                            </p>
                            <button type="button" class="btn btn-primary" onclick="document.getElementById('new-bill-dialog').showModal()">
                              + Enter First Bill
                            </button>
                          </div>
                        </td>
                      </tr>
                    `}
              </tbody>
            </table>
          </div>
          ${renderPagination({
            page,
            limit: pageSize,
            total: totalFiltered,
            baseUrl: '/accounting/bills',
            queryParams: { tab: 'queue', property_id: propertyFilter, status: statusFilter }
          })}
        `
      : html`
          <!-- Tab 2: Recurring Schedules & Missing Invoices -->
          <div class="card" style="padding: 1.5rem;">
            <h3 style="margin-bottom: 0.5rem;">Recurring Bills & Utility Tracking</h3>
            <p class="text-muted" style="margin-bottom: 1.5rem;">
              Recurring bill schedules support both fixed-rate services (e.g. Landscaping) and variable-rate utilities (e.g. Electric/Water).
            </p>
            <div class="alert alert-info" style="display: flex; gap: 1rem; align-items: center;">
              <span style="font-size: 1.5rem;">💡</span>
              <div>
                <strong>Missing Invoices Monitor:</strong>
                All active utility and maintenance contracts configured with recurring billing schedules automatically flag if an expected billing period passes without a logged invoice.
              </div>
            </div>
          </div>
        `}

    <!-- Bill Entry Dialog Modal -->
    <dialog id="new-bill-dialog" class="modal modal-box" style="max-width: 820px; width: 95%; border-radius: var(--radius-lg); border: 1px solid var(--border-color); padding: 0; background: var(--bg-surface); color: var(--text-main);">
      <div style="padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface);">
        <h2 style="font-size: 1.25rem; font-weight: 700; margin: 0; color: var(--text-main);">Enter Vendor Bill & Allocation Split</h2>
        <button type="button" class="btn btn-sm btn-subtle" onclick="document.getElementById('new-bill-dialog').close()">✕</button>
      </div>
      <form method="POST" action="/accounting/bills" id="bill-entry-form" class="modal-box" style="padding: 1.5rem; background: var(--bg-surface); color: var(--text-main);">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="create_bill" />

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.25rem;">
          <div class="form-group">
            <label for="vendor_id">Vendor / Payee *</label>
            ${vendors.length > 0
              ? html`
                  <select id="vendor_id" name="vendor_id" class="form-control" required>
                    <option value="">-- Select Registered Vendor --</option>
                    ${vendors.map((v) => {
                      const vName = v.company_name
                        ? `${v.company_name} (${v.first_name} ${v.last_name})`
                        : `${v.first_name} ${v.last_name}`;
                      const w9Tag = v.w9_received ? ' [W-9 Verified]' : ' [No W-9]';
                      return html`<option value="${v.id}">${vName}${w9Tag}</option>`;
                    })}
                  </select>
                `
              : html`
                  <div style="border: 1px dashed var(--danger); border-radius: var(--radius-sm); padding: 0.5rem; font-size: 0.85rem; color: var(--danger);">
                    ⚠️ No registered vendors found. All bill payees must exist in Contacts.
                    <a href="/contacts" style="font-weight: 700; text-decoration: underline; margin-left: 0.25rem;">+ Add Vendor</a>
                  </div>
                  <input type="hidden" id="vendor_id" name="vendor_id" value="" required />
                `}
          </div>
          <div class="form-group">
            <label for="work_order_id">Linked Maintenance Work Order</label>
            <select id="work_order_id" name="work_order_id" class="form-control">
              <option value="">-- None (Operating Expense) --</option>
              ${workOrders.map((wo) => {
                const uStr = wo.unit_number ? ` (Unit ${wo.unit_number})` : '';
                return html`<option value="${wo.id}">WO #${wo.id.replace(/-/g, '').slice(0, 8).toUpperCase()}: ${wo.title} • ${wo.property_name || 'Property'}${uStr}</option>`;
              })}
            </select>
          </div>
          <div class="form-group">
            <label for="invoice_number">Invoice # *</label>
            <input type="text" id="invoice_number" name="invoice_number" class="form-control" placeholder="INV-2026-001" required />
          </div>
          <div class="form-group">
            <label for="invoice_date">Invoice Date</label>
            <input type="date" id="invoice_date" name="invoice_date" class="form-control" value="${new Date().toISOString().slice(0, 10)}" />
          </div>
          <div class="form-group">
            <label for="due_date">Due Date</label>
            <input type="date" id="due_date" name="due_date" class="form-control" value="${new Date(now + 30 * 86400000).toISOString().slice(0, 10)}" />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
          <div class="form-group">
            <label for="total_amount">Total Bill Amount ($) *</label>
            <input type="number" step="0.01" id="total_amount" name="total_amount" class="form-control" placeholder="0.00" required style="font-size: 1.2rem; font-weight: 700;" />
          </div>
          <div class="form-group">
            <label for="payment_method_intent">Payment Method Intent</label>
            <select id="payment_method_intent" name="payment_method_intent" class="form-control">
              <option value="check">Check (Print via Check Register)</option>
              <option value="ach">ACH / Direct Electronic Transfer</option>
              <option value="operator_credit_card">Operator Credit Card (Due to Operator Clearing)</option>
            </select>
          </div>
        </div>

        <!-- Dynamic Multi-Row Allocation Splits -->
        <fieldset class="card" style="padding: 1rem; margin-bottom: 1.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
            <legend style="font-size: 0.95rem; font-weight: 700; margin: 0;">Multi-Property / Lease Expense Splits</legend>
            <button type="button" class="btn btn-sm btn-secondary" id="btn-add-split-row">+ Add Line Split</button>
          </div>
          <table class="table" style="font-size: 0.85rem; margin-bottom: 0.75rem;" id="split-rows-table">
            <thead>
              <tr>
                <th style="width: 25%;">Property *</th>
                <th style="width: 26%;">Lease Billback (Quick Search)</th>
                <th style="width: 25%;">GL Expense Account *</th>
                <th style="width: 18%;">Amount ($) *</th>
                <th style="width: 6%;"></th>
              </tr>
            </thead>
            <tbody id="split-rows-body">
              <tr class="split-row">
                <td>
                  <select name="alloc_property_id" class="form-control form-control-sm alloc-property-select" required>
                    <option value="">-- Select Property --</option>
                    ${properties.map((p) => html`<option value="${p.id}">${p.name}</option>`)}
                  </select>
                </td>
                <td>
                  <select name="alloc_lease_id" class="form-control form-control-sm alloc-lease-select">
                    <option value="">-- No Billback (Owner Expense) --</option>
                    ${leases.map((l) => html`
                      <option value="${l.id}" data-property-id="${l.property_id || ''}">
                        ${l.property_name ? `${l.property_name} • ` : ''}${l.unit_number ? `Unit ${l.unit_number}` : 'Unit'} (Lease #${l.id.slice(0, 8)})
                      </option>
                    `)}
                  </select>
                </td>
                <td>
                  <select name="alloc_account_id" class="form-control form-control-sm" required>
                    <option value="">-- Expense Account --</option>
                    ${expenseAccounts.map((a) => html`<option value="${a.id}">${a.account_number} ${a.account_name}</option>`)}
                  </select>
                </td>
                <td>
                  <input type="number" step="0.01" name="alloc_amount" class="form-control form-control-sm split-amount" placeholder="0.00" required />
                </td>
                <td style="text-align: center;">
                  <button type="button" class="btn btn-sm btn-subtle btn-remove-row" style="color: var(--danger);">✕</button>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- Penny Balancing Counter -->
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; font-size: 0.9rem;">
            <span>Allocated: <strong id="lbl-allocated-total">$0.00</strong></span>
            <span id="lbl-remaining-balance" style="font-weight: 700; color: var(--danger);">
              Remaining to allocate: $0.00
            </span>
          </div>
          <div class="form-feedback error" id="allocation-balance-alert" style="display: none; color: var(--danger); font-size: 0.85rem; margin-top: 0.25rem;">
            Allocation splits must equal the total bill amount to the penny before submitting.
          </div>
        </fieldset>

        <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('new-bill-dialog').close()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="btn-submit-bill">Save Bill</button>
        </div>
      </form>
    </dialog>

    <script>
      (function() {
        function updateAllocationTotals() {
          const totalInput = document.getElementById('total_amount');
          const totalVal = Math.round((parseFloat(totalInput ? totalInput.value : '0') || 0) * 100);
          const amountInputs = document.querySelectorAll('.split-amount');
          let allocatedCents = 0;
          amountInputs.forEach(function(inp) {
            allocatedCents += Math.round((parseFloat(inp.value || '0') || 0) * 100);
          });
          const remainingCents = totalVal - allocatedCents;
          const lblAlloc = document.getElementById('lbl-allocated-total');
          const lblRem = document.getElementById('lbl-remaining-balance');
          const alertBox = document.getElementById('allocation-balance-alert');
          if (lblAlloc) lblAlloc.textContent = '$' + (allocatedCents / 100).toFixed(2);
          if (lblRem) {
            if (remainingCents === 0 && totalVal > 0) {
              lblRem.textContent = '✓ Perfectly Balanced';
              lblRem.style.color = 'var(--success)';
              if (alertBox) alertBox.style.display = 'none';
            } else if (remainingCents < 0) {
              lblRem.textContent = 'Overallocated by $' + (Math.abs(remainingCents) / 100).toFixed(2);
              lblRem.style.color = 'var(--danger)';
              if (alertBox) alertBox.style.display = 'block';
            } else {
              lblRem.textContent = 'Remaining to allocate: $' + (remainingCents / 100).toFixed(2);
              lblRem.style.color = 'var(--danger)';
              if (alertBox && totalVal > 0) alertBox.style.display = 'block';
            }
          }
        }

        function filterLeasesForRow(row) {
          const propSelect = row.querySelector('.alloc-property-select');
          const leaseSelect = row.querySelector('.alloc-lease-select');
          if (!propSelect || !leaseSelect) return;
          const selectedPropId = propSelect.value;
          const options = leaseSelect.querySelectorAll('option');
          options.forEach(function(opt) {
            const optPropId = opt.getAttribute('data-property-id');
            if (!optPropId || !selectedPropId || optPropId === selectedPropId) {
              opt.hidden = false;
            } else {
              opt.hidden = true;
              if (opt.selected) opt.selected = false;
            }
          });
        }

        document.addEventListener('input', function(e) {
          if (e.target && (e.target.id === 'total_amount' || e.target.classList.contains('split-amount'))) {
            updateAllocationTotals();
          }
        });

        document.addEventListener('change', function(e) {
          if (e.target && e.target.classList.contains('alloc-property-select')) {
            const row = e.target.closest('.split-row');
            if (row) filterLeasesForRow(row);
          }
        });

        const btnAdd = document.getElementById('btn-add-split-row');
        if (btnAdd) {
          btnAdd.addEventListener('click', function() {
            const body = document.getElementById('split-rows-body');
            const firstRow = body ? body.querySelector('.split-row') : null;
            if (firstRow && body) {
              const clone = firstRow.cloneNode(true);
              const inputs = clone.querySelectorAll('input, select');
              inputs.forEach(function(inp) {
                if (inp.name === 'alloc_amount') inp.value = '';
                else if (inp.tagName === 'SELECT') inp.selectedIndex = 0;
              });
              body.appendChild(clone);
              updateAllocationTotals();
            }
          });
        }

        document.addEventListener('click', function(e) {
          if (e.target && e.target.classList.contains('btn-remove-row')) {
            const rows = document.querySelectorAll('.split-row');
            if (rows.length > 1) {
              const row = e.target.closest('.split-row');
              if (row) row.remove();
              updateAllocationTotals();
            }
          }
        });
      })();
    </script>
  `;

  return {
    title: 'Accounts Payable Bills',
    content
  };
}
