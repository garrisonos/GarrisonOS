import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import process from 'node:process';
import { getDatabase, withTransaction } from './client.js';
import { runMigrations } from './migrator.js';
import { generateUUIDv7, hashPassword } from '../core/crypto.js';
import { DEFAULT_PROPERTY_MANAGEMENT_COA } from '../modules/accounting/backend/chart_of_accounts.js';

/**
 * Seeds a comprehensive, realistic demo dataset for GarrisonOS including
 * an operator account, branding configuration, 3 portfolios, properties, 50 units
 * representing all 4 unit statuses (42 occupied, 4 vacant, 2 turnover, 2 hold),
 * 42 active leases, 2 terminated leases with notice and move-out history,
 * recurring lease charges, preventative maintenance schedules, universal conversations,
 * client accounting capital contributions and draws, 7 vendors with W-9 and tax classifications,
 * 1099-NEC qualifying payments, and diverse work orders.
 *
 * @param dbInstance - Optional SQLite DatabaseSync instance to seed into.
 * @returns Promise resolving when seeding is complete.
 */
export async function seedDatabase(dbInstance?: DatabaseSync): Promise<void> {
  const db = dbInstance || getDatabase();

  // Run migrations first
  runMigrations(db);

  const now = Date.now();
  const OPERATOR_ID = 'operator-demo';
  const passwordHash = await hashPassword('Password123!');

  withTransaction((tx) => {
    // 1. Clean existing demo data in safe reverse dependency order
    try { tx.prepare('DELETE FROM operator_branding WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM conversation_messages WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM conversation_participants WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM conversations WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM preventative_maintenance_schedules WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM notification_logs WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM operator_notification_settings WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM client_distributions WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM client_capital_contributions WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM management_fee_agreements WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM security_deposit_refunds WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM lease_credits_and_concessions WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM recurring_lease_charges WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM late_fee_policies WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM quickbooks_export_logs WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM journal_lines WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM journal_entries WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM chart_of_accounts WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM transactions WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM work_orders WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM lease_contacts WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM leases WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM units WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM buildings WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM properties WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM portfolios WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM contacts WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM audit_logs WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM user_portfolio_access WHERE user_id IN (SELECT id FROM users WHERE operator_id = ?)').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM user_module_access WHERE user_id IN (SELECT id FROM users WHERE operator_id = ?)').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM users WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM operators WHERE id = ?').run(OPERATOR_ID); } catch {}

    // 2. Create Operator Account & Default Institutional Branding
    tx.prepare(`
      INSERT INTO operators (id, name, subdomain, currency, created_at, updated_at)
      VALUES (?, ?, ?, 'USD', ?, ?)
    `).run(OPERATOR_ID, 'Garrison Heritage Properties', 'demo', now, now);

    try {
      tx.prepare(`
        INSERT INTO operator_branding (
          operator_id, brand_name, logo_url, favicon_url, tagline,
          theme_preset, primary_color, primary_hover, accent_color,
          default_dark_mode, updated_at
        ) VALUES (?, ?, NULL, NULL, 'Fiduciary Property Management & Accounting', 'classic_blue', '#1d4ed8', '#1e40af', '#3b82f6', 0, ?)
      `).run(OPERATOR_ID, 'Garrison Heritage Properties', now);
    } catch {}

    // 2b. Seed Standard Chart of Accounts
    const coaInsertStmt = tx.prepare(`
      INSERT INTO chart_of_accounts (
        id, operator_id, account_number, account_name, account_type,
        qb_account_type, category_mapping, description, is_system_default,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
    `);
    const glAccountMap = new Map<string, string>();
    for (const def of DEFAULT_PROPERTY_MANAGEMENT_COA) {
      const coaId = generateUUIDv7();
      coaInsertStmt.run(
        coaId,
        OPERATOR_ID,
        def.account_number,
        def.account_name,
        def.account_type,
        def.qb_account_type ?? null,
        def.category_mapping ?? null,
        def.description ?? null,
        now,
        now
      );
      if (def.category_mapping) {
        glAccountMap.set(def.category_mapping, coaId);
      }
      glAccountMap.set(def.account_number, coaId);
    }

    // 3. Create Users
    const userId = generateUUIDv7();
    tx.prepare(`
      INSERT INTO users (id, operator_id, email, password_hash, first_name, last_name, role, token_version, is_system_user, created_at, updated_at)
      VALUES (?, ?, 'operator@garrisonos.local', ?, 'Alexander', 'Garrison', 'owner', 1, 0, ?, ?)
    `).run(userId, OPERATOR_ID, passwordHash, now, now);

    // 4. Create 3 Portfolios
    const portfolio1Id = generateUUIDv7();
    const portfolio2Id = generateUUIDv7();
    const portfolio3Id = generateUUIDv7();

    tx.prepare(`
      INSERT INTO portfolios (id, operator_id, name, tax_id, notes, created_at, updated_at)
      VALUES (?, ?, 'Blue Ridge Residential LLC', 'XX-XXX4819', 'Single family residential and luxury townhomes', ?, ?),
             (?, ?, 'Piedmont Multifamily Holdings', 'XX-XXX9201', 'Duplexes and garden apartments portfolio', ?, ?),
             (?, ?, 'Downtown Lofts & Commercial', 'XX-XXX6632', 'High-density urban residential lofts and commercial assets', ?, ?)
    `).run(
      portfolio1Id, OPERATOR_ID, now, now,
      portfolio2Id, OPERATOR_ID, now, now,
      portfolio3Id, OPERATOR_ID, now, now
    );

    // 4b. Create Subuser (Leasing Agent scoped to Piedmont)
    const subuserId = generateUUIDv7();
    tx.prepare(`
      INSERT INTO users (id, operator_id, email, password_hash, first_name, last_name, role, token_version, is_system_user, created_at, updated_at)
      VALUES (?, ?, 'leasing@garrisonos.local', ?, 'Sarah', 'Jenkins', 'leasing_agent', 1, 0, ?, ?)
    `).run(subuserId, OPERATOR_ID, passwordHash, now, now);

    tx.prepare(`
      INSERT INTO user_portfolio_access (id, operator_id, user_id, portfolio_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(generateUUIDv7(), OPERATOR_ID, subuserId, portfolio2Id, now);

    for (const mod of ['properties', 'leases', 'maintenance']) {
      tx.prepare(`
        INSERT INTO user_module_access (id, operator_id, user_id, module_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(generateUUIDv7(), OPERATOR_ID, subuserId, mod, now);
    }

    // 5. Create 7 Vendors with Trades, W-9 and Tax Classifications
    const vendorPlumbingId = generateUUIDv7();
    const vendorHvacId = generateUUIDv7();
    const vendorElectricId = generateUUIDv7();
    const vendorGeneralId = generateUUIDv7();
    const vendorApplianceId = generateUUIDv7();
    const vendorMakeReadyId = generateUUIDv7();
    const vendorPaintingId = generateUUIDv7();

    tx.prepare(`
      INSERT INTO contacts (
        id, operator_id, contact_type, first_name, last_name, company_name, email, phone,
        tax_id_last4, vendor_specialty, w9_received, tax_classification, created_at, updated_at
      ) VALUES
        (?, ?, 'vendor', 'Marcus', 'Vance', 'Apex Plumbing Services', 'marcus@apexplumb.local', '(555) 301-4401', '4401', 'Plumbing', 1, 'llc', ?, ?),
        (?, ?, 'vendor', 'Elena', 'Reyes', 'CoolAir Climate Systems', 'elena@coolair.local', '(555) 301-4402', '4402', 'HVAC', 1, 'corporation', ?, ?),
        (?, ?, 'vendor', 'David', 'Kowalski', 'VoltMaster Electric', 'david@voltmaster.local', '(555) 301-4403', '4403', 'Electrical', 1, 'llc', ?, ?),
        (?, ?, 'vendor', 'Sam', 'Hawkins', 'Hawkins General Repair', 'sam@hawkinsrepair.local', '(555) 301-4404', '4404', 'General Contractor', 1, 'individual', ?, ?),
        (?, ?, 'vendor', 'Frank', 'Castillo', 'Elite Appliance Pro', 'frank@eliteappliance.local', '(555) 301-4405', '4405', 'Appliance', 1, 'individual', ?, ?),
        (?, ?, 'vendor', 'Maria', 'Santos', 'CleanTurn Turnover Services', 'maria@cleanturn.local', '(555) 301-4406', '4406', 'Make-Ready', 1, 'llc', ?, ?),
        (?, ?, 'vendor', 'Tyler', 'Brooks', 'Blue Ridge Pro Painters', 'tyler@blueridgepainters.local', '(555) 301-4407', NULL, 'Painting', 0, 'partnership', ?, ?)
    `).run(
      vendorPlumbingId, OPERATOR_ID, now, now,
      vendorHvacId, OPERATOR_ID, now, now,
      vendorElectricId, OPERATOR_ID, now, now,
      vendorGeneralId, OPERATOR_ID, now, now,
      vendorApplianceId, OPERATOR_ID, now, now,
      vendorMakeReadyId, OPERATOR_ID, now, now,
      vendorPaintingId, OPERATOR_ID, now, now
    );

    // 6. Create Properties & 50 Units Across All 4 Statuses:
    // Target breakdown:
    // Occupied: 42
    // Vacant: 4
    // Turnover: 2
    // Maintenance Hold: 2
    // Total = 50 units

    interface CreatedUnit {
      unitId: string;
      propertyId: string;
      rentCents: number;
      unitNumber: string;
      propertyName: string;
    }

    const occupiedUnits: CreatedUnit[] = [];
    let sycamorePropId = '';
    let sycamoreHoldUnitId = '';
    let fourPlexPropId = '';
    let fourPlexTurnoverUnitId = '';
    let loftsPropId = '';
    let loftsTurnoverUnitId = '';

    // =========================================================================
    // PORTFOLIO 1: Blue Ridge Residential LLC (18 units: 15 occupied, 2 vacant, 1 hold)
    // =========================================================================

    // 12 Single Family Residences (10 occupied, 1 hold, 1 vacant)
    const sfhSpecs = [
      { name: '104 Oakwood Drive', addr: '104 Oakwood Dr', city: 'Asheville', state: 'NC', zip: '28801', rent: 185000, bd: 3, ba: 2, sqft: 1450, status: 'occupied' as const },
      { name: '212 Meadow Lane', addr: '212 Meadow Ln', city: 'Asheville', state: 'NC', zip: '28803', rent: 195000, bd: 3, ba: 2, sqft: 1600, status: 'occupied' as const },
      { name: '318 Pinecrest Road', addr: '318 Pinecrest Rd', city: 'Black Mountain', state: 'NC', zip: '28711', rent: 175000, bd: 3, ba: 1.5, sqft: 1320, status: 'occupied' as const },
      { name: '425 Highland Avenue', addr: '425 Highland Ave', city: 'Asheville', state: 'NC', zip: '28804', rent: 220000, bd: 4, ba: 2.5, sqft: 2100, status: 'occupied' as const },
      { name: '509 Willow Creek Way', addr: '509 Willow Creek Way', city: 'Weaverville', state: 'NC', zip: '28787', rent: 165000, bd: 2, ba: 2, sqft: 1200, status: 'occupied' as const },
      { name: '614 Cedar Ridge Court', addr: '614 Cedar Ridge Ct', city: 'Asheville', state: 'NC', zip: '28805', rent: 210000, bd: 4, ba: 2, sqft: 1900, status: 'occupied' as const },
      { name: '722 Magnolia Circle', addr: '722 Magnolia Cir', city: 'Fletcher', state: 'NC', zip: '28732', rent: 180000, bd: 3, ba: 2, sqft: 1550, status: 'occupied' as const },
      { name: '831 Chestnut Terrace', addr: '831 Chestnut Ter', city: 'Asheville', state: 'NC', zip: '28801', rent: 240000, bd: 4, ba: 3, sqft: 2350, status: 'occupied' as const },
      { name: '940 Sycamore Street', addr: '940 Sycamore St', city: 'Black Mountain', state: 'NC', zip: '28711', rent: 155000, bd: 2, ba: 1, sqft: 1100, status: 'maintenance_hold' as const },
      { name: '1055 Laurel Ridge Trail', addr: '1055 Laurel Ridge Trl', city: 'Weaverville', state: 'NC', zip: '28787', rent: 260000, bd: 4, ba: 3.5, sqft: 2800, status: 'occupied' as const },
      { name: '1120 Sunset Summit', addr: '1120 Sunset Summit', city: 'Asheville', state: 'NC', zip: '28804', rent: 285000, bd: 4, ba: 3, sqft: 2950, status: 'occupied' as const },
      { name: '1210 Whispering Pines', addr: '1210 Whispering Pines Dr', city: 'Fletcher', state: 'NC', zip: '28732', rent: 170000, bd: 3, ba: 2, sqft: 1500, status: 'vacant' as const }
    ];

    for (const sfh of sfhSpecs) {
      const propId = generateUUIDv7();
      tx.prepare(`
        INSERT INTO properties (id, operator_id, portfolio_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'single_family', ?, ?, ?, ?, ?, ?)
      `).run(propId, OPERATOR_ID, portfolio1Id, sfh.name, sfh.addr, sfh.city, sfh.state, sfh.zip, now, now);

      const unitId = generateUUIDv7();
      tx.prepare(`
        INSERT INTO units (id, operator_id, property_id, unit_number, status, bedrooms, bathrooms, square_feet, market_rent_cents, target_deposit_cents, created_at, updated_at)
        VALUES (?, ?, ?, 'Main', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(unitId, OPERATOR_ID, propId, sfh.status, sfh.bd, sfh.ba, sfh.sqft, sfh.rent, sfh.rent, now, now);

      if (sfh.status === 'occupied') {
        occupiedUnits.push({ unitId, propertyId: propId, rentCents: sfh.rent, unitNumber: 'Main', propertyName: sfh.name });
      } else if (sfh.status === 'maintenance_hold') {
        sycamorePropId = propId;
        sycamoreHoldUnitId = unitId;
      }
    }

    // 1 Townhome Community (6 units: 5 occupied, 1 vacant)
    const thPropId = generateUUIDv7();
    tx.prepare(`
      INSERT INTO properties (id, operator_id, portfolio_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
      VALUES (?, ?, ?, 'Highland Pines Townhomes', 'townhouse', '800 Highland Pine Lane', 'Asheville', 'NC', '28805', ?, ?)
    `).run(thPropId, OPERATOR_ID, portfolio1Id, now, now);

    for (let u = 1; u <= 6; u++) {
      const unitId = generateUUIDv7();
      const status = u === 6 ? 'vacant' : 'occupied';
      const rent = 190000;
      tx.prepare(`
        INSERT INTO units (id, operator_id, property_id, unit_number, status, bedrooms, bathrooms, square_feet, market_rent_cents, target_deposit_cents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 3, 2.5, 1750, ?, ?, ?, ?)
      `).run(unitId, OPERATOR_ID, thPropId, `TH-${u}`, status, rent, rent, now, now);

      if (status === 'occupied') {
        occupiedUnits.push({ unitId, propertyId: thPropId, rentCents: rent, unitNumber: `TH-${u}`, propertyName: 'Highland Pines Townhomes' });
      }
    }

    // =========================================================================
    // PORTFOLIO 2: Piedmont Multifamily Holdings (16 units: 13 occupied, 1 vacant, 1 turnover, 1 hold)
    // =========================================================================

    // 3 Duplexes (6 units: all 6 occupied)
    const duplexSpecs = [
      { name: 'Riverside Duplex', addr: '142 Riverside Dr', city: 'Woodfin', state: 'NC', zip: '28804', uA: 140000, uB: 145000 },
      { name: 'Lookout Mountain Duplex', addr: '88 Lookout Rd', city: 'Asheville', state: 'NC', zip: '28804', uA: 150000, uB: 150000 },
      { name: 'Haw Creek Duplex', addr: '304 Haw Creek Rd', city: 'Asheville', state: 'NC', zip: '28805', uA: 135000, uB: 135000 }
    ];

    for (const dup of duplexSpecs) {
      const propId = generateUUIDv7();
      tx.prepare(`
        INSERT INTO properties (id, operator_id, portfolio_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'multi_family', ?, ?, ?, ?, ?, ?)
      `).run(propId, OPERATOR_ID, portfolio2Id, dup.name, dup.addr, dup.city, dup.state, dup.zip, now, now);

      for (const [unitNum, rent] of [['A', dup.uA], ['B', dup.uB]] as const) {
        const unitId = generateUUIDv7();
        tx.prepare(`
          INSERT INTO units (id, operator_id, property_id, unit_number, status, bedrooms, bathrooms, square_feet, market_rent_cents, target_deposit_cents, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'occupied', 2, 1.5, 950, ?, ?, ?, ?)
        `).run(unitId, OPERATOR_ID, propId, unitNum, rent, rent, now, now);
        occupiedUnits.push({ unitId, propertyId: propId, rentCents: rent, unitNumber: unitNum, propertyName: dup.name });
      }
    }

    // 1 4-Plex (4 units: 101/102 occupied, 201 turnover, 202 vacant)
    fourPlexPropId = generateUUIDv7();
    tx.prepare(`
      INSERT INTO properties (id, operator_id, portfolio_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
      VALUES (?, ?, ?, 'Broadview 4-Plex', 'multi_family', '512 Broadview Terrace', 'Asheville', 'NC', '28806', ?, ?)
    `).run(fourPlexPropId, OPERATOR_ID, portfolio2Id, now, now);

    const buildingAId = generateUUIDv7();
    tx.prepare(`
      INSERT INTO buildings (id, operator_id, property_id, name, building_number, floors, notes, created_at, updated_at)
      VALUES (?, ?, ?, 'Building A', 'Bldg-A', 2, 'Two-story residential quadplex building', ?, ?)
    `).run(buildingAId, OPERATOR_ID, fourPlexPropId, now, now);

    const fourPlexUnits = [
      { num: '101', rent: 125000, status: 'occupied' as const },
      { num: '102', rent: 125000, status: 'occupied' as const },
      { num: '201', rent: 130000, status: 'turnover' as const },
      { num: '202', rent: 130000, status: 'vacant' as const }
    ];

    for (const fpu of fourPlexUnits) {
      const unitId = generateUUIDv7();
      tx.prepare(`
        INSERT INTO units (id, operator_id, property_id, building_id, unit_number, status, bedrooms, bathrooms, square_feet, market_rent_cents, target_deposit_cents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 2, 1, 800, ?, ?, ?, ?)
      `).run(unitId, OPERATOR_ID, fourPlexPropId, buildingAId, fpu.num, fpu.status, fpu.rent, fpu.rent, now, now);

      if (fpu.status === 'occupied') {
        occupiedUnits.push({ unitId, propertyId: fourPlexPropId, rentCents: fpu.rent, unitNumber: fpu.num, propertyName: 'Broadview 4-Plex' });
      } else if (fpu.status === 'turnover') {
        fourPlexTurnoverUnitId = unitId;
      }
    }

    // 1 Garden Apartment Building "Riverbend Flats" (6 units: 5 occupied, 1 hold)
    const riverbendPropId = generateUUIDv7();
    tx.prepare(`
      INSERT INTO properties (id, operator_id, portfolio_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
      VALUES (?, ?, ?, 'Riverbend Flats', 'multi_family', '220 Riverbend Parkway', 'Woodfin', 'NC', '28804', ?, ?)
    `).run(riverbendPropId, OPERATOR_ID, portfolio2Id, now, now);

    for (let u = 101; u <= 106; u++) {
      const unitId = generateUUIDv7();
      const status = u === 106 ? 'maintenance_hold' : 'occupied';
      const rent = 135000;
      tx.prepare(`
        INSERT INTO units (id, operator_id, property_id, unit_number, status, bedrooms, bathrooms, square_feet, market_rent_cents, target_deposit_cents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 2, 2, 920, ?, ?, ?, ?)
      `).run(unitId, OPERATOR_ID, riverbendPropId, String(u), status, rent, rent, now, now);

      if (status === 'occupied') {
        occupiedUnits.push({ unitId, propertyId: riverbendPropId, rentCents: rent, unitNumber: String(u), propertyName: 'Riverbend Flats' });
      }
    }

    // =========================================================================
    // PORTFOLIO 3: Downtown Lofts & Commercial (16 units: 14 occupied, 1 turnover, 1 vacant)
    // =========================================================================
    loftsPropId = generateUUIDv7();
    tx.prepare(`
      INSERT INTO properties (id, operator_id, portfolio_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
      VALUES (?, ?, ?, 'Grand Central Lofts', 'commercial', '45 Biltmore Avenue', 'Asheville', 'NC', '28801', ?, ?)
    `).run(loftsPropId, OPERATOR_ID, portfolio3Id, now, now);

    const loftsBuildingId = generateUUIDv7();
    tx.prepare(`
      INSERT INTO buildings (id, operator_id, property_id, name, building_number, floors, notes, created_at, updated_at)
      VALUES (?, ?, ?, 'Main Tower', 'Tower-1', 4, 'Historic brick timber mid-rise with urban lofts', ?, ?)
    `).run(loftsBuildingId, OPERATOR_ID, loftsPropId, now, now);

    const loftsUnitsSpecs = [
      { num: '101', rent: 175000, status: 'occupied' as const },
      { num: '102', rent: 175000, status: 'occupied' as const },
      { num: '103', rent: 180000, status: 'occupied' as const },
      { num: '104', rent: 180000, status: 'occupied' as const },
      { num: '201', rent: 195000, status: 'occupied' as const },
      { num: '202', rent: 195000, status: 'occupied' as const },
      { num: '203', rent: 200000, status: 'occupied' as const },
      { num: '204', rent: 200000, status: 'occupied' as const },
      { num: '301', rent: 215000, status: 'occupied' as const },
      { num: '302', rent: 215000, status: 'occupied' as const },
      { num: '303', rent: 220000, status: 'occupied' as const },
      { num: '304', rent: 220000, status: 'turnover' as const },
      { num: '401', rent: 245000, status: 'occupied' as const },
      { num: '402', rent: 245000, status: 'occupied' as const },
      { num: '403', rent: 250000, status: 'occupied' as const },
      { num: '404', rent: 250000, status: 'vacant' as const }
    ];

    for (const lu of loftsUnitsSpecs) {
      const unitId = generateUUIDv7();
      tx.prepare(`
        INSERT INTO units (id, operator_id, property_id, building_id, unit_number, status, bedrooms, bathrooms, square_feet, market_rent_cents, target_deposit_cents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, 1, 850, ?, ?, ?, ?)
      `).run(unitId, OPERATOR_ID, loftsPropId, loftsBuildingId, lu.num, lu.status, lu.rent, lu.rent, now, now);

      if (lu.status === 'occupied') {
        occupiedUnits.push({ unitId, propertyId: loftsPropId, rentCents: lu.rent, unitNumber: lu.num, propertyName: 'Grand Central Lofts' });
      } else if (lu.status === 'turnover') {
        loftsTurnoverUnitId = unitId;
      }
    }

    // 7. Create Tenants & Active Leases for All 42 Occupied Units
    const tenantFirstNames = [
      'Lucas', 'Sophia', 'James', 'Emily', 'Benjamin', 'Olivia', 'William', 'Ava',
      'Henry', 'Mia', 'Alexander', 'Charlotte', 'Daniel', 'Amelia', 'Matthew', 'Harper',
      'Jackson', 'Evelyn', 'Sebastian', 'Abigail', 'Logan', 'Ella', 'David', 'Chloe',
      'Joseph', 'Victoria', 'Samuel', 'Aria', 'Carter', 'Grace', 'Owen', 'Scarlett',
      'Wyatt', 'Zoey', 'John', 'Penelope', 'Jack', 'Riley', 'Luke', 'Layla',
      'Julian', 'Nora'
    ];

    const tenantLastNames = [
      'Bennett', 'Chen', 'Wilson', 'Rodriguez', 'Taylor', 'Martinez', 'Anderson', 'Thomas',
      'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Garcia', 'Robinson', 'Clark',
      'Lewis', 'Walker', 'Hall', 'Allen', 'Young', 'Hernandez', 'King', 'Wright',
      'Lopez', 'Hill', 'Scott', 'Green', 'Adams', 'Baker', 'Gonzalez', 'Nelson',
      'Carter', 'Mitchell', 'Perez', 'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker',
      'Evans', 'Edwards'
    ];

    const yearStartMs = Date.UTC(2026, 0, 1);
    const yearEndMs = Date.UTC(2026, 11, 31);
    const createdLeaseIds: string[] = [];

    for (let i = 0; i < occupiedUnits.length; i++) {
      const unit = occupiedUnits[i]!;
      const fName = tenantFirstNames[i] || `Tenant${i + 1}`;
      const lName = tenantLastNames[i] || `Resident`;
      const contactId = generateUUIDv7();

      tx.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, email, phone, created_at, updated_at)
        VALUES (?, ?, 'tenant', ?, ?, ?, ?, ?, ?)
      `).run(
        contactId,
        OPERATOR_ID,
        fName,
        lName,
        `${fName.toLowerCase()}.${lName.toLowerCase()}${i}@example.com`,
        `(555) 441-${(1000 + i).toString()}`,
        now,
        now
      );

      const leaseId = generateUUIDv7();
      createdLeaseIds.push(leaseId);
      let leaseStatus = 'active';
      let leaseEnd = yearEndMs;

      if (i === 1) {
        leaseStatus = 'expiring';
        leaseEnd = now + (20 * 24 * 60 * 60 * 1000);
      } else if (i === 2) {
        leaseStatus = 'month_to_month';
      }

      tx.prepare(`
        INSERT INTO leases (
          id, operator_id, unit_id, status, start_date, end_date,
          rent_amount_cents, security_deposit_cents, deposit_held_cents,
          rent_due_day, late_fee_grace_days, late_fee_amount_cents,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 5, 5000, ?, ?)
      `).run(
        leaseId,
        OPERATOR_ID,
        unit.unitId,
        leaseStatus,
        yearStartMs,
        leaseEnd,
        unit.rentCents,
        unit.rentCents,
        unit.rentCents,
        now,
        now
      );

      tx.prepare(`
        INSERT INTO lease_contacts (id, operator_id, lease_id, contact_id, role, is_financially_responsible, created_at)
        VALUES (?, ?, ?, ?, 'primary_tenant', 1, ?)
      `).run(generateUUIDv7(), OPERATOR_ID, leaseId, contactId, now);

      // Security deposit trust inflow
      tx.prepare(`
        INSERT INTO transactions (
          id, operator_id, transaction_type, category, amount_cents,
          transaction_date, description, property_id, unit_id, lease_id, payer_contact_id,
          created_at, updated_at
        ) VALUES (?, ?, 'deposit_inflow', 'security_deposit', ?, ?, 'Security Deposit Held in Trust', ?, ?, ?, ?, ?, ?)
      `).run(
        generateUUIDv7(),
        OPERATOR_ID,
        unit.rentCents,
        yearStartMs,
        unit.propertyId,
        unit.unitId,
        leaseId,
        contactId,
        now,
        now
      );

      // Monthly rent charges & payments for past months (Jan - Sep 2026)
      const currentMonth = 8; // Sep (0-indexed 8)
      const isDelinquentTenant = (i === 0);

      for (let m = 0; m <= currentMonth; m++) {
        const monthDueMs = Date.UTC(2026, m, 1);
        const yyyyMm = `2026-${(m + 1).toString().padStart(2, '0')}`;

        tx.prepare(`
          INSERT INTO transactions (
            id, operator_id, transaction_type, category, amount_cents,
            transaction_date, description, reference_number,
            property_id, unit_id, lease_id, created_at, updated_at
          ) VALUES (?, ?, 'charge', 'rent', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          generateUUIDv7(),
          OPERATOR_ID,
          unit.rentCents,
          monthDueMs,
          `Monthly Rent – ${yyyyMm}`,
          `rent_charge:${leaseId}:${yyyyMm}`,
          unit.propertyId,
          unit.unitId,
          leaseId,
          now,
          now
        );

        if (!isDelinquentTenant || m < currentMonth - 1) {
          const payDateMs = Date.UTC(2026, m, 2);
          tx.prepare(`
            INSERT INTO transactions (
              id, operator_id, transaction_type, category, amount_cents,
              transaction_date, description, payment_method, reference_number,
              property_id, unit_id, lease_id, payer_contact_id, created_at, updated_at
            ) VALUES (?, ?, 'payment', 'rent', ?, ?, ?, 'ach', ?, ?, ?, ?, ?, ?, ?)
          `).run(
            generateUUIDv7(),
            OPERATOR_ID,
            unit.rentCents,
            payDateMs,
            `Rent Payment – ${yyyyMm}`,
            `ACH-${leaseId.slice(0, 4)}-${yyyyMm}`,
            unit.propertyId,
            unit.unitId,
            leaseId,
            contactId,
            now,
            now
          );
        } else if (isDelinquentTenant) {
          tx.prepare(`
            INSERT INTO transactions (
              id, operator_id, transaction_type, category, amount_cents,
              transaction_date, description, property_id, unit_id, lease_id, created_at, updated_at
            ) VALUES (?, ?, 'charge', 'late_fee', 5000, ?, 'Late Fee – 5-Day Grace Period Expired', ?, ?, ?, ?, ?)
          `).run(
            generateUUIDv7(),
            OPERATOR_ID,
            Date.UTC(2026, m, 6),
            unit.propertyId,
            unit.unitId,
            leaseId,
            now,
            now
          );
        }
      }
    }

    // 8. Recurring Lease Charges (Itemized amenities, pet rent, parking)
    if (createdLeaseIds.length >= 5) {
      const parkingGl = glAccountMap.get('parking_fee') || glAccountMap.get('4060') || generateUUIDv7();
      const petGl = glAccountMap.get('pet_fee') || glAccountMap.get('4030') || parkingGl;
      const utilityGl = glAccountMap.get('utility_rebill') || glAccountMap.get('4040') || parkingGl;

      tx.prepare(`
        INSERT INTO recurring_lease_charges (
          id, operator_id, lease_id, charge_category, amount_cents,
          gl_account_id, billing_frequency, billing_day, description, created_at
        ) VALUES
          (?, ?, ?, 'parking_fee', 7500, ?, 'monthly', 1, 'Assigned Garage Space #12', ?),
          (?, ?, ?, 'pet_rent', 3500, ?, 'monthly', 1, 'Pet Rent (1 Dog)', ?),
          (?, ?, ?, 'storage_fee', 5000, ?, 'monthly', 1, 'Basement Storage Locker #B4', ?),
          (?, ?, ?, 'utility_surcharge', 4500, ?, 'monthly', 1, 'Water/Sewer RUBS Surcharge', ?)
      `).run(
        generateUUIDv7(), OPERATOR_ID, createdLeaseIds[0]!, parkingGl, now,
        generateUUIDv7(), OPERATOR_ID, createdLeaseIds[1]!, petGl, now,
        generateUUIDv7(), OPERATOR_ID, createdLeaseIds[2]!, parkingGl, now,
        generateUUIDv7(), OPERATOR_ID, createdLeaseIds[3]!, utilityGl, now
      );
    }

    // 9. Historical Terminated Leases for the 2 Turnover Units
    // Unit 201 at Broadview 4-Plex
    const pastTenant1Id = generateUUIDv7();
    tx.prepare(`
      INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, email, phone, created_at, updated_at)
      VALUES (?, ?, 'tenant', 'Noah', 'Campbell', 'noah.campbell@example.com', '(555) 441-0199', ?, ?)
    `).run(pastTenant1Id, OPERATOR_ID, now - (400 * 86400000), now - (45 * 86400000));

    tx.prepare(`
      INSERT INTO leases (
        id, operator_id, unit_id, status, start_date, end_date,
        notice_date, move_out_date,
        rent_amount_cents, security_deposit_cents, deposit_held_cents,
        rent_due_day, late_fee_grace_days, late_fee_amount_cents,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'terminated', ?, ?, ?, ?, 130000, 130000, 0, 1, 5, 5000, ?, ?)
    `).run(
      generateUUIDv7(),
      OPERATOR_ID,
      fourPlexTurnoverUnitId,
      Date.UTC(2025, 0, 1),
      Date.UTC(2025, 11, 31),
      Date.UTC(2026, 6, 15),
      Date.UTC(2026, 7, 31),
      now - (400 * 86400000),
      Date.UTC(2026, 7, 31)
    );

    // Unit 304 at Grand Central Lofts
    const pastTenant2Id = generateUUIDv7();
    tx.prepare(`
      INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, email, phone, created_at, updated_at)
      VALUES (?, ?, 'tenant', 'Zachary', 'Myers', 'z.myers@example.com', '(555) 441-0288', ?, ?)
    `).run(pastTenant2Id, OPERATOR_ID, now - (300 * 86400000), now - (15 * 86400000));

    tx.prepare(`
      INSERT INTO leases (
        id, operator_id, unit_id, status, start_date, end_date,
        notice_date, move_out_date,
        rent_amount_cents, security_deposit_cents, deposit_held_cents,
        rent_due_day, late_fee_grace_days, late_fee_amount_cents,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'terminated', ?, ?, ?, ?, 220000, 220000, 0, 1, 5, 5000, ?, ?)
    `).run(
      generateUUIDv7(),
      OPERATOR_ID,
      loftsTurnoverUnitId,
      Date.UTC(2025, 5, 1),
      Date.UTC(2026, 4, 31),
      Date.UTC(2026, 7, 1),
      Date.UTC(2026, 8, 15),
      now - (300 * 86400000),
      Date.UTC(2026, 8, 15)
    );

    // 10. Record Operating Expenses & Qualifying 1099-NEC Payments
    const propertyExpenses = [
      { prop: occupiedUnits[0]!.propertyId, payee: null, cat: 'insurance', amount: 145000, desc: 'Annual Landlord Hazard & Liability Insurance' },
      { prop: occupiedUnits[0]!.propertyId, payee: null, cat: 'property_taxes', amount: 285000, desc: 'County Real Estate Ad Valorem Property Tax' },
      { prop: occupiedUnits[1]!.propertyId, payee: vendorPlumbingId, cat: 'repairs', amount: 32000, desc: 'Emergency Plumbing Drain Clear & Snaking' },
      { prop: occupiedUnits[2]!.propertyId, payee: vendorPlumbingId, cat: 'repairs', amount: 200000, desc: 'Main Water Service Line & Sewer Lateral Replacement' },
      { prop: occupiedUnits[3]!.propertyId, payee: vendorGeneralId, cat: 'repairs', amount: 215000, desc: 'Structural Subfloor & Foundation Crawlspace Remediation' },
      { prop: fourPlexPropId, payee: vendorHvacId, cat: 'repairs', amount: 85000, desc: 'HVAC Seasonal Inspection and Dual-Zone Filter Replacement' },
      { prop: fourPlexPropId, payee: vendorHvacId, cat: 'repairs', amount: 60000, desc: 'Smart Thermostat Installation and Condenser Service' },
      { prop: fourPlexPropId, payee: vendorMakeReadyId, cat: 'cleaning_maintenance', amount: 45000, desc: 'Deep Clean & Make-Ready Turnover Service Unit 201' },
      { prop: fourPlexPropId, payee: null, cat: 'utilities', amount: 48000, desc: 'Common Area Hallway Electric & Exterior Lighting' },
      { prop: loftsPropId, payee: null, cat: 'management_fees', amount: 75000, desc: 'Professional Commercial Property Advisory' }
    ];

    for (const exp of propertyExpenses) {
      tx.prepare(`
        INSERT INTO transactions (
          id, operator_id, transaction_type, category, amount_cents,
          transaction_date, description, property_id, payee_contact_id, payment_method, created_at, updated_at
        ) VALUES (?, ?, 'expense', ?, ?, ?, ?, ?, ?, 'direct_deposit', ?, ?)
      `).run(
        generateUUIDv7(),
        OPERATOR_ID,
        exp.cat,
        exp.amount,
        Date.UTC(2026, 4, 15),
        exp.desc,
        exp.prop,
        exp.payee,
        now,
        now
      );
    }

    // 11. Create 8 Diverse Work Orders
    tx.prepare(`
      INSERT INTO work_orders (
        id, operator_id, property_id, unit_id, title, description,
        status, priority, category, permission_to_enter, vendor_contact_id,
        scheduled_date, completed_date, estimated_cost_cents, actual_cost_cents, created_at, updated_at
      ) VALUES
        (?, ?, ?, ?, 'Master Bathroom Toilet Leak', 'Water leaking onto bathroom floor from tank flange seal. Urgent fix.', 'in_progress', 'emergency', 'plumbing', 1, ?, ?, NULL, 25000, 0, ?, ?),
        (?, ?, ?, ?, 'HVAC AC Unit Making Buzzing Noise', 'Air conditioning compressor outside vibrating loud when running.', 'assigned', 'high', 'hvac', 1, ?, ?, NULL, 35000, 0, ?, ?),
        (?, ?, ?, ?, 'Main Electrical Panel Breaker Tripping', 'Kitchen dedicated circuit breaker tripping under load.', 'in_progress', 'high', 'electrical', 1, ?, ?, NULL, 28000, 0, ?, ?),
        (?, ?, ?, ?, 'Turnover Make-Ready: Broadview 4-Plex Unit 201', 'Full make-ready turnover: deep clean, lock rekeying, touch-up painting.', 'assigned', 'medium', 'cosmetic', 1, ?, ?, NULL, 45000, 0, ?, ?),
        (?, ?, ?, ?, 'Kitchen Cabinet Hinge Loose', 'Upper cabinet door hinge over sink is loose and sagging.', 'open', 'low', 'other', 1, NULL, NULL, NULL, 9500, 0, ?, ?),
        (?, ?, ?, ?, 'Foundation & Subfloor Stabilization', 'Crawlspace beam reinforcement and floor leveling following inspection.', 'in_progress', 'high', 'structural', 1, ?, ?, NULL, 180000, 0, ?, ?),
        (?, ?, ?, ?, 'Garbage Disposal Replacement', 'Disposal motor seized. Replaced with new 3/4 HP continuous-feed unit.', 'completed', 'medium', 'appliance', 1, ?, ?, ?, 16500, 16500, ?, ?),
        (?, ?, ?, ?, 'Screen Door Latch Sticking', 'Front storm door handle sticking. Resident resolved latch independently.', 'cancelled', 'low', 'other', 1, NULL, NULL, NULL, 6000, 0, ?, ?)
    `).run(
      generateUUIDv7(), OPERATOR_ID, occupiedUnits[0]!.propertyId, occupiedUnits[0]!.unitId, vendorPlumbingId, now + 3600000, now - 7200000, now,
      generateUUIDv7(), OPERATOR_ID, occupiedUnits[1]!.propertyId, occupiedUnits[1]!.unitId, vendorHvacId, now + 86400000, now - 86400000, now,
      generateUUIDv7(), OPERATOR_ID, occupiedUnits[3]!.propertyId, occupiedUnits[3]!.unitId, vendorElectricId, now + 172800000, now - 14400000, now,
      generateUUIDv7(), OPERATOR_ID, fourPlexPropId, fourPlexTurnoverUnitId, vendorMakeReadyId, now + 86400000, now - 3600000, now,
      generateUUIDv7(), OPERATOR_ID, occupiedUnits[5]!.propertyId, occupiedUnits[5]!.unitId, now - 18000000, now,
      generateUUIDv7(), OPERATOR_ID, sycamorePropId, sycamoreHoldUnitId, vendorGeneralId, now + 259200000, now - (3 * 86400000), now,
      generateUUIDv7(), OPERATOR_ID, occupiedUnits[2]!.propertyId, occupiedUnits[2]!.unitId, vendorApplianceId, now - (6 * 86400000), now - (5 * 86400000), now - (7 * 86400000), now - (5 * 86400000),
      generateUUIDv7(), OPERATOR_ID, occupiedUnits[4]!.propertyId, occupiedUnits[4]!.unitId, now - (4 * 86400000), now - (2 * 86400000)
    );

    // 12. Preventative Maintenance Schedules
    try {
      tx.prepare(`
        INSERT INTO preventative_maintenance_schedules (
          id, operator_id, property_id, title, description, category,
          priority, frequency, next_due_date, is_active, created_at, updated_at
        ) VALUES
          (?, ?, ?, 'Quarterly HVAC Filter & Coil Service', 'Replace 16x25x1 filter, clean condenser coils, and check refrigerant pressure', 'hvac', 'medium', 'quarterly', ?, 1, ?, ?),
          (?, ?, ?, 'Semi-Annual Roof & Gutter Inspection', 'Inspect shingles and flashing, clear downspout debris, check attic crawlspace for moisture', 'roofing', 'high', 'semi_annually', ?, 1, ?, ?),
          (?, ?, ?, 'Annual Fire Extinguisher & Alarm Recertification', 'Test all smoke and CO detectors, inspect fire extinguisher pressure gauges, check emergency exit lighting', 'fire_safety', 'high', 'annually', ?, 1, ?, ?)
      `).run(
        generateUUIDv7(), OPERATOR_ID, fourPlexPropId, now + (14 * 86400000), now, now,
        generateUUIDv7(), OPERATOR_ID, loftsPropId, now + (30 * 86400000), now, now,
        generateUUIDv7(), OPERATOR_ID, occupiedUnits[0]!.propertyId, now + (60 * 86400000), now, now
      );
    } catch {}

    // 13. Universal Conversations & Notes
    try {
      const conv1Id = generateUUIDv7();
      tx.prepare(`
        INSERT INTO conversations (id, operator_id, entity_type, entity_id, subject, is_private, created_at, updated_at)
        VALUES (?, ?, 'property', ?, 'Annual Exterior Façade Maintenance Plan', 1, ?, ?)
      `).run(conv1Id, OPERATOR_ID, loftsPropId, now - 86400000, now);

      tx.prepare(`
        INSERT INTO conversation_messages (id, operator_id, conversation_id, body, created_at)
        VALUES (?, ?, ?, 'Staff inspection noted minor brick mortar settling near east staircase. Scheduled mason for estimate.', ?)
      `).run(generateUUIDv7(), OPERATOR_ID, conv1Id, now - 86400000);

      const conv2Id = generateUUIDv7();
      tx.prepare(`
        INSERT INTO conversations (id, operator_id, entity_type, entity_id, subject, is_private, created_at, updated_at)
        VALUES (?, ?, 'lease', ?, 'Parking Space Reassignment Request', 0, ?, ?)
      `).run(conv2Id, OPERATOR_ID, createdLeaseIds[0]!, now - 3600000, now);

      tx.prepare(`
        INSERT INTO conversation_messages (id, operator_id, conversation_id, body, created_at)
        VALUES (?, ?, ?, 'Resident requested moving from Stall 12 to Stall 14 closer to building entrance.', ?)
      `).run(generateUUIDv7(), OPERATOR_ID, conv2Id, now - 3600000);
    } catch {}

    // 14. Client Accounting Capital Contributions & Owner Distributions
    try {
      const clientOwnerContactId = generateUUIDv7();
      tx.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, email, phone, created_at, updated_at)
        VALUES (?, ?, 'owner', 'Alexander', 'Garrison', 'alexander@garrisonproperties.local', '(555) 201-9000', ?, ?)
      `).run(clientOwnerContactId, OPERATOR_ID, now, now);

      const ownerCapitalGl = glAccountMap.get('owner_capital') || glAccountMap.get('3010') || generateUUIDv7();
      const ownerDrawGl = glAccountMap.get('owner_draw') || glAccountMap.get('3020') || generateUUIDv7();
      const mgmtFeeGl = glAccountMap.get('management_fees') || glAccountMap.get('5070') || generateUUIDv7();

      tx.prepare(`
        INSERT INTO client_capital_contributions (
          id, operator_id, client_contact_id, portfolio_id, amount_cents,
          contribution_date, destination_account_id, reference_number, memo, created_at, updated_at
        ) VALUES
          (?, ?, ?, ?, 5000000, ?, ?, 'WIRE-559201', 'Initial Portfolio Capital Reserve Injection', ?, ?),
          (?, ?, ?, ?, 2500000, ?, ?, 'ACH-110294', 'Q3 Capital Expenditure & Roof Reserve', ?, ?)
      `).run(
        generateUUIDv7(), OPERATOR_ID, clientOwnerContactId, portfolio1Id, now - (90 * 86400000), ownerCapitalGl, now, now,
        generateUUIDv7(), OPERATOR_ID, clientOwnerContactId, portfolio2Id, now - (30 * 86400000), ownerCapitalGl, now, now
      );

      tx.prepare(`
        INSERT INTO client_distributions (
          id, operator_id, client_contact_id, portfolio_id, amount_cents,
          distribution_date, source_account_id, disbursement_method, reference_number, memo, created_at, updated_at
        ) VALUES
          (?, ?, ?, ?, 1500000, ?, ?, 'ach', 'ACH-DIST-01', 'Q2 Net Cash Flow Owner Draw', ?, ?),
          (?, ?, ?, ?, 1000000, ?, ?, 'ach', 'ACH-DIST-02', 'Q3 Owner Draw', ?, ?)
      `).run(
        generateUUIDv7(), OPERATOR_ID, clientOwnerContactId, portfolio1Id, now - (60 * 86400000), ownerDrawGl, now, now,
        generateUUIDv7(), OPERATOR_ID, clientOwnerContactId, portfolio2Id, now - (15 * 86400000), ownerDrawGl, now, now
      );

      tx.prepare(`
        INSERT INTO management_fee_agreements (
          id, operator_id, portfolio_id, calculation_method,
          percentage_bps, flat_fee_cents, fee_gl_account_id, pass_through_expenses, created_at
        ) VALUES (?, ?, ?, 'percentage_collected_revenue', 800, 0, ?, 1, ?)
      `).run(generateUUIDv7(), OPERATOR_ID, portfolio1Id, mgmtFeeGl, now);
    } catch {}
  }, db);
}

// CLI Execution
const isDirectExecution = process.argv[1] && (
  process.argv[1].endsWith('seed.ts') ||
  process.argv[1].endsWith('seed.js') ||
  (import.meta.url && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
);

if (isDirectExecution) {
  seedDatabase()
    .then(() => {
      process.stdout.write('Successfully seeded realistic 50-unit GarrisonOS portfolio dataset.\n');
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`Seeding failed: ${String(err)}\n`);
      process.exit(1);
    });
}
