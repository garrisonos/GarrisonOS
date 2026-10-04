import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';
import { renderPagination } from '../../../../web/templates/pagination.js';

export async function handle(ctx: PageContext): Promise<PageResult> {
  const csrfToken = ctx.session.getCsrfToken();
  const portfolioFilter = ctx.query['portfolio_id'] || '';
  const page = Math.max(1, parseInt(ctx.query['page'] || '1', 10) || 1);
  const limit = 10;
  let error: string | null = null;

  if (ctx.method === 'POST' && ctx.body['action'] === 'create_property') {
    if (!validateCsrf(ctx.session.getCsrfToken(), ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF token validation failed. Please refresh and try again.</div>`
      };
    }

    try {
      await ctx.api.post('/api/v1/properties', {
        name: ctx.body['name'] ?? '',
        property_type: ctx.body['property_type'] ?? 'single_family',
        address_line1: ctx.body['address_line1'] ?? '',
        city: ctx.body['city'] ?? '',
        state: ctx.body['state'] ?? '',
        postal_code: ctx.body['postal_code'] ?? '',
        portfolio_id: ctx.body['portfolio_id'] ? ctx.body['portfolio_id'] : null,
        year_built: ctx.body['year_built'] ? parseInt(ctx.body['year_built'], 10) : null
      });
      ctx.session.addFlash('success', 'Property successfully added');
      return { redirect: '/properties', content: '' };
    } catch (err: any) {
      error = err.message;
    }
  }

  let properties: any[] = [];
  let portfolios: any[] = [];
  let metrics: any = null;

  try {
    const propRes = await ctx.api.get('/api/v1/properties');
    properties = propRes?.data?.properties || [];

    const portRes = await ctx.api.get('/api/v1/properties/portfolios');
    portfolios = portRes?.data?.portfolios || [];

    const metricRes = await ctx.api.get('/api/v1/properties/metrics/occupancy');
    metrics = metricRes?.data?.metrics || null;
  } catch (err: any) {
    error = error || err.message;
  }

  // Filter properties by portfolio if specified
  const filteredProperties = portfolioFilter
    ? properties.filter((p) => p.portfolio_id === portfolioFilter)
    : properties;

  const total = filteredProperties.length;
  const paginatedProperties = filteredProperties.slice((page - 1) * limit, page * limit);

  const errorAlert = error
    ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>`
    : raw('');

  const metricsGrid = metrics
    ? html`
      <div class="metrics-grid">
        <div class="card metric-card">
          <div class="metric-label">Total Units</div>
          <div class="metric-value">${metrics.totalUnits}</div>
        </div>
        <div class="card metric-card">
          <div class="metric-label">Occupancy Rate</div>
          <div class="metric-value">${Number(metrics.occupancyRatePercentage || 0).toFixed(1)}%</div>
          <div class="metric-subtitle">${metrics.occupiedUnits} occupied / ${metrics.vacantUnits} vacant</div>
        </div>
        <div class="card metric-card">
          <div class="metric-label">Total Market Rent</div>
          <div class="metric-value">$${((metrics.totalMarketRentCents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div class="metric-subtitle">Monthly potential rent roll</div>
        </div>
      </div>
    `
    : raw('');

  const propertyRows = paginatedProperties.length > 0
    ? paginatedProperties.map((prop) => {
        const typeFormatted = (prop.property_type || '').replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
        return html`
          <tr data-entity="property" data-id="${prop.id}">
            <td>
              <strong><a href="/properties/show?id=${encodeURIComponent(prop.id)}" data-entity-id="${prop.id}" data-entity-type="property">${prop.name}</a></strong>
              <button class="btn-icon" data-action="copy-id" data-copy-value="${prop.id}" title="Copy Property ID" style="margin-left: 0.35rem; font-size: 0.75rem; background: transparent; border: none; cursor: pointer;">📋</button>
            </td>
            <td><span class="badge">${typeFormatted}</span></td>
            <td>${prop.address_line1}</td>
            <td>${prop.city}, ${prop.state} ${prop.postal_code}</td>
            <td>
              <a href="/properties/show?id=${encodeURIComponent(prop.id)}" data-entity-id="${prop.id}" data-entity-type="property" class="btn btn-sm btn-secondary">View Units</a>
            </td>
          </tr>
        `;
      })
    : [html`
        <tr>
          <td colspan="5" class="text-center text-muted">No properties found matching the selected portfolio.</td>
        </tr>
      `];

  const portfolioOptions = portfolios.map((p) => html`<option value="${p.id}">${p.name} (${p.property_count || 0})</option>`);

  const content = html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Properties</h1>
        <p class="page-subtitle">Manage physical buildings, residential units, and legal portfolios.</p>
      </div>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <a href="/properties/amenities" class="btn btn-secondary">✨ Amenities Catalog</a>
        <button class="btn btn-primary" onclick="document.getElementById('addPropertyModal').showModal()">+ Add Property</button>
      </div>
    </div>

    ${errorAlert}
    ${metricsGrid}

    <!-- Portfolio Filter Bar -->
    <div class="filter-bar card">
      <form method="GET" action="/properties" style="display: flex; gap: 0.75rem; align-items: center; width: 100%; flex-wrap: wrap;">
        <label for="filter_portfolio_id" style="font-weight: 500; font-size: 0.875rem; color: var(--text-muted); margin: 0;">Portfolio:</label>
        <select class="form-select form-input-sm" id="filter_portfolio_id" name="portfolio_id" onchange="this.form.submit()" style="max-width: 320px;">
          <option value="">All Portfolios (${properties.length})</option>
          ${portfolios.map((p) => html`
            <option value="${p.id}" ${portfolioFilter === p.id ? 'selected' : ''}>${p.name} (${p.property_count || 0})</option>
          `)}
        </select>
        ${portfolioFilter ? html`<a href="/properties" class="btn btn-sm btn-secondary">Clear Filter</a>` : raw('')}
      </form>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Properties (${total})</h2>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Property Name</th>
              <th>Type</th>
              <th>Address</th>
              <th>City, State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${propertyRows}
          </tbody>
        </table>
      </div>
      ${renderPagination({
        page,
        limit,
        total,
        baseUrl: '/properties',
        queryParams: { portfolio_id: portfolioFilter }
      })}
    </div>

    <!-- Modal: Add Property -->
    <dialog id="addPropertyModal" class="modal">
      <form method="POST" action="/properties" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="create_property">
        <div class="modal-header">
          <h3>Add New Property</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('addPropertyModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label" for="name">Property Name *</label>
            <input class="form-input" type="text" id="name" name="name" required placeholder="e.g. Maple Heights Duplex">
          </div>
          <div class="form-group">
            <label class="form-label" for="property_type">Property Type *</label>
            <select class="form-select" id="property_type" name="property_type" required>
              <option value="single_family">Single Family</option>
              <option value="multi_family">Multi Family</option>
              <option value="condo">Condo</option>
              <option value="townhouse">Townhouse</option>
              <option value="commercial">Commercial</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="address_line1">Street Address *</label>
            <input class="form-input" type="text" id="address_line1" name="address_line1" required placeholder="e.g. 1044 Elm Street">
          </div>
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="city">City *</label>
              <input class="form-input" type="text" id="city" name="city" required placeholder="Springfield">
            </div>
            <div class="form-group col-3">
              <label class="form-label" for="state">State *</label>
              <input class="form-input" type="text" id="state" name="state" required placeholder="IL" maxlength="2">
            </div>
            <div class="form-group col-3">
              <label class="form-label" for="postal_code">Zip Code *</label>
              <input class="form-input" type="text" id="postal_code" name="postal_code" required placeholder="62701">
            </div>
          </div>
          ${portfolios.length > 0
            ? html`
              <div class="form-group">
                <label class="form-label" for="portfolio_id">Portfolio / Entity</label>
                <select class="form-select" id="portfolio_id" name="portfolio_id">
                  <option value="">-- No Portfolio Assigned --</option>
                  ${portfolioOptions}
                </select>
              </div>
            `
            : raw('')}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('addPropertyModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Property</button>
        </div>
      </form>
    </dialog>
  `;

  return {
    title: 'Properties & Portfolios',
    content
  };
}
