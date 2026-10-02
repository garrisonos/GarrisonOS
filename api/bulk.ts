/**
 * Standardized High-Volume Bulk Transactional Ingestion Engine
 *
 * Handles atomic batch ingestion for primary entities:
 * POST /api/v1/:resource/bulk (and alias /api/v1/properties/units/bulk)
 *
 * Invariant: All-or-nothing rollback on partial failure. If any single item fails validation,
 * the entire batch transaction rolls back with zero state mutations committed.
 */

import { ApiRequest } from './router.js';
import { ServerResponse } from 'node:http';
import { successResponse, errorResponse } from './response.js';
import { withTransaction } from '../database/client.js';
import { PropertiesRepository } from '../modules/properties/backend/repository.js';
import { ContactsRepository } from '../modules/contacts/backend/repository.js';
import { LeasesRepository } from '../modules/leases/backend/repository.js';
import { MaintenanceRepository } from '../modules/maintenance/backend/repository.js';
import { CustomFieldsService, CustomFieldEntityType } from '../core/custom-fields.js';

/**
 * Error detail envelope for an invalid item in a bulk ingestion array.
 */
export interface BulkItemError {
  /** 0-based index of the failed item within the ingestion payload. */
  index: number;
  /** Categorical error code (e.g. VALIDATION_ERROR). */
  code: string;
  /** Explanatory validation or constraint violation message. */
  message: string;
}

const MAX_BULK_ITEMS = 100;

const RESOURCE_ENTITY_TYPE_MAP: Record<string, CustomFieldEntityType | undefined> = {
  properties: 'property',
  property: 'property',
  buildings: 'building',
  building: 'building',
  units: 'unit',
  unit: 'unit',
  contacts: 'contact',
  contact: 'contact',
  leases: 'lease',
  lease: 'lease',
  work_orders: 'work_order',
  work_order: 'work_order',
  maintenance: 'work_order'
};

/**
 * Validates a single item in a bulk ingestion array for the specified resource.
 *
 * @param resource - Canonical resource name.
 * @param item - Raw item payload.
 * @param index - Position in batch array.
 * @returns Array of validation error messages for this item.
 */
function validateResourceItem(resource: string, item: any, _index: number): string[] {
  const errors: string[] = [];

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return ['Item must be a valid JSON object'];
  }

  // Validate custom fields if definition entity type matches
  const entityType = RESOURCE_ENTITY_TYPE_MAP[resource];
  if (entityType && item.custom_fields !== undefined) {
    if (typeof item.custom_fields !== 'object' || item.custom_fields === null || Array.isArray(item.custom_fields)) {
      errors.push('custom_fields must be a JSON object');
    } else {
      const cfValidation = CustomFieldsService.validateAndFormat(entityType, item.custom_fields);
      if (!cfValidation.valid) {
        errors.push(...cfValidation.errors);
      } else {
        item.custom_fields = cfValidation.formatted;
      }
    }
  }

  switch (resource) {
    case 'amenities':
      if (!item.name || typeof item.name !== 'string' || !item.name.trim()) {
        errors.push('Amenity name is required and must be a string');
      }
      if (!['community', 'unit', 'accessibility', 'pet', 'eco'].includes(item.category)) {
        errors.push(`Invalid amenity category "${item.category}". Must be one of: community, unit, accessibility, pet, eco`);
      }
      break;

    case 'properties':
      if (!item.name || typeof item.name !== 'string' || !item.name.trim()) {
        errors.push('Property name is required');
      }
      if (!['single_family', 'multi_family', 'condo', 'townhouse', 'commercial'].includes(item.property_type)) {
        errors.push(`Invalid property_type "${item.property_type}"`);
      }
      if (!item.address_line1 || !item.city || !item.state || !item.postal_code) {
        errors.push('address_line1, city, state, and postal_code are required');
      }
      break;

    case 'buildings':
      if (!item.property_id || typeof item.property_id !== 'string') {
        errors.push('property_id is required for building');
      }
      if (!item.name || typeof item.name !== 'string' || !item.name.trim()) {
        errors.push('Building name is required');
      }
      break;

    case 'units':
      if (!item.property_id || typeof item.property_id !== 'string') {
        errors.push('property_id is required for unit');
      }
      if (!item.unit_number || typeof item.unit_number !== 'string' || !item.unit_number.trim()) {
        errors.push('unit_number is required');
      }
      if (item.market_rent_cents === undefined || !Number.isInteger(Number(item.market_rent_cents))) {
        errors.push('market_rent_cents must be an integer');
      }
      break;

    case 'contacts':
      if (!['tenant', 'owner', 'vendor', 'guarantor', 'prospect', 'emergency'].includes(item.contact_type)) {
        errors.push(`Invalid contact_type "${item.contact_type}"`);
      }
      if (!item.first_name || typeof item.first_name !== 'string' || !item.first_name.trim()) {
        errors.push('first_name is required');
      }
      if (!item.last_name || typeof item.last_name !== 'string' || !item.last_name.trim()) {
        errors.push('last_name is required');
      }
      break;

    case 'leases':
      if (!item.unit_id || typeof item.unit_id !== 'string') {
        errors.push('unit_id is required');
      }
      if (!Number.isInteger(Number(item.start_date)) || !Number.isInteger(Number(item.end_date))) {
        errors.push('start_date and end_date must be integer timestamps');
      }
      if (item.rent_amount_cents === undefined || !Number.isInteger(Number(item.rent_amount_cents))) {
        errors.push('rent_amount_cents must be an integer in cents');
      }
      break;

    case 'work_orders':
    case 'maintenance':
      if (!item.property_id || typeof item.property_id !== 'string') {
        errors.push('property_id is required');
      }
      if (!item.title || typeof item.title !== 'string' || !item.title.trim()) {
        errors.push('title is required');
      }
      if (!item.description || typeof item.description !== 'string' || !item.description.trim()) {
        errors.push('description is required');
      }
      break;

    default:
      errors.push(`Unsupported resource for bulk ingestion: "${resource}"`);
      break;
  }

  return errors;
}

