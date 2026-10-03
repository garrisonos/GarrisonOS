import { Router } from '../../../api/router.js';
import { successResponse, errorResponse } from '../../../api/response.js';
import { PropertiesRepository } from './repository.js';
import { AmenitiesRepository, AmenityCategory } from './amenities.js';
import { generateMarketingFlyerPdf } from '../../../web/lib/pdf.js';

/**
 * Register properties, portfolios, buildings, and units API routes with the router.
 *
 * @param router - Application router instance to register route handlers on.
 */
export function registerRoutes(router: Router): void {
  // --- Portfolios ---
  router.get('/api/v1/properties/portfolios', (_req, res) => {
    const portfolios = PropertiesRepository.listPortfolios();
    successResponse(res, { portfolios });
  });

  router.post('/api/v1/properties/portfolios', (req, res) => {
    const { name, tax_id, notes } = req.body || {};
    if (!name) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Portfolio name is required', 400);
    }
    const portfolio = PropertiesRepository.createPortfolio({ name, tax_id, notes });
    successResponse(res, { portfolio }, 201);
  });

  router.get('/api/v1/properties/portfolios/:id', (req, res) => {
    const portfolio = PropertiesRepository.getPortfolioById(req.params.id!);
    if (!portfolio) {
      return errorResponse(res, 'NOT_FOUND', 'Portfolio not found', 404);
    }
    successResponse(res, { portfolio });
  });

  router.put('/api/v1/properties/portfolios/:id', (req, res) => {
    const portfolio = PropertiesRepository.updatePortfolio(req.params.id!, req.body || {});
    if (!portfolio) {
      return errorResponse(res, 'NOT_FOUND', 'Portfolio not found', 404);
    }
    successResponse(res, { portfolio });
  });

  router.delete('/api/v1/properties/portfolios/:id', (req, res) => {
    const deleted = PropertiesRepository.deletePortfolio(req.params.id!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Portfolio not found', 404);
    }
    successResponse(res, { deleted: true });
  });

  // --- Occupancy Metrics ---
  router.getBatchSafe('/api/v1/properties/metrics/occupancy', (req, res) => {
    const propertyId = req.query['property_id'] as string | undefined;
    const portfolio = req.query['portfolio'] as string | undefined;
    const metrics = PropertiesRepository.getOccupancyMetrics({
      property_id: propertyId,
      portfolio: portfolio
    });
    successResponse(res, { metrics });
  });

  // --- Units (placed before :id to prevent collision) ---
  router.get('/api/v1/properties/units', (req, res) => {
    const units = PropertiesRepository.listUnits({
      property_id: req.query.property_id,
      status: req.query.status
    });
    successResponse(res, { units });
  });

  router.post('/api/v1/properties/units', (req, res) => {
    const { property_id, unit_number, market_rent_cents } = req.body || {};
    if (!property_id || !unit_number || market_rent_cents === undefined) {
      return errorResponse(res, 'VALIDATION_ERROR', 'property_id, unit_number, and market_rent_cents are required', 400);
    }
    try {
      const unit = PropertiesRepository.createUnit(req.body);
      successResponse(res, { unit }, 201);
    } catch (err: any) {
      return errorResponse(res, 'VALIDATION_ERROR', err.message || 'Failed to create unit', 400);
    }
  });

  router.get('/api/v1/properties/units/:id', (req, res) => {
    const unit = PropertiesRepository.getUnitById(req.params.id!);
    if (!unit) {
      return errorResponse(res, 'NOT_FOUND', 'Unit not found', 404);
    }
    successResponse(res, { unit });
  });

  router.put('/api/v1/properties/units/:id', (req, res) => {
    try {
      const unit = PropertiesRepository.updateUnit(req.params.id!, req.body || {});
      if (!unit) {
        return errorResponse(res, 'NOT_FOUND', 'Unit not found', 404);
      }
      successResponse(res, { unit });
    } catch (err: any) {
      return errorResponse(res, 'VALIDATION_ERROR', err.message || 'Failed to update unit', 400);
    }
  });

  router.delete('/api/v1/properties/units/:id', (req, res) => {
    const deleted = PropertiesRepository.deleteUnit(req.params.id!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Unit not found', 404);
    }
    successResponse(res, { deleted: true });
  });

  // --- Properties ---
  router.get('/api/v1/properties', (req, res) => {
    const properties = PropertiesRepository.listProperties({
      portfolio_id: req.query.portfolio_id,
      portfolio: req.query.portfolio
    });
    successResponse(res, { properties });
  });

  router.post('/api/v1/properties', (req, res) => {
    const { name, property_type, address_line1, city, state, postal_code } = req.body || {};
    if (!name || !property_type || !address_line1 || !city || !state || !postal_code) {
      return errorResponse(
        res,
        'VALIDATION_ERROR',
        'name, property_type, address_line1, city, state, and postal_code are required',
        400
      );
    }
    const property = PropertiesRepository.createProperty(req.body);
    successResponse(res, { property }, 201);
  });

  router.get('/api/v1/properties/:id', (req, res) => {
    const property = PropertiesRepository.getPropertyById(req.params.id!);
    if (!property) {
      return errorResponse(res, 'NOT_FOUND', 'Property not found', 404);
    }
    const buildings = PropertiesRepository.listBuildings(property.id);
    const units = PropertiesRepository.listUnits({ property_id: property.id });
    successResponse(res, { property, buildings, units });
  });

  router.put('/api/v1/properties/:id', (req, res) => {
    const property = PropertiesRepository.updateProperty(req.params.id!, req.body || {});
    if (!property) {
      return errorResponse(res, 'NOT_FOUND', 'Property not found', 404);
    }
    successResponse(res, { property });
  });

  router.delete('/api/v1/properties/:id', (req, res) => {
    const deleted = PropertiesRepository.deleteProperty(req.params.id!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Property not found', 404);
    }
    successResponse(res, { deleted: true });
  });

  // --- Buildings ---
  router.get('/api/v1/properties/:id/buildings', (req, res) => {
    const property = PropertiesRepository.getPropertyById(req.params.id!);
    if (!property) {
      return errorResponse(res, 'NOT_FOUND', 'Property not found', 404);
    }
    const buildings = PropertiesRepository.listBuildings(property.id);
    successResponse(res, { buildings });
  });

  router.post('/api/v1/properties/:id/buildings', (req, res) => {
    const property = PropertiesRepository.getPropertyById(req.params.id!);
    if (!property) {
      return errorResponse(res, 'NOT_FOUND', 'Property not found', 404);
    }
    const { name, building_number, floors, notes } = req.body || {};
    if (!name) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Building name is required', 400);
    }
    let parsedFloors: number | null = null;
    if (floors !== undefined && floors !== null) {
      const num = Number(floors);
      if (!Number.isInteger(num) || num <= 0) {
        return errorResponse(res, 'VALIDATION_ERROR', 'floors must be a positive integer', 400);
      }
      parsedFloors = num;
    }
    const building = PropertiesRepository.createBuilding({
      property_id: property.id,
      name,
      building_number,
      floors: parsedFloors,
      notes
    });
    successResponse(res, { building }, 201);
  });

  router.get('/api/v1/buildings/:id', (req, res) => {
    const building = PropertiesRepository.getBuildingById(req.params.id!);
    if (!building) {
      return errorResponse(res, 'NOT_FOUND', 'Building not found', 404);
    }
    const units = PropertiesRepository.listUnits({ building_id: building.id });
    successResponse(res, { building, units });
  });

  router.put('/api/v1/buildings/:id', (req, res) => {
    const { floors } = req.body || {};
    if (floors !== undefined && floors !== null) {
      const num = Number(floors);
      if (!Number.isInteger(num) || num <= 0) {
        return errorResponse(res, 'VALIDATION_ERROR', 'floors must be a positive integer', 400);
      }
    }
    const building = PropertiesRepository.updateBuilding(req.params.id!, req.body || {});
    if (!building) {
      return errorResponse(res, 'NOT_FOUND', 'Building not found', 404);
    }
    successResponse(res, { building });
  });

  router.delete('/api/v1/buildings/:id', (req, res) => {
    const deleted = PropertiesRepository.deleteBuilding(req.params.id!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Building not found', 404);
    }
    successResponse(res, { deleted: true });
  });

  // --- Amenities Catalog & Assignments ---
  router.get('/api/v1/properties/amenities/definitions', (req, res) => {
    const category = typeof req.query['category'] === 'string' ? req.query['category'] as AmenityCategory : undefined;
    const amenities = AmenitiesRepository.listAmenities(category);
    successResponse(res, { amenities });
  });

  router.post('/api/v1/properties/amenities/definitions', (req, res) => {
    const { category, name, icon } = req.body || {};
    if (!category || !name) {
      return errorResponse(res, 'VALIDATION_ERROR', 'category and name are required', 400);
    }
    try {
      const def = AmenitiesRepository.createAmenity(category, name, icon, true);
      successResponse(res, { amenity: def }, 201);
    } catch (err: any) {
      errorResponse(res, 'CREATION_FAILED', err.message, 400);
    }
  });

  router.get('/api/v1/properties/:id/amenities', (req, res) => {
    const data = AmenitiesRepository.getPropertyAmenities(req.params.id!);
    successResponse(res, data);
  });

  router.put('/api/v1/properties/:id/amenities', (req, res) => {
    const amenityIds = Array.isArray(req.body?.amenity_ids) ? req.body.amenity_ids : [];
    try {
      AmenitiesRepository.setPropertyAmenities(req.params.id!, amenityIds);
      const data = AmenitiesRepository.getPropertyAmenities(req.params.id!);
      successResponse(res, data);
    } catch (err: any) {
      errorResponse(res, 'UPDATE_FAILED', err.message, 400);
    }
  });

  router.get('/api/v1/properties/units/:id/amenities', (req, res) => {
    const unit = PropertiesRepository.getUnitById(req.params.id!);
    if (!unit) {
      return errorResponse(res, 'NOT_FOUND', 'Unit not found', 404);
    }
    const data = AmenitiesRepository.getUnitAmenities(unit.id, unit.property_id);
    successResponse(res, data);
  });

  router.put('/api/v1/properties/units/:id/amenities', (req, res) => {
    const unit = PropertiesRepository.getUnitById(req.params.id!);
    if (!unit) {
      return errorResponse(res, 'NOT_FOUND', 'Unit not found', 404);
    }
    const selectedIds = Array.isArray(req.body?.selected_ids) ? req.body.selected_ids : [];
    const excludedInheritedIds = Array.isArray(req.body?.excluded_inherited_ids) ? req.body.excluded_inherited_ids : [];
    try {
      AmenitiesRepository.setUnitAmenities(unit.id, { selectedIds, excludedInheritedIds });
      const data = AmenitiesRepository.getUnitAmenities(unit.id, unit.property_id);
      successResponse(res, data);
    } catch (err: any) {
      errorResponse(res, 'UPDATE_FAILED', err.message, 400);
    }
  });

  // --- Marketing Syndication & Flyers ---
  router.get('/api/v1/properties/:id/marketing', (req, res) => {
    const syndication = AmenitiesRepository.getMarketingSyndication(req.params.id!);
    successResponse(res, { syndication });
  });

  router.put('/api/v1/properties/:id/marketing', (req, res) => {
    try {
      const syndication = AmenitiesRepository.upsertMarketingSyndication({
        property_id: req.params.id!,
        ...req.body
      });
      successResponse(res, { syndication });
    } catch (err: any) {
      errorResponse(res, 'UPDATE_FAILED', err.message, 400);
    }
  });

  router.get('/api/v1/properties/units/:id/marketing', (req, res) => {
    const syndication = AmenitiesRepository.getMarketingSyndication(undefined, req.params.id!);
    successResponse(res, { syndication });
  });

  router.put('/api/v1/properties/units/:id/marketing', (req, res) => {
    try {
      const syndication = AmenitiesRepository.upsertMarketingSyndication({
        unit_id: req.params.id!,
        ...req.body
      });
      successResponse(res, { syndication });
    } catch (err: any) {
      errorResponse(res, 'UPDATE_FAILED', err.message, 400);
    }
  });

  router.get('/api/v1/properties/:id/flyer-pdf', (req, res) => {
    const property = PropertiesRepository.getPropertyById(req.params.id!);
    if (!property) {
      return errorResponse(res, 'NOT_FOUND', 'Property not found', 404);
    }
    const { active } = AmenitiesRepository.getPropertyAmenities(property.id);
    const syndication = AmenitiesRepository.getMarketingSyndication(property.id);

    try {
      const pdfBuffer = generateMarketingFlyerPdf({
        property_name: property.name,
        property_type: property.property_type,
        address: `${property.address_line1}, ${property.city}, ${property.state} ${property.postal_code}`,
        headline: syndication?.headline || `Spacious Living at ${property.name}`,
        description: syndication?.description || 'Premier residential community offering modern living spaces, convenience, and attentive local property management.',
        market_rent_cents: syndication?.advertised_rent_cents || 150000,
        target_deposit_cents: syndication?.target_deposit_cents || 150000,
        bedrooms: 2,
        bathrooms: 1.5,
        available_date: syndication?.available_date ? new Date(syndication.available_date).toISOString().slice(0, 10) : 'Immediate',
        amenities: active.map((a) => ({ name: a.name, category: a.category.toUpperCase() })),
        contact_name: syndication?.contact_name || 'Leasing Office',
        contact_phone: syndication?.contact_phone || null,
        contact_email: syndication?.contact_email || null
      });

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="flyer-${property.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.pdf"`,
        'Content-Length': pdfBuffer.length
      });
      res.end(pdfBuffer);
    } catch (err: any) {
      errorResponse(res, 'PDF_FAILED', err.message, 500);
    }
  });

  router.get('/api/v1/properties/units/:id/flyer-pdf', (req, res) => {
    const unit = PropertiesRepository.getUnitById(req.params.id!);
    if (!unit) {
      return errorResponse(res, 'NOT_FOUND', 'Unit not found', 404);
    }
    const property = PropertiesRepository.getPropertyById(unit.property_id);
    const { active } = AmenitiesRepository.getUnitAmenities(unit.id, unit.property_id);
    const syndication = AmenitiesRepository.getMarketingSyndication(undefined, unit.id) || AmenitiesRepository.getMarketingSyndication(unit.property_id);

    try {
      const pdfBuffer = generateMarketingFlyerPdf({
        property_name: property?.name || 'Residence',
        unit_number: unit.unit_number,
        property_type: property?.property_type || 'Apartment',
        address: property ? `${property.address_line1}, ${property.city}, ${property.state} ${property.postal_code}` : 'Address on file',
        headline: syndication?.headline || `Unit ${unit.unit_number} Available at ${property?.name || 'Property'}`,
        description: syndication?.description || 'Thoughtfully finished interior with modern appliances, ample closet space, and fast responsive maintenance.',
        market_rent_cents: syndication?.advertised_rent_cents || unit.market_rent_cents,
        target_deposit_cents: syndication?.target_deposit_cents || unit.target_deposit_cents,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        square_feet: unit.square_feet,
        available_date: syndication?.available_date ? new Date(syndication.available_date).toISOString().slice(0, 10) : 'Available Now',
        amenities: active.map((a) => ({ name: a.name, category: a.category.toUpperCase() })),
        contact_name: syndication?.contact_name || 'Leasing Office',
        contact_phone: syndication?.contact_phone || null,
        contact_email: syndication?.contact_email || null
      });

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="flyer-unit-${unit.unit_number}.pdf"`,
        'Content-Length': pdfBuffer.length
      });
      res.end(pdfBuffer);
    } catch (err: any) {
      errorResponse(res, 'PDF_FAILED', err.message, 500);
    }
  });
}

