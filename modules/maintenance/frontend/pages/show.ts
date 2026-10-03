import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';
import { renderCustomFields } from '../../../../web/templates/custom-fields.js';
import { renderConversationsWidget } from '../../../../web/templates/conversations.js';

/**
 * Format integer cents into USD currency string.
 *
 * @param cents - Value in integer cents.
 * @returns Formatted currency string (e.g. '1,250.00').
 */
function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Test trade specialty compatibility against work order category.
 *
 * @param vendorSpecialty - Vendor trade specialty.
 * @param category - Work order category.
 * @returns True if compatible or general contractor.
 */
function matchesSpecialty(vendorSpecialty?: string | null, category?: string | null): boolean {
  if (!vendorSpecialty || !category) return false;
  const spec = vendorSpecialty.toLowerCase().trim();
  const cat = category.toLowerCase().trim();
  if (spec === cat) return true;
  if (spec === 'general contractor' || spec === 'general repair' || spec === 'handyman') return true;
  if ((cat === 'cosmetic' || cat === 'other') && (spec === 'make_ready' || spec === 'turnkey' || spec === 'cleaning' || spec === 'painting' || spec === 'general contractor')) return true;
  return spec.includes(cat) || cat.includes(spec);
}

/**
 * Web request handler for viewing, editing, and tracking budget and expenses for individual work order tickets.
 *
 * @param ctx - Page request context including session, query, and body.
 * @returns Rendered HTML page or redirect response.
 */