/**
 * Executes a single entity insertion within the active transaction.
 *
 * @param resource - Canonical resource name.
 * @param item - Validated item data.
 * @returns Created entity record.
 */
function insertResourceItem(resource: string, item: any): any {
  switch (resource) {
    case 'amenities':
      return PropertiesRepository.createAmenity(item);
    case 'properties':
      return PropertiesRepository.createProperty(item);
    case 'buildings':
      return PropertiesRepository.createBuilding(item);
    case 'units':
      return PropertiesRepository.createUnit(item);
    case 'contacts':
      return ContactsRepository.createContact(item);
    case 'leases':
      return LeasesRepository.createLease(item);
    case 'work_orders':
    case 'maintenance':
      return MaintenanceRepository.createWorkOrder(item);
    default:
      throw new Error(`Unsupported resource "${resource}"`);
  }
}

/**
 * Executes atomic transactional bulk insertion of items.
 *
 * Pre-validates all items and executes inserts in a single transaction.
 * Rolls back completely if any item fails validation or database constraint.
 *
 * @param rawResource - Target resource name.
 * @param rawItems - Array of entity objects to insert.
 * @returns Result object containing count, ids, and created entity records.
 * @throws Error if validation fails or batch size is invalid.
 */
export function executeBulkIngestion(
  rawResource: string,
  rawItems: any[]
): { count: number; ids: string[]; entities: any[]; details?: BulkItemError[] } {
  if (!rawResource) {
    throw new Error('Resource parameter is required');
  }

  const resource = rawResource.toLowerCase();
  const supported = ['amenities', 'properties', 'buildings', 'units', 'contacts', 'leases', 'work_orders', 'maintenance'];
  if (!supported.includes(resource)) {
    throw new Error(`Resource "${rawResource}" does not support bulk ingestion`);
  }

  if (!rawItems || !Array.isArray(rawItems)) {
    throw new Error('Items must be an array');
  }

  if (rawItems.length === 0 || rawItems.length > MAX_BULK_ITEMS) {
    throw new Error(`Bulk request must contain between 1 and ${MAX_BULK_ITEMS} items`);
  }

  // Pre-validate all items before beginning database transaction
  const validationErrors: BulkItemError[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const itemErrors = validateResourceItem(resource, rawItems[i], i);
    for (const msg of itemErrors) {
      validationErrors.push({
        index: i,
        code: 'VALIDATION_ERROR',
        message: msg
      });
    }
  }

  if (validationErrors.length > 0) {
    const err: any = new Error(`Bulk ingestion failed validation: ${validationErrors.map((e) => `Item ${e.index + 1}: ${e.message}`).join('; ')}`);
    err.code = 'VALIDATION_ERROR';
    err.details = validationErrors;
    throw err;
  }

  const createdRecords: any[] = [];

  withTransaction(() => {
    for (let i = 0; i < rawItems.length; i++) {
      try {
        const created = insertResourceItem(resource, rawItems[i]);
        createdRecords.push(created);
      } catch (insertErr: any) {
        const bulkErr: any = new Error(insertErr.message || 'Insertion failed');
        bulkErr.code = insertErr.code || 'VALIDATION_ERROR';
        bulkErr.failedIndex = i;
        throw bulkErr;
      }
    }
  });

  return {
    count: createdRecords.length,
    ids: createdRecords.map((r) => r.id),
    entities: createdRecords
  };
}

/**
 * HTTP route handler for transactional bulk array ingestion.
 *
 * @param req - Incoming API request.
 * @param res - Outgoing server response.
 * @param explicitResource - Optional resource override (e.g. for /properties/units/bulk).
 */
export function handleBulkIngestion(req: ApiRequest, res: ServerResponse, explicitResource?: string): void {
  const rawResource = explicitResource || req.params['resource'];
  if (!rawResource) {
    return errorResponse(res, 'VALIDATION_ERROR', 'Resource route parameter is required', 400);
  }

  // Extract batch items array from body
  let items: any[] | null = null;
  if (Array.isArray(req.body)) {
    items = req.body;
  } else if (req.body && typeof req.body === 'object') {
    if (Array.isArray(req.body.items)) {
      items = req.body.items;
    } else if (Array.isArray(req.body.records)) {
      items = req.body.records;
    } else if (Array.isArray(req.body[rawResource.toLowerCase()])) {
      items = req.body[rawResource.toLowerCase()];
    }
  }

  if (!items || !Array.isArray(items)) {
    return errorResponse(res, 'VALIDATION_ERROR', 'Request body must contain an array of items (e.g. { "items": [ ... ] })', 400);
  }

  try {
    const result = executeBulkIngestion(rawResource, items);
    successResponse(
      res,
      {
        total_processed: items.length,
        success_count: result.count,
        failed_count: 0,
        ids: result.ids,
        created_records: result.entities,
        errors: []
      },
      201
    );
  } catch (err: any) {
    const failureIndex = typeof err.failedIndex === 'number' ? err.failedIndex : 0;
    const details = err.details || [
      {
        index: failureIndex,
        code: err.code || 'VALIDATION_ERROR',
        message: err.message || 'Bulk ingestion failed'
      }
    ];
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: false,
        error: {
          code: err.code || 'VALIDATION_ERROR',
          message: err.message || 'Bulk ingestion failed; all changes rolled back',
          details
        }
      })
    );
  }
}
