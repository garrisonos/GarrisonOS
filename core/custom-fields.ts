/**
 * Dynamic Custom Fields Engine
 *
 * Provides schema definitions, type validation, strict date formatting (YYYY-MM-DD),
 * and parent entity mutation across properties, buildings, units, leases, contacts, and work orders.
 */

import { getDatabase } from '../database/client.js';
import { RequestContext } from './context.js';
import { generateUUIDv7 } from './crypto.js';

/**
 * Permitted entity types supporting dynamic custom fields.
 */
export type CustomFieldEntityType = 'property' | 'building' | 'unit' | 'lease' | 'contact' | 'work_order';

/**
 * Permitted custom field data types.
 */
export type CustomFieldDataType = 'string' | 'number' | 'boolean' | 'date' | 'select';

/**
 * Custom field definition model representing an active schema rule.
 */
export interface CustomFieldDefinition {
  /** Unique UUIDv7 primary key. */
  id: string;
  /** Operator isolation identifier. */
  operator_id: string;
  /** Target entity domain type. */
  entity_type: CustomFieldEntityType;
  /** Programmatic field key used in JSON payload. */
  field_name: string;
  /** Human-readable label for UI rendering. */
  field_label: string;
  /** Primitive or structured data type rule. */
  data_type: CustomFieldDataType;
  /** JSON-serialized array of valid options for 'select' type. */
  options_json?: string | null;
  /** Boolean flag (1 or 0) indicating whether field is mandatory. */
  is_required: number;
  /** UTC creation epoch millisecond timestamp. */
  created_at: number;
  /** UTC last update epoch millisecond timestamp. */
  updated_at: number;
  /** Soft-delete epoch millisecond timestamp. */
  deleted_at?: number | null;
}

/**
 * Validation result returned after evaluating a custom fields payload against active definitions.
 */
export interface CustomFieldValidationResult {
  /** True if all definition assertions pass; false otherwise. */
  valid: boolean;
  /** Formatted and normalized custom field key-values (with dates formatted to YYYY-MM-DD). */
  formatted: Record<string, any>;
  /** List of validation error messages. */
  errors: string[];
}

const ENTITY_TABLE_MAP: Record<CustomFieldEntityType, string> = {
  property: 'properties',
  building: 'buildings',
  unit: 'units',
  lease: 'leases',
  contact: 'contacts',
  work_order: 'work_orders'
};

const VALID_ENTITY_TYPES: Set<string> = new Set(['property', 'building', 'unit', 'lease', 'contact', 'work_order']);
const VALID_DATA_TYPES: Set<string> = new Set(['string', 'number', 'boolean', 'date', 'select']);

/**
 * Validates whether a calendar date conforms strictly to Gregorian YYYY-MM-DD.
 *
 * @param dateStr - Date string to evaluate.
 * @returns True if valid calendar date; false otherwise.
 */
function isValidIsoDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr!, 10);
  const month = parseInt(monthStr!, 10);
  const day = parseInt(dayStr!, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000 || year > 9999) {
    return false;
  }

  // Days in month check with leap year calculation
  const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1]!;
}

/**
 * Normalizes candidate date inputs into strict YYYY-MM-DD format or returns null if invalid.
 *
 * @param value - Candidate date input (string or numeric timestamp).
 * @returns Standardized YYYY-MM-DD string or null.
 */