export async function handle(ctx: PageContext): Promise<PageResult> {
  const id = ctx.query['id'] || '';
  if (!id) {
    return { redirect: '/maintenance', content: '' };
  }

  const csrfToken = ctx.session.getCsrfToken();
  let error: string | null = null;

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
      if (action === 'update_status') {
        await ctx.api.put(`/api/v1/maintenance/work-orders/${encodeURIComponent(id)}`, {
          status: ctx.body['status'] ?? 'open',
          vendor_contact_id: ctx.body['vendor_contact_id'] || null
        });
        ctx.session.addFlash('success', 'Work order status updated');
        return { redirect: `/maintenance/show?id=${encodeURIComponent(id)}`, content: '' };
      } else if (action === 'edit_details') {
        const estCostRaw = parseFloat(ctx.body['estimated_cost'] ?? '0') || 0;
        const estCostCents = Math.round(estCostRaw * 100);
        const schedDateRaw = ctx.body['scheduled_date'];
        const schedDateMs = schedDateRaw ? new Date(schedDateRaw).getTime() : null;

        await ctx.api.put(`/api/v1/maintenance/work-orders/${encodeURIComponent(id)}`, {
          title: ctx.body['title'],
          description: ctx.body['description'],
          category: ctx.body['category'],
          priority: ctx.body['priority'],
          status: ctx.body['status'],
          vendor_contact_id: ctx.body['vendor_contact_id'] || null,
          permission_to_enter: ctx.body['permission_to_enter'] === '1' || ctx.body['permission_to_enter'] === 'on' ? 1 : 0,
          entry_instructions: ctx.body['entry_instructions'] || null,
          scheduled_date: schedDateMs,
          estimated_cost_cents: estCostCents
        });
        ctx.session.addFlash('success', 'Work order details updated successfully');
        return { redirect: `/maintenance/show?id=${encodeURIComponent(id)}`, content: '' };
      } else if (action === 'log_expense') {
        const amountRaw = parseFloat(ctx.body['amount'] ?? '0') || 0;
        const amountCents = Math.round(amountRaw * 100);
        if (amountCents <= 0) {
          throw new Error('Expense amount must be greater than zero');
        }
        if (!ctx.body['vendor_id']) {
          throw new Error('Please select an existing registered vendor');
        }
        if (!ctx.body['invoice_number']) {
          throw new Error('Invoice # is required');
        }

        const invDateMs = ctx.body['invoice_date'] ? new Date(ctx.body['invoice_date']).getTime() : Date.now();
        const dueDateMs = ctx.body['due_date'] ? new Date(ctx.body['due_date']).getTime() : Date.now() + 30 * 86400000;

        await ctx.api.post('/api/v1/accounting/bills', {
          vendor_id: ctx.body['vendor_id'],
          work_order_id: id,
          invoice_number: ctx.body['invoice_number'],
          invoice_date: invDateMs,
          due_date: dueDateMs,
          total_amount_cents: amountCents,
          notes: ctx.body['notes'] || `Work order repair expense for WO #${id.slice(0, 8)}`,
          allocations: ctx.body['account_id']
            ? [
                {
                  property_id: ctx.body['property_id'],
                  unit_id: ctx.body['unit_id'] || null,
                  account_id: ctx.body['account_id'],
                  amount_cents: amountCents,
                  description: ctx.body['notes'] || `Maintenance repair expense for WO #${id.slice(0, 8)}`
                }
              ]
            : undefined
        });

        ctx.session.addFlash('success', `Expense bill #${ctx.body['invoice_number']} successfully linked to work order`);
        return { redirect: `/maintenance/show?id=${encodeURIComponent(id)}`, content: '' };
      } else if (action === 'assign_vendor') {
        if (!ctx.body['vendor_contact_id']) {
          throw new Error('Please select a contractor to assign');
        }
        await ctx.api.post(`/api/v1/maintenance/work-orders/${encodeURIComponent(id)}/vendors`, {
          vendor_contact_id: ctx.body['vendor_contact_id'],
          role: ctx.body['role'] || 'contractor',
          notes: ctx.body['notes'] || undefined
        });
        ctx.session.addFlash('success', 'Contractor assigned to work order');
        return { redirect: `/maintenance/show?id=${encodeURIComponent(id)}`, content: '' };
      } else if (action === 'remove_vendor') {
        await ctx.api.delete(`/api/v1/maintenance/work-orders/${encodeURIComponent(id)}/vendors/${encodeURIComponent(ctx.body['vendor_contact_id'])}`);
        ctx.session.addFlash('success', 'Contractor assignment removed');
        return { redirect: `/maintenance/show?id=${encodeURIComponent(id)}`, content: '' };
      } else if (action === 'complete_order') {
        const costCents = Math.round(parseFloat(ctx.body['actual_cost'] ?? '0') * 100);
        await ctx.api.post(`/api/v1/maintenance/work-orders/${encodeURIComponent(id)}/complete`, {
          actual_cost_cents: costCents
        });
        ctx.session.addFlash('success', 'Work order marked completed and expense recorded');
        return { redirect: `/maintenance/show?id=${encodeURIComponent(id)}`, content: '' };
      }
    } catch (err: any) {
      error = err.message;
    }
  }

  let workOrder: any = null;
  let vendors: any[] = [];
  let assignedVendors: any[] = [];
  let expenseAccounts: any[] = [];
  let conversations: any[] = [];
  let expensesData: {
    budget: {
      estimated_cost_cents: number;
      actual_cost_cents: number;
      total_invoiced_cents: number;
      total_paid_cents: number;
      remaining_variance_cents: number;
      is_over_budget: boolean;
      percent_utilized: number;
    };
    bills: any[];
  } = {
    budget: {
      estimated_cost_cents: 0,
      actual_cost_cents: 0,
      total_invoiced_cents: 0,
      total_paid_cents: 0,
      remaining_variance_cents: 0,
      is_over_budget: false,
      percent_utilized: 0
    },
    bills: []
  };

  try {
    const res = await ctx.api.get(`/api/v1/maintenance/work-orders/${encodeURIComponent(id)}`);
    workOrder = res?.data?.workOrder ?? null;

    const vendRes = await ctx.api.get('/api/v1/contacts?contact_type=vendor');
    vendors = vendRes?.data?.contacts || [];

    const expRes = await ctx.api.get(`/api/v1/maintenance/work-orders/${encodeURIComponent(id)}/expenses`);
    if (expRes?.data) {
      expensesData = expRes.data;
    }

    const [vendListRes, convRes, coaRes] = await Promise.all([
      ctx.api.get(`/api/v1/maintenance/work-orders/${encodeURIComponent(id)}/vendors`).catch(() => ({ data: { vendors: [] } })),
      ctx.api.get(`/api/v1/conversations?entity_type=work_order&entity_id=${encodeURIComponent(id)}`).catch(() => ({ data: [] })),
      ctx.api.get('/api/v1/accounting/chart-of-accounts').catch(() => ({ data: { accounts: [] } }))
    ]);

    assignedVendors = vendListRes?.data?.vendors || [];
    expenseAccounts = (coaRes?.data?.accounts || []).filter((a: any) => a.account_type === 'Expense');

    const rawConvList = Array.isArray(convRes?.data) ? convRes.data : (convRes?.data?.conversations || []);
    conversations = await Promise.all(
      rawConvList.map(async (c: any) => {
        try {
          const threadRes = await ctx.api.get(`/api/v1/conversations/${encodeURIComponent(c.id)}`);
          return threadRes?.data || c;
        } catch {
          return c;
        }
      })
    );
  } catch (err: any) {
    error = error || err.message;
  }

  if (!workOrder) {
    return {
      title: 'Work Order Not Found',
      content: html`
        <div class="alert alert-danger">Work order not found.</div>
        <p><a href="/maintenance" class="btn btn-secondary">← Back to Work Orders</a></p>
      `
    };
  }

  const errorAlert = error
    ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>`
    : raw('');

  const ticketCode = (workOrder.id || '').slice(0, 8).toUpperCase();
  const isDispatchable = workOrder.status === 'open' || workOrder.status === 'on_hold';
  const isCompletable = workOrder.status !== 'completed' && workOrder.status !== 'cancelled';

  const statusFormatted = (workOrder.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
  const prioFormatted = workOrder.priority ? workOrder.priority.charAt(0).toUpperCase() + workOrder.priority.slice(1) : '';
  const catFormatted = workOrder.category ? workOrder.category.charAt(0).toUpperCase() + workOrder.category.slice(1) : '';

  const vendorOptions = vendors.map((v) => {
    const isSelected = workOrder.vendor_contact_id === v.id;
    const specialtyText = v.vendor_specialty ? ` [${v.vendor_specialty}]` : '';
    const w9Text = v.w9_received ? ' [W-9 ✓]' : ' [W-9 Pending]';
    return html`
      <option value="${v.id}" ${isSelected ? raw('selected') : raw('')}>
        ${v.company_name ? `${v.company_name} (${v.first_name} ${v.last_name})` : `${v.last_name}, ${v.first_name}`}${specialtyText}${w9Text}
      </option>
    `;
  });

  const eligibleDispatchVendors = vendors.filter((v) => {
    return v.w9_received === 1 && matchesSpecialty(v.vendor_specialty, workOrder.category);
  });

  const dispatchVendorOptions = eligibleDispatchVendors.length > 0
    ? eligibleDispatchVendors.map((v) => {
        const isSelected = workOrder.vendor_contact_id === v.id;
        const specialtyText = v.vendor_specialty ? ` [${v.vendor_specialty}]` : '';
        return html`
          <option value="${v.id}" ${isSelected ? raw('selected') : raw('')}>
            ${v.company_name ? `${v.company_name} (${v.first_name} ${v.last_name})` : `${v.last_name}, ${v.first_name}`}${specialtyText} [W-9 ✓]
          </option>
        `;
      })
    : [html`<option value="" disabled>No W-9 verified vendors matching category "${catFormatted}"</option>`];

  const statuses = [
    { value: 'open', label: 'Open' },
    { value: 'assigned', label: 'Assigned to Vendor' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'on_hold', label: 'On Hold / Awaiting Parts' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' }
  ];

  const categories = [
    { value: 'plumbing', label: 'Plumbing' },
    { value: 'electrical', label: 'Electrical' },
    { value: 'hvac', label: 'HVAC' },
    { value: 'appliance', label: 'Appliance' },
    { value: 'structural', label: 'Structural' },
    { value: 'cosmetic', label: 'Cosmetic' },
    { value: 'pest', label: 'Pest Control' },
    { value: 'other', label: 'Other / General' }
  ];

  const priorities = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'emergency', label: 'Emergency' }
  ];

  const statusOptions = statuses.map((s) => {
    const isSelected = workOrder.status === s.value;
    return html`<option value="${s.value}" ${isSelected ? raw('selected') : raw('')}>${s.label}</option>`;
  });

  const categoryOptions = categories.map((c) => {
    const isSelected = workOrder.category === c.value;
    return html`<option value="${c.value}" ${isSelected ? raw('selected') : raw('')}>${c.label}</option>`;
  });

  const priorityOptions = priorities.map((p) => {
    const isSelected = workOrder.priority === p.value;
    return html`<option value="${p.value}" ${isSelected ? raw('selected') : raw('')}>${p.label}</option>`;
  });

  const descHtml = workOrder.description
    ? raw(String(workOrder.description).split(/\r?\n/).map((line) => html`${line}`.toString()).join('<br>'))
    : html`<span class="text-muted">No details provided.</span>`;

  const autoHoldBanner = workOrder.status === 'on_hold' && workOrder.hold_reason
    ? html`
      <div class="alert alert-warning" style="margin-bottom: 1.5rem; border-left: 4px solid #d97706; background: #fffbeb; padding: 1rem 1.25rem;">
        <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
          <span style="font-size: 1.5rem;">⚠️</span>
          <div>
            <strong style="color: #92400e; font-size: 1.05rem;">Work Order Automatically Placed On Hold</strong>
            <p style="margin: 0.25rem 0 0.5rem 0; color: #78350f;">
              ${workOrder.hold_reason}
            </p>
            <small style="color: #b45309;">
              This work order was automatically held because its estimated expense exceeds permissible spend thresholds or available portfolio operating cash.
            </small>
          </div>
        </div>
      </div>
    `
    : raw('');

  const conversationsHtml = renderConversationsWidget({
    entityType: 'work_order',
    entityId: id,
    conversations,
    canCreate: true,
    currentUserRole: ctx.session.user?.role || 'manager'
  });

  const content = html`
    <div class="page-header" data-entity="work_order" data-id="${workOrder.id}">
      <div>
        <a href="/maintenance" class="text-muted">← Back to Work Orders</a>
        <h1 class="page-title" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <span>${workOrder.title}</span>
          <span class="badge badge-${workOrder.status === 'completed' ? 'success' : workOrder.status === 'in_progress' ? 'primary' : 'info'}">
            ${statusFormatted}
          </span>
          <span class="badge badge-${workOrder.priority === 'emergency' ? 'danger' : workOrder.priority === 'high' ? 'warning' : 'secondary'}">
            ${prioFormatted}
          </span>
          <button class="btn-icon" data-action="copy-id" data-copy-value="${workOrder.id}" title="Copy Work Order ID" style="font-size: 0.85rem; background: transparent; border: none; cursor: pointer;">📋</button>
        </h1>
        <p class="page-subtitle">
          Ticket #${ticketCode} •
          <a href="/properties/show?id=${encodeURIComponent(workOrder.property_id)}" style="color: inherit; text-decoration: underline;">
            ${workOrder.property_name || 'Property'}
          </a>
          ${workOrder.unit_number ? html` (Unit ${workOrder.unit_number})` : raw('')}
        </p>
      </div>
      <div class="btn-group" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <button type="button" class="btn btn-secondary" data-action="copy-id" data-copy-value="${workOrder.id}">📋 Copy ID</button>
        <a href="/api/v1/maintenance/work-orders/${encodeURIComponent(id)}/pdf" target="_blank" class="btn btn-secondary" title="Download printable PDF dispatch sheet for field technicians">
          🖨️ Printable Work Order PDF
        </a>
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('editWorkOrderModal').showModal()">
          ✏️ Edit Details
        </button>
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('logExpenseModal').showModal()">
          💰 + Log Expense Bill
        </button>
        ${isDispatchable
          ? html`<button type="button" class="btn btn-secondary" onclick="document.getElementById('dispatchModal').showModal()">⚡ Dispatch Vendor</button>`
          : raw('')}
        ${isCompletable
          ? html`<button type="button" class="btn btn-primary" onclick="document.getElementById('completeOrderModal').showModal()">✓ Complete & Record Cost</button>`
          : workOrder.status === 'completed'
            ? html`<span class="badge badge-success" style="padding: 0.5rem 1rem; font-size: 1rem;">Completed</span>`
            : html`<span class="badge badge-danger" style="padding: 0.5rem 1rem; font-size: 1rem;">Cancelled</span>`}
      </div>
    </div>

    ${errorAlert}
    ${autoHoldBanner}

    <!-- Budget & Expense Tracking Section -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h2 class="card-title" style="margin: 0;">Budget & Expense Tracking</h2>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0.25rem 0 0 0;">
            Real-time variance analysis between approved budget estimate and itemized contractor invoices.
          </p>
        </div>
        <button type="button" class="btn btn-sm btn-primary" onclick="document.getElementById('logExpenseModal').showModal()">
          + Log Expense Bill
        </button>
      </div>

      <!-- KPI Summary Tiles -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin: 1rem 0;">
        <div class="kpi-card" style="background: var(--bg-surface-raised, rgba(0,0,0,0.02)); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem;">
          <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Authorized Budget</div>
          <div style="font-size: 1.4rem; font-weight: 700; margin-top: 0.25rem; font-family: var(--font-mono);">$${formatCurrency(expensesData.budget.estimated_cost_cents)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Initial approved estimate</div>
        </div>

        <div class="kpi-card" style="background: var(--bg-surface-raised, rgba(0,0,0,0.02)); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem;">
          <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Total Invoiced</div>
          <div style="font-size: 1.4rem; font-weight: 700; margin-top: 0.25rem; font-family: var(--font-mono); color: var(--primary);">$${formatCurrency(expensesData.budget.total_invoiced_cents)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Across ${expensesData.bills.length} vendor bill(s)</div>
        </div>

        <div class="kpi-card" style="background: var(--bg-surface-raised, rgba(0,0,0,0.02)); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem;">
          <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Remaining Variance</div>
          <div style="font-size: 1.4rem; font-weight: 700; margin-top: 0.25rem; font-family: var(--font-mono); color: ${expensesData.budget.is_over_budget ? 'var(--danger)' : 'var(--success)'};">
            ${expensesData.budget.is_over_budget ? '-' : '+'}$${formatCurrency(Math.abs(expensesData.budget.remaining_variance_cents))}
          </div>
          <div style="font-size: 0.75rem; color: ${expensesData.budget.is_over_budget ? 'var(--danger)' : 'var(--success)'}; margin-top: 0.25rem; font-weight: 600;">
            ${expensesData.budget.is_over_budget ? '⚠️ Over Budget' : '✓ Within Budget'}
          </div>
        </div>

        <div class="kpi-card" style="background: var(--bg-surface-raised, rgba(0,0,0,0.02)); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem;">
          <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Disbursed / Paid</div>
          <div style="font-size: 1.4rem; font-weight: 700; margin-top: 0.25rem; font-family: var(--font-mono);">$${formatCurrency(expensesData.budget.total_paid_cents)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Cleared vendor disbursements</div>
        </div>
      </div>

      <!-- Budget Progress Bar -->
      <div style="margin-bottom: 1.25rem;">
        <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.35rem;">
          <span>Budget Consumption</span>
          <span style="font-weight: 700; color: ${expensesData.budget.is_over_budget ? 'var(--danger)' : 'var(--text-main)'};">
            ${expensesData.budget.percent_utilized}% utilized
          </span>
        </div>
        <div style="height: 8px; width: 100%; background: var(--border-color); border-radius: 4px; overflow: hidden;">
          <div style="height: 100%; width: ${Math.min(100, expensesData.budget.percent_utilized)}%; background: ${expensesData.budget.is_over_budget ? 'var(--danger)' : expensesData.budget.percent_utilized > 80 ? 'var(--warning, #e67e22)' : 'var(--success)'}; border-radius: 4px;"></div>
        </div>
      </div>

      <!-- Itemized Linked Expenses Table -->
      <div style="overflow-x: auto; margin-top: 1rem;">
        <table class="table" style="margin-bottom: 0; font-size: 0.9rem;">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Vendor / Contractor</th>
              <th>Invoice Date</th>
              <th>Due Date</th>
              <th>Amount ($)</th>
              <th>Paid Amount</th>
              <th>Status</th>
              <th style="text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${expensesData.bills.length > 0
              ? expensesData.bills.map((b) => html`
                  <tr>
                    <td style="font-family: var(--font-mono); font-weight: 600;">
                      ${b.invoice_number}
                    </td>
                    <td>
                      ${b.vendor_name}
                      ${b.vendor_company ? html`<span class="text-muted" style="font-size: 0.8rem; display: block;">${b.vendor_company}</span>` : raw('')}
                    </td>
                    <td>${new Date(b.invoice_date).toISOString().slice(0, 10)}</td>
                    <td>${new Date(b.due_date).toISOString().slice(0, 10)}</td>
                    <td style="font-weight: 700; font-family: var(--font-mono);">$${formatCurrency(b.total_amount_cents)}</td>
                    <td class="text-muted" style="font-family: var(--font-mono);">$${formatCurrency(b.amount_paid_cents || 0)}</td>
                    <td>
                      <span class="badge ${b.status === 'paid' ? 'badge-success' : b.status === 'approved' ? 'badge-primary' : 'badge-secondary'}">
                        ${b.status.toUpperCase()}
                      </span>
                    </td>
                    <td style="text-align: right;">
                      <a href="/accounting/bills" class="btn btn-sm btn-subtle" title="View in Accounts Payable">View in AP →</a>
                    </td>
                  </tr>
                `)
              : html`
                  <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">
                      No contractor invoices or expenses have been linked to this work order yet.
                      <div style="margin-top: 0.5rem;">
                        <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('logExpenseModal').showModal()">
                          + Log Expense Bill
                        </button>
                      </div>
                    </td>
                  </tr>
                `}
          </tbody>
        </table>
      </div>
    </div>

    ${renderCustomFields('work_order', workOrder.custom_fields || {}, { operatorId: ctx.session.operatorId })}

    <!-- 2-Column Details Grid -->
    <div class="grid-2-col">
      <!-- Left Column: Issue Scope & Location -->
      <div class="card">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
          <h2 class="card-title">Issue Scope & Location</h2>
          <button type="button" class="btn btn-sm btn-subtle" onclick="document.getElementById('editWorkOrderModal').showModal()">✏️ Edit</button>
        </div>
        <div class="detail-list">
          <div class="detail-item">
            <span class="detail-label">Property</span>
            <span class="detail-value">
              <a href="/properties/show?id=${encodeURIComponent(workOrder.property_id)}" style="font-weight: 600;">
                ${workOrder.property_name || 'Property'}
              </a>
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Unit / Space</span>
            <span class="detail-value">${workOrder.unit_number ? `Unit ${workOrder.unit_number}` : 'Common Area / Entire Property'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Trade / Category</span>
            <span class="detail-value">${catFormatted}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Permission to Enter</span>
            <span class="detail-value">${workOrder.permission_to_enter ? 'Yes – Granted' : 'No – Requires Appointment'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Access / Lockbox Notes</span>
            <span class="detail-value">${workOrder.entry_instructions || 'Standard access on file.'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Scheduled Date</span>
            <span class="detail-value">${workOrder.scheduled_date ? new Date(workOrder.scheduled_date).toISOString().slice(0, 10) : 'Not Scheduled'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Authorized Budget</span>
            <span class="detail-value">$${formatCurrency(workOrder.estimated_cost_cents || 0)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Recorded Actual Cost</span>
            <span class="detail-value font-bold text-danger">$${formatCurrency(workOrder.actual_cost_cents || 0)}</span>
          </div>
        </div>
        <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
          <strong style="display: block; margin-bottom: 0.5rem;">Detailed Work Scope & Instructions:</strong>
          <div style="line-height: 1.6; background: var(--bg-surface-raised, rgba(0,0,0,0.01)); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
            ${descHtml}
          </div>
        </div>
      </div>

      <!-- Right Column: Dispatch & Contractor Information -->
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Assigned Contractor & Dispatch</h2>
        </div>

        <div style="margin-bottom: 1.5rem; background: var(--bg-surface-raised, rgba(0,0,0,0.02)); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem;">
          <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Current Contractor</div>
          <div style="font-size: 1.1rem; font-weight: 700; margin-top: 0.25rem;">
            ${workOrder.vendor_name || 'No Vendor Assigned'}
          </div>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">
            ${workOrder.vendor_contact_id ? 'Assigned service partner' : 'Self-managed or pending trade dispatch'}
          </div>
        </div>

        <form method="POST" action="/maintenance/show?id=${encodeURIComponent(id)}">
          ${csrfField(csrfToken)}
          <input type="hidden" name="action" value="update_status">
          <div class="form-group">
            <label class="form-label" for="status">Update Status</label>
            <select class="form-select" id="status" name="status">
              ${statusOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="vendor_contact_id">Assigned Vendor</label>
            <select class="form-select" id="vendor_contact_id" name="vendor_contact_id">
              <option value="">-- None / Self Managed --</option>
              ${vendorOptions}
            </select>
          </div>
          <button type="submit" class="btn btn-secondary">Update Status & Vendor</button>
        </form>

        <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 0.5rem;">
          <a href="/api/v1/maintenance/work-orders/${encodeURIComponent(id)}/pdf" target="_blank" class="btn btn-secondary" style="text-align: center;">
            🖨️ Generate Van Dispatch PDF
          </a>
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('logExpenseModal').showModal()">
            💰 Log Linked Expense Bill
          </button>
        </div>
      </div>
    </div>

    <!-- Assigned Contractors & Subcontractors -->
    <div class="card" style="margin-top: 1.5rem;">
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 class="card-title" style="margin: 0; font-size: 1.15rem;">Assigned Contractors & Specialists</h2>
          <small class="text-muted">Link multiple trade contractors, subcontractors, or inspectors to this work order</small>
        </div>
        <button type="button" class="btn btn-sm btn-primary" onclick="document.getElementById('assignVendorModal').showModal()">
          + Link Contractor
        </button>
      </div>

      <div style="overflow-x: auto; margin-top: 0.75rem;">
        <table class="table" style="margin-bottom: 0; font-size: 0.9rem;">
          <thead>
            <tr>
              <th>Contractor / Vendor</th>
              <th>Specialty</th>
              <th>Role</th>
              <th>Contact Info</th>
              <th>Notes / Scope</th>
              <th>Assigned Date</th>
              <th style="text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${assignedVendors.length > 0
              ? assignedVendors.map((v) => html`
                  <tr>
                    <td>
                      <strong>${v.vendor_name || 'Vendor'}</strong>
                      ${v.company_name ? html`<span class="text-muted" style="font-size: 0.8rem; display: block;">${v.company_name}</span>` : raw('')}
                    </td>
                    <td>
                      <span class="badge badge-subtle">${(v.vendor_specialty || 'General').toUpperCase()}</span>
                    </td>
                    <td>
                      <span class="badge ${v.role === 'primary' ? 'badge-primary' : 'badge-secondary'}">${v.role}</span>
                    </td>
                    <td>
                      ${v.phone ? html`<div>📞 ${v.phone}</div>` : raw('')}
                      ${v.email ? html`<small class="text-muted">✉️ ${v.email}</small>` : raw('')}
                      ${!v.phone && !v.email ? '—' : raw('')}
                    </td>
                    <td class="text-muted">${v.notes || '—'}</td>
                    <td>${new Date(v.assigned_at).toISOString().slice(0, 10)}</td>
                    <td style="text-align: right;">
                      <form method="POST" action="/maintenance/show?id=${encodeURIComponent(id)}" style="display: inline;" onsubmit="return confirm('Remove this contractor assignment?');">
                        ${csrfField(csrfToken)}
                        <input type="hidden" name="action" value="remove_vendor">
                        <input type="hidden" name="vendor_contact_id" value="${v.vendor_contact_id}">
                        <button type="submit" class="btn btn-sm btn-subtle" style="color: var(--danger); padding: 0.2rem 0.5rem;" title="Unlink Contractor">
                          ✕ Unlink
                        </button>
                      </form>
                    </td>
                  </tr>
                `)
              : html`
                  <tr>
                    <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">
                      ${workOrder.vendor_name
                        ? `Primary vendor assigned: ${workOrder.vendor_name}. You can link additional subcontractors or trade specialists above.`
                        : 'No additional contractors or specialists assigned to this work order yet.'}
                    </td>
                  </tr>
                `}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Status Updates, Comments & Operational Notes Widget -->
    <div style="margin-top: 1.5rem;">
      ${conversationsHtml}
    </div>

    <!-- Modal: Edit Work Order Details -->
    <dialog id="editWorkOrderModal" class="modal">
      <form method="POST" action="/maintenance/show?id=${encodeURIComponent(id)}" class="modal-box" style="max-width: 650px; width: 95%;">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="edit_details">
        <div class="modal-header">
          <h3>Edit Work Order Details</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('editWorkOrderModal').close()">✕</button>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; gap: 1rem;">
          <div class="form-group">
            <label class="form-label" for="edit_title">Title / Issue Summary *</label>
            <input class="form-input" type="text" id="edit_title" name="title" required value="${workOrder.title}">
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="form-group">
              <label class="form-label" for="edit_category">Trade Category</label>
              <select class="form-select" id="edit_category" name="category">
                ${categoryOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="edit_priority">Priority</label>
              <select class="form-select" id="edit_priority" name="priority">
                ${priorityOptions}
              </select>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="form-group">
              <label class="form-label" for="edit_status">Workflow Status</label>
              <select class="form-select" id="edit_status" name="status">
                ${statusOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="edit_vendor">Assigned Vendor</label>
              <select class="form-select" id="edit_vendor" name="vendor_contact_id">
                <option value="">-- None / In-House --</option>
                ${vendorOptions}
              </select>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="form-group">
              <label class="form-label" for="edit_scheduled_date">Scheduled Date</label>
              <input class="form-input" type="date" id="edit_scheduled_date" name="scheduled_date" value="${workOrder.scheduled_date ? new Date(workOrder.scheduled_date).toISOString().slice(0, 10) : ''}">
            </div>
            <div class="form-group">
              <label class="form-label" for="edit_estimated_cost">Authorized Budget ($)</label>
              <input class="form-input" type="number" step="0.01" id="edit_estimated_cost" name="estimated_cost" value="${((workOrder.estimated_cost_cents || 0) / 100).toFixed(2)}">
            </div>
          </div>

          <div class="form-group">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
              <input type="checkbox" name="permission_to_enter" value="1" ${workOrder.permission_to_enter ? raw('checked') : raw('')}>
              <strong>Permission to Enter:</strong> Technician authorized to access property if resident is absent
            </label>
          </div>

          <div class="form-group">
            <label class="form-label" for="edit_entry_instructions">Access & Lockbox Instructions</label>
            <input class="form-input" type="text" id="edit_entry_instructions" name="entry_instructions" placeholder="Lockbox code, gate instructions, key notes" value="${workOrder.entry_instructions || ''}">
          </div>

          <div class="form-group">
            <label class="form-label" for="edit_description">Detailed Scope & Instructions</label>
            <textarea class="form-textarea" id="edit_description" name="description" rows="4">${workOrder.description || ''}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('editWorkOrderModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </form>
    </dialog>

    <!-- Modal: Log Linked Expense Bill -->
    <dialog id="logExpenseModal" class="modal">
      <form method="POST" action="/maintenance/show?id=${encodeURIComponent(id)}" class="modal-box" style="max-width: 600px; width: 95%;">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="log_expense">
        <input type="hidden" name="property_id" value="${workOrder.property_id}">
        <input type="hidden" name="unit_id" value="${workOrder.unit_id || ''}">
        <div class="modal-header">
          <h3>Log Work Order Expense / Vendor Bill</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('logExpenseModal').close()">✕</button>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; gap: 1rem;">
          <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">
            Record a contractor invoice or materials expense linked directly to this work order. The bill will be logged in Accounts Payable and update actual costs.
          </p>

          <div class="form-group">
            <label class="form-label" for="expense_vendor_id">Vendor / Contractor *</label>
            ${vendors.length > 0
              ? html`
                  <select class="form-select" id="expense_vendor_id" name="vendor_id" required>
                    <option value="">-- Select Registered Vendor --</option>
                    ${vendors.map((v) => {
                      const isDefault = workOrder.vendor_contact_id === v.id;
                      const vName = v.company_name
                        ? `${v.company_name} (${v.first_name} ${v.last_name})`
                        : `${v.first_name} ${v.last_name}`;
                      const w9Tag = v.w9_received ? ' [W-9 Verified]' : ' [No W-9]';
                      return html`<option value="${v.id}" ${isDefault ? raw('selected') : raw('')}>${vName}${w9Tag}</option>`;
                    })}
                  </select>
                `
              : html`
                  <div style="border: 1px dashed var(--danger); border-radius: var(--radius-sm); padding: 0.5rem; font-size: 0.85rem; color: var(--danger);">
                    ⚠️ No registered vendors found. All expense payees must exist in Contacts.
                    <a href="/contacts" style="font-weight: 700; text-decoration: underline; margin-left: 0.25rem;">+ Add Vendor</a>
                  </div>
                  <input type="hidden" id="expense_vendor_id" name="vendor_id" value="" required />
                `}
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="form-group">
              <label class="form-label" for="expense_invoice_number">Invoice # *</label>
              <input class="form-input" type="text" id="expense_invoice_number" name="invoice_number" required placeholder="INV-WO-${workOrder.id.slice(-4).toUpperCase()}-1">
            </div>
            <div class="form-group">
              <label class="form-label" for="expense_amount">Amount ($) *</label>
              <input class="form-input" type="number" step="0.01" id="expense_amount" name="amount" required placeholder="0.00" value="${((expensesData.budget.remaining_variance_cents > 0 ? expensesData.budget.remaining_variance_cents : workOrder.estimated_cost_cents || 0) / 100).toFixed(2)}">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="form-group">
              <label class="form-label" for="expense_invoice_date">Invoice Date</label>
              <input class="form-input" type="date" id="expense_invoice_date" name="invoice_date" value="${new Date().toISOString().slice(0, 10)}">
            </div>
            <div class="form-group">
              <label class="form-label" for="expense_due_date">Due Date</label>
              <input class="form-input" type="date" id="expense_due_date" name="due_date" value="${new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)}">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="expense_account_id">GL Expense Account</label>
            <select class="form-select" id="expense_account_id" name="account_id">
              <option value="">-- Select Expense Account --</option>
              ${expenseAccounts.map((a) => html`<option value="${a.id}">${a.account_number} ${a.account_name}</option>`)}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="expense_notes">Description / Memo</label>
            <input class="form-input" type="text" id="expense_notes" name="notes" value="Repair expense for ${workOrder.title}">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('logExpenseModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Expense Bill</button>
        </div>
      </form>
    </dialog>

    <!-- Modal: Dispatch Vendor -->
    <dialog id="dispatchModal" class="modal">
      <form method="POST" action="/maintenance/show?id=${encodeURIComponent(id)}" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="update_status">
        <input type="hidden" name="status" value="assigned">
        <div class="modal-header">
          <h3>Dispatch Vendor for Work Order</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('dispatchModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <p>Assign a qualified trade contractor and transition this ticket to <strong>Assigned to Vendor</strong>.</p>
          <div class="form-group" style="margin-top: 1rem;">
            <label class="form-label" for="dispatch_vendor_id">Select Qualified Vendor / Contractor *</label>
            <select class="form-select" id="dispatch_vendor_id" name="vendor_contact_id" required>
              <option value="">-- Choose Trade Vendor --</option>
              ${dispatchVendorOptions}
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('dispatchModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Dispatch Work Order</button>
        </div>
      </form>
    </dialog>

    <!-- Modal: Complete Work Order -->
    <dialog id="completeOrderModal" class="modal">
      <form method="POST" action="/maintenance/show?id=${encodeURIComponent(id)}" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="complete_order">
        <div class="modal-header">
          <h3>Complete Maintenance Work Order</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('completeOrderModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <p>Marking this work order as complete will record a repair operating expense under Schedule E in the property ledger if an actual cost is provided.</p>
          <div class="form-group" style="margin-top: 1rem;">
            <label class="form-label" for="actual_cost">Actual Invoice / Repair Cost ($) *</label>
            <input class="form-input" type="number" id="actual_cost" name="actual_cost" step="0.01" required value="${((expensesData.budget.total_invoiced_cents > 0 ? expensesData.budget.total_invoiced_cents : workOrder.estimated_cost_cents || 0) / 100).toFixed(2)}">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('completeOrderModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Complete & Post Expense</button>
        </div>
      </form>
    </dialog>

    <!-- Modal: Link Contractor / Vendor -->
    <dialog id="assignVendorModal" class="modal">
      <form method="POST" action="/maintenance/show?id=${encodeURIComponent(id)}" class="modal-box" style="max-width: 520px; width: 95%;">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="assign_vendor">
        <div class="modal-header">
          <h3>Link Vendor / Contractor to Work Order</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('assignVendorModal').close()">✕</button>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; gap: 1rem;">
          <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">
            Attach a trade specialist, general contractor, or subcontractor to collaborate on this ticket.
          </p>
          <div class="form-group">
            <label class="form-label" for="assign_vendor_id">Select Vendor Contact *</label>
            <select class="form-select" id="assign_vendor_id" name="vendor_contact_id" required>
              <option value="">-- Choose Vendor --</option>
              ${vendorOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="assign_vendor_role">Functional Role</label>
            <select class="form-select" id="assign_vendor_role" name="role">
              <option value="contractor">Primary Contractor</option>
              <option value="subcontractor">Subcontractor</option>
              <option value="specialist">Trade Specialist</option>
              <option value="inspector">City / Insurance Inspector</option>
              <option value="estimator">Estimator / Assessor</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="assign_vendor_notes">Scope / Assignment Notes</label>
            <input class="form-input" type="text" id="assign_vendor_notes" name="notes" placeholder="e.g., Handle main line snaking or provide second estimate">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('assignVendorModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Link Contractor</button>
        </div>
      </form>
    </dialog>
  `;

  return {
    title: `Work Order #${ticketCode}`,
    content
  };
}
