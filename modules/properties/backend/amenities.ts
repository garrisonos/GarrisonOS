import { getDatabase } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';

export type AmenityCategory = 'community' | 'unit' | 'accessibility' | 'pet' | 'eco';

export interface AmenityDefinitionRecord {
  id: string;
  operator_id: string;
  category: AmenityCategory;
  name: string;
  icon: string | null;
  is_custom: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface UnitAmenityViewRecord extends AmenityDefinitionRecord {
  is_inherited: boolean;
  is_override: boolean;
  is_excluded: boolean;
}

export interface MarketingSyndicationRecord {
  id: string;
  operator_id: string;
  property_id: string | null;
  unit_id: string | null;
  headline: string | null;
  description: string | null;
  advertised_rent_cents: number | null;
  target_deposit_cents: number | null;
  available_date: number | null;
  assigned_contact_id: string | null;
  channels_json: string;
  status: 'draft' | 'active' | 'paused';
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  channels?: Record<string, boolean>;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}

export interface UpsertMarketingInput {
  property_id?: string | null;
  unit_id?: string | null;
  headline?: string | null;
  description?: string | null;
  advertised_rent_cents?: number | null;
  target_deposit_cents?: number | null;
  available_date?: number | null;
  assigned_contact_id?: string | null;
  channels?: Record<string, boolean>;
  status?: 'draft' | 'active' | 'paused';
}

const DEFAULT_AMENITIES: Array<{ category: AmenityCategory; name: string; icon: string }> = [
  // Community
  { category: 'community', name: 'Clubhouse', icon: '🏛️' },
  { category: 'community', name: 'Swimming Pool', icon: '🏊' },
  { category: 'community', name: 'Fitness Center', icon: '🏋️' },
  { category: 'community', name: 'Dog Park', icon: '🐕' },
  { category: 'community', name: 'Rooftop Deck', icon: '🌇' },
  { category: 'community', name: 'Gated Access', icon: '🔒' },
  { category: 'community', name: 'Package Lockers', icon: '📦' },
  { category: 'community', name: 'Business Center', icon: '💼' },

  // Unit
  { category: 'unit', name: 'In-Unit Washer/Dryer', icon: '🧺' },
  { category: 'unit', name: 'Dishwasher', icon: '🍽️' },
  { category: 'unit', name: 'Private Balcony / Patio', icon: '🌿' },
  { category: 'unit', name: 'Central Air Conditioning', icon: '❄️' },
  { category: 'unit', name: 'Hardwood Floors', icon: '🪵' },
  { category: 'unit', name: 'Stainless Steel Appliances', icon: '✨' },
  { category: 'unit', name: 'Walk-in Closets', icon: '👔' },

  // Accessibility
  { category: 'accessibility', name: 'Wheelchair Accessible', icon: '♿' },
  { category: 'accessibility', name: 'Elevator Access', icon: '🛗' },
  { category: 'accessibility', name: 'Roll-in Shower', icon: '🚿' },
  { category: 'accessibility', name: 'Accessible Parking', icon: '🅿️' },
  { category: 'accessibility', name: 'Ground Floor Unit', icon: '🚪' },

  // Pet
  { category: 'pet', name: 'Dogs Allowed', icon: '🐕' },
  { category: 'pet', name: 'Cats Allowed', icon: '🐈' },
  { category: 'pet', name: 'Large Dogs Allowed', icon: '🦮' },
  { category: 'pet', name: 'Pet Wash Station', icon: '🛁' },
  { category: 'pet', name: 'No Pets Allowed', icon: '🚫' },

  // Eco
  { category: 'eco', name: 'EV Charging Station', icon: '⚡' },
  { category: 'eco', name: 'Solar Panels', icon: '☀️' },
  { category: 'eco', name: 'Energy Star Appliances', icon: '⭐' },
  { category: 'eco', name: 'Recycling Service', icon: '♻️' },
  { category: 'eco', name: 'Bike Storage', icon: '🚲' }
];

export class AmenitiesRepository {
  /**
   * Seed default amenities for the operator if none exist.
   */
  public static ensureDefaults(opId?: string): void {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();

    const count = (db.prepare('SELECT COUNT(*) as cnt FROM amenity_definitions WHERE operator_id = ? AND deleted_at IS NULL').get(operatorId) as any)?.cnt || 0;
    if (count > 0) return;

    const now = Date.now();
    const stmt = db.prepare(`
      INSERT INTO amenity_definitions (
        id, operator_id, category, name, icon, is_custom, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL)
      ON CONFLICT (operator_id, category, name) WHERE deleted_at IS NULL DO NOTHING
    `);

    for (const item of DEFAULT_AMENITIES) {
      stmt.run(generateUUIDv7(), operatorId, item.category, item.name, item.icon, now, now);
    }
  }

