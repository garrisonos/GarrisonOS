import { getDatabase } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { buildTemporalSqlConditions } from '../../../api/query-parser.js';

export interface Contact {
  id: string;
  operator_id: string;
  tenant_id?: string;
  contact_type: 'tenant' | 'owner' | 'vendor' | 'guarantor' | 'prospect' | 'emergency';
  first_name: string;
  last_name: string;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
  secondary_phone?: string | null;
  tax_id_last4?: string | null;
  vendor_specialty?: string | null;
  w9_received?: number;
  tax_classification?: string | null;
  notes?: string | null;
  custom_fields?: string | null;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
}

/**
 * Permitted IRS tax classifications for vendor contacts.
 */
export const VALID_TAX_CLASSIFICATIONS = ['individual', 'llc', 'corporation', 'partnership', 'other'] as const;

/**
 * Union type representing valid IRS tax classifications.
 */
export type TaxClassification = typeof VALID_TAX_CLASSIFICATIONS[number];

export class ContactsRepository {
  public static listContacts(filter?: {
    contact_type?: string;
    query?: string;
    temporal?: Record<string, number>;
    orderBy?: string;
  }): Contact[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    let sql = 'SELECT * FROM contacts WHERE operator_id = ? AND deleted_at IS NULL';
    const params: any[] = [operatorId];

    if (filter?.contact_type) {
      sql += ' AND contact_type = ?';
      params.push(filter.contact_type);
    }

    if (filter?.query) {
      sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR company_name LIKE ? OR email LIKE ? OR phone LIKE ?)';
      const term = `%${filter.query}%`;
      params.push(term, term, term, term, term);
    }

    if (filter?.temporal) {
      const { sql: temporalSql, params: temporalParams } = buildTemporalSqlConditions(filter.temporal);
      sql += temporalSql;
      params.push(...temporalParams);
    }

    sql += ` ORDER BY ${filter?.orderBy || 'last_name ASC, first_name ASC'}`;
    return db.prepare(sql).all(...params) as unknown as Contact[];
  }

  public static getContactById(id: string): Contact | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM contacts
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(id, operatorId) as Contact | undefined;
    return row || null;
  }

  public static createContact(data: {
    contact_type: Contact['contact_type'];
    first_name: string;
    last_name: string;
    company_name?: string;
    email?: string;
    phone?: string;
    secondary_phone?: string;
    tax_id_last4?: string;
    vendor_specialty?: string;
    w9_received?: number;
    tax_classification?: string;
    notes?: string;
    custom_fields?: Record<string, any> | string;
  }): Contact {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const id = generateUUIDv7();
    const now = Date.now();

    if (data.tax_classification && !VALID_TAX_CLASSIFICATIONS.includes(data.tax_classification as any)) {
      throw new Error(`Invalid tax_classification: "${data.tax_classification}". Allowed values: ${VALID_TAX_CLASSIFICATIONS.join(', ')}`);
    }

    const customFieldsJson = data.custom_fields !== undefined
      ? (typeof data.custom_fields === 'string' ? data.custom_fields : JSON.stringify(data.custom_fields))
      : '{}';

    db.prepare(`
      INSERT INTO contacts (
        id, operator_id, contact_type, first_name, last_name,
        company_name, email, phone, secondary_phone,
        tax_id_last4, vendor_specialty, w9_received, tax_classification, notes, custom_fields, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      operatorId,
      data.contact_type,
      data.first_name,
      data.last_name,
      data.company_name || null,
      data.email || null,
      data.phone || null,
      data.secondary_phone || null,
      data.tax_id_last4 || null,
      data.vendor_specialty || null,
      data.w9_received ? 1 : 0,
      data.tax_classification || null,
      data.notes || null,
      customFieldsJson,
      now,
      now
    );

    return ContactsRepository.getContactById(id)!;
  }

  public static updateContact(id: string, data: Partial<Omit<Contact, 'id' | 'operator_id' | 'tenant_id' | 'created_at' | 'updated_at' | 'deleted_at'>> & { custom_fields?: Record<string, any> | string }): Contact | null {
    const existing = ContactsRepository.getContactById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    if (data.tax_classification && !VALID_TAX_CLASSIFICATIONS.includes(data.tax_classification as any)) {
      throw new Error(`Invalid tax_classification: "${data.tax_classification}". Allowed values: ${VALID_TAX_CLASSIFICATIONS.join(', ')}`);
    }

    const customFieldsJson = data.custom_fields !== undefined
      ? (typeof data.custom_fields === 'string' ? data.custom_fields : JSON.stringify(data.custom_fields))
      : (typeof existing.custom_fields === 'string' ? existing.custom_fields : JSON.stringify(existing.custom_fields || {}));

    const updated = { ...existing, ...data, updated_at: now };

    db.prepare(`
      UPDATE contacts SET
        contact_type = ?, first_name = ?, last_name = ?,
        company_name = ?, email = ?, phone = ?, secondary_phone = ?,
        tax_id_last4 = ?, vendor_specialty = ?, w9_received = ?, tax_classification = ?, notes = ?, custom_fields = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(
      updated.contact_type,
      updated.first_name,
      updated.last_name,
      updated.company_name || null,
      updated.email || null,
      updated.phone || null,
      updated.secondary_phone || null,
      updated.tax_id_last4 || null,
      updated.vendor_specialty || null,
      updated.w9_received ? 1 : 0,
      updated.tax_classification || null,
      updated.notes || null,
      customFieldsJson,
      now,
      id,
      operatorId
    );

    return ContactsRepository.getContactById(id);
  }

  public static deleteContact(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const info = db.prepare(`
      UPDATE contacts SET deleted_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, id, operatorId);
    return info.changes > 0;
  }
}
