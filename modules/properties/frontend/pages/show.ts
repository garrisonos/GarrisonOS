import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';
import { renderCustomFields } from '../../../../web/templates/custom-fields.js';

/**
 * Handles presentation requests for viewing a single property detail page,
 * managing its units, initiating turnover flows, and updating unit statuses.
 *
 * @param ctx - The active web page request context.
 * @returns A promise resolving to the rendered PageResult or redirect.
 */
export async function handle(ctx: PageContext): Promise<PageResult> {
  const id = ctx.query['id'] || '';
  if (!id) {
    return { redirect: '/properties', content: '' };
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
      if (action === 'create_unit') {
        const marketRent = parseFloat(ctx.body['market_rent'] || '0') || 0;
        const targetDeposit = parseFloat(ctx.body['target_deposit'] || '0') || 0;

        await ctx.api.post('/api/v1/properties/units', {
          property_id: id,
          unit_number: ctx.body['unit_number'] ?? '',
          status: ctx.body['status'] ?? 'vacant',
          bedrooms: parseInt(ctx.body['bedrooms'] ?? '1', 10),
          bathrooms: parseFloat(ctx.body['bathrooms'] ?? '1.0'),
          square_feet: ctx.body['square_feet'] ? parseInt(ctx.body['square_feet'], 10) : null,
          market_rent_cents: Math.round(marketRent * 100),
          target_deposit_cents: Math.round(targetDeposit * 100)
        });
        ctx.session.addFlash('success', 'Unit added successfully');
        return { redirect: `/properties/show?id=${encodeURIComponent(id)}`, content: '' };
      } else if (action === 'update_unit_status') {
        const unitId = ctx.body['unit_id'] || '';
        const newStatus = ctx.body['status'] || 'vacant';
        await ctx.api.put(`/api/v1/properties/units/${encodeURIComponent(unitId)}`, {
          status: newStatus
        });
        ctx.session.addFlash('success', `Unit status transitioned to ${newStatus.replace(/_/g, ' ')}`);
        return { redirect: `/properties/show?id=${encodeURIComponent(id)}`, content: '' };
      } else if (action === 'initiate_turnover') {
        const unitId = ctx.body['unit_id'] || '';
        const unitNumber = ctx.body['unit_number'] || '';
        const createWorkOrder = ctx.body['create_work_order'] === '1' || ctx.body['create_work_order'] === 'on';

        await ctx.api.put(`/api/v1/properties/units/${encodeURIComponent(unitId)}`, {
          status: 'turnover'
        });

        if (createWorkOrder) {
          try {
            await ctx.api.post('/api/v1/maintenance/work-orders', {
              property_id: id,
              unit_id: unitId,
              title: `Turnover Make-Ready: Unit ${unitNumber}`,
              description: `Standard turnover inspection, deep cleaning, paint touch-ups, and lock rekeying for Unit ${unitNumber}.`,
              priority: 'medium',
              category: 'cosmetic',
              estimated_cost_cents: 35000
            });
            ctx.session.addFlash('success', `Unit ${unitNumber} placed in turnover and make-ready work order generated`);
          } catch (workOrderErr: any) {
            ctx.session.addFlash('warning', `Unit ${unitNumber} placed in turnover, but make-ready work order could not be generated: ${workOrderErr.message || 'Unknown error'}`);
          }
        } else {
          ctx.session.addFlash('success', `Unit ${unitNumber} placed in turnover status`);
        }
        return { redirect: `/properties/show?id=${encodeURIComponent(id)}`, content: '' };
      }
    } catch (err: any) {
      error = err.message;
    }
  }

  let property: any = null;
  let units: any[] = [];

  try {
    const res = await ctx.api.get(`/api/v1/properties/${encodeURIComponent(id)}`);
    property = res?.data?.property ?? null;
    units = res?.data?.units ?? [];
  } catch (err: any) {
    error = error || err.message;
  }

  if (!property) {
    return {
      title: 'Property Not Found',
      content: html`
        <div class="alert alert-danger">Property not found.</div>
        <p><a href="/properties" class="btn btn-secondary">← Back to Properties</a></p>
      `
    };
  }

  const errorAlert = error
    ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>`
    : raw('');

  const unitRows = units.length > 0
    ? units.map((u) => {
        let statusClass = 'badge-info';
        if (u.status === 'occupied') statusClass = 'badge-success';
        else if (u.status === 'vacant') statusClass = 'badge-warning';
        else if (u.status === 'turnover' || u.status === 'maintenance_hold') statusClass = 'badge-danger';

        const statusFormatted = (u.status || '').replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());

        let statusActionBtn = raw('');
        if (u.status === 'vacant') {
          statusActionBtn = html`
            <button class="btn btn-sm btn-secondary" data-unit-id="${u.id}" data-unit-number="${u.unit_number}" onclick="openTurnoverModal(this.dataset.unitId, this.dataset.unitNumber)">Start Turnover</button>
          `;
        } else if (u.status === 'turnover') {
          statusActionBtn = html`
            <form method="POST" action="/properties/show?id=${encodeURIComponent(id)}" style="display:inline;">
              ${csrfField(csrfToken)}
              <input type="hidden" name="action" value="update_unit_status">
              <input type="hidden" name="unit_id" value="${u.id}">
              <input type="hidden" name="status" value="vacant">
              <button type="submit" class="btn btn-sm btn-success" title="Mark turnover complete and make unit vacant">✓ Set Vacant</button>
            </form>
          `;
        } else if (u.status === 'maintenance_hold') {
          statusActionBtn = html`
            <form method="POST" action="/properties/show?id=${encodeURIComponent(id)}" style="display:inline;">
              ${csrfField(csrfToken)}
              <input type="hidden" name="action" value="update_unit_status">
              <input type="hidden" name="unit_id" value="${u.id}">
              <input type="hidden" name="status" value="vacant">
              <button type="submit" class="btn btn-sm btn-secondary">Release Hold</button>
            </form>
          `;
        }

        return html`
          <tr data-entity="unit" data-id="${u.id}" data-status="${u.status}" data-amount-cents="${u.market_rent_cents}">
            <td>
              <strong>Unit ${u.unit_number}</strong>
              <button class="btn-icon" data-action="copy-id" data-copy-value="${u.id}" title="Copy Unit ID" style="margin-left: 0.35rem; font-size: 0.75rem; background: transparent; border: none; cursor: pointer;">📋</button>
            </td>
            <td><span class="badge ${statusClass}">${statusFormatted}</span></td>
            <td>${u.bedrooms} bd / ${Number(u.bathrooms).toFixed(1)} ba</td>
            <td>${u.square_feet ? `${u.square_feet.toLocaleString()} sqft` : '—'}</td>
            <td><strong>$${((u.market_rent_cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>/mo</td>
            <td>$${(((u.target_deposit_cents || 0) / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="display: flex; gap: 0.35rem; align-items: center;">
              <a href="/properties/units/${encodeURIComponent(u.id)}/amenities" class="btn btn-sm btn-secondary" title="Unit Amenities & Overrides">Amenities</a>
              ${statusActionBtn}
            </td>
          </tr>
        `;
      })
    : [html`
        <tr>
          <td colspan="7" class="text-center text-muted">No units configured for this property. Add a unit above.</td>
        </tr>
      `];

  const propTypeFormatted = (property.property_type || '').replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());

  const content = html`
    <div class="page-header" data-entity="property" data-id="${property.id}">
      <div>
        <a href="/properties" class="text-muted">← Back to Properties</a>
        <h1 class="page-title">
          ${property.name}
          <button class="btn-icon" data-action="copy-id" data-copy-value="${property.id}" title="Copy Property ID" style="margin-left: 0.5rem; font-size: 0.85rem; background: transparent; border: none; cursor: pointer;">📋</button>
        </h1>
        <p class="page-subtitle">
          ${property.address_line1}, ${property.city}, ${property.state} ${property.postal_code}
          • <span class="badge">${propTypeFormatted}</span>
        </p>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
        <a href="/properties/amenities?property_id=${encodeURIComponent(id)}" class="btn btn-secondary">✨ Amenities & Marketing</a>
        <a href="/api/v1/properties/${encodeURIComponent(id)}/flyer-pdf" target="_blank" class="btn btn-secondary">📄 Marketing Flyer</a>
        <button class="btn btn-primary" onclick="document.getElementById('addUnitModal').showModal()">+ Add Unit</button>
      </div>
    </div>

    ${errorAlert}

    ${renderCustomFields('property', property.custom_fields || {}, { operatorId: ctx.session.operatorId })}

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Rentable Units (${units.length})</h2>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Unit #</th>
              <th>Status</th>
              <th>Bed / Bath</th>
              <th>Sq Ft</th>
              <th>Market Rent</th>
              <th>Deposit</th>
              <th>Workflow Action</th>
            </tr>
          </thead>
          <tbody>
            ${unitRows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal: Initiate Turnover -->
    <dialog id="turnoverModal" class="modal">
      <form method="POST" action="/properties/show?id=${encodeURIComponent(id)}" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="initiate_turnover">
        <input type="hidden" id="turnover_unit_id" name="unit_id" value="">
        <input type="hidden" id="turnover_unit_number" name="unit_number" value="">
        <div class="modal-header">
          <h3>Initiate Unit Turnover (<span id="turnoverModalUnitDisplay"></span>)</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('turnoverModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <p>Moving this unit to <strong>Turnover</strong> status marks it as currently unavailable for leasing while make-ready turnover work is performed.</p>
          <div class="form-group" style="margin-top: 1rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
              <input type="checkbox" name="create_work_order" value="1" checked>
              <span><strong>Auto-generate Make-Ready Work Order</strong> (deep clean, lock rekeying, turnover inspection)</span>
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('turnoverModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Begin Turnover</button>
        </div>
      </form>
    </dialog>

    <script>
      function openTurnoverModal(unitId, unitNumber) {
        document.getElementById('turnover_unit_id').value = unitId;
        document.getElementById('turnover_unit_number').value = unitNumber;
        document.getElementById('turnoverModalUnitDisplay').textContent = 'Unit ' + unitNumber;
        document.getElementById('turnoverModal').showModal();
      }
    </script>

    <!-- Modal: Add Unit -->
    <dialog id="addUnitModal" class="modal">
      <form method="POST" action="/properties/show?id=${encodeURIComponent(id)}" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="create_unit">
        <div class="modal-header">
          <h3>Add Unit to ${property.name}</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('addUnitModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="unit_number">Unit Number / Identifier *</label>
              <input class="form-input" type="text" id="unit_number" name="unit_number" required placeholder="e.g. 101, A, Main">
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="status">Status</label>
              <select class="form-select" id="status" name="status">
                <option value="vacant">Vacant</option>
                <option value="occupied">Occupied</option>
                <option value="notice_given">Notice Given</option>
                <option value="turnover">Turnover</option>
                <option value="maintenance_hold">Maintenance Hold</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group col-4">
              <label class="form-label" for="bedrooms">Bedrooms</label>
              <input class="form-input" type="number" id="bedrooms" name="bedrooms" value="1" min="0" required>
            </div>
            <div class="form-group col-4">
              <label class="form-label" for="bathrooms">Bathrooms</label>
              <input class="form-input" type="number" id="bathrooms" name="bathrooms" value="1.0" step="0.5" min="0" required>
            </div>
            <div class="form-group col-4">
              <label class="form-label" for="square_feet">Square Feet</label>
              <input class="form-input" type="number" id="square_feet" name="square_feet" placeholder="e.g. 850">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="market_rent">Market Monthly Rent ($) *</label>
              <input class="form-input" type="number" id="market_rent" name="market_rent" step="0.01" required placeholder="1450.00">
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="target_deposit">Security Deposit Target ($)</label>
              <input class="form-input" type="number" id="target_deposit" name="target_deposit" step="0.01" placeholder="1450.00">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('addUnitModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Unit</button>
        </div>
      </form>
    </dialog>
  `;

  return {
    title: property.name,
    content
  };
}
