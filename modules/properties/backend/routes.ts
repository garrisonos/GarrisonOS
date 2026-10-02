import { Router } from '../../../api/router.js';
import { successResponse, errorResponse } from '../../../api/response.js';
import { PropertiesRepository, AmenityCategory } from './repository.js';
import { validateTemporalParams, parseOrderByClause } from '../../../api/query-parser.js';

/**
 * Register properties, portfolios, buildings, units, and amenities API routes with the router.
 *
 * @param router - Application router instance to register route handlers on.
 */
export function registerRoutes(router: Router): void {
  // --- Amenities Catalog ---
  router.get('/api/v1/amenities', (req, res) => {
    const temporal = validateTemporalParams(req.query, ['created_at', 'updated_at']);
    if (temporal.error) {
      return errorResponse(res, 'VALIDATION_ERROR', temporal.error, 400);
    }

    const orderBy = parseOrderByClause(
      req.query['order_by'],
      ['name', 'category', 'created_at', 'updated_at'],
      'name ASC'
    );
    if (orderBy.error) {
      return errorResponse(res, 'VALIDATION_ERROR', orderBy.error, 400);
    }

    const category = req.query['category'] as AmenityCategory | undefined;
    if (category) {
      const validCategories: AmenityCategory[] = ['community', 'unit', 'accessibility', 'pet', 'eco'];
      if (!validCategories.includes(category)) {
        return errorResponse(
          res,
          'VALIDATION_ERROR',
          `Invalid category "${category}". Must be one of: ${validCategories.join(', ')}`,
          400
        );
      }
    }

    const amenities = PropertiesRepository.listAmenities({
      category,
      temporal: temporal.params,
      orderBy: orderBy.clause
    });
    successResponse(res, { amenities });
  });

  router.post('/api/v1/amenities', (req, res) => {
    const { name, category, description } = req.body || {};
    if (!name || !category) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Amenity name and category are required', 400);
    }

    try {
      const amenity = PropertiesRepository.createAmenity({ name, category, description });
      successResponse(res, { amenity }, 201);
    } catch (err: any) {
      const status = err.code === 'CONFLICT' ? 409 : 400;
      return errorResponse(res, err.code || 'VALIDATION_ERROR', err.message || 'Failed to create amenity', status);
    }
  });

  router.get('/api/v1/amenities/:id', (req, res) => {
    const amenity = PropertiesRepository.getAmenityById(req.params.id!);
    if (!amenity) {
      return errorResponse(res, 'NOT_FOUND', 'Amenity not found', 404);
    }
    successResponse(res, { amenity });
  });

  router.put('/api/v1/amenities/:id', (req, res) => {
    try {
      const amenity = PropertiesRepository.updateAmenity(req.params.id!, req.body || {});
      if (!amenity) {
        return errorResponse(res, 'NOT_FOUND', 'Amenity not found', 404);
      }
      successResponse(res, { amenity });
    } catch (err: any) {
      const status = err.code === 'CONFLICT' ? 409 : 400;
      return errorResponse(res, err.code || 'VALIDATION_ERROR', err.message || 'Failed to update amenity', status);
    }
  });

  router.delete('/api/v1/amenities/:id', (req, res) => {
    const deleted = PropertiesRepository.deleteAmenity(req.params.id!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Amenity not found', 404);
    }
    successResponse(res, { deleted: true });
  });

  // --- Portfolios ---
  router.get('/api/v1/properties/portfolios', (req, res) => {
    const temporal = validateTemporalParams(req.query, ['created_at', 'updated_at']);
    if (temporal.error) {
      return errorResponse(res, 'VALIDATION_ERROR', temporal.error, 400);
    }

    const orderBy = parseOrderByClause(
      req.query['order_by'],
      ['name', 'tax_id', 'created_at', 'updated_at'],
      'name ASC'
    );
    if (orderBy.error) {
      return errorResponse(res, 'VALIDATION_ERROR', orderBy.error, 400);
    }

    const portfolios = PropertiesRepository.listPortfolios({
      temporal: temporal.params,
      orderBy: orderBy.clause
    });
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
  router.getBatchSafe('/api/v1/properties/metrics/occupancy', (_req, res) => {
    const metrics = PropertiesRepository.getOccupancyMetrics();
    successResponse(res, { metrics });
  });

  // --- Unit Amenities (Placed before generic /units/:id) ---
  router.get('/api/v1/properties/units/:unit_id/amenities', (req, res) => {
    const unit = PropertiesRepository.getUnitById(req.params.unit_id!);
    if (!unit) {
      return errorResponse(res, 'NOT_FOUND', 'Unit not found', 404);
    }
    const amenities = PropertiesRepository.getUnitAmenities(unit.id);
    successResponse(res, { amenities });
  });

  router.put('/api/v1/properties/units/:unit_id/amenities', (req, res) => {
    const { amenity_ids } = req.body || {};
    if (!Array.isArray(amenity_ids)) {
      return errorResponse(res, 'VALIDATION_ERROR', 'amenity_ids array is required', 400);
    }

    try {
      const amenities = PropertiesRepository.setUnitAmenities(req.params.unit_id!, amenity_ids);
      successResponse(res, { amenities });
    } catch (err: any) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return errorResponse(res, err.code || 'VALIDATION_ERROR', err.message || 'Failed to set unit amenities', status);
    }
  });

  // --- Units ---
  router.get('/api/v1/properties/units', (req, res) => {
    const temporal = validateTemporalParams(req.query, ['created_at', 'updated_at']);
    if (temporal.error) {
      return errorResponse(res, 'VALIDATION_ERROR', temporal.error, 400);
    }

    const orderBy = parseOrderByClause(
      req.query['order_by'],
      [
        'unit_number',
        'status',
        'bedrooms',
        'bathrooms',
        'square_feet',
        'market_rent_cents',
        'target_deposit_cents',
        'published_for_rent',
        'created_at',
        'updated_at'
      ],
      'unit_number ASC'
    );
    if (orderBy.error) {
      return errorResponse(res, 'VALIDATION_ERROR', orderBy.error, 400);
    }

    const units = PropertiesRepository.listUnits({
      property_id: req.query.property_id,
      building_id: req.query.building_id,
      status: req.query.status,
      temporal: temporal.params,
      orderBy: orderBy.clause
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
      if (err?.code === 'VALIDATION_ERROR') {
        return errorResponse(res, 'VALIDATION_ERROR', err.message, 400, err.details);
      }
      throw err;
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
      if (err?.code === 'VALIDATION_ERROR') {
        return errorResponse(res, 'VALIDATION_ERROR', err.message, 400, err.details);
      }
      throw err;
    }
  });

  router.delete('/api/v1/properties/units/:id', (req, res) => {
    const deleted = PropertiesRepository.deleteUnit(req.params.id!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Unit not found', 404);
    }
    successResponse(res, { deleted: true });
  });

  // --- Property Amenities ---
  router.get('/api/v1/properties/:id/amenities', (req, res) => {
    const property = PropertiesRepository.getPropertyById(req.params.id!);
    if (!property) {
      return errorResponse(res, 'NOT_FOUND', 'Property not found', 404);
    }
    const amenities = PropertiesRepository.getPropertyAmenities(property.id);
    successResponse(res, { amenities });
  });

  router.put('/api/v1/properties/:id/amenities', (req, res) => {
    const { amenity_ids } = req.body || {};
    if (!Array.isArray(amenity_ids)) {
      return errorResponse(res, 'VALIDATION_ERROR', 'amenity_ids array is required', 400);
    }

    try {
      const amenities = PropertiesRepository.setPropertyAmenities(req.params.id!, amenity_ids);
      successResponse(res, { amenities });
    } catch (err: any) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return errorResponse(res, err.code || 'VALIDATION_ERROR', err.message || 'Failed to set property amenities', status);
    }
  });

  // --- Properties ---
  router.get('/api/v1/properties', (req, res) => {
    const temporal = validateTemporalParams(req.query, ['created_at', 'updated_at']);
    if (temporal.error) {
      return errorResponse(res, 'VALIDATION_ERROR', temporal.error, 400);
    }

    const orderBy = parseOrderByClause(
      req.query['order_by'],
      [
        'name',
        'property_type',
        'city',
        'state',
        'postal_code',
        'year_built',
        'published_for_rent',
        'created_at',
        'updated_at'
      ],
      'name ASC'
    );
    if (orderBy.error) {
      return errorResponse(res, 'VALIDATION_ERROR', orderBy.error, 400);
    }

    const properties = PropertiesRepository.listProperties({
      portfolio_id: req.query.portfolio_id,
      temporal: temporal.params,
      orderBy: orderBy.clause
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
    try {
      const property = PropertiesRepository.createProperty(req.body);
      successResponse(res, { property }, 201);
    } catch (error: any) {
      if (error?.code === 'VALIDATION_ERROR') {
        return errorResponse(res, 'VALIDATION_ERROR', error.message, 400, error.details);
      }
      throw error;
    }
  });

  router.get('/api/v1/properties/:id', (req, res) => {
    const property = PropertiesRepository.getPropertyById(req.params.id!);
    if (!property) {
      return errorResponse(res, 'NOT_FOUND', 'Property not found', 404);
    }
    const buildings = PropertiesRepository.listBuildings(property.id);
    const units = PropertiesRepository.listUnits({ property_id: property.id });
    const amenities = PropertiesRepository.getPropertyAmenities(property.id);
    successResponse(res, { property, buildings, units, amenities });
  });

  router.put('/api/v1/properties/:id', (req, res) => {
    try {
      const property = PropertiesRepository.updateProperty(req.params.id!, req.body || {});
      if (!property) {
        return errorResponse(res, 'NOT_FOUND', 'Property not found', 404);
      }
      successResponse(res, { property });
    } catch (error: any) {
      if (error?.code === 'VALIDATION_ERROR') {
        return errorResponse(res, 'VALIDATION_ERROR', error.message, 400, error.details);
      }
      throw error;
    }
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

    const temporal = validateTemporalParams(req.query, ['created_at', 'updated_at']);
    if (temporal.error) {
      return errorResponse(res, 'VALIDATION_ERROR', temporal.error, 400);
    }

    const orderBy = parseOrderByClause(
      req.query['order_by'],
      ['name', 'building_number', 'floors', 'created_at', 'updated_at'],
      'name ASC'
    );
    if (orderBy.error) {
      return errorResponse(res, 'VALIDATION_ERROR', orderBy.error, 400);
    }

    const buildings = PropertiesRepository.listBuildings(property.id, {
      temporal: temporal.params,
      orderBy: orderBy.clause
    });
    successResponse(res, { buildings });
  });

  router.post('/api/v1/properties/:id/buildings', (req, res) => {
    const property = PropertiesRepository.getPropertyById(req.params.id!);
    if (!property) {
      return errorResponse(res, 'NOT_FOUND', 'Property not found', 404);
    }
    const { name, building_number, floors, notes, custom_fields } = req.body || {};
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
    try {
      const building = PropertiesRepository.createBuilding({
        property_id: property.id,
        name,
        building_number,
        floors: parsedFloors,
        notes,
        custom_fields
      });
      successResponse(res, { building }, 201);
    } catch (error: any) {
      if (error?.code === 'VALIDATION_ERROR') {
        return errorResponse(res, 'VALIDATION_ERROR', error.message, 400, error.details);
      }
      throw error;
    }
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
    try {
      const building = PropertiesRepository.updateBuilding(req.params.id!, req.body || {});
      if (!building) {
        return errorResponse(res, 'NOT_FOUND', 'Building not found', 404);
      }
      successResponse(res, { building });
    } catch (error: any) {
      if (error?.code === 'VALIDATION_ERROR') {
        return errorResponse(res, 'VALIDATION_ERROR', error.message, 400, error.details);
      }
      throw error;
    }
  });

  router.delete('/api/v1/buildings/:id', (req, res) => {
    const deleted = PropertiesRepository.deleteBuilding(req.params.id!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Building not found', 404);
    }
    successResponse(res, { deleted: true });
  });
}
