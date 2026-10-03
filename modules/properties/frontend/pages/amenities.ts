import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';
import {
  AmenitiesRepository,
  AmenityCategory,
  AmenityDefinitionRecord,
  UnitAmenityViewRecord
} from '../../backend/amenities.js';
import { getDatabase } from '../../../../database/client.js';

interface PropertyRow {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface UnitRow {
  id: string;
  property_id: string;
  unit_number: string;
  status: string;
  market_rent_cents: number;
  target_deposit_cents: number;
}

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

const CATEGORY_META: Record<AmenityCategory, { label: string; icon: string; description: string }> = {
  community: {
    label: 'Community Amenities',
    icon: '🏛️',
    description: 'Shared building facilities, outdoor recreation, and common areas.'
  },
  unit: {
    label: 'Unit Features',
    icon: '🏠',
    description: 'Appliances, in-unit fixtures, floor finishes, and interior perks.'
  },
  accessibility: {
    label: 'Accessibility (ADA)',
    icon: '♿',
    description: 'Step-free access, elevators, roll-in showers, and accessible parking.'
  },
  pet: {
    label: 'Pet Policies & Facilities',
    icon: '🐾',
    description: 'Pet allowances, dog runs, wash stations, and size restrictions.'
  },
  eco: {
    label: 'Eco & Sustainability',
    icon: '🌱',
    description: 'EV charging, solar power, energy star appliances, and recycling.'
  }
};

/**
 * Handles presentation and mutations for property/unit amenities tag-chip editor
 * and multi-channel marketing syndication settings.
 *
 * @param ctx - Active page context.
 * @returns Rendered PageResult or redirection.
 */
export async function handle(ctx: PageContext): Promise<PageResult> {
  const opId = ctx.session.operatorId || 'default';
  const db = getDatabase();

  const propertyId = (ctx.query['property_id'] || ctx.query['id'] || '').trim();
  const unitId = (ctx.query['unit_id'] || '').trim();

  let property: PropertyRow | null = null;
  let unit: UnitRow | null = null;

  if (unitId) {
    unit = (db.prepare('SELECT id, property_id, unit_number, status, market_rent_cents, target_deposit_cents FROM units WHERE id = ? AND operator_id = ? AND deleted_at IS NULL')
      .get(unitId, opId) as unknown as UnitRow) || null;
    if (unit) {
      property = (db.prepare('SELECT id, name, address, city, state, zip FROM properties WHERE id = ? AND operator_id = ? AND deleted_at IS NULL')
        .get(unit.property_id, opId) as unknown as PropertyRow) || null;
    }
  } else if (propertyId) {
    property = (db.prepare('SELECT id, name, address, city, state, zip FROM properties WHERE id = ? AND operator_id = ? AND deleted_at IS NULL')
      .get(propertyId, opId) as unknown as PropertyRow) || null;
  }

  if (!property && !unit) {
    ctx.session.addFlash('error', 'Property or Unit not found.');
    return { redirect: '/properties', content: '' };
  }

  const csrfToken = ctx.session.getCsrfToken();

  // POST mutations
  if (ctx.method === 'POST') {
    if (!validateCsrf(csrfToken, ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF validation failed.</div>`
      };
    }

    const action = ctx.body['action'] || '';

    try {
      if (action === 'save_amenities') {
        const rawSelected = ctx.body['amenities'] || [];
        const selectedIds = Array.isArray(rawSelected) ? rawSelected : rawSelected ? [rawSelected] : [];

        if (unit && property) {
          const rawExcluded = ctx.body['excluded_inherited'] || [];
          const excludedInheritedIds = Array.isArray(rawExcluded) ? rawExcluded : rawExcluded ? [rawExcluded] : [];

          AmenitiesRepository.setUnitAmenities(unit.id, {
            selectedIds,
            excludedInheritedIds
          }, opId);

          ctx.session.addFlash('success', 'Unit amenities and overrides updated successfully.');
          return { redirect: `/properties/amenities?unit_id=${encodeURIComponent(unit.id)}`, content: '' };
        } else if (property) {
          AmenitiesRepository.setPropertyAmenities(property.id, selectedIds, opId);
          ctx.session.addFlash('success', 'Property amenities updated successfully.');
          return { redirect: `/properties/amenities?property_id=${encodeURIComponent(property.id)}`, content: '' };
        }
      } else if (action === 'create_custom_amenity') {
        const category = (ctx.body['category'] || 'community') as AmenityCategory;
        const name = (ctx.body['name'] || '').trim();
        const icon = (ctx.body['icon'] || '').trim() || '🏷️';

        if (!name) {
          ctx.session.addFlash('error', 'Amenity name is required.');
        } else {
          AmenitiesRepository.createAmenity(category, name, icon, true, opId);
          ctx.session.addFlash('success', `Created custom amenity "${name}".`);
        }

        const returnUrl = unit
          ? `/properties/amenities?unit_id=${encodeURIComponent(unit.id)}`
          : `/properties/amenities?property_id=${encodeURIComponent(property!.id)}`;
        return { redirect: returnUrl, content: '' };
      } else if (action === 'save_syndication') {
        const headline = (ctx.body['headline'] || '').trim();
        const description = (ctx.body['description'] || '').trim();
        const rentDollars = parseFloat(ctx.body['advertised_rent'] || '0') || 0;
        const depositDollars = parseFloat(ctx.body['target_deposit'] || '0') || 0;
        const availableDateStr = (ctx.body['available_date'] || '').trim();
        const assignedContactId = (ctx.body['assigned_contact_id'] || '').trim() || null;
        const status = (ctx.body['status'] || 'draft') as 'draft' | 'active' | 'paused';

        const channels: Record<string, boolean> = {
          zillow: ctx.body['channel_zillow'] === '1',
          apartments_com: ctx.body['channel_apartments_com'] === '1',
          trulia: ctx.body['channel_trulia'] === '1',
          realtor_com: ctx.body['channel_realtor_com'] === '1',
          craigslist: ctx.body['channel_craigslist'] === '1',
          website: ctx.body['channel_website'] === '1'
        };

        const availableDate = availableDateStr ? new Date(availableDateStr).getTime() : null;

        AmenitiesRepository.upsertMarketingSyndication({
          property_id: unit ? null : property!.id,
          unit_id: unit ? unit.id : null,
          headline,
          description,
          advertised_rent_cents: rentDollars > 0 ? Math.round(rentDollars * 100) : null,
          target_deposit_cents: depositDollars > 0 ? Math.round(depositDollars * 100) : null,
          available_date: availableDate,
          assigned_contact_id: assignedContactId,
          channels,
          status
        }, opId);

        ctx.session.addFlash('success', 'Marketing & syndication settings saved.');
        const returnUrl = unit
          ? `/properties/amenities?unit_id=${encodeURIComponent(unit.id)}`
          : `/properties/amenities?property_id=${encodeURIComponent(property!.id)}`;
        return { redirect: returnUrl, content: '' };
      }
    } catch (err: any) {
      ctx.session.addFlash('error', err.message || 'Operation failed.');
    }
  }

  // Load data for presentation
  const allAmenities = AmenitiesRepository.listAmenities(undefined, opId);
  const contacts = db.prepare('SELECT id, first_name, last_name, email FROM contacts WHERE operator_id = ? AND deleted_at IS NULL ORDER BY first_name ASC')
    .all(opId) as unknown as ContactRow[];

  let activeAmenityIds = new Set<string>();
  let inheritedAmenityIds = new Set<string>();
  let excludedInheritedIds = new Set<string>();

  if (unit && property) {
    const unitData = AmenitiesRepository.getUnitAmenities(unit.id, property.id, opId);
    for (const a of unitData.active) {
      activeAmenityIds.add(a.id);
      if (a.is_inherited) {
        inheritedAmenityIds.add(a.id);
      }
    }
    // Also find if any inherited ones are excluded
    const rawExcluded = db.prepare(`
      SELECT amenity_id FROM unit_amenities
      WHERE operator_id = ? AND unit_id = ? AND is_excluded = 1 AND deleted_at IS NULL
    `).all(opId, unit.id) as any[];
    for (const r of rawExcluded) {
      excludedInheritedIds.add(r.amenity_id);
    }
  } else if (property) {
    const propData = AmenitiesRepository.getPropertyAmenities(property.id, opId);
    for (const a of propData.active) {
      activeAmenityIds.add(a.id);
    }
  }

  const syndication = AmenitiesRepository.getMarketingSyndication(
    unit ? undefined : property?.id,
    unit ? unit.id : undefined,
    opId
  );

  const flyerPdfUrl = unit
    ? `/api/v1/properties/units/${encodeURIComponent(unit.id)}/flyer-pdf`
    : `/api/v1/properties/${encodeURIComponent(property!.id)}/flyer-pdf`;

  const backUrl = property ? `/properties/show?id=${encodeURIComponent(property.id)}` : '/properties';
  const targetTitle = unit ? `${property?.name || 'Property'} - Unit ${unit.unit_number}` : property!.name;

  const categories: AmenityCategory[] = ['community', 'unit', 'accessibility', 'pet', 'eco'];

  const content = html`
    <div class="container-fluid py-4" data-entity-type="${unit ? 'unit' : 'property'}" data-entity-id="${unit ? unit.id : property!.id}">
      <!-- Breadcrumbs & Header -->
      <nav aria-label="breadcrumb" class="mb-3">
        <ol class="breadcrumb">
          <li class="breadcrumb-item"><a href="/properties">Properties</a></li>
          ${property ? html`<li class="breadcrumb-item"><a href="${backUrl}">${property.name}</a></li>` : ''}
          ${unit ? html`<li class="breadcrumb-item active" aria-current="page">Unit ${unit.unit_number} Amenities</li>` : html`<li class="breadcrumb-item active" aria-current="page">Amenities & Marketing</li>`}
        </ol>
      </nav>

      <div class="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
        <div>
          <h1 class="h3 mb-1">
            ${unit ? `Unit ${unit.unit_number} Amenities & Syndication` : `${property!.name} Amenities & Syndication`}
          </h1>
          <p class="text-muted mb-0">
            ${property ? `${property.address}, ${property.city}, ${property.state} ${property.zip}` : ''}
            <span class="ms-2 badge bg-secondary">ID: ${unit ? unit.id.slice(0, 8) : property!.id.slice(0, 8)}</span>
            <button type="button" class="btn btn-sm btn-link p-0 text-decoration-none ms-1" data-action="copy-id" data-id="${unit ? unit.id : property!.id}" title="Copy ID">
              📋 Copy ID
            </button>
          </p>
        </div>
        <div class="d-flex gap-2">
          <a href="${flyerPdfUrl}" target="_blank" class="btn btn-outline-danger d-flex align-items-center gap-1" id="btn-download-flyer">
            <span>📄</span> Download Marketing Flyer (PDF)
          </a>
          <button type="button" class="btn btn-outline-primary" data-bs-toggle="modal" data-bs-target="#modalCustomAmenity">
            ➕ Add Custom Amenity
          </button>
          <a href="${backUrl}" class="btn btn-secondary">Back to Details</a>
        </div>
      </div>

      <div class="row g-4">
        <!-- Left: Amenities Tag-Chip Editor (5 Categories) -->
        <div class="col-lg-7">
          <div class="card shadow-sm mb-4">
            <div class="card-header bg-light d-flex justify-content-between align-items-center">
              <div>
                <h2 class="h5 mb-0">Feature & Amenity Checklist</h2>
                <small class="text-muted">Select features applicable to this ${unit ? 'unit' : 'property'}.</small>
              </div>
              ${unit ? html`<span class="badge bg-info text-dark">Inheritance Active</span>` : ''}
            </div>
            <div class="card-body">
              <form method="POST" action="">
                ${csrfField(csrfToken)}
                <input type="hidden" name="action" value="save_amenities">

                ${categories.map((cat) => {
                  const meta = CATEGORY_META[cat];
                  const catAmenities = allAmenities.filter((a) => a.category === cat);
                  if (catAmenities.length === 0) return '';

                  return html`
                    <div class="amenity-category-block mb-4" data-category="${cat}">
                      <div class="d-flex align-items-center mb-2 pb-1 border-bottom">
                        <span class="fs-5 me-2">${meta.icon}</span>
                        <div>
                          <h3 class="h6 mb-0 fw-bold">${meta.label}</h3>
                          <small class="text-muted">${meta.description}</small>
                        </div>
                      </div>

                      <div class="row row-cols-1 row-cols-md-2 g-2 pt-1">
                        ${catAmenities.map((a) => {
                          const isActive = activeAmenityIds.has(a.id);
                          const isInherited = inheritedAmenityIds.has(a.id);
                          const isExcluded = excludedInheritedIds.has(a.id);

                          return html`
                            <div class="col">
                              <div class="form-check p-2 border rounded amenity-checkbox-card ${isActive ? 'bg-light border-primary' : ''}">
                                <input
                                  class="form-check-input ms-1"
                                  type="checkbox"
                                  name="amenities"
                                  value="${a.id}"
                                  id="amenity_${a.id}"
                                  ${isActive ? 'checked' : ''}
                                >
                                <label class="form-check-label ms-2 d-flex align-items-center justify-content-between w-100" for="amenity_${a.id}">
                                  <span>
                                    <span class="me-1">${a.icon || '🏷️'}</span>
                                    ${a.name}
                                  </span>
                                  <span class="d-flex gap-1">
                                    ${isInherited ? html`<span class="badge bg-secondary" title="Inherited from property">Property</span>` : ''}
                                    ${a.is_custom ? html`<span class="badge bg-light text-dark border">Custom</span>` : ''}
                                  </span>
                                </label>
                                ${unit && isInherited ? html`
                                  <div class="mt-1 ps-4 pt-1 border-top text-muted small">
                                    <label class="form-check-label small">
                                      <input type="checkbox" name="excluded_inherited" value="${a.id}" class="form-check-input" ${isExcluded ? 'checked' : ''}>
                                      Exclude from this unit
                                    </label>
                                  </div>
                                ` : ''}
                              </div>
                            </div>
                          `;
                        })}
                      </div>
                    </div>
                  `;
                })}

                <div class="d-flex justify-content-end pt-3 border-top">
                  <button type="submit" class="btn btn-primary px-4" id="btn-save-amenities">
                    Save Amenities
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        <!-- Right: Marketing & Syndication Panel -->
        <div class="col-lg-5">
          <div class="card shadow-sm mb-4">
            <div class="card-header bg-light d-flex justify-content-between align-items-center">
              <h2 class="h5 mb-0">Marketing & Syndication</h2>
              <span class="badge ${syndication?.status === 'active' ? 'bg-success' : syndication?.status === 'paused' ? 'bg-warning text-dark' : 'bg-secondary'}">
                ${(syndication?.status || 'draft').toUpperCase()}
              </span>
            </div>
            <div class="card-body">
              <form method="POST" action="">
                ${csrfField(csrfToken)}
                <input type="hidden" name="action" value="save_syndication">

                <div class="mb-3">
                  <label class="form-label fw-bold">Syndication Status</label>
                  <select name="status" class="form-select" id="select-syndication-status">
                    <option value="draft" ${!syndication || syndication.status === 'draft' ? 'selected' : ''}>Draft (Internal Only)</option>
                    <option value="active" ${syndication?.status === 'active' ? 'selected' : ''}>Active (Published to Channels)</option>
                    <option value="paused" ${syndication?.status === 'paused' ? 'selected' : ''}>Paused (Temporarily Delisted)</option>
                  </select>
                </div>

                <div class="mb-3">
                  <label class="form-label fw-bold">Listing Headline</label>
                  <input
                    type="text"
                    name="headline"
                    class="form-control"
                    placeholder="e.g. Spacious Luxury 2-Bedroom with Private Balcony"
                    value="${syndication?.headline || ''}"
                    maxlength="150"
                  >
                </div>

                <div class="row g-2 mb-3">
                  <div class="col-6">
                    <label class="form-label fw-bold">Advertised Rent ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      name="advertised_rent"
                      class="form-control"
                      value="${syndication?.advertised_rent_cents ? (syndication.advertised_rent_cents / 100).toFixed(2) : unit?.market_rent_cents ? (unit.market_rent_cents / 100).toFixed(2) : ''}"
                    >
                  </div>
                  <div class="col-6">
                    <label class="form-label fw-bold">Security Deposit ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      name="target_deposit"
                      class="form-control"
                      value="${syndication?.target_deposit_cents ? (syndication.target_deposit_cents / 100).toFixed(2) : unit?.target_deposit_cents ? (unit.target_deposit_cents / 100).toFixed(2) : ''}"
                    >
                  </div>
                </div>

                <div class="mb-3">
                  <label class="form-label fw-bold">Available Date</label>
                  <input
                    type="date"
                    name="available_date"
                    class="form-control"
                    value="${syndication?.available_date ? new Date(syndication.available_date).toISOString().slice(0, 10) : ''}"
                  >
                </div>

                <div class="mb-3">
                  <label class="form-label fw-bold">Assigned Leasing Contact</label>
                  <select name="assigned_contact_id" class="form-select">
                    <option value="">-- Select Contact / Agent --</option>
                    ${contacts.map((c) => html`
                      <option value="${c.id}" ${syndication?.assigned_contact_id === c.id ? 'selected' : ''}>
                        ${c.first_name || ''} ${c.last_name || ''} (${c.email || 'No email'})
                      </option>
                    `)}
                  </select>
                </div>

                <div class="mb-3">
                  <label class="form-label fw-bold">Public Listing Description</label>
                  <textarea
                    name="description"
                    class="form-control"
                    rows="4"
                    placeholder="Provide a detailed overview of the property or unit, neighborhood perks, and lease terms..."
                  >${syndication?.description || ''}</textarea>
                </div>

                <div class="mb-3">
                  <label class="form-label fw-bold">Syndication Channels</label>
                  <div class="card p-3 bg-light border">
                    <div class="form-check mb-2">
                      <input class="form-check-input" type="checkbox" name="channel_website" value="1" id="ch_website" ${syndication?.channels?.website !== false ? 'checked' : ''}>
                      <label class="form-check-label fw-semibold" for="ch_website">Public Website / Resident Portal</label>
                    </div>
                    <div class="form-check mb-2">
                      <input class="form-check-input" type="checkbox" name="channel_zillow" value="1" id="ch_zillow" ${syndication?.channels?.zillow ? 'checked' : ''}>
                      <label class="form-check-label" for="ch_zillow">Zillow Rental Network</label>
                    </div>
                    <div class="form-check mb-2">
                      <input class="form-check-input" type="checkbox" name="channel_apartments_com" value="1" id="ch_apartments_com" ${syndication?.channels?.apartments_com ? 'checked' : ''}>
                      <label class="form-check-label" for="ch_apartments_com">Apartments.com Network</label>
                    </div>
                    <div class="form-check mb-2">
                      <input class="form-check-input" type="checkbox" name="channel_trulia" value="1" id="ch_trulia" ${syndication?.channels?.trulia ? 'checked' : ''}>
                      <label class="form-check-label" for="ch_trulia">Trulia</label>
                    </div>
                    <div class="form-check mb-2">
                      <input class="form-check-input" type="checkbox" name="channel_realtor_com" value="1" id="ch_realtor_com" ${syndication?.channels?.realtor_com ? 'checked' : ''}>
                      <label class="form-check-label" for="ch_realtor_com">Realtor.com</label>
                    </div>
                    <div class="form-check">
                      <input class="form-check-input" type="checkbox" name="channel_craigslist" value="1" id="ch_craigslist" ${syndication?.channels?.craigslist ? 'checked' : ''}>
                      <label class="form-check-label" for="ch_craigslist">Craigslist Formatter</label>
                    </div>
                  </div>
                </div>

                <div class="alert alert-info py-2 px-3 small d-flex gap-2 align-items-center">
                  <span>ℹ️</span>
                  <div>
                    <strong>Pluggable Syndication Engine:</strong>
                    When status is set to Active, background events automatically format and syndicate listing payloads to selected channel APIs.
                  </div>
                </div>

                <button type="submit" class="btn btn-success w-100" id="btn-save-syndication">
                  Save Syndication Settings
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal: Add Custom Amenity -->
      <div class="modal fade" id="modalCustomAmenity" tabindex="-1" aria-labelledby="modalCustomAmenityLabel" aria-hidden="true">
        <div class="modal-dialog">
          <div class="modal-content">
            <form method="POST" action="">
              ${csrfField(csrfToken)}
              <input type="hidden" name="action" value="create_custom_amenity">
              <div class="modal-header">
                <h5 class="modal-title" id="modalCustomAmenityLabel">Add Custom Amenity</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body">
                <div class="mb-3">
                  <label class="form-label fw-bold">Category</label>
                  <select name="category" class="form-select" required>
                    <option value="community">Community Amenity</option>
                    <option value="unit">Unit Feature</option>
                    <option value="accessibility">Accessibility (ADA)</option>
                    <option value="pet">Pet Policy / Facility</option>
                    <option value="eco">Eco & Sustainability</option>
                  </select>
                </div>
                <div class="mb-3">
                  <label class="form-label fw-bold">Amenity Name</label>
                  <input type="text" name="name" class="form-control" placeholder="e.g. Pickleball Court or Wine Chiller" required>
                </div>
                <div class="mb-3">
                  <label class="form-label fw-bold">Icon (Emoji)</label>
                  <input type="text" name="icon" class="form-control" placeholder="e.g. 🎾 or 🍷" value="🏷️" maxlength="4">
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn btn-primary">Create Amenity</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  return {
    title: `${targetTitle} - Amenities & Syndication`,
    content
  };
}
