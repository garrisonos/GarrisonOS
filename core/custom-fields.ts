/**
 * Dynamic Custom Fields Engine
 *
 * Provides schema definitions, customizable section cards, type validation,
 * strict date formatting (YYYY-MM-DD), and parent entity mutation across
 * properties, buildings, units, leases, contacts, work orders, and bills.
 */

import { getDatabase, withTransaction } from '../database/client.js';
import { RequestContext } from './context.js';
import { generateUUIDv7 } from './crypto.js';

/**
 * Permitted entity types supporting dynamic custom fields.
 */
export type CustomFieldEntityType =
  | 'property'
  | 'building'
  | 'unit'
  | 'lease'
  | 'contact'
  | 'work_order'
  | 'bill';

/**
 * Permitted custom field data types.
 */
export type CustomFieldDataType =
  | 'string'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'date'
  | 'select';

/**
 * Interface representing a custom field grouping section card.
 */
export interface CustomFieldSectionRecord {
  id: string;
  operator_id: string;
  entity_type: CustomFieldEntityType;
  title: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/**
 * Custom field definition model representing an active schema rule.
 */
export interface CustomFieldDefinition {
  /** Unique UUIDv7 primary key. */
  id: string;
  /** Operator isolation identifier. */
  operator_id: string;
  /** Optional grouping section card identifier. */
  section_id?: string | null;
  /** Target entity domain type. */
  entity_type: CustomFieldEntityType;
  /** Programmatic field key used in JSON payload. */
  field_name: string;
  /** Human-readable label for UI rendering. */
  field_label: string;
  /** Primitive or structured data type rule. */
  data_type: CustomFieldDataType;
  /** Default value for UI forms. */
  default_value?: string | null;
  /** JSON-serialized array of valid options for 'select' type. */
  options_json?: string | null;
  /** Display sort order within UI forms. */
  sort_order?: number;
  /** Boolean flag (1 or 0) indicating whether field is mandatory. */
  is_required: number;
  /** UTC creation epoch millisecond timestamp. */
  created_at: number;
  /** UTC last update epoch millisecond timestamp. */
  updated_at: number;
  /** Soft-delete epoch millisecond timestamp. */
  deleted_at?: number | null;
  /** Deserialized array of allowed options. */
  options?: string[];
  /** Optional joined title of the parent section card. */
  section_title?: string | null;
}

/**
 * Backward-compatibility alias for CustomFieldDefinition.
 */
export type CustomFieldDefinitionRecord = CustomFieldDefinition;

/**
 * Input for creating a new custom field section card.
 */
export interface CreateSectionInput {
  entity_type: CustomFieldEntityType;
  title: string;
  sort_order?: number;
}

/**
 * Input for creating a custom field definition.
 */
export interface CreateDefinitionInput {
  section_id?: string | null;
  entity_type: CustomFieldEntityType;
  field_name: string;
  field_label: string;
  data_type: CustomFieldDataType;
  options?: string[];
  is_required?: boolean | number;
  default_value?: string | null;
  sort_order?: number;
}

/**
 * Validation result returned after evaluating a custom fields payload against active definitions.
 */
export interface CustomFieldValidationResult {
  /** True if all definition assertions pass; false otherwise. */
  valid: boolean;
  /** Formatted and normalized custom field key-values. */
  formatted: Record<string, any>;
  /** Array of human-readable validation error messages. */
  errors: string[];
}

const VALID_ENTITY_TYPES = new Set<CustomFieldEntityType>([
  'property',
  'building',
  'unit',
  'lease',
  'contact',
  'work_order',
  'bill'
]);

const VALID_DATA_TYPES = new Set<CustomFieldDataType>([
  'string',
  'number',
  'currency',
  'boolean',
  'date',
  'select'
]);

const ENTITY_SQL: Record<string, { select: string; update: string }> = {
  property: {
    select: 'SELECT id, custom_fields FROM properties WHERE id = ? AND operator_id = ? AND deleted_at IS NULL',
    update: 'UPDATE properties SET custom_fields = ?, updated_at = ? WHERE id = ? AND operator_id = ? AND deleted_at IS NULL'
  },
  building: {
    select: 'SELECT id, custom_fields FROM buildings WHERE id = ? AND operator_id = ? AND deleted_at IS NULL',
    update: 'UPDATE buildings SET custom_fields = ?, updated_at = ? WHERE id = ? AND operator_id = ? AND deleted_at IS NULL'
  },
  unit: {
    select: 'SELECT id, custom_fields FROM units WHERE id = ? AND operator_id = ? AND deleted_at IS NULL',
    update: 'UPDATE units SET custom_fields = ?, updated_at = ? WHERE id = ? AND operator_id = ? AND deleted_at IS NULL'
  },
  lease: {
    select: 'SELECT id, custom_fields FROM leases WHERE id = ? AND operator_id = ? AND deleted_at IS NULL',
    update: 'UPDATE leases SET custom_fields = ?, updated_at = ? WHERE id = ? AND operator_id = ? AND deleted_at IS NULL'
  },
  contact: {
    select: 'SELECT id, custom_fields FROM contacts WHERE id = ? AND operator_id = ? AND deleted_at IS NULL',
    update: 'UPDATE contacts SET custom_fields = ?, updated_at = ? WHERE id = ? AND operator_id = ? AND deleted_at IS NULL'
  },
  work_order: {
    select: 'SELECT id, custom_fields FROM work_orders WHERE id = ? AND operator_id = ? AND deleted_at IS NULL',
    update: 'UPDATE work_orders SET custom_fields = ?, updated_at = ? WHERE id = ? AND operator_id = ? AND deleted_at IS NULL'
  }
};

/**
 * Validates a candidate date string or timestamp against strict YYYY-MM-DD Gregorian calendar rules.
 */
function normalizeDateValue(raw: any): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;

  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const day = parseInt(match[3]!, 10);

