import { getDatabase } from '../database/client.js';
import { RequestContext } from './context.js';
import { generateUUIDv7 } from './crypto.js';

/**
 * Valid entity types that support dynamic custom fields.
 */
export type CustomFieldEntityType = 'property' | 'unit' | 'lease' | 'contact' | 'work_order' | 'bill';

/**
 * Supported data types for dynamic custom fields.
 */
export type CustomFieldDataType = 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'select';

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
 * Interface representing a custom field definition.
 */
export interface CustomFieldDefinitionRecord {
  id: string;
  operator_id: string;
  section_id: string | null;
  entity_type: CustomFieldEntityType;
  field_name: string;
  field_label: string;
  data_type: CustomFieldDataType;
  is_required: number;
  default_value: string | null;
  options_json: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  options?: string[];
  section_title?: string | null;
}

/**
 * Input for creating a new section.
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
  is_required?: boolean | number;
  default_value?: string | null;
  options?: string[];
  sort_order?: number;
}

/**
 * Service managing dynamic custom field definitions, sections, and schema validation.
 */
export class CustomFieldsService {
  /**
   * List custom field sections for an entity type within the active operator context.
   */
  public static listSections(entityType?: CustomFieldEntityType, opId?: string): CustomFieldSectionRecord[] {
    const operatorId = opId || RequestContext.tryGet()?.operatorId;
    if (!operatorId) return [];
    const db = getDatabase();

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
   * Create a new custom field section.
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
   * Delete a custom field section.
   */
  public static deleteSection(sectionId: string, opId?: string): void {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    db.prepare('UPDATE custom_field_sections SET deleted_at = ?, updated_at = ? WHERE operator_id = ? AND id = ? AND deleted_at IS NULL')
      .run(now, now, operatorId, sectionId);

    // Unlink any fields assigned to this section
    db.prepare('UPDATE custom_field_definitions SET section_id = NULL, updated_at = ? WHERE operator_id = ? AND section_id = ? AND deleted_at IS NULL')
      .run(now, operatorId, sectionId);
  }

  /**
   * List custom field definitions, optionally filtered by entity type.
   */
  public static listDefinitions(entityType?: CustomFieldEntityType, opId?: string): CustomFieldDefinitionRecord[] {
    const operatorId = opId || RequestContext.tryGet()?.operatorId;
    if (!operatorId) return [];
    const db = getDatabase();

    const sql = `
      SELECT d.*, s.title as section_title
      FROM custom_field_definitions d
      LEFT JOIN custom_field_sections s ON d.section_id = s.id AND s.deleted_at IS NULL
      WHERE d.operator_id = ? ${entityType ? 'AND d.entity_type = ?' : ''} AND d.deleted_at IS NULL
      ORDER BY COALESCE(s.sort_order, 999) ASC, d.sort_order ASC, d.field_label ASC
    `;

    const rows = (entityType ? db.prepare(sql).all(operatorId, entityType) : db.prepare(sql).all(operatorId)) as any[];

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
   * Create a new custom field definition.
   */
  public static createDefinition(input: CreateDefinitionInput, opId?: string): CustomFieldDefinitionRecord {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();
    const id = generateUUIDv7();
    const now = Date.now();

    const fieldName = input.field_name.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    const optionsJson = input.options && Array.isArray(input.options) ? JSON.stringify(input.options) : null;
    const isRequired = input.is_required ? 1 : 0;

    db.prepare(`
      INSERT INTO custom_field_definitions (
        id, operator_id, section_id, entity_type, field_name, field_label, data_type,
        is_required, default_value, options_json, sort_order, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id,
      operatorId,
      input.section_id || null,
      input.entity_type,
      fieldName,
      input.field_label.trim(),
      input.data_type,
      isRequired,
      input.default_value ?? null,
      optionsJson,
      input.sort_order ?? 0,
      now,
      now
    );

    return this.getDefinitionById(id, operatorId)!;
  }

  /**
   * Get a definition by ID.
   */
  public static getDefinitionById(id: string, opId?: string): CustomFieldDefinitionRecord | null {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT d.*, s.title as section_title
      FROM custom_field_definitions d
      LEFT JOIN custom_field_sections s ON d.section_id = s.id AND s.deleted_at IS NULL
      WHERE d.operator_id = ? AND d.id = ? AND d.deleted_at IS NULL
    `).get(operatorId, id) as any;

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
   * Soft delete a custom field definition.
   */
  public static deleteDefinition(id: string, opId?: string): void {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    db.prepare('UPDATE custom_field_definitions SET deleted_at = ?, updated_at = ? WHERE operator_id = ? AND id = ? AND deleted_at IS NULL')
      .run(now, now, operatorId, id);
  }

  /**
   * Validates and formats user-supplied custom field inputs against active definitions.
   */
  public static validateAndFormatCustomFields(
    entityType: CustomFieldEntityType,
    inputValues: Record<string, any>,
    opId?: string
  ): { valid: boolean; errors: string[]; formatted: Record<string, any> } {
    const defs = this.listDefinitions(entityType, opId);
    const errors: string[] = [];
    const formatted: Record<string, any> = {};

    for (const def of defs) {
      const rawVal = inputValues[def.field_name] ?? inputValues[`cf_${def.field_name}`];

      // Check required
      if (def.is_required && (rawVal === undefined || rawVal === null || rawVal === '')) {
        errors.push(`Field '${def.field_label}' is required.`);
        continue;
      }

      if (rawVal === undefined || rawVal === null || rawVal === '') {
        if (def.default_value !== null && def.default_value !== undefined) {
          formatted[def.field_name] = def.default_value;
        }
        continue;
      }

      // Type-specific validation and formatting
      switch (def.data_type) {
        case 'string':
          formatted[def.field_name] = String(rawVal).trim();
          break;

        case 'number': {
          const num = Number(rawVal);
          if (isNaN(num)) {
            errors.push(`Field '${def.field_label}' must be a valid number.`);
          } else {
            formatted[def.field_name] = num;
          }
          break;
        }

        case 'currency': {
          // Stored as integer cents
          const dollars = parseFloat(String(rawVal).replace(/[$,]/g, ''));
          if (isNaN(dollars)) {
            errors.push(`Field '${def.field_label}' must be a valid currency amount.`);
          } else {
            formatted[def.field_name] = Math.round(dollars * 100);
          }
          break;
        }

        case 'boolean':
          formatted[def.field_name] = rawVal === true || rawVal === '1' || rawVal === 1 || rawVal === 'true' || rawVal === 'on';
          break;

        case 'date': {
          const str = String(rawVal).trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            errors.push(`Field '${def.field_label}' must be formatted as YYYY-MM-DD.`);
          } else {
            formatted[def.field_name] = str;
          }
          break;
        }

        case 'select': {
          const str = String(rawVal).trim();
          if (def.options && def.options.length > 0 && !def.options.includes(str)) {
            errors.push(`Field '${def.field_label}' contains an invalid option.`);
          } else {
            formatted[def.field_name] = str;
          }
          break;
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      formatted
    };
  }
}
