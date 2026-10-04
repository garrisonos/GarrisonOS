import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { buildTemporalSqlConditions } from '../../../api/query-parser.js';
import { CustomFieldsService } from '../../../core/custom-fields.js';
import { assertUnitQuota } from '../../../core/license.js';

/**
 * Permitted amenity catalog categories.
 */
export type AmenityCategory = 'community' | 'unit' | 'accessibility' | 'pet' | 'eco';

/**
 * Standardized Amenity catalog entity.
 */
export interface Amenity {
  id: string;
  operator_id: string;
  name: string;
  category: AmenityCategory;
  description?: string | null;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
}

/**
 * Portfolio entity representing a grouping of real estate properties.
 */
export interface Portfolio {
  id: string;
  operator_id: string;
  tenant_id?: string;
  name: string;
  tax_id?: string | null;
  notes?: string | null;
  property_count?: number;
  unit_count?: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
}

/**
 * Property entity representing a physical real estate asset.
 */
export interface Property {
  id: string;
  operator_id: string;
  tenant_id?: string;
  portfolio_id?: string | null;
  name: string;
  property_type: 'single_family' | 'multi_family' | 'condo' | 'townhouse' | 'commercial';
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state: string;
  postal_code: string;
  year_built?: number | null;
  unit_count?: number;
  published_for_rent?: number;
  posting_title?: string | null;
  marketing_description?: string | null;
  pet_policy?: string | null;
  specials?: string | null;
  custom_fields?: string | null;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
}

/**
 * Building entity representing a physical structure within a multi-building property.
 */
export interface Building {
  id: string;
  operator_id: string;
  property_id: string;
  name: string;
  building_number?: string | null;
  floors?: number | null;
  notes?: string | null;
  custom_fields?: string | null;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
}

/**
 * Unit entity representing a leasable space within a property or building.
 */
export interface Unit {
  id: string;
  operator_id: string;
  tenant_id?: string;
  property_id: string;
  building_id?: string | null;
  unit_number: string;
  status: 'vacant' | 'occupied' | 'notice_given' | 'turnover' | 'maintenance_hold';
  bedrooms: number;
  bathrooms: number;
  square_feet?: number | null;
  market_rent_cents: number;
  target_deposit_cents: number;
  published_for_rent?: number;
  posting_title?: string | null;
  marketing_description?: string | null;
  pet_policy?: string | null;
  specials?: string | null;
  custom_fields?: string | null;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
}

/**
 * Repository providing data access for portfolios, properties, buildings, units, and occupancy metrics.
 */
export class PropertiesRepository {
  // --- Portfolios ---

  /**
   * List all active portfolios belonging to the active operator.
   *
   * @param filter - Optional filter containing temporal range and order_by options.
   * @returns Array of active Portfolio records ordered by name or custom sort.
   */
  public static listPortfolios(filter?: { temporal?: Record<string, number>; orderBy?: string }): Portfolio[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    let sql = `
      SELECT p.*,
        COUNT(DISTINCT prop.id) AS property_count,
        COUNT(DISTINCT u.id) AS unit_count
      FROM portfolios p
      LEFT JOIN properties prop ON prop.portfolio_id = p.id AND prop.deleted_at IS NULL AND prop.operator_id = p.operator_id
      LEFT JOIN units u ON u.property_id = prop.id AND u.deleted_at IS NULL AND u.operator_id = p.operator_id
      WHERE p.operator_id = ? AND p.deleted_at IS NULL
    `;
    const params: any[] = [operatorId];

    if (filter?.temporal) {
      const { sql: temporalSql, params: temporalParams } = buildTemporalSqlConditions(filter.temporal, 'p');
      sql += temporalSql;
      params.push(...temporalParams);
    }

    sql += ' GROUP BY p.id';
    sql += ` ORDER BY ${filter?.orderBy ? `p.${filter.orderBy}` : 'p.name ASC'}`;
    return db.prepare(sql).all(...params) as unknown as Portfolio[];
  }