  if (year < 1000 || year > 9999) return null;
  if (month < 1 || month > 12) return null;

  const daysInMonths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (isLeap) {
    daysInMonths[1] = 29;
  }

  if (day < 1 || day > daysInMonths[month - 1]!) return null;

  return trimmed;
}

/**
 * Service managing dynamic custom field definitions, sections, and schema validation.
 */
export class CustomFieldsService {
  // --- Section Management ---

  /**
   * List custom field sections for an entity type within the active operator context.
   */
  public static listSections(entityType?: CustomFieldEntityType, opId?: string): CustomFieldSectionRecord[] {
    const operatorId = opId || RequestContext.tryGet()?.operatorId;
    if (!operatorId) return [];
    const db = getDatabase();

    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='custom_field_sections'").get();
    if (!tableCheck) return [];

    if (entityType) {
      return db.prepare(
        'SELECT * FROM custom_field_sections WHERE operator_id = ? AND entity_type = ? AND deleted_at IS NULL ORDER BY sort_order ASC, title ASC'
      ).all(operatorId, entityType) as unknown as CustomFieldSectionRecord[];
    }

    return db.prepare(
      'SELECT * FROM custom_field_sections WHERE operator_id = ? AND deleted_at IS NULL ORDER BY entity_type ASC, sort_order ASC, title ASC'
    ).all(operatorId) as unknown as CustomFieldSectionRecord[];
  }

