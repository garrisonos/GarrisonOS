import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';

function formatDate(epochMs: number): string {
  if (!epochMs) return '—';
  try {
    const d = new Date(epochMs);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch {
    return '—';
  }
}

export async function handle(ctx: PageContext): Promise<PageResult> {
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
      if (action === 'create_schedule') {
        const nextDueStr = ctx.body['next_due_date'] || '';
        const nextDue = nextDueStr ? new Date(nextDueStr).getTime() : Date.now();
        const checklistRaw = ctx.body['checklist'] || '';
        const checklist = checklistRaw
          .split('\n')
          .map((s: string) => s.trim())
          .filter(Boolean);

        await ctx.api.post('/api/v1/maintenance/preventative_schedules', {
          title: ctx.body['title'] || '',
          description: ctx.body['description'] || checklist.join('\n') || ctx.body['title'] || '',
          property_id: ctx.body['property_id'] || '',
          unit_id: ctx.body['unit_id'] || null,
          category: ctx.body['category'] || 'general',
          frequency: ctx.body['frequency'] || 'quarterly',
          next_due_date: nextDue,
          priority: ctx.body['priority'] || 'medium',
          assigned_vendor_contact_id: ctx.body['vendor_contact_id'] || null
        });
        ctx.session.addFlash('success', 'Preventative maintenance schedule created');
        return { redirect: '/maintenance/preventative', content: '' };
      } else if (action === 'trigger_schedule') {
        const scheduleId = ctx.body['schedule_id'] || '';
        await ctx.api.post(`/api/v1/maintenance/preventative_schedules/${encodeURIComponent(scheduleId)}/trigger`, {});
        ctx.session.addFlash('success', 'Preventative schedule triggered. Work order generated.');
        return { redirect: '/maintenance/preventative', content: '' };
      } else if (action === 'run_due_check') {
        const res = await ctx.api.post('/api/v1/maintenance/preventative_schedules/run', {});
        const count = res?.data?.count ?? 0;
        ctx.session.addFlash('success', `Evaluated preventative maintenance schedules. Generated ${count} work order(s).`);
        return { redirect: '/maintenance/preventative', content: '' };
      }
    } catch (err: any) {
      error = err.message;
    }
  }

  let schedules: any[] = [];
  let properties: any[] = [];
  let vendors: any[] = [];

  try {
    const [sRes, pRes, vRes] = await Promise.all([
      ctx.api.get('/api/v1/maintenance/preventative_schedules').catch(() => ({ data: { schedules: [] } })),
      ctx.api.get('/api/v1/properties').catch(() => ({ data: { properties: [] } })),
      ctx.api.get('/api/v1/contacts?type=vendor').catch(() => ({ data: { contacts: [] } }))
    ]);

    schedules = Array.isArray(sRes?.data) ? sRes.data : sRes?.data?.schedules || [];
    properties = pRes?.data?.properties || [];
    vendors = vRes?.data?.contacts || [];
  } catch (err: any) {
    error = error || err.message;
  }

  const errorAlert = error
    ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>`
    : raw('');

  const now = Date.now();
  const scheduleRows = schedules.length === 0
    ? html`<tr><td colspan="7" class="text-center text-muted">No preventative maintenance schedules established yet.</td></tr>`
    : schedules.map((s) => {
        const isOverdue = s.next_due_date && s.next_due_date <= now;
        const dueClass = isOverdue ? 'text-danger font-bold' : '';
        const cadenceDesc = String(s.frequency || '').replace(/_/g, ' ');

        return html`
          <tr>
            <td>
              <strong>${s.title}</strong>
              <div class="text-muted" style="font-size:0.75rem;">Category: ${s.category}</div>
            </td>
            <td>${s.property_name || s.property_id}</td>
            <td><span class="badge badge-info">${cadenceDesc}</span></td>
            <td class="${dueClass}">${formatDate(s.next_due_date)} ${isOverdue ? html`<span class="badge badge-danger">DUE</span>` : raw('')}</td>
            <td>${formatDate(s.last_generated_at)}</td>
            <td>
              ${s.is_active ? html`<span class="badge badge-success">Active</span>` : html`<span class="badge">Paused</span>`}
            </td>
            <td style="text-align: right;">
              <form method="POST" action="/maintenance/preventative" style="display:inline;">
                ${csrfField(csrfToken)}
                <input type="hidden" name="action" value="trigger_schedule">
                <input type="hidden" name="schedule_id" value="${s.id}">
                <button type="submit" class="btn btn-sm btn-secondary">⚡ Trigger Now</button>
              </form>
            </td>
          </tr>
        `;
      });

  const propertyOptions = properties.map((p) => html`<option value="${p.id}">${p.name}</option>`);
  const vendorOptions = vendors.map((v) => html`<option value="${v.id}">${v.last_name}, ${v.first_name}${v.company_name ? ` (${v.company_name})` : ''}</option>`);

  const content = html`
    <div class="page-header">
      <div>
        <a href="/maintenance" class="text-muted">← Back to Work Orders</a>
        <h1 class="page-title">Preventative Maintenance Engine</h1>
        <p class="page-subtitle">Automate recurring property inspections, seasonal HVAC servicing, and compliance audits.</p>
      </div>
      <div class="btn-group">
        <form method="POST" action="/maintenance/preventative" style="display:inline;">
          ${csrfField(csrfToken)}
          <input type="hidden" name="action" value="run_due_check">
          <button type="submit" class="btn btn-secondary">🔄 Check & Dispatch Due</button>
        </form>
        <button class="btn btn-primary" onclick="document.getElementById('createScheduleModal').showModal()">+ New Recurring Schedule</button>
      </div>
    </div>

    ${errorAlert}

    <!-- Quick Stats -->
    <div class="metrics-grid">
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Active Schedules</span>
          <span class="kpi-icon">📋</span>
        </div>
        <div class="kpi-value">${schedules.filter((s) => s.is_active).length}</div>
        <div class="kpi-trend positive">Automated recurring cadences</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Due For Inspection</span>
          <span class="kpi-icon">⚠️</span>
        </div>
        <div class="kpi-value text-danger">${schedules.filter((s) => s.next_due_date && s.next_due_date <= now).length}</div>
        <div class="kpi-trend negative">Requires dispatch</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Covered Properties</span>
          <span class="kpi-icon">🏢</span>
        </div>
        <div class="kpi-value">${new Set(schedules.map((s) => s.property_id)).size}</div>
        <div class="kpi-trend neutral">Properties enrolled</div>
      </div>
    </div>

    <!-- Schedules Table -->
    <div class="card">
      <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
        <h2 class="card-title">Recurring Maintenance Cadences</h2>
        <span class="badge badge-info">${schedules.length} configured</span>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Schedule Title</th>
              <th>Property</th>
              <th>Cadence</th>
              <th>Next Due Date</th>
              <th>Last Triggered</th>
              <th>Status</th>
              <th style="text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${scheduleRows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal: Create Schedule -->
    <dialog id="createScheduleModal" class="modal">
      <form method="POST" action="/maintenance/preventative" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="create_schedule">
        <div class="modal-header">
          <h3>Create Preventative Maintenance Schedule</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('createScheduleModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Schedule Title *</label>
            <input type="text" name="title" class="form-input" placeholder="e.g. Quarterly HVAC Filter Replacement & Coil Clean" required>
          </div>
          <div class="form-group">
            <label class="form-label">Property *</label>
            <select name="property_id" class="form-select" required>
              <option value="">-- Choose Property --</option>
              ${propertyOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Category *</label>
            <select name="category" class="form-select" required>
              <option value="hvac">HVAC & Heating</option>
              <option value="plumbing">Plumbing & Water Heaters</option>
              <option value="electrical">Electrical & Lighting</option>
              <option value="roofing">Roofing & Gutters</option>
              <option value="fire_safety">Life Safety & Fire Alarms</option>
              <option value="landscaping">Landscaping & Exterior</option>
              <option value="winterization">Winterization & Freeze Defense</option>
              <option value="general">General Building Audit</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Recurrence Frequency *</label>
            <select name="frequency" class="form-select" required>
              <option value="monthly">Monthly</option>
              <option value="quarterly" selected>Quarterly</option>
              <option value="semi_annually">Semi-Annually</option>
              <option value="annually">Annually</option>
              <option value="seasonal">Seasonal</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Description / Scope of Work *</label>
            <textarea name="description" class="form-input" rows="2" placeholder="Describe routine preventative maintenance tasks" required></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">First Due Date *</label>
            <input type="date" name="next_due_date" class="form-input" required>
          </div>
          <div class="form-group">
            <label class="form-label">Dispatch Priority</label>
            <select name="priority" class="form-select">
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="high">High</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Preferred Vendor</label>
            <select name="vendor_contact_id" class="form-select">
              <option value="">-- Assign Later --</option>
              ${vendorOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Inspection Checklist (one task per line)</label>
            <textarea name="checklist" class="form-input" rows="4" placeholder="Inspect air handler filters&#10;Verify thermostat calibration&#10;Check condensate drain line for blockages"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('createScheduleModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Establish Schedule</button>
        </div>
      </form>
    </dialog>
  `;

  return {
    title: 'Preventative Maintenance',
    content
  };
}
