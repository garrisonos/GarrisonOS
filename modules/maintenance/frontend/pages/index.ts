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

export async function handle(ctx: PageContext): Promise<PageResult> {
  const statusFilter = ctx.query['status'] || '';
  const priorityFilter = ctx.query['priority'] || '';
  const propertyFilter = ctx.query['property_id'] || '';
  const page = Math.max(1, parseInt(ctx.query['page'] || '1', 10) || 1);
  const limit = 10;
  const csrfToken = ctx.session.getCsrfToken();
  let error: string | null = null;

  if (ctx.method === 'POST' && ctx.body['action'] === 'create_work_order') {
    if (!validateCsrf(csrfToken, ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF token validation failed.</div>`
      };
    }

    try {
      const estCost = parseFloat(ctx.body['estimated_cost'] || '0') || 0;
      await ctx.api.post('/api/v1/maintenance/work-orders', {
        property_id: ctx.body['property_id'] ?? '',
        title: ctx.body['title'] ?? '',
        description: ctx.body['description'] ?? '',
        priority: ctx.body['priority'] ?? 'medium',
        category: ctx.body['category'] ?? 'other',
        vendor_contact_id: ctx.body['vendor_contact_id'] || null,
        permission_to_enter: ctx.body['permission_to_enter'] === '1' || ctx.body['permission_to_enter'] === true,
        entry_instructions: ctx.body['entry_instructions'] || null,
        estimated_cost_cents: Math.round(estCost * 100)
      });
      ctx.session.addFlash('success', 'Work order created successfully');
      return { redirect: '/maintenance', content: '' };
    } catch (err: any) {
      error = err.message;
    }
  }

  let workOrders: any[] = [];
  let properties: any[] = [];
  let vendors: any[] = [];
  let metrics: any = null;

  try {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (priorityFilter) params.set('priority', priorityFilter);
    if (propertyFilter) params.set('property_id', propertyFilter);
    const queryStr = params.toString() ? `?${params.toString()}` : '';

    const res = await ctx.api.get(`/api/v1/maintenance/work-orders${queryStr}`);
    workOrders = res?.data?.workOrders || [];

    const allOrdersRes = await ctx.api.get('/api/v1/maintenance/work-orders');
    const allOrders = allOrdersRes?.data?.workOrders || [];

    const metricRes = await ctx.api.get('/api/v1/maintenance/metrics');
    metrics = metricRes?.data?.metrics || null;

    const propRes = await ctx.api.get('/api/v1/properties');
    properties = propRes?.data?.properties || [];

    const vendRes = await ctx.api.get('/api/v1/contacts?type=vendor');
    vendors = vendRes?.data?.contacts || [];

    (ctx as any).__allOrders = allOrders;
  } catch (err: any) {
    error = error || err.message;
  }

  const allOrdersList: any[] = (ctx as any).__allOrders || workOrders;
  const ordersByProperty = new Map<string, number>();
  for (const o of allOrdersList) {
    if (o.property_id) {
      ordersByProperty.set(o.property_id, (ordersByProperty.get(o.property_id) || 0) + 1);
    }
  }

  const filteredWorkOrders = propertyFilter
    ? workOrders.filter((w) => w.property_id === propertyFilter || w.property_name === propertyFilter)
    : workOrders;

  const total = filteredWorkOrders.length;
  const paginatedWorkOrders = filteredWorkOrders.slice((page - 1) * limit, page * limit);

  const errorAlert = error
    ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>`
    : raw('');

  const metricsGrid = metrics
    ? html`
      <div class="metrics-grid">
        <div class="card metric-card">
          <div class="metric-label">Open Tickets</div>
          <div class="metric-value">${metrics.openWorkOrders ?? 0}</div>
        </div>
        <div class="card metric-card">
          <div class="metric-label">Emergency Repairs</div>
          <div class="metric-value ${(metrics.emergencyWorkOrders || 0) > 0 ? 'text-danger' : 'text-success'}">
            ${metrics.emergencyWorkOrders ?? 0}
          </div>
          <div class="metric-subtitle">
            ${(metrics.emergencyWorkOrders || 0) > 0 ? 'Requires immediate dispatch' : 'No active emergencies'}
          </div>
        </div>
        <div class="card metric-card">
          <div class="metric-label">Repairs In Progress</div>
          <div class="metric-value">${metrics.inProgressWorkOrders ?? 0}</div>
        </div>
        <div class="card metric-card">
          <div class="metric-label">Completed (30d)</div>
          <div class="metric-value text-success">${metrics.completedLast30Days ?? 0}</div>
        </div>
      </div>
    `
    : raw('');

  const workOrderRows = paginatedWorkOrders.length > 0
    ? paginatedWorkOrders.map((wo) => {
        let prioClass = 'badge';
        if (wo.priority === 'emergency') prioClass = 'badge-danger';
        else if (wo.priority === 'high') prioClass = 'badge-warning';
        else if (wo.priority === 'medium') prioClass = 'badge-info';

        let statusClass = 'badge';
        if (wo.status === 'completed') statusClass = 'badge-success';
        else if (wo.status === 'in_progress') statusClass = 'badge-info';
        else if (wo.status === 'open' || wo.status === 'assigned') statusClass = 'badge-warning';

        const prioFormatted = wo.priority ? wo.priority.charAt(0).toUpperCase() + wo.priority.slice(1) : '';
        const catFormatted = wo.category ? wo.category.charAt(0).toUpperCase() + wo.category.slice(1) : '';
        const statusFormatted = (wo.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

        return html`
          <tr data-entity="work_order" data-id="${wo.id}" data-status="${wo.status}">
            <td>
              <strong><a href="/maintenance/show?id=${encodeURIComponent(wo.id)}" data-entity-id="${wo.id}" data-entity-type="work_order">${wo.title}</a></strong>
              <button class="btn-icon" data-action="copy-id" data-copy-value="${wo.id}" title="Copy Work Order ID" style="margin-left: 0.35rem; font-size: 0.75rem; background: transparent; border: none; cursor: pointer;">📋</button>
              <div class="text-muted text-sm">WO-${wo.id.slice(-6).toUpperCase()} • ${formatDate(wo.created_at)}</div>
            </td>
            <td>
              ${wo.property_id
                ? html`<a href="/properties/show?id=${encodeURIComponent(wo.property_id)}" data-entity-id="${wo.property_id}" data-entity-type="property">${wo.property_name}</a>`
                : wo.property_name}
              ${wo.unit_number ? html` • Unit ${wo.unit_number}` : raw('')}
            </td>
            <td><span class="badge ${prioClass}">${prioFormatted}</span></td>
            <td><span class="badge">${catFormatted}</span></td>
            <td><span class="badge ${statusClass}">${statusFormatted}</span></td>
            <td>${wo.vendor_name ? wo.vendor_name : html`<span class="text-muted">Unassigned</span>`}</td>
            <td><a href="/maintenance/show?id=${encodeURIComponent(wo.id)}" data-entity-id="${wo.id}" data-entity-type="work_order" class="btn btn-sm btn-secondary">Manage</a></td>
          </tr>
        `;
      })
    : [html`
        <tr>
          <td colspan="7" class="text-center text-muted">No work orders matching the selected filters.</td>
        </tr>
      `];

  const propertyOptions = properties.map((p) => html`<option value="${p.id}">${p.name}</option>`);
  const vendorOptions = vendors.map((v) => html`
    <option value="${v.id}">
      ${v.last_name}, ${v.first_name}${v.company_name ? ` (${v.company_name})` : ''}
    </option>
  `);

  const buildFilterUrl = (status: string, propId: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (priorityFilter) params.set('priority', priorityFilter);
    if (propId) params.set('property_id', propId);
    const qs = params.toString();
    return `/maintenance${qs ? `?${qs}` : ''}`;
  };

  const content = html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Work Orders & Repairs</h1>
        <p class="page-subtitle">Track repair tickets, dispatch vendors, and record maintenance expenses.</p>
      </div>
      <div class="btn-group">
        <a href="/maintenance/preventative" class="btn btn-secondary">⏱️ Preventative Schedules</a>
        <button class="btn btn-primary" onclick="document.getElementById('addWorkOrderModal').showModal()">+ New Work Order</button>
      </div>
    </div>

    ${errorAlert}
    ${metricsGrid}

    <!-- Filter Pills & Property Dropdown -->
    <div class="filter-bar card" style="display: flex; gap: 1rem; align-items: center; justify-content: space-between; flex-wrap: wrap;">
      <div class="filter-pills">
        <a href="${buildFilterUrl('', propertyFilter)}" class="filter-pill ${!statusFilter ? 'active' : ''}">All Statuses</a>
        <a href="${buildFilterUrl('open', propertyFilter)}" class="filter-pill ${statusFilter === 'open' ? 'active' : ''}">Open</a>
        <a href="${buildFilterUrl('in_progress', propertyFilter)}" class="filter-pill ${statusFilter === 'in_progress' ? 'active' : ''}">In Progress</a>
        <a href="${buildFilterUrl('completed', propertyFilter)}" class="filter-pill ${statusFilter === 'completed' ? 'active' : ''}">Completed</a>
      </div>

      <form method="GET" action="/maintenance" style="display: flex; gap: 0.5rem; align-items: center; margin: 0;">
        ${statusFilter ? html`<input type="hidden" name="status" value="${statusFilter}">` : raw('')}
        ${priorityFilter ? html`<input type="hidden" name="priority" value="${priorityFilter}">` : raw('')}
        <select class="form-select form-input-sm" name="property_id" onchange="this.form.submit()" style="max-width: 260px;">
          <option value="">All Properties (${allOrdersList.length})</option>
          ${properties.map((p) => html`
            <option value="${p.id}" ${propertyFilter === p.id ? 'selected' : ''}>${p.name} (${ordersByProperty.get(p.id) || 0})</option>
          `)}
        </select>
        ${propertyFilter ? html`<a href="${buildFilterUrl(statusFilter, '')}" class="btn btn-sm btn-secondary">Clear</a>` : raw('')}
      </form>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Work Orders (${total})</h2>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ticket / Title</th>
              <th>Property / Unit</th>
              <th>Priority</th>
              <th>Category</th>
              <th>Status</th>
              <th>Assigned Vendor</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${workOrderRows}
          </tbody>
        </table>
      </div>
      ${renderPagination({
        page,
        limit,
        total,
        baseUrl: '/maintenance',
        queryParams: { status: statusFilter, priority: priorityFilter, property_id: propertyFilter }
      })}
    </div>

    <!-- Modal: New Work Order -->
    <dialog id="addWorkOrderModal" class="modal">
      <form method="POST" action="/maintenance" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="create_work_order">
        <div class="modal-header">
          <h3>Create Maintenance Work Order</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('addWorkOrderModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label" for="wo_property_id">Property *</label>
            <select class="form-select" id="wo_property_id" name="property_id" required>
              <option value="">-- Choose Property --</option>
              ${propertyOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="title">Title / Issue Summary *</label>
            <input class="form-input" type="text" id="title" name="title" required placeholder="e.g. Kitchen sink leaking under cabinet">
          </div>
          <div class="form-group">
            <label class="form-label" for="description">Detailed Description *</label>
            <textarea class="form-input" id="description" name="description" rows="3" required placeholder="Describe issue location, tenant report, and symptoms..."></textarea>
          </div>
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="priority">Priority *</label>
              <select class="form-select" id="priority" name="priority" required>
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="category">Trade / Category *</label>
              <select class="form-select" id="category" name="category" required>
                <option value="plumbing">Plumbing</option>
                <option value="electrical">Electrical</option>
                <option value="hvac">HVAC / Heating / AC</option>
                <option value="appliance">Appliance</option>
                <option value="structural">Structural / Roof / Windows</option>
                <option value="cosmetic">Cosmetic / Paint / Drywall</option>
                <option value="pest">Pest Control</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="vendor_contact_id">Assign Vendor</label>
              <select class="form-select" id="vendor_contact_id" name="vendor_contact_id">
                <option value="">-- None / Self Managed --</option>
                ${vendorOptions}
              </select>
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="estimated_cost">Estimated Cost ($)</label>
              <input class="form-input" type="number" id="estimated_cost" name="estimated_cost" step="0.01" placeholder="0.00">
            </div>
          </div>
          <div class="form-group" style="display:flex; align-items:center; gap:0.5rem;">
            <input type="checkbox" id="permission_to_enter" name="permission_to_enter" value="1" checked>
            <label for="permission_to_enter">Tenant Granted Permission to Enter</label>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('addWorkOrderModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Work Order</button>
        </div>
      </form>
    </dialog>
  `;

  return {
    title: 'Maintenance & Repairs',
    content
  };
}
