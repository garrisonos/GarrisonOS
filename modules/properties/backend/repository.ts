import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';

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
   * @returns Array of active Portfolio records ordered by name.
   */
  public static listPortfolios(): Portfolio[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    return db.prepare(`
      SELECT p.*,
        COUNT(DISTINCT prop.id) AS property_count,
        COUNT(DISTINCT u.id) AS unit_count
      FROM portfolios p
      LEFT JOIN properties prop ON prop.portfolio_id = p.id AND prop.deleted_at IS NULL AND prop.operator_id = p.operator_id
      LEFT JOIN units u ON u.property_id = prop.id AND u.deleted_at IS NULL AND u.operator_id = p.operator_id
      WHERE p.operator_id = ? AND p.deleted_at IS NULL
      GROUP BY p.id
      ORDER BY p.name ASC
    `).all(operatorId) as unknown as Portfolio[];
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
   * @param filter - Optional filter containing portfolio_id.
   * @returns Array of active Property records ordered by name.
   */
  public static listProperties(filter?: { portfolio_id?: string; portfolio?: string }): Property[] {
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
    sql += ' GROUP BY prop.id ORDER BY prop.name ASC';

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
   * @param data - Initial property creation payload.
   * @returns The newly created Property entity.
   */
  public static createProperty(data: {
    name: string;
    property_type: Property['property_type'];
    address_line1: string;
    address_line2?: string;
    city: string;
    state: string;
    postal_code: string;
    portfolio_id?: string;
    year_built?: number;
  }): Property {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const id = generateUUIDv7();
    const now = Date.now();

    db.prepare(`
      INSERT INTO properties (
        id, operator_id, portfolio_id, name, property_type,
        address_line1, address_line2, city, state, postal_code,
        year_built, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  public static updateProperty(id: string, data: Partial<Omit<Property, 'id' | 'operator_id' | 'tenant_id' | 'created_at' | 'updated_at' | 'deleted_at'>>): Property | null {
    const existing = PropertiesRepository.getPropertyById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const updated = { ...existing, ...data, updated_at: now };

    db.prepare(`
      UPDATE properties SET
        portfolio_id = ?, name = ?, property_type = ?,
        address_line1 = ?, address_line2 = ?, city = ?, state = ?, postal_code = ?,
        year_built = ?, updated_at = ?
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
   * @returns Array of active Building records ordered by name.
   */
  public static listBuildings(propertyId?: string): Building[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    let sql = 'SELECT * FROM buildings WHERE operator_id = ? AND deleted_at IS NULL';
    const params: any[] = [operatorId];

    if (propertyId) {
      sql += ' AND property_id = ?';
      params.push(propertyId);
    }
    sql += ' ORDER BY name ASC';

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
  }): Building {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const id = generateUUIDv7();
    const now = Date.now();

    db.prepare(`
      INSERT INTO buildings (
        id, operator_id, property_id, name, building_number,
        floors, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      operatorId,
      data.property_id,
      data.name,
      data.building_number || null,
      data.floors || null,
      data.notes || null,
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
  public static updateBuilding(id: string, data: Partial<Omit<Building, 'id' | 'operator_id' | 'created_at' | 'updated_at' | 'deleted_at'>>): Building | null {
    const existing = PropertiesRepository.getBuildingById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const updated = { ...existing, ...data, updated_at: now };

    db.prepare(`
      UPDATE buildings SET
        name = ?, building_number = ?, floors = ?, notes = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(
      updated.name,
      updated.building_number || null,
      updated.floors || null,
      updated.notes || null,
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
   * @param filter - Optional filters for property_id, building_id, or status.
   * @returns Array of active Unit records ordered by unit_number.
   */
  public static listUnits(filter?: { property_id?: string; building_id?: string; status?: string }): Unit[] {
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
    sql += ' ORDER BY unit_number ASC';

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
   * @param data - Initial unit creation payload.
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
    square_feet?: number;
    market_rent_cents: number;
    target_deposit_cents?: number;
  }): Unit {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const id = generateUUIDv7();
    const now = Date.now();

    if (data.building_id) {
      const building = PropertiesRepository.getBuildingById(data.building_id);
      if (!building || building.property_id !== data.property_id) {
        throw new Error('Invalid building_id: building does not exist or does not belong to the specified property');
      }
    }

    db.prepare(`
      INSERT INTO units (
        id, operator_id, property_id, building_id, unit_number, status,
        bedrooms, bathrooms, square_feet, market_rent_cents, target_deposit_cents,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  public static updateUnit(id: string, data: Partial<Omit<Unit, 'id' | 'operator_id' | 'tenant_id' | 'created_at' | 'updated_at' | 'deleted_at'>>): Unit | null {
    const existing = PropertiesRepository.getUnitById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const updated = { ...existing, ...data, updated_at: now };

    const targetPropertyId = updated.property_id;
    if (updated.building_id) {
      const building = PropertiesRepository.getBuildingById(updated.building_id);
      if (!building || building.property_id !== targetPropertyId) {
        throw new Error('Invalid building_id: building does not exist or does not belong to the specified property');
      }
    }

    db.prepare(`
      UPDATE units SET
        property_id = ?, building_id = ?, unit_number = ?, status = ?,
        bedrooms = ?, bathrooms = ?, square_feet = ?,
        market_rent_cents = ?, target_deposit_cents = ?, updated_at = ?
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