  /**
   * List all amenity definitions, grouped or filtered.
   */
  public static listAmenities(category?: AmenityCategory, opId?: string): AmenityDefinitionRecord[] {
    const operatorId = opId || RequestContext.getOperatorId();
    this.ensureDefaults(operatorId);
    const db = getDatabase();

    if (category) {
      return db.prepare('SELECT * FROM amenity_definitions WHERE operator_id = ? AND category = ? AND deleted_at IS NULL ORDER BY name ASC')
        .all(operatorId, category) as unknown as AmenityDefinitionRecord[];
    }

    return db.prepare('SELECT * FROM amenity_definitions WHERE operator_id = ? AND deleted_at IS NULL ORDER BY category ASC, name ASC')
      .all(operatorId) as unknown as AmenityDefinitionRecord[];
  }

  /**
   * Create a new custom amenity tag.
   */
  public static createAmenity(category: AmenityCategory, name: string, icon?: string, isCustom: boolean = true, opId?: string): AmenityDefinitionRecord {
    const operatorId = opId || RequestContext.getOperatorId();
    this.ensureDefaults(operatorId);
    const db = getDatabase();
    const id = generateUUIDv7();
    const now = Date.now();

    db.prepare(`
      INSERT INTO amenity_definitions (
        id, operator_id, category, name, icon, is_custom, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(id, operatorId, category, name.trim(), icon || '🏷️', isCustom ? 1 : 0, now, now);

    return db.prepare('SELECT * FROM amenity_definitions WHERE id = ?').get(id) as unknown as AmenityDefinitionRecord;
  }

  /**
   * Get amenities assigned to a property.
   */
  public static getPropertyAmenities(propertyId: string, opId?: string): { active: AmenityDefinitionRecord[]; all: AmenityDefinitionRecord[] } {
    const operatorId = opId || RequestContext.getOperatorId();
    this.ensureDefaults(operatorId);
    const db = getDatabase();

    const all = this.listAmenities(undefined, operatorId);
    const active = db.prepare(`
      SELECT a.*
      FROM property_amenities pa
      JOIN amenity_definitions a ON pa.amenity_id = a.id
      WHERE pa.operator_id = ? AND pa.property_id = ? AND pa.deleted_at IS NULL AND a.deleted_at IS NULL
      ORDER BY a.category ASC, a.name ASC
    `).all(operatorId, propertyId) as unknown as AmenityDefinitionRecord[];

    return { active, all };
  }

  /**
   * Set amenities assigned to a property.
   */
  public static setPropertyAmenities(propertyId: string, amenityIds: string[], opId?: string): void {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    // Soft delete existing
    db.prepare('UPDATE property_amenities SET deleted_at = ? WHERE operator_id = ? AND property_id = ? AND deleted_at IS NULL')
      .run(now, operatorId, propertyId);

    const insertStmt = db.prepare(`
      INSERT INTO property_amenities (id, operator_id, property_id, amenity_id, created_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, NULL)
    `);

    for (const amenityId of amenityIds) {
      if (!amenityId) continue;
      insertStmt.run(generateUUIDv7(), operatorId, propertyId, amenityId, now);
    }
  }

  /**
   * Get unit amenities, resolving inheritance from property and manual overrides.
   */
  public static getUnitAmenities(unitId: string, propertyId: string, opId?: string): {
    active: UnitAmenityViewRecord[];
    all: AmenityDefinitionRecord[];
  } {
    const operatorId = opId || RequestContext.getOperatorId();
    this.ensureDefaults(operatorId);
    const db = getDatabase();

    const all = this.listAmenities(undefined, operatorId);

    // 1. Get parent property amenities (inherited)
    const propRows = db.prepare(`
      SELECT a.*
      FROM property_amenities pa
      JOIN amenity_definitions a ON pa.amenity_id = a.id
      WHERE pa.operator_id = ? AND pa.property_id = ? AND pa.deleted_at IS NULL AND a.deleted_at IS NULL
    `).all(operatorId, propertyId) as unknown as AmenityDefinitionRecord[];

    // 2. Get unit-specific assignments and overrides
    const unitRows = db.prepare(`
      SELECT ua.amenity_id, ua.is_override, ua.is_excluded, a.*
      FROM unit_amenities ua
      JOIN amenity_definitions a ON ua.amenity_id = a.id
      WHERE ua.operator_id = ? AND ua.unit_id = ? AND ua.deleted_at IS NULL AND a.deleted_at IS NULL
    `).all(operatorId, unitId) as any[];

    const unitMap = new Map<string, any>(unitRows.map((u) => [u.amenity_id, u]));

    const result: UnitAmenityViewRecord[] = [];

    // Add inherited community amenities (unless explicitly excluded)
    for (const p of propRows) {
      const uOverride = unitMap.get(p.id);
      if (uOverride && uOverride.is_excluded) {
        continue; // excluded on this unit
      }
      result.push({
        ...p,
        is_inherited: true,
        is_override: false,
        is_excluded: false
      });
    }

    // Add unit-specific additions
    for (const u of unitRows) {
      if (!u.is_excluded && !result.some((r) => r.id === u.id)) {
        result.push({
          ...u,
          is_inherited: false,
          is_override: !!u.is_override,
          is_excluded: false
        });
      }
    }

    return { active: result, all };
  }

  /**
   * Set unit amenities including overrides and exclusions.
   */
  public static setUnitAmenities(
    unitId: string,
    options: { selectedIds: string[]; excludedInheritedIds?: string[] },
    opId?: string
  ): void {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    db.prepare('UPDATE unit_amenities SET deleted_at = ? WHERE operator_id = ? AND unit_id = ? AND deleted_at IS NULL')
      .run(now, operatorId, unitId);

    const insertStmt = db.prepare(`
      INSERT INTO unit_amenities (id, operator_id, unit_id, amenity_id, is_override, is_excluded, created_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `);

    for (const id of options.selectedIds) {
      if (!id) continue;
      insertStmt.run(generateUUIDv7(), operatorId, unitId, id, 1, 0, now);
    }

    for (const id of options.excludedInheritedIds || []) {
      if (!id) continue;
      insertStmt.run(generateUUIDv7(), operatorId, unitId, id, 1, 1, now);
    }
  }

  /**
   * Get marketing syndication record.
   */
  public static getMarketingSyndication(propertyId?: string, unitId?: string, opId?: string): MarketingSyndicationRecord | null {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();

    const sql = unitId
      ? `SELECT m.*, c.first_name, c.last_name, c.email as contact_email, c.phone as contact_phone
         FROM marketing_syndication m
         LEFT JOIN contacts c ON m.assigned_contact_id = c.id
         WHERE m.operator_id = ? AND m.unit_id = ? AND m.deleted_at IS NULL`
      : `SELECT m.*, c.first_name, c.last_name, c.email as contact_email, c.phone as contact_phone
         FROM marketing_syndication m
         LEFT JOIN contacts c ON m.assigned_contact_id = c.id
         WHERE m.operator_id = ? AND m.property_id = ? AND m.deleted_at IS NULL`;

    const row = (unitId ? db.prepare(sql).get(operatorId, unitId) : db.prepare(sql).get(operatorId, propertyId || '')) as any;
    if (!row) return null;

    let channels: Record<string, boolean> = {};
    try {
      channels = JSON.parse(row.channels_json);
    } catch {
      channels = {};
    }

    const contactName = row.first_name || row.last_name ? `${row.first_name || ''} ${row.last_name || ''}`.trim() : null;

    return {
      ...row,
      channels,
      contact_name: contactName
    };
  }

  /**
   * Upsert marketing syndication details.
   */
  public static upsertMarketingSyndication(input: UpsertMarketingInput, opId?: string): MarketingSyndicationRecord {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const existing = this.getMarketingSyndication(input.property_id || undefined, input.unit_id || undefined, operatorId);
    const channelsJson = JSON.stringify(input.channels || {});

    if (existing) {
      db.prepare(`
        UPDATE marketing_syndication SET
          headline = ?,
          description = ?,
          advertised_rent_cents = ?,
          target_deposit_cents = ?,
          available_date = ?,
          assigned_contact_id = ?,
          channels_json = ?,
          status = ?,
          updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(
        input.headline ?? existing.headline,
        input.description ?? existing.description,
        input.advertised_rent_cents ?? existing.advertised_rent_cents,
        input.target_deposit_cents ?? existing.target_deposit_cents,
        input.available_date ?? existing.available_date,
        input.assigned_contact_id ?? existing.assigned_contact_id,
        channelsJson,
        input.status ?? existing.status,
        now,
        existing.id,
        operatorId
      );
      return this.getMarketingSyndication(input.property_id || undefined, input.unit_id || undefined, operatorId)!;
    }

    const id = generateUUIDv7();
    db.prepare(`
      INSERT INTO marketing_syndication (
        id, operator_id, property_id, unit_id, headline, description,
        advertised_rent_cents, target_deposit_cents, available_date,
        assigned_contact_id, channels_json, status, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id,
      operatorId,
      input.property_id || null,
      input.unit_id || null,
      input.headline ?? null,
      input.description ?? null,
      input.advertised_rent_cents ?? null,
      input.target_deposit_cents ?? null,
      input.available_date ?? null,
      input.assigned_contact_id ?? null,
      channelsJson,
      input.status || 'draft',
      now,
      now
    );

    return this.getMarketingSyndication(input.property_id || undefined, input.unit_id || undefined, operatorId)!;
  }
}