function normalizeDateValue(value: any): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (isValidIsoDate(trimmed)) {
      return trimmed;
    }
    // Attempt parse if full ISO string
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const candidate = `${yyyy}-${mm}-${dd}`;
        if (isValidIsoDate(candidate)) return candidate;
      }
    }
    return null;
  }

  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const candidate = `${yyyy}-${mm}-${dd}`;
      if (isValidIsoDate(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Core Service governing Dynamic Custom Field Definitions and entity-level validation.
 */
export class CustomFieldsService {
  /**
   * List custom field definitions for the active operator, optionally filtered by entity type.
   *
   * @param entityType - Optional entity domain type filter.
   * @returns Array of active CustomFieldDefinition records.
   */
  public static listDefinitions(entityType?: CustomFieldEntityType): CustomFieldDefinition[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    let sql = 'SELECT * FROM custom_field_definitions WHERE operator_id = ? AND deleted_at IS NULL';
    const params: any[] = [operatorId];

    if (entityType) {
      sql += ' AND entity_type = ?';
      params.push(entityType);
    }
    sql += ' ORDER BY field_label ASC, created_at ASC';

    return db.prepare(sql).all(...params) as unknown as CustomFieldDefinition[];
  }

  /**
   * Retrieve a single custom field definition by ID within the active operator context.
   *
   * @param id - Unique UUIDv7 of the definition.
   * @returns The definition entity or null if not found.
   */
  public static getDefinitionById(id: string): CustomFieldDefinition | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM custom_field_definitions
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(id, operatorId) as CustomFieldDefinition | undefined;
    return row || null;
  }

  /**
   * Retrieve a definition by entity type and field name within the active operator context.
   *
   * @param entityType - Entity domain type.
   * @param fieldName - Programmatic field key.
   * @returns The definition entity or null if not found.
   */
  public static getDefinitionByName(entityType: CustomFieldEntityType, fieldName: string): CustomFieldDefinition | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM custom_field_definitions
      WHERE operator_id = ? AND entity_type = ? AND field_name = ? AND deleted_at IS NULL
    `).get(operatorId, entityType, fieldName) as CustomFieldDefinition | undefined;
    return row || null;
  }

  /**
   * Create a new custom field definition.
   *
   * @param data - Creation payload.
   * @returns The newly created definition record.
   * @throws Error if validation fails or a duplicate definition name exists for the entity type.
   */
  public static createDefinition(data: {
    entity_type: CustomFieldEntityType;
    field_name: string;
    field_label: string;
    data_type: CustomFieldDataType;
    options?: string[];
    is_required?: boolean | number;
  }): CustomFieldDefinition {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    if (!VALID_ENTITY_TYPES.has(data.entity_type)) {
      throw new Error(`Invalid entity_type "${data.entity_type}". Allowed values: ${Array.from(VALID_ENTITY_TYPES).join(', ')}`);
    }

    if (!VALID_DATA_TYPES.has(data.data_type)) {
      throw new Error(`Invalid data_type "${data.data_type}". Allowed values: ${Array.from(VALID_DATA_TYPES).join(', ')}`);
    }

    const cleanFieldName = (data.field_name || '').trim();
    if (!cleanFieldName || !/^[a-z0-9_]{2,64}$/.test(cleanFieldName)) {
      throw new Error('field_name must contain 2-64 lowercase alphanumeric or underscore characters');
    }

    const cleanLabel = (data.field_label || '').trim();
    if (!cleanLabel) {
      throw new Error('field_label is required');
    }

    let optionsJson: string | null = null;
    if (data.data_type === 'select') {
      if (!Array.isArray(data.options) || data.options.length === 0) {
        throw new Error('options array is required for select data type');
      }
      const sanitizedOptions = data.options.map((opt) => String(opt).trim()).filter(Boolean);
      if (sanitizedOptions.length === 0) {
        throw new Error('select data type requires at least one non-empty option');
      }
      optionsJson = JSON.stringify(sanitizedOptions);
    }

    const isRequired = data.is_required === true || data.is_required === 1 ? 1 : 0;
    const existing = CustomFieldsService.getDefinitionByName(data.entity_type, cleanFieldName);
    if (existing) {
      const err: any = new Error(`A custom field definition with name "${cleanFieldName}" already exists for ${data.entity_type}`);
      err.code = 'CONFLICT';
      throw err;
    }

    const id = generateUUIDv7();
    const now = Date.now();

    db.prepare(`
      INSERT INTO custom_field_definitions (
        id, operator_id, entity_type, field_name, field_label,
        data_type, options_json, is_required, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, operatorId, data.entity_type, cleanFieldName, cleanLabel, data.data_type, optionsJson, isRequired, now, now);

    return CustomFieldsService.getDefinitionById(id)!;
  }

  /**
   * Update an existing custom field definition.
   *
   * @param id - Definition ID to update.
   * @param data - Partial fields to update.
   * @returns Updated definition or null if not found.
   */
  public static updateDefinition(
    id: string,
    data: Partial<{ field_label: string; is_required: boolean | number; options: string[] }>
  ): CustomFieldDefinition | null {
    const existing = CustomFieldsService.getDefinitionById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const fieldLabel = data.field_label !== undefined ? data.field_label.trim() : existing.field_label;
    if (!fieldLabel) {
      throw new Error('field_label cannot be empty');
    }

    const isRequired = data.is_required !== undefined
      ? (data.is_required === true || data.is_required === 1 ? 1 : 0)
      : existing.is_required;

    let optionsJson = existing.options_json;
    if (existing.data_type === 'select' && data.options !== undefined) {
      if (!Array.isArray(data.options) || data.options.length === 0) {
        throw new Error('options array is required for select data type');
      }
      const sanitized = data.options.map((opt) => String(opt).trim()).filter(Boolean);
      if (sanitized.length === 0) {
        throw new Error('select data type requires at least one non-empty option');
      }
      optionsJson = JSON.stringify(sanitized);
    }

    db.prepare(`
      UPDATE custom_field_definitions
      SET field_label = ?, is_required = ?, options_json = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(fieldLabel, isRequired, optionsJson ?? null, now, id, operatorId);

    return CustomFieldsService.getDefinitionById(id);
  }

  /**
   * Soft-delete a custom field definition by ID within the active operator context.
   *
   * @param id - Unique definition ID.
   * @returns True if deleted; false otherwise.
   */
  public static deleteDefinition(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const info = db.prepare(`
      UPDATE custom_field_definitions
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, now, id, operatorId);
    return info.changes > 0;
  }

  /**
   * Validates a custom_fields payload against active definitions for an entity type.
   *
   * Standardizes date formats to strict YYYY-MM-DD.
   *
   * @param entityType - Entity domain type.
   * @param customFields - Raw custom fields object from client payload.
   * @param operatorId - Optional explicit operator context override.
   * @returns Validation result with formatted values or error messages.
   */
  public static validateAndFormat(
    entityType: CustomFieldEntityType,
    customFields: Record<string, any> = {},
    operatorId?: string
  ): CustomFieldValidationResult {
    const activeOperatorId = operatorId || RequestContext.getOperatorId();
    const db = getDatabase();

    const definitions = db.prepare(`
      SELECT * FROM custom_field_definitions
      WHERE operator_id = ? AND entity_type = ? AND deleted_at IS NULL
    `).all(activeOperatorId, entityType) as unknown as CustomFieldDefinition[];

    const formatted: Record<string, any> = {};
    const errors: string[] = [];

    // Safely copy non-defined fields while filtering prototype pollution keys
    for (const [key, val] of Object.entries(customFields)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      formatted[key] = val;
    }

    for (const def of definitions) {
      const val = customFields[def.field_name];
      const isMissing = val === undefined || val === null || (typeof val === 'string' ? val.trim() === '' : false);

      if (def.is_required === 1 && isMissing) {
        errors.push(`Custom field "${def.field_label}" (${def.field_name}) is required`);
        continue;
      }

      if (isMissing) {
        continue;
      }

      switch (def.data_type) {
        case 'string':
          if (typeof val !== 'string') {
            errors.push(`Custom field "${def.field_name}" must be a string`);
          } else {
            formatted[def.field_name] = val;
          }
          break;

        case 'number':
          if (typeof val !== 'number' || !Number.isFinite(val)) {
            errors.push(`Custom field "${def.field_name}" must be a valid finite number`);
          } else {
            formatted[def.field_name] = val;
          }
          break;

        case 'boolean':
          if (typeof val !== 'boolean') {
            errors.push(`Custom field "${def.field_name}" must be a boolean`);
          } else {
            formatted[def.field_name] = val;
          }
          break;

        case 'date': {
          const normalized = normalizeDateValue(val);
          if (!normalized) {
            errors.push(`Custom field "${def.field_name}" must be a valid date in strict YYYY-MM-DD format`);
          } else {
            formatted[def.field_name] = normalized;
          }
          break;
        }

        case 'select': {
          let allowedOptions: string[] = [];
          try {
            allowedOptions = def.options_json ? JSON.parse(def.options_json) : [];
          } catch {
            allowedOptions = [];
          }

          const stringVal = String(val);
          if (!allowedOptions.includes(stringVal)) {
            errors.push(
              `Custom field "${def.field_name}" value "${stringVal}" is invalid. Allowed options: ${allowedOptions.join(', ')}`
            );
          } else {
            formatted[def.field_name] = stringVal;
          }
          break;
        }
      }
    }

    return {
      valid: errors.length === 0,
      formatted,
      errors
    };
  }

  /**
   * Updates an entity's custom_fields JSON column after strict validation.
   *
   * @param entityType - Entity domain type.
   * @param entityId - Unique UUIDv7 of the target entity.
   * @param customFieldsPayload - Candidate custom field values.
   * @returns Updated entity row and formatted custom fields.
   */
  public static updateEntityCustomFields(
    entityType: CustomFieldEntityType,
    entityId: string,
    customFieldsPayload: Record<string, any>
  ): { entity: any; custom_fields: Record<string, any> } {
    if (!VALID_ENTITY_TYPES.has(entityType)) {
      throw new Error(`Unsupported entity type "${entityType}" for custom fields`);
    }

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const tableName = ENTITY_TABLE_MAP[entityType];

    // Ensure entity exists and belongs to active operator
    const entity = db.prepare(`
      SELECT * FROM ${tableName}
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(entityId, operatorId) as any;

    if (!entity) {
      const err: any = new Error(`${entityType} entity not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Merge with existing custom_fields
    let existingCustomFields: Record<string, any> = {};
    if (entity.custom_fields) {
      try {
        existingCustomFields = typeof entity.custom_fields === 'string'
          ? JSON.parse(entity.custom_fields)
          : entity.custom_fields;
      } catch {
        existingCustomFields = {};
      }
    }

    const merged = { ...existingCustomFields, ...customFieldsPayload };
    const validation = CustomFieldsService.validateAndFormat(entityType, merged, operatorId);

    if (!validation.valid) {
      const err: any = new Error(validation.errors.join('; '));
      err.code = 'VALIDATION_ERROR';
      err.details = validation.errors;
      throw err;
    }

    const now = Date.now();
    const customFieldsJson = JSON.stringify(validation.formatted);

    db.prepare(`
      UPDATE ${tableName}
      SET custom_fields = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(customFieldsJson, now, entityId, operatorId);

    const updatedEntity = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(entityId) as any;
    return {
      entity: updatedEntity,
      custom_fields: validation.formatted
    };
  }
}