  /**
   * Create a new custom field section card.
   */
  public static createSection(input: CreateSectionInput, opId?: string): CustomFieldSectionRecord {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();
    const id = generateUUIDv7();
    const now = Date.now();

    db.prepare(`
      INSERT INTO custom_field_sections (
        id, operator_id, entity_type, title, sort_order, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(id, operatorId, input.entity_type, input.title.trim(), input.sort_order ?? 0, now, now);

    return db.prepare('SELECT * FROM custom_field_sections WHERE id = ?').get(id) as unknown as CustomFieldSectionRecord;
  }

  /**
   * Delete a custom field section card.
   */
  public static deleteSection(sectionId: string, opId?: string): void {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    withTransaction((tx) => {
      tx.prepare(`
        UPDATE custom_field_sections SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(now, now, sectionId, operatorId);

      const colCheck = tx.prepare("PRAGMA table_info(custom_field_definitions)").all() as Array<{ name: string }>;
      if (colCheck.some((c) => c.name === 'section_id')) {
        tx.prepare(`
          UPDATE custom_field_definitions SET section_id = NULL, updated_at = ?
          WHERE section_id = ? AND operator_id = ? AND deleted_at IS NULL
        `).run(now, sectionId, operatorId);
      }
    }, db);
  }

  // --- Definition Management ---

  /**
   * List custom field definitions, optionally filtered by entity type.
   */
  public static listDefinitions(
    entityType?: CustomFieldEntityType,
    opId?: string
  ): CustomFieldDefinition[] {
    const operatorId = opId || RequestContext.tryGet()?.operatorId;
    if (!operatorId) return [];
    const db = getDatabase();

    const colCheck = db.prepare("PRAGMA table_info(custom_field_definitions)").all() as Array<{ name: string }>;
    const hasSectionId = colCheck.some((c) => c.name === 'section_id');

    let rows: any[];
    if (hasSectionId) {
      let sql = `
        SELECT d.*, s.title as section_title
        FROM custom_field_definitions d
        LEFT JOIN custom_field_sections s ON d.section_id = s.id AND s.deleted_at IS NULL
        WHERE d.operator_id = ? AND d.deleted_at IS NULL
      `;
      const params: any[] = [operatorId];
      if (entityType) {
        sql += ' AND d.entity_type = ?';
        params.push(entityType);
      }
      sql += ' ORDER BY d.sort_order ASC, d.field_label ASC';
      rows = db.prepare(sql).all(...params);
    } else {
      let sql = 'SELECT * FROM custom_field_definitions WHERE operator_id = ? AND deleted_at IS NULL';
      const params: any[] = [operatorId];
      if (entityType) {
        sql += ' AND entity_type = ?';
        params.push(entityType);
      }
      sql += ' ORDER BY created_at ASC';
      rows = db.prepare(sql).all(...params);
    }

    return rows.map((r) => {
      let options: string[] = [];
      if (r.options_json) {
        try {
          options = JSON.parse(r.options_json);
        } catch {
          options = [];
        }
      }
      return {
        ...r,
        options
      };
    });
  }

  /**
   * Retrieve a single definition by its ID.
   */
  public static getDefinitionById(id: string, opId?: string): CustomFieldDefinition | null {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();

    const colCheck = db.prepare("PRAGMA table_info(custom_field_definitions)").all() as Array<{ name: string }>;
    const hasSectionId = colCheck.some((c) => c.name === 'section_id');

    let row: any;
    if (hasSectionId) {
      row = db.prepare(`
        SELECT d.*, s.title as section_title
        FROM custom_field_definitions d
        LEFT JOIN custom_field_sections s ON d.section_id = s.id AND s.deleted_at IS NULL
        WHERE d.id = ? AND d.operator_id = ? AND d.deleted_at IS NULL
      `).get(id, operatorId);
    } else {
      row = db.prepare(`
        SELECT * FROM custom_field_definitions
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).get(id, operatorId);
    }

    if (!row) return null;

    let options: string[] = [];
    if (row.options_json) {
      try {
        options = JSON.parse(row.options_json);
      } catch {
        options = [];
      }
    }

    return {
      ...row,
      options
    };
  }

  /**
   * Create a new custom field definition.
   */
  public static createDefinition(data: CreateDefinitionInput, opId?: string): CustomFieldDefinition {
    const operatorId = opId || RequestContext.getOperatorId();
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
      throw new Error('field_label cannot be empty');
    }

    let optionsJson: string | null = null;
    if (data.data_type === 'select') {
      if (!Array.isArray(data.options) || data.options.length === 0) {
        throw new Error('Data type "select" requires a non-empty array of options');
      }
      const cleaned = data.options.map((o) => String(o).trim()).filter(Boolean);
      if (cleaned.length === 0) {
        throw new Error('Options array must contain at least one non-empty string option');
      }
      optionsJson = JSON.stringify(cleaned);
    }

    const existing = db.prepare(`
      SELECT id FROM custom_field_definitions
      WHERE operator_id = ? AND entity_type = ? AND field_name = ? AND deleted_at IS NULL
    `).get(operatorId, data.entity_type, cleanFieldName);

    if (existing) {
      const err: any = new Error(`A custom field named "${cleanFieldName}" already exists for entity "${data.entity_type}"`);
      err.code = 'CONFLICT';
      throw err;
    }

    const id = generateUUIDv7();
    const now = Date.now();
    const isRequired = data.is_required ? 1 : 0;

    const colCheck = db.prepare("PRAGMA table_info(custom_field_definitions)").all() as Array<{ name: string }>;
    const hasSectionId = colCheck.some((c) => c.name === 'section_id');

    if (hasSectionId) {
      db.prepare(`
        INSERT INTO custom_field_definitions (
          id, operator_id, section_id, entity_type, field_name, field_label,
          data_type, is_required, default_value, options_json, sort_order,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        id,
        operatorId,
        data.section_id || null,
        data.entity_type,
        cleanFieldName,
        cleanLabel,
        data.data_type,
        isRequired,
        data.default_value || null,
        optionsJson,
        data.sort_order ?? 0,
        now,
        now
      );
    } else {
      db.prepare(`
        INSERT INTO custom_field_definitions (
          id, operator_id, entity_type, field_name, field_label,
          data_type, options_json, is_required, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        id,
        operatorId,
        data.entity_type,
        cleanFieldName,
        cleanLabel,
        data.data_type,
        optionsJson,
        isRequired,
        now,
        now
      );
    }

    return CustomFieldsService.getDefinitionById(id, operatorId)!;
  }

  /**
   * Update an existing custom field definition.
   */
  public static updateDefinition(
    id: string,
    data: Partial<CreateDefinitionInput>,
    opId?: string
  ): CustomFieldDefinition | null {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();

    const existing = CustomFieldsService.getDefinitionById(id, operatorId);
    if (!existing) return null;

    const cleanLabel = data.field_label !== undefined ? data.field_label.trim() : existing.field_label;
    if (!cleanLabel) {
      throw new Error('field_label cannot be empty');
    }

    let isRequired = existing.is_required;
    if (data.is_required !== undefined) {
      isRequired = data.is_required ? 1 : 0;
    }

    let optionsJson = existing.options_json;
    if (existing.data_type === 'select' && data.options !== undefined) {
      if (!Array.isArray(data.options) || data.options.length === 0) {
        throw new Error('Data type "select" requires a non-empty array of options');
      }
      const cleaned = data.options.map((o) => String(o).trim()).filter(Boolean);
      if (cleaned.length === 0) {
        throw new Error('Options array must contain at least one non-empty string option');
      }
      optionsJson = JSON.stringify(cleaned);
    }

    const now = Date.now();

    const colCheck = db.prepare("PRAGMA table_info(custom_field_definitions)").all() as Array<{ name: string }>;
    const hasSectionId = colCheck.some((c) => c.name === 'section_id');

    if (hasSectionId) {
      const sectionId = data.section_id !== undefined ? data.section_id : existing.section_id;
      const defaultValue = data.default_value !== undefined ? data.default_value : existing.default_value;
      const sortOrder = data.sort_order !== undefined ? data.sort_order : existing.sort_order;

      db.prepare(`
        UPDATE custom_field_definitions
        SET field_label = ?, is_required = ?, options_json = ?, section_id = ?, default_value = ?, sort_order = ?, updated_at = ?
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(cleanLabel, isRequired, optionsJson, sectionId || null, defaultValue || null, sortOrder ?? 0, now, id, operatorId);
    } else {
      db.prepare(`
        UPDATE custom_field_definitions
        SET field_label = ?, is_required = ?, options_json = ?, updated_at = ?
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(cleanLabel, isRequired, optionsJson, now, id, operatorId);
    }

    return CustomFieldsService.getDefinitionById(id, operatorId);
  }

  /**
   * Soft-delete a custom field definition.
   */
  public static deleteDefinition(id: string, opId?: string): boolean {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const info = db.prepare(`
      UPDATE custom_field_definitions
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, now, id, operatorId);

    return info.changes > 0;
  }

  // --- Validation and Persistence ---

  /**
   * Validate and format a candidate custom fields dictionary against active definitions.
   */
  public static validateAndFormat(
    entityType: CustomFieldEntityType,
    payload: Record<string, any>,
    opId?: string
  ): CustomFieldValidationResult {
    const operatorId = opId || RequestContext.tryGet()?.operatorId;
    const errors: string[] = [];
    const formatted: Record<string, any> = {};

    if (!operatorId) {
      return { valid: true, formatted: { ...payload }, errors: [] };
    }

    const definitions = CustomFieldsService.listDefinitions(entityType, operatorId);
    const defMap = new Map<string, CustomFieldDefinition>();
    for (const def of definitions) {
      defMap.set(def.field_name, def);
    }

    // 1. Check required fields
    for (const def of definitions) {
      if (def.is_required) {
        const val = payload[def.field_name];
        if (val === undefined || val === null || val === '') {
          errors.push(`Field '${def.field_label}' (${def.field_name}) is required.`);
        }
      }
    }

    // 2. Validate and cast supplied values
    for (const [key, val] of Object.entries(payload)) {
      if (val === undefined || val === null || val === '') {
        continue;
      }

      const def = defMap.get(key);
      if (!def) {
        formatted[key] = val;
        continue;
      }

      switch (def.data_type) {
        case 'string':
          formatted[def.field_name] = String(val).trim();
          break;

        case 'number': {
          const num = Number(val);
          if (!Number.isFinite(num)) {
            errors.push(`Field '${def.field_label}' must be a valid number.`);
          } else {
            formatted[def.field_name] = num;
          }
          break;
        }

        case 'currency': {
          if (typeof val === 'number') {
            formatted[def.field_name] = Math.round(val);
          } else {
            const cleanStr = String(val).replace(/[$,]/g, '').trim();
            const dollars = parseFloat(cleanStr);
            if (isNaN(dollars)) {
              errors.push(`Field '${def.field_label}' must be a valid currency amount.`);
            } else {
              formatted[def.field_name] = Math.round(dollars * 100);
            }
          }
          break;
        }

        case 'boolean':
          formatted[def.field_name] = val === true || val === '1' || val === 1 || val === 'true' || val === 'on';
          break;

        case 'date': {
          const normalized = normalizeDateValue(val);
          if (!normalized) {
            errors.push(`Field '${def.field_label}' must be a valid date in strict YYYY-MM-DD format.`);
          } else {
            formatted[def.field_name] = normalized;
          }
          break;
        }

        case 'select': {
          let allowedOptions: string[] = [];
          if (def.options && def.options.length > 0) {
            allowedOptions = def.options;
          } else if (def.options_json) {
            try {
              allowedOptions = JSON.parse(def.options_json);
            } catch {
              allowedOptions = [];
            }
          }

          const strVal = String(val).trim();
          if (allowedOptions.length > 0 && !allowedOptions.includes(strVal)) {
            errors.push(
              `Custom field "${def.field_name}" value "${strVal}" is invalid. Allowed options: ${allowedOptions.join(', ')}`
            );
          } else {
            formatted[def.field_name] = strVal;
          }
          break;
        }

        default:
          formatted[def.field_name] = val;
      }
    }

    return {
      valid: errors.length === 0,
      formatted,
      errors
    };
  }

  /**
   * Prepares, validates, and serializes a custom_fields payload for database storage.
   */
  public static prepareForWrite(
    entityType: CustomFieldEntityType,
    input?: any,
    existingValue?: string | Record<string, any> | null,
    operatorId?: string
  ): string {
    const isUpdate = existingValue !== undefined && existingValue !== null;

    if (input === undefined) {
      if (isUpdate) {
        if (typeof existingValue === 'object') {
          return JSON.stringify(existingValue);
        }
        return existingValue || '{}';
      }
      const res = CustomFieldsService.validateAndFormat(entityType, {}, operatorId);
      if (!res.valid) {
        const err: any = new Error(res.errors.join('; '));
        err.code = 'VALIDATION_ERROR';
        err.statusCode = 400;
        err.details = res.errors;
        throw err;
      }
      return JSON.stringify(res.formatted);
    }

    if (input === null) {
      if (isUpdate) {
        const err: any = new Error('custom_fields cannot be null');
        err.code = 'VALIDATION_ERROR';
        err.statusCode = 400;
        throw err;
      }
      const res = CustomFieldsService.validateAndFormat(entityType, {}, operatorId);
      if (!res.valid) {
        const err: any = new Error(res.errors.join('; '));
        err.code = 'VALIDATION_ERROR';
        err.statusCode = 400;
        err.details = res.errors;
        throw err;
      }
      return JSON.stringify(res.formatted);
    }

    let parsedInput: Record<string, any>;
    if (typeof input === 'string') {
      try {
        parsedInput = JSON.parse(input);
      } catch {
        const err: any = new Error('custom_fields must be a valid JSON object');
        err.code = 'VALIDATION_ERROR';
        err.statusCode = 400;
        throw err;
      }
    } else {
      parsedInput = input;
    }

    if (typeof parsedInput !== 'object' || parsedInput === null || Array.isArray(parsedInput)) {
      const err: any = new Error('custom_fields must be a JSON object');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    let mergedPayload: Record<string, any> = {};
    if (isUpdate && existingValue) {
      if (typeof existingValue === 'string') {
        try {
          mergedPayload = JSON.parse(existingValue);
        } catch {
          mergedPayload = {};
        }
      } else if (typeof existingValue === 'object') {
        mergedPayload = { ...existingValue };
      }
    }

    const finalFields = { ...mergedPayload, ...parsedInput };
    const res = CustomFieldsService.validateAndFormat(entityType, finalFields, operatorId);
    if (!res.valid) {
      const err: any = new Error(res.errors.join('; '));
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      err.details = res.errors;
      throw err;
    }

    return JSON.stringify(res.formatted);
  }

  /**
   * Updates an entity's custom_fields JSON column after strict validation.
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
    const sqlSet = ENTITY_SQL[entityType];

    if (!sqlSet) {
      throw new Error(`Unsupported entity type "${entityType}" for custom fields`);
    }

    const entity = db.prepare(sqlSet.select).get(entityId, operatorId) as any;

    if (!entity) {
      const err: any = new Error(`${entityType} entity not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const customFieldsJson = CustomFieldsService.prepareForWrite(
      entityType,
      customFieldsPayload,
      entity.custom_fields,
      operatorId
    );

    const now = Date.now();
    db.prepare(sqlSet.update).run(customFieldsJson, now, entityId, operatorId);

    const updatedEntity = db.prepare(sqlSet.select).get(entityId, operatorId) as any;
    return {
      entity: updatedEntity,
      custom_fields: JSON.parse(customFieldsJson)
    };
  }
}