  /**
   * Retrieve a single portfolio by ID within the active operator context.
   *
   * @param id - Unique UUIDv7 of the portfolio.
   * @returns The portfolio entity or null if not found.
   */
  public static getPortfolioById(id: string): Portfolio | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM portfolios
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(id, operatorId) as Portfolio | undefined;
    return row || null;
  }

  /**
   * Create a new portfolio record scoped to the active operator.
   *
   * @param data - Initial portfolio creation payload.
   * @returns The newly created Portfolio entity.
   */
  public static createPortfolio(data: { name: string; tax_id?: string; notes?: string }): Portfolio {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const id = generateUUIDv7();
    const now = Date.now();

    db.prepare(`
      INSERT INTO portfolios (id, operator_id, name, tax_id, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, operatorId, data.name, data.tax_id || null, data.notes || null, now, now);

    return PropertiesRepository.getPortfolioById(id)!;
  }

  /**
   * Update an existing portfolio within the active operator context.
   *
   * @param id - Unique UUIDv7 of the portfolio to update.
   * @param data - Partial fields to update.
   * @returns The updated Portfolio entity or null if not found.
   */
  public static updatePortfolio(id: string, data: Partial<{ name: string; tax_id: string; notes: string }>): Portfolio | null {
    const existing = PropertiesRepository.getPortfolioById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const name = data.name !== undefined ? data.name : existing.name;
    const tax_id = data.tax_id !== undefined ? data.tax_id : existing.tax_id;
    const notes = data.notes !== undefined ? data.notes : existing.notes;

    db.prepare(`
      UPDATE portfolios
      SET name = ?, tax_id = ?, notes = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(name, tax_id || null, notes || null, now, id, operatorId);

    return PropertiesRepository.getPortfolioById(id);
  }

  /**
   * Soft-delete a portfolio by ID within the active operator context.
   *
   * @param id - Unique UUIDv7 of the portfolio to delete.
   * @returns True if a record was soft-deleted, false otherwise.
   */
  public static deletePortfolio(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const info = db.prepare(`
      UPDATE portfolios SET deleted_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, id, operatorId);
    return info.changes > 0;
  }

  // --- Properties ---

  /**
   * List active properties for the active operator, optionally filtered by portfolio.
   *
   * @param filter - Optional filter containing portfolio_id, temporal options, and order_by.
   * @returns Array of active Property records ordered by name or custom sort.
   */
  public static listProperties(filter?: {
    portfolio_id?: string;
    portfolio?: string;
    temporal?: Record<string, number>;
    orderBy?: string;
  }): Property[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    let sql = `
      SELECT prop.*,
        COUNT(DISTINCT u.id) AS unit_count
      FROM properties prop
      LEFT JOIN units u ON u.property_id = prop.id AND u.deleted_at IS NULL AND u.operator_id = prop.operator_id
      WHERE prop.operator_id = ? AND prop.deleted_at IS NULL
    `;
    const params: any[] = [operatorId];

    if (filter?.portfolio_id) {
      sql += ' AND prop.portfolio_id = ?';
      params.push(filter.portfolio_id);
    } else if (filter?.portfolio) {
      sql += ` AND prop.portfolio_id IN (
        SELECT id FROM portfolios WHERE operator_id = ? AND (id = ? OR name = ?) AND deleted_at IS NULL
      )`;
      params.push(operatorId, filter.portfolio, filter.portfolio);
    }

    if (filter?.temporal) {
      const { sql: temporalSql, params: temporalParams } = buildTemporalSqlConditions(filter.temporal, 'prop');
      sql += temporalSql;
      params.push(...temporalParams);
    }

    sql += ' GROUP BY prop.id';
    sql += ` ORDER BY ${filter?.orderBy ? `prop.${filter.orderBy}` : 'prop.name ASC'}`;

    return db.prepare(sql).all(...params) as unknown as Property[];
  }

  /**
   * Retrieve a single property by ID within the active operator context.
   *
   * @param id - Unique UUIDv7 of the property.
   * @returns The property entity or null if not found.
   */
  public static getPropertyById(id: string): Property | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM properties
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(id, operatorId) as Property | undefined;
    return row || null;
  }

  /**
   * Create a new property record scoped to the active operator.
   *
   * @param data - Initial property creation payload including syndication profiles and custom fields.
   * @returns The newly created Property entity.
   */
  public static createProperty(data: {
    name: string;
    property_type: Property['property_type'];
    address_line1: string;
    address_line2?: string | null;
    city: string;
    state: string;
    postal_code: string;
    portfolio_id?: string | null;
    year_built?: number | null;
    published_for_rent?: boolean | number;
    posting_title?: string | null;
    marketing_description?: string | null;
    pet_policy?: string | null;
    specials?: string | null;
    custom_fields?: Record<string, any> | string;
  }): Property {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const id = generateUUIDv7();
    const now = Date.now();

    const publishedForRent = data.published_for_rent === true || data.published_for_rent === 1 ? 1 : 0;
    const customFieldsJson = CustomFieldsService.prepareForWrite('property', data.custom_fields);

    db.prepare(`
      INSERT INTO properties (
        id, operator_id, portfolio_id, name, property_type,
        address_line1, address_line2, city, state, postal_code,
        year_built, published_for_rent, posting_title, marketing_description,
        pet_policy, specials, custom_fields, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      operatorId,
      data.portfolio_id || null,
      data.name,
      data.property_type,
      data.address_line1,
      data.address_line2 || null,
      data.city,
      data.state,
      data.postal_code,
      data.year_built || null,
      publishedForRent,
      data.posting_title || null,
      data.marketing_description || null,
      data.pet_policy || null,
      data.specials || null,
      customFieldsJson,
      now,
      now
    );

    return PropertiesRepository.getPropertyById(id)!;
  }

  /**
   * Update an existing property within the active operator context.
   *
   * @param id - Unique UUIDv7 of the property to update.
   * @param data - Fields to update.
   * @returns The updated Property entity or null if not found.
   */
  public static updateProperty(id: string, data: Partial<Omit<Property, 'id' | 'operator_id' | 'tenant_id' | 'created_at' | 'updated_at' | 'deleted_at' | 'published_for_rent'>> & {
    custom_fields?: Record<string, any> | string;
    published_for_rent?: boolean | number;
  }): Property | null {
    const existing = PropertiesRepository.getPropertyById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const publishedForRent = data.published_for_rent !== undefined
      ? (data.published_for_rent === true || data.published_for_rent === 1 ? 1 : 0)
      : (existing.published_for_rent ?? 0);

    const customFieldsJson = CustomFieldsService.prepareForWrite('property', data.custom_fields, existing.custom_fields);

    const updated = { ...existing, ...data, published_for_rent: publishedForRent, custom_fields: customFieldsJson, updated_at: now };

    db.prepare(`
      UPDATE properties SET
        portfolio_id = ?, name = ?, property_type = ?,
        address_line1 = ?, address_line2 = ?, city = ?, state = ?, postal_code = ?,
        year_built = ?, published_for_rent = ?, posting_title = ?, marketing_description = ?,
        pet_policy = ?, specials = ?, custom_fields = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(
      updated.portfolio_id || null,
      updated.name,
      updated.property_type,
      updated.address_line1,
      updated.address_line2 || null,
      updated.city,
      updated.state,
      updated.postal_code,
      updated.year_built || null,
      updated.published_for_rent,
      updated.posting_title || null,
      updated.marketing_description || null,
      updated.pet_policy || null,
      updated.specials || null,
      updated.custom_fields,
      now,
      id,
      operatorId
    );

    return PropertiesRepository.getPropertyById(id);
  }

  /**
   * Soft-delete a property by ID within the active operator context.
   *
   * @param id - Unique UUIDv7 of the property to delete.
   * @returns True if a record was soft-deleted, false otherwise.
   */
  public static deleteProperty(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const info = db.prepare(`
      UPDATE properties SET deleted_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, id, operatorId);
    return info.changes > 0;
  }

  // --- Buildings ---

  /**
   * List active buildings for the active operator, optionally filtered by property.
   *
   * @param propertyId - Optional UUIDv7 of the property.
   * @param filter - Optional filter containing temporal options and order_by.
   * @returns Array of active Building records ordered by name or custom sort.
   */
  public static listBuildings(
    propertyId?: string,
    filter?: { temporal?: Record<string, number>; orderBy?: string }
  ): Building[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    let sql = 'SELECT * FROM buildings WHERE operator_id = ? AND deleted_at IS NULL';
    const params: any[] = [operatorId];

    if (propertyId) {
      sql += ' AND property_id = ?';
      params.push(propertyId);
    }

    if (filter?.temporal) {
      const { sql: temporalSql, params: temporalParams } = buildTemporalSqlConditions(filter.temporal);
      sql += temporalSql;
      params.push(...temporalParams);
    }

    sql += ` ORDER BY ${filter?.orderBy || 'name ASC'}`;

    return db.prepare(sql).all(...params) as unknown as Building[];
  }

  /**
   * Retrieve a single building by ID within the active operator context.
   *
   * @param id - Unique UUIDv7 of the building.
   * @returns The building entity or null if not found.
   */
  public static getBuildingById(id: string): Building | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM buildings
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(id, operatorId) as Building | undefined;
    return row || null;
  }

  /**
   * Create a new building record scoped to the active operator.
   *
   * @param data - Initial building creation payload.
   * @returns The newly created Building entity.
   */
  public static createBuilding(data: {
    property_id: string;
    name: string;
    building_number?: string | null;
    floors?: number | null;
    notes?: string | null;
    custom_fields?: Record<string, any> | string;
  }): Building {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const id = generateUUIDv7();
    const now = Date.now();

    const customFieldsJson = CustomFieldsService.prepareForWrite('building', data.custom_fields);

    db.prepare(`
      INSERT INTO buildings (
        id, operator_id, property_id, name, building_number,
        floors, notes, custom_fields, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      operatorId,
      data.property_id,
      data.name,
      data.building_number || null,
      data.floors || null,
      data.notes || null,
      customFieldsJson,
      now,
      now
    );

    return PropertiesRepository.getBuildingById(id)!;
  }

  /**
   * Update an existing building within the active operator context.
   *
   * @param id - Unique UUIDv7 of the building to update.
   * @param data - Fields to update.
   * @returns The updated Building entity or null if not found.
   */
  public static updateBuilding(
    id: string,
    data: Partial<Omit<Building, 'id' | 'operator_id' | 'created_at' | 'updated_at' | 'deleted_at'>> & {
      custom_fields?: Record<string, any> | string;
    }
  ): Building | null {
    const existing = PropertiesRepository.getBuildingById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const customFieldsJson = CustomFieldsService.prepareForWrite('building', data.custom_fields, existing.custom_fields);

    const updated = { ...existing, ...data, custom_fields: customFieldsJson, updated_at: now };

    db.prepare(`
      UPDATE buildings SET
        name = ?, building_number = ?, floors = ?, notes = ?, custom_fields = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(
      updated.name,
      updated.building_number || null,
      updated.floors || null,
      updated.notes || null,
      updated.custom_fields,
      now,
      id,
      operatorId
    );

    return PropertiesRepository.getBuildingById(id);
  }

  /**
   * Soft-delete a building and decouple linked units within an atomic transaction.
   *
   * @param id - Unique UUIDv7 of the building to delete.
   * @returns True if the building was soft-deleted, false otherwise.
   */
  public static deleteBuilding(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    return withTransaction((tx) => {
      tx.prepare(`
        UPDATE units SET building_id = NULL, updated_at = ?
        WHERE building_id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(now, id, operatorId);

      const info = tx.prepare(`
        UPDATE buildings SET deleted_at = ?
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(now, id, operatorId);

      return info.changes > 0;
    }, db);
  }

  // --- Units ---

  /**
   * List active units for the active operator matching optional filters.
   *
   * @param filter - Optional filters for property_id, building_id, status, temporal ranges, or order_by.
   * @returns Array of active Unit records ordered by unit_number or custom sort.
   */
  public static listUnits(filter?: {
    property_id?: string;
    building_id?: string;
    status?: string;
    temporal?: Record<string, number>;
    orderBy?: string;
  }): Unit[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    let sql = 'SELECT * FROM units WHERE operator_id = ? AND deleted_at IS NULL';
    const params: any[] = [operatorId];

    if (filter?.property_id) {
      sql += ' AND property_id = ?';
      params.push(filter.property_id);
    }
    if (filter?.building_id) {
      sql += ' AND building_id = ?';
      params.push(filter.building_id);
    }
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }

    if (filter?.temporal) {
      const { sql: temporalSql, params: temporalParams } = buildTemporalSqlConditions(filter.temporal);
      sql += temporalSql;
      params.push(...temporalParams);
    }

    sql += ` ORDER BY ${filter?.orderBy || 'unit_number ASC'}`;

    return db.prepare(sql).all(...params) as unknown as Unit[];
  }

  /**
   * Retrieve a single unit by ID within the active operator context.
   *
   * @param id - Unique UUIDv7 of the unit.
   * @returns The unit entity or null if not found.
   */
  public static getUnitById(id: string): Unit | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM units
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(id, operatorId) as Unit | undefined;
    return row || null;
  }

  /**
   * Create a new unit record scoped to the active operator.
   * Validates that building_id (if supplied) exists and belongs to the property.
   *
   * @param data - Initial unit creation payload including syndication profiles and custom fields.
   * @returns The newly created Unit entity.
   * @throws Error if building_id is invalid or belongs to a different property.
   */
  public static createUnit(data: {
    property_id: string;
    building_id?: string | null;
    unit_number: string;
    status?: Unit['status'];
    bedrooms?: number;
    bathrooms?: number;
    square_feet?: number | null;
    market_rent_cents: number;
    target_deposit_cents?: number;
    published_for_rent?: boolean | number;
    posting_title?: string | null;
    marketing_description?: string | null;
    pet_policy?: string | null;
    specials?: string | null;
    custom_fields?: Record<string, any> | string;
  }): Unit {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    // Enforce Fair-Code and Enterprise unit quotas
    assertUnitQuota(db);

    const id = generateUUIDv7();
    const now = Date.now();

    if (data.building_id) {
      const building = PropertiesRepository.getBuildingById(data.building_id);
      if (!building || building.property_id !== data.property_id) {
        throw new Error('Invalid building_id: building does not exist or does not belong to the specified property');
      }
    }

    const publishedForRent = data.published_for_rent === true || data.published_for_rent === 1 ? 1 : 0;
    const customFieldsJson = CustomFieldsService.prepareForWrite('unit', data.custom_fields);

    db.prepare(`
      INSERT INTO units (
        id, operator_id, property_id, building_id, unit_number, status,
        bedrooms, bathrooms, square_feet, market_rent_cents, target_deposit_cents,
        published_for_rent, posting_title, marketing_description, pet_policy, specials,
        custom_fields, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      operatorId,
      data.property_id,
      data.building_id || null,
      data.unit_number,
      data.status || 'vacant',
      data.bedrooms ?? 1,
      data.bathrooms ?? 1.0,
      data.square_feet || null,
      data.market_rent_cents || 0,
      data.target_deposit_cents || 0,
      publishedForRent,
      data.posting_title || null,
      data.marketing_description || null,
      data.pet_policy || null,
      data.specials || null,
      customFieldsJson,
      now,
      now
    );

    return PropertiesRepository.getUnitById(id)!;
  }

  /**
   * Update an existing unit within the active operator context.
   * Validates that building_id (if supplied) exists and belongs to the property.
   *
   * @param id - Unique UUIDv7 of the unit to update.
   * @param data - Fields to update.
   * @returns The updated Unit entity or null if not found.
   * @throws Error if building_id is invalid or belongs to a different property.
   */
  public static updateUnit(id: string, data: Partial<Omit<Unit, 'id' | 'operator_id' | 'tenant_id' | 'created_at' | 'updated_at' | 'deleted_at' | 'published_for_rent'>> & {
    custom_fields?: Record<string, any> | string;
    published_for_rent?: boolean | number;
  }): Unit | null {
    const existing = PropertiesRepository.getUnitById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const targetPropertyId = data.property_id !== undefined ? data.property_id : existing.property_id;
    const targetBuildingId = data.building_id !== undefined ? data.building_id : existing.building_id;

    if (targetBuildingId) {
      const building = PropertiesRepository.getBuildingById(targetBuildingId);
      if (!building || building.property_id !== targetPropertyId) {
        throw new Error('Invalid building_id: building does not exist or does not belong to the specified property');
      }
    }

    const publishedForRent = data.published_for_rent !== undefined
      ? (data.published_for_rent === true || data.published_for_rent === 1 ? 1 : 0)
      : (existing.published_for_rent ?? 0);

    const customFieldsJson = CustomFieldsService.prepareForWrite('unit', data.custom_fields, existing.custom_fields);

    const updated = {
      ...existing,
      ...data,
      published_for_rent: publishedForRent,
      custom_fields: customFieldsJson,
      updated_at: now
    };

    db.prepare(`
      UPDATE units SET
        property_id = ?, building_id = ?, unit_number = ?, status = ?,
        bedrooms = ?, bathrooms = ?, square_feet = ?,
        market_rent_cents = ?, target_deposit_cents = ?,
        published_for_rent = ?, posting_title = ?, marketing_description = ?,
        pet_policy = ?, specials = ?, custom_fields = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(
      updated.property_id,
      updated.building_id || null,
      updated.unit_number,
      updated.status,
      updated.bedrooms,
      updated.bathrooms,
      updated.square_feet || null,
      updated.market_rent_cents,
      updated.target_deposit_cents,
      updated.published_for_rent,
      updated.posting_title || null,
      updated.marketing_description || null,
      updated.pet_policy || null,
      updated.specials || null,
      updated.custom_fields,
      now,
      id,
      operatorId
    );

    return PropertiesRepository.getUnitById(id);
  }

  /**
   * Update the status of a unit within the active operator context.
   *
   * @param id - Unique UUIDv7 of the unit.
   * @param status - New operational status.
   * @returns True if updated, false otherwise.
   */
  public static updateUnitStatus(id: string, status: Unit['status']): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const info = db.prepare(`
      UPDATE units SET status = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(status, now, id, operatorId);
    return info.changes > 0;
  }

  /**
   * Soft-delete a unit by ID within the active operator context.
   *
   * @param id - Unique UUIDv7 of the unit to delete.
   * @returns True if a record was soft-deleted, false otherwise.
   */
  public static deleteUnit(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const info = db.prepare(`
      UPDATE units SET deleted_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, id, operatorId);
    return info.changes > 0;
  }

  // --- Amenities Catalog & Junctions ---

  /**
   * List active amenities in the catalog for the active operator, optionally filtered by category.
   *
   * @param filter - Optional category, temporal range, and order_by parameters.
   * @returns Array of active Amenity catalog records.
   */
  public static listAmenities(filter?: {
    category?: AmenityCategory;
    temporal?: Record<string, number>;
    orderBy?: string;
  }): Amenity[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    let sql = 'SELECT * FROM amenities WHERE operator_id = ? AND deleted_at IS NULL';
    const params: any[] = [operatorId];

    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }

    if (filter?.temporal) {
      const { sql: temporalSql, params: temporalParams } = buildTemporalSqlConditions(filter.temporal);
      sql += temporalSql;
      params.push(...temporalParams);
    }

    sql += ` ORDER BY ${filter?.orderBy || 'name ASC'}`;

    return db.prepare(sql).all(...params) as unknown as Amenity[];
  }

  /**
   * Retrieve an amenity by unique ID within the active operator context.
   *
   * @param id - Unique UUIDv7 of the amenity.
   * @returns The amenity record or null if not found.
   */
  public static getAmenityById(id: string): Amenity | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM amenities
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(id, operatorId) as Amenity | undefined;
    return row || null;
  }

  /**
   * Create a new amenity in the catalog for the active operator.
   *
   * @param data - Amenity creation payload.
   * @returns The newly created Amenity entity.
   * @throws Error if category is invalid or amenity name already exists for the operator.
   */
  public static createAmenity(data: {
    name: string;
    category: AmenityCategory;
    description?: string | null;
  }): Amenity {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const id = generateUUIDv7();
    const now = Date.now();

    const cleanName = (data.name || '').trim();
    if (!cleanName) {
      throw new Error('Amenity name is required');
    }

    const validCategories: AmenityCategory[] = ['community', 'unit', 'accessibility', 'pet', 'eco'];
    if (!validCategories.includes(data.category)) {
      throw new Error(`Invalid category "${data.category}". Must be one of: ${validCategories.join(', ')}`);
    }

    const existing = db.prepare(`
      SELECT id FROM amenities
      WHERE operator_id = ? AND name = ? AND deleted_at IS NULL
    `).get(operatorId, cleanName);

    if (existing) {
      const err: any = new Error(`An amenity with name "${cleanName}" already exists`);
      err.code = 'CONFLICT';
      throw err;
    }

    db.prepare(`
      INSERT INTO amenities (id, operator_id, name, category, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, operatorId, cleanName, data.category, data.description || null, now, now);

    return PropertiesRepository.getAmenityById(id)!;
  }

  /**
   * Update an existing amenity in the catalog.
   *
   * @param id - Unique UUIDv7 of the amenity to update.
   * @param data - Fields to update.
   * @returns The updated Amenity entity or null if not found.
   */
  public static updateAmenity(
    id: string,
    data: Partial<{ name: string; category: AmenityCategory; description: string | null }>
  ): Amenity | null {
    const existing = PropertiesRepository.getAmenityById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const name = data.name !== undefined ? data.name.trim() : existing.name;
    if (!name) {
      throw new Error('Amenity name cannot be empty');
    }

    const category = data.category !== undefined ? data.category : existing.category;
    const validCategories: AmenityCategory[] = ['community', 'unit', 'accessibility', 'pet', 'eco'];
    if (!validCategories.includes(category)) {
      throw new Error(`Invalid category "${category}". Must be one of: ${validCategories.join(', ')}`);
    }

    if (name !== existing.name) {
      const duplicate = db.prepare(`
        SELECT id FROM amenities
        WHERE operator_id = ? AND name = ? AND id <> ? AND deleted_at IS NULL
      `).get(operatorId, name, id);

      if (duplicate) {
        const err: any = new Error(`An amenity with name "${name}" already exists`);
        err.code = 'CONFLICT';
        throw err;
      }
    }

    const description = data.description !== undefined ? data.description : existing.description;

    db.prepare(`
      UPDATE amenities
      SET name = ?, category = ?, description = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(name, category, description || null, now, id, operatorId);

    return PropertiesRepository.getAmenityById(id);
  }

  /**
   * Soft-delete an amenity from the catalog and decouple linked property/unit junctions.
   *
   * @param id - Unique UUIDv7 of the amenity to delete.
   * @returns True if soft-deleted, false otherwise.
   */
  public static deleteAmenity(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    return withTransaction((tx) => {
      const info = tx.prepare(`
        UPDATE amenities SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(now, now, id, operatorId);

      if (info.changes > 0) {
        tx.prepare(`
          UPDATE property_amenities SET deleted_at = ?
          WHERE amenity_id = ? AND operator_id = ? AND deleted_at IS NULL
        `).run(now, id, operatorId);

        tx.prepare(`
          UPDATE unit_amenities SET deleted_at = ?
          WHERE amenity_id = ? AND operator_id = ? AND deleted_at IS NULL
        `).run(now, id, operatorId);
      }

      return info.changes > 0;
    }, db);
  }

  /**
   * List all amenities associated with a specific property.
   *
   * @param propertyId - Unique UUIDv7 of the property.
   * @returns Array of Amenity entities linked to this property.
   */
  public static getPropertyAmenities(propertyId: string): Amenity[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    return db.prepare(`
      SELECT a.* FROM amenities a
      JOIN property_amenities pa ON pa.amenity_id = a.id
      WHERE pa.property_id = ? AND pa.operator_id = ? AND pa.deleted_at IS NULL
        AND a.operator_id = ? AND a.deleted_at IS NULL
      ORDER BY a.category ASC, a.name ASC
    `).all(propertyId, operatorId, operatorId) as unknown as Amenity[];
  }

  /**
   * Replace and synchronize the set of amenities assigned to a property.
   *
   * @param propertyId - Unique UUIDv7 of the property.
   * @param amenityIds - Array of amenity UUIDs to associate.
   * @returns Array of resulting Amenity entities linked to the property.
   */
  public static setPropertyAmenities(propertyId: string, amenityIds: string[]): Amenity[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const property = PropertiesRepository.getPropertyById(propertyId);
    if (!property) {
      const err: any = new Error('Property not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (amenityIds.length > 0) {
      const placeholders = amenityIds.map(() => '?').join(', ');
      const found = db.prepare(`
        SELECT id FROM amenities
        WHERE operator_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL
      `).all(operatorId, ...amenityIds) as Array<{ id: string }>;

      if (found.length !== amenityIds.length) {
        const foundSet = new Set(found.map((f) => f.id));
        const missing = amenityIds.filter((id) => !foundSet.has(id));
        const err: any = new Error(`One or more amenities do not exist or belong to another operator: ${missing.join(', ')}`);
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
    }

    withTransaction((tx) => {
      tx.prepare(`
        UPDATE property_amenities SET deleted_at = ?
        WHERE property_id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(now, propertyId, operatorId);

      const insertStmt = tx.prepare(`
        INSERT INTO property_amenities (id, operator_id, property_id, amenity_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const amenityId of amenityIds) {
        insertStmt.run(generateUUIDv7(), operatorId, propertyId, amenityId, now);
      }
    }, db);

    return PropertiesRepository.getPropertyAmenities(propertyId);
  }

  /**
   * List all amenities associated with a specific unit.
   *
   * @param unitId - Unique UUIDv7 of the unit.
   * @returns Array of Amenity entities linked to this unit.
   */
  public static getUnitAmenities(unitId: string): Amenity[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    return db.prepare(`
      SELECT a.* FROM amenities a
      JOIN unit_amenities ua ON ua.amenity_id = a.id
      WHERE ua.unit_id = ? AND ua.operator_id = ? AND ua.deleted_at IS NULL
        AND a.operator_id = ? AND a.deleted_at IS NULL
      ORDER BY a.category ASC, a.name ASC
    `).all(unitId, operatorId, operatorId) as unknown as Amenity[];
  }

  /**
   * Replace and synchronize the set of amenities assigned to a unit.
   *
   * @param unitId - Unique UUIDv7 of the unit.
   * @param amenityIds - Array of amenity UUIDs to associate.
   * @returns Array of resulting Amenity entities linked to the unit.
   */
  public static setUnitAmenities(unitId: string, amenityIds: string[]): Amenity[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const unit = PropertiesRepository.getUnitById(unitId);
    if (!unit) {
      const err: any = new Error('Unit not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (amenityIds.length > 0) {
      const placeholders = amenityIds.map(() => '?').join(', ');
      const found = db.prepare(`
        SELECT id FROM amenities
        WHERE operator_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL
      `).all(operatorId, ...amenityIds) as Array<{ id: string }>;

      if (found.length !== amenityIds.length) {
        const foundSet = new Set(found.map((f) => f.id));
        const missing = amenityIds.filter((id) => !foundSet.has(id));
        const err: any = new Error(`One or more amenities do not exist or belong to another operator: ${missing.join(', ')}`);
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
    }

    withTransaction((tx) => {
      tx.prepare(`
        UPDATE unit_amenities SET deleted_at = ?
        WHERE unit_id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(now, unitId, operatorId);

      const insertStmt = tx.prepare(`
        INSERT INTO unit_amenities (id, operator_id, unit_id, amenity_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const amenityId of amenityIds) {
        insertStmt.run(generateUUIDv7(), operatorId, unitId, amenityId, now);
      }
    }, db);

    return PropertiesRepository.getUnitAmenities(unitId);
  }

  // --- Metrics ---

  /**
   * Calculate portfolio-wide unit occupancy metrics and market rent totals.
   *
   * @returns Aggregated metrics including total, occupied, vacant units, percentage, and rent sum.
   */
  public static getOccupancyMetrics(filter?: { property_id?: string; portfolio?: string }): {
    totalUnits: number;
    occupiedUnits: number;
    vacantUnits: number;
    occupancyRatePercentage: number;
    totalMarketRentCents: number;
    byBedroomType: Array<{
      bedrooms: number;
      label: string;
      bedroomType: string;
      total: number;
      totalUnits: number;
      occupied: number;
      occupiedUnits: number;
      vacant: number;
      vacantUnits: number;
      occupancyRate: number;
      occupancyRatePercentage: number;
    }>;
  } {
    let units = PropertiesRepository.listUnits(filter?.property_id ? { property_id: filter.property_id } : undefined);
    if (filter?.portfolio) {
      const properties = PropertiesRepository.listProperties({ portfolio: filter.portfolio });
      const propIds = new Set(properties.map((p) => p.id));
      units = units.filter((u) => propIds.has(u.property_id));
    }

    const totalUnits = units.length;
    const occupiedUnits = units.filter((u) => u.status === 'occupied').length;
    const vacantUnits = totalUnits - occupiedUnits;
    const occupancyRatePercentage = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 10000) / 100 : 0;
    const totalMarketRentCents = units.reduce((sum, u) => sum + (u.market_rent_cents || 0), 0);

    const bedroomDefs = [
      { bedrooms: 0, label: 'Studio' },
      { bedrooms: 1, label: '1 Bedroom' },
      { bedrooms: 2, label: '2 Bedroom' },
      { bedrooms: 3, label: '3+ Bedroom' }
    ];

    const byBedroomType = bedroomDefs.map((def) => {
      const matchingUnits = units.filter((u) => {
        if (def.bedrooms === 3) return u.bedrooms >= 3;
        return u.bedrooms === def.bedrooms;
      });
      const bTotal = matchingUnits.length;
      const bOccupied = matchingUnits.filter((u) => u.status === 'occupied').length;
      const bVacant = bTotal - bOccupied;
      const bRate = bTotal > 0 ? Math.round((bOccupied / bTotal) * 1000) / 10 : 0;
      return {
        bedrooms: def.bedrooms,
        label: def.label,
        bedroomType: def.label,
        total: bTotal,
        totalUnits: bTotal,
        occupied: bOccupied,
        occupiedUnits: bOccupied,
        vacant: bVacant,
        vacantUnits: bVacant,
        occupancyRate: bRate,
        occupancyRatePercentage: bRate
      };
    });

    return {
      totalUnits,
      occupiedUnits,
      vacantUnits,
      occupancyRatePercentage,
      totalMarketRentCents,
      byBedroomType
    };
  }
}
