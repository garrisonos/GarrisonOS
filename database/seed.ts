import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import process from 'node:process';
import { getDatabase, withTransaction } from './client.js';
import { runMigrations } from './migrator.js';
import { generateUUIDv7, hashPassword } from '../core/crypto.js';
import { RequestContext } from '../core/context.js';
import { DEFAULT_PROPERTY_MANAGEMENT_COA } from '../modules/accounting/backend/chart_of_accounts.js';
import { JournalService } from '../modules/accounting/backend/journal.js';

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

  RequestContext.run({ operatorId: OPERATOR_ID, correlationId: `seed-${now}` }, () => {
    withTransaction((tx) => {
    // 1. Clean existing demo data in safe reverse dependency order
    try { tx.prepare('DELETE FROM marketing_syndication WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM unit_amenities WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM property_amenities WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM amenity_definitions WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM custom_field_definitions WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM custom_field_sections WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM vendor_check_allocations WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM vendor_checks WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM vendor_credit_allocations WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM vendor_credits WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM bill_allocations WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM recurring_bills WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM bills WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM bank_deposit_lines WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM bank_deposits WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
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
    try { tx.prepare('UPDATE journal_entries SET reversed_by_entry_id = NULL WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM transactions WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM journal_lines WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM journal_entries WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM chart_of_accounts WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
    try { tx.prepare('DELETE FROM work_order_vendors WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
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
    try { tx.prepare('DELETE FROM backups WHERE operator_id = ?').run(OPERATOR_ID); } catch {}
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

    // 4. Create 3 Portfolios with Spend Thresholds
    const portfolio1Id = generateUUIDv7();
    const portfolio2Id = generateUUIDv7();
    const portfolio3Id = generateUUIDv7();

    tx.prepare(`
      INSERT INTO portfolios (id, operator_id, name, tax_id, notes, spend_threshold_cents, created_at, updated_at)
      VALUES (?, ?, 'Blue Ridge Residential LLC', 'XX-XXX4819', 'Single family residential and luxury townhomes', 150000, ?, ?),
             (?, ?, 'Piedmont Multifamily Holdings', 'XX-XXX9201', 'Duplexes and garden apartments portfolio', 250000, ?, ?),
             (?, ?, 'Downtown Lofts & Commercial', 'XX-XXX6632', 'High-density urban residential lofts and commercial assets', 500000, ?, ?)
    `).run(
      portfolio1Id, OPERATOR_ID, now, now,
      portfolio2Id, OPERATOR_ID, now, now,
      portfolio3Id, OPERATOR_ID, now, now
    );

    // 4b. Create Team Members (Leasing Agent, Maintenance Coordinator, Financial Auditor)
    const subuserId = generateUUIDv7();
    const maintUserId = generateUUIDv7();
    const auditorUserId = generateUUIDv7();

    tx.prepare(`
      INSERT INTO users (id, operator_id, email, password_hash, first_name, last_name, role, token_version, is_system_user, created_at, updated_at)
      VALUES (?, ?, 'leasing@garrisonos.local', ?, 'Sarah', 'Jenkins', 'leasing_agent', 1, 0, ?, ?),
             (?, ?, 'maintenance@garrisonos.local', ?, 'Elena', 'Rostova', 'maintenance', 1, 0, ?, ?),
             (?, ?, 'auditor@garrisonos.local', ?, 'David', 'Miller', 'auditor', 1, 0, ?, ?)
    `).run(
      subuserId, OPERATOR_ID, passwordHash, now - (30 * 86400000), now,
      maintUserId, OPERATOR_ID, passwordHash, now - (20 * 86400000), now,
      auditorUserId, OPERATOR_ID, passwordHash, now - (10 * 86400000), now
    );

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

    for (const mod of ['properties', 'maintenance', 'contacts']) {
      tx.prepare(`
        INSERT INTO user_module_access (id, operator_id, user_id, module_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(generateUUIDv7(), OPERATOR_ID, maintUserId, mod, now);
    }

    for (const mod of ['properties', 'leases', 'accounting']) {
      tx.prepare(`
        INSERT INTO user_module_access (id, operator_id, user_id, module_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(generateUUIDv7(), OPERATOR_ID, auditorUserId, mod, now);
    }

    // Seed realistic audit log entries
    const auditStmt = tx.prepare(`
      INSERT INTO audit_logs (id, operator_id, user_id, entity_type, entity_id, action, changes_json, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Sarah Jenkins audit entries
    auditStmt.run(
      generateUUIDv7(), OPERATOR_ID, userId, 'user', subuserId, 'create',
      JSON.stringify({ email: 'leasing@garrisonos.local', role: 'leasing_agent', first_name: 'Sarah', last_name: 'Jenkins' }),
      '127.0.0.1', now - (30 * 86400000)
    );
    auditStmt.run(
      generateUUIDv7(), OPERATOR_ID, userId, 'user', subuserId, 'update',
      JSON.stringify({ allowed_portfolios: [portfolio2Id], allowed_modules: ['properties', 'leases', 'maintenance'] }),
      '127.0.0.1', now - (29 * 86400000)
    );

    // Elena Rostova audit entries
    auditStmt.run(
      generateUUIDv7(), OPERATOR_ID, userId, 'user', maintUserId, 'create',
      JSON.stringify({ email: 'maintenance@garrisonos.local', role: 'maintenance', first_name: 'Elena', last_name: 'Rostova' }),
      '127.0.0.1', now - (20 * 86400000)
    );
    auditStmt.run(
      generateUUIDv7(), OPERATOR_ID, maintUserId, 'user', maintUserId, 'login',
      JSON.stringify({ method: 'password', session: 'active' }),
      '127.0.0.1', now - (5 * 86400000)
    );
    auditStmt.run(
      generateUUIDv7(), OPERATOR_ID, maintUserId, 'work_order', generateUUIDv7(), 'update',
      JSON.stringify({ action_detail: 'dispatch_vendor', vendor: 'Apex Plumbing Services', priority: 'emergency' }),
      '127.0.0.1', now - (2 * 86400000)
    );

    // David Miller audit entries
    auditStmt.run(
      generateUUIDv7(), OPERATOR_ID, userId, 'user', auditorUserId, 'create',
      JSON.stringify({ email: 'auditor@garrisonos.local', role: 'auditor', first_name: 'David', last_name: 'Miller' }),
      '127.0.0.1', now - (10 * 86400000)
    );
    auditStmt.run(
      generateUUIDv7(), OPERATOR_ID, auditorUserId, 'user', auditorUserId, 'login',
      JSON.stringify({ method: 'password', session: 'active' }),
      '127.0.0.1', now - (8 * 86400000)
    );
    auditStmt.run(
      generateUUIDv7(), OPERATOR_ID, auditorUserId, 'audit_report', generateUUIDv7(), 'create',
      JSON.stringify({ report: 'q3_operating_cash_reconciliation', status: 'verified' }),
      '127.0.0.1', now - (3 * 86400000)
    );

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
      const parkingGl = glAccountMap.get('parking_fee') || glAccountMap.get('4060');
      if (!parkingGl) throw new Error('Parking & Storage Fee GL account (4060) not found in seed.');
      const petGl = glAccountMap.get('pet_fee') || glAccountMap.get('4030');
      if (!petGl) throw new Error('Pet Fee GL account (4030) not found in seed.');
      const utilityGl = glAccountMap.get('utility_rebill') || glAccountMap.get('4040');
      if (!utilityGl) throw new Error('Utility Rebill GL account (4040) not found in seed.');

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

    // 11. Create 9 Diverse Work Orders (Including Multi-Vendor & Spend Policy Auto-Hold)
    const wo1Id = generateUUIDv7(); // Master Bathroom Toilet Leak (Emergency, Multi-Vendor, Linked Bill)
    const wo2Id = generateUUIDv7(); // HVAC AC Unit Buzzing
    const wo3Id = generateUUIDv7(); // Electrical Panel
    const wo4Id = generateUUIDv7(); // Turnover Make-Ready
    const wo5Id = generateUUIDv7(); // Cabinet Hinge Loose
    const wo6Id = generateUUIDv7(); // Foundation Stabilization
    const wo7Id = generateUUIDv7(); // Garbage Disposal Replacement
    const wo8Id = generateUUIDv7(); // Screen Door Latch
    const woHoldId = generateUUIDv7(); // Commercial Chiller Overhaul (AUTO-HELD via Spend Limit Policy)

    tx.prepare(`
      INSERT INTO work_orders (
        id, operator_id, property_id, unit_id, title, description,
        status, priority, category, permission_to_enter, vendor_contact_id,
        scheduled_date, completed_date, estimated_cost_cents, actual_cost_cents,
        hold_reason, created_at, updated_at
      ) VALUES
        (?, ?, ?, ?, 'Master Bathroom Toilet Leak', 'Water leaking onto bathroom floor from tank flange seal. Urgent plumbing and moisture dryout required.', 'in_progress', 'emergency', 'plumbing', 1, ?, ?, NULL, 25000, 145000, NULL, ?, ?),
        (?, ?, ?, ?, 'HVAC AC Unit Making Buzzing Noise', 'Air conditioning compressor outside vibrating loud when running.', 'assigned', 'high', 'hvac', 1, ?, ?, NULL, 35000, 0, NULL, ?, ?),
        (?, ?, ?, ?, 'Main Electrical Panel Breaker Tripping', 'Kitchen dedicated circuit breaker tripping under load.', 'in_progress', 'high', 'electrical', 1, ?, ?, NULL, 28000, 0, NULL, ?, ?),
        (?, ?, ?, ?, 'Turnover Make-Ready: Broadview 4-Plex Unit 201', 'Full make-ready turnover: deep clean, lock rekeying, touch-up painting.', 'assigned', 'medium', 'cosmetic', 1, ?, ?, NULL, 45000, 0, NULL, ?, ?),
        (?, ?, ?, ?, 'Kitchen Cabinet Hinge Loose', 'Upper cabinet door hinge over sink is loose and sagging.', 'open', 'low', 'other', 1, NULL, NULL, NULL, 9500, 0, NULL, ?, ?),
        (?, ?, ?, ?, 'Foundation & Subfloor Stabilization', 'Crawlspace beam reinforcement and floor leveling following inspection.', 'in_progress', 'high', 'structural', 1, ?, ?, NULL, 180000, 0, NULL, ?, ?),
        (?, ?, ?, ?, 'Garbage Disposal Replacement', 'Disposal motor seized. Replaced with new 3/4 HP continuous-feed unit.', 'completed', 'medium', 'appliance', 1, ?, ?, ?, 16500, 16500, NULL, ?, ?),
        (?, ?, ?, ?, 'Screen Door Latch Sticking', 'Front storm door handle sticking. Resident resolved latch independently.', 'cancelled', 'low', 'other', 1, NULL, NULL, NULL, 6000, 0, NULL, ?, ?),
        (?, ?, ?, NULL, 'Commercial Chiller & Cooling Tower Overhaul', 'Complete rebuild of rooftop centrifugal chiller and cooling tower pump system.', 'on_hold', 'high', 'hvac', 1, ?, ?, NULL, 850000, 0, 'Estimated cost ($8500.00) exceeds portfolio ''Downtown Lofts & Commercial'' permissible spend threshold of $5000.00', ?, ?)
    `).run(
      wo1Id, OPERATOR_ID, occupiedUnits[0]!.propertyId, occupiedUnits[0]!.unitId, vendorPlumbingId, now + 3600000, now - 7200000, now,
      wo2Id, OPERATOR_ID, occupiedUnits[1]!.propertyId, occupiedUnits[1]!.unitId, vendorHvacId, now + 86400000, now - 86400000, now,
      wo3Id, OPERATOR_ID, occupiedUnits[3]!.propertyId, occupiedUnits[3]!.unitId, vendorElectricId, now + 172800000, now - 14400000, now,
      wo4Id, OPERATOR_ID, fourPlexPropId, fourPlexTurnoverUnitId, vendorMakeReadyId, now + 86400000, now - 3600000, now,
      wo5Id, OPERATOR_ID, occupiedUnits[5]!.propertyId, occupiedUnits[5]!.unitId, now - 18000000, now,
      wo6Id, OPERATOR_ID, sycamorePropId, sycamoreHoldUnitId, vendorGeneralId, now + 259200000, now - (3 * 86400000), now,
      wo7Id, OPERATOR_ID, occupiedUnits[2]!.propertyId, occupiedUnits[2]!.unitId, vendorApplianceId, now - (6 * 86400000), now - (5 * 86400000), now - (7 * 86400000), now - (5 * 86400000),
      wo8Id, OPERATOR_ID, occupiedUnits[4]!.propertyId, occupiedUnits[4]!.unitId, now - (4 * 86400000), now - (2 * 86400000),
      woHoldId, OPERATOR_ID, loftsPropId, vendorHvacId, now + 86400000, now - 18000000, now
    );

    // Multi-Vendor Links for Work Orders
    const wovStmt = tx.prepare(`
      INSERT INTO work_order_vendors (id, operator_id, work_order_id, vendor_contact_id, role, notes, assigned_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // wo1: Plumber + Dryout Specialist
    wovStmt.run(generateUUIDv7(), OPERATOR_ID, wo1Id, vendorPlumbingId, 'Lead Plumbing Contractor', 'Disassemble tank flange and replace ring seal', now - 7200000, now - 7200000);
    wovStmt.run(generateUUIDv7(), OPERATOR_ID, wo1Id, vendorGeneralId, 'Remediation Specialist', 'Inspect subfloor moisture and deploy drying blowers', now - 3600000, now - 3600000);

    // woHold: HVAC Specialist + High Voltage Electrician
    wovStmt.run(generateUUIDv7(), OPERATOR_ID, woHoldId, vendorHvacId, 'Mechanical Specialist', '40-ton centrifugal compressor rebuild', now - 18000000, now - 18000000);
    wovStmt.run(generateUUIDv7(), OPERATOR_ID, woHoldId, vendorElectricId, 'High-Voltage Electrician', 'Isolate 480V 3-phase feeder disconnect', now - 14400000, now - 14400000);

    // 12. Preventative Maintenance Schedules
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

    // 13. Universal Conversations & Notes
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

    // Conversations for Work Orders
    const wo1ConvId = generateUUIDv7();
    tx.prepare(`
      INSERT INTO conversations (id, operator_id, entity_type, entity_id, subject, is_private, created_at, updated_at)
      VALUES (?, ?, 'work_order', ?, 'Field Progress Updates & Diagnostic Notes', 0, ?, ?)
    `).run(wo1ConvId, OPERATOR_ID, wo1Id, now - 7200000, now - 1800000);

    tx.prepare(`
      INSERT INTO conversation_messages (id, operator_id, conversation_id, author_user_id, author_contact_id, body, created_at)
      VALUES
        (?, ?, ?, NULL, ?, 'Arrived on site. Shut off water angle stop. Subfloor is structurally sound; replacing wax gasket and brass bolts.', ?),
        (?, ?, ?, ?, NULL, 'Approved. Please check ceiling drywall of unit below before restoring water pressure.', ?)
    `).run(
      generateUUIDv7(), OPERATOR_ID, wo1ConvId, vendorPlumbingId, now - 5400000,
      generateUUIDv7(), OPERATOR_ID, wo1ConvId, userId, now - 1800000
    );

    const woHoldConvId = generateUUIDv7();
    tx.prepare(`
      INSERT INTO conversations (id, operator_id, entity_type, entity_id, subject, is_private, created_at, updated_at)
      VALUES (?, ?, 'work_order', ?, 'Spend Policy Auto-Hold Notice', 1, ?, ?)
    `).run(woHoldConvId, OPERATOR_ID, woHoldId, now - 18000000, now - 7200000);

    tx.prepare(`
      INSERT INTO conversation_messages (id, operator_id, conversation_id, author_user_id, author_contact_id, body, created_at)
      VALUES
        (?, ?, ?, NULL, NULL, '⚠️ Work Order automatically placed ON HOLD:\nEstimated cost ($8500.00) exceeds portfolio ''Downtown Lofts & Commercial'' permissible spend threshold of $5000.00', ?),
        (?, ?, ?, ?, NULL, 'Estimates reviewed. Requesting portfolio owner capital authorization prior to approving contractor mobilization.', ?)
    `).run(
      generateUUIDv7(), OPERATOR_ID, woHoldConvId, now - 18000000,
      generateUUIDv7(), OPERATOR_ID, woHoldConvId, userId, now - 7200000
    );

    // 14. Client Accounting Capital Contributions & Owner Distributions
    const clientOwnerContactId = generateUUIDv7();
    tx.prepare(`
      INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, email, phone, created_at, updated_at)
      VALUES (?, ?, 'owner', 'Alexander', 'Garrison', 'alexander@garrisonproperties.local', '(555) 201-9000', ?, ?)
    `).run(clientOwnerContactId, OPERATOR_ID, now, now);

    const operatingBankGl = glAccountMap.get('operating_bank') || glAccountMap.get('1010');
    if (!operatingBankGl) throw new Error('Operating Bank GL account (1010) not found in seed.');

    const ownerCapitalGl = glAccountMap.get('owner_capital') || glAccountMap.get('3010');
    if (!ownerCapitalGl) throw new Error('Owner Capital GL account (3010) not found in seed.');

    const ownerDrawGl = glAccountMap.get('owner_draw') || glAccountMap.get('3020');
    if (!ownerDrawGl) throw new Error('Owner Draw GL account (3020) not found in seed.');

    const mgmtFeeGl = glAccountMap.get('management_fees') || glAccountMap.get('5070');
    if (!mgmtFeeGl) throw new Error('Management Fees GL account (5070) not found in seed.');

    const contrib1Id = generateUUIDv7();
    const contrib1Date = now - (90 * 86400000);
    const contrib2Id = generateUUIDv7();
    const contrib2Date = now - (30 * 86400000);

    tx.prepare(`
      INSERT INTO client_capital_contributions (
        id, operator_id, client_contact_id, portfolio_id, amount_cents,
        contribution_date, destination_account_id, reference_number, memo, created_at, updated_at
      ) VALUES
        (?, ?, ?, ?, 5000000, ?, ?, 'WIRE-559201', 'Initial Portfolio Capital Reserve Injection', ?, ?),
        (?, ?, ?, ?, 2500000, ?, ?, 'ACH-110294', 'Q3 Capital Expenditure & Roof Reserve', ?, ?)
    `).run(
      contrib1Id, OPERATOR_ID, clientOwnerContactId, portfolio1Id, contrib1Date, operatingBankGl, now, now,
      contrib2Id, OPERATOR_ID, clientOwnerContactId, portfolio2Id, contrib2Date, operatingBankGl, now, now
    );

    JournalService.postEntry({
      date_ms: contrib1Date,
      memo: 'Initial Portfolio Capital Reserve Injection',
      source_type: 'client_contribution',
      source_id: contrib1Id,
      lines: [
        { account_id: operatingBankGl, debit_cents: 5000000, credit_cents: 0, contact_id: clientOwnerContactId, description: 'Initial Portfolio Capital Reserve Injection Inflow' },
        { account_id: ownerCapitalGl, debit_cents: 0, credit_cents: 5000000, contact_id: clientOwnerContactId, description: 'Owner Capital Equity Credit' }
      ]
    }, tx);

    JournalService.postEntry({
      date_ms: contrib2Date,
      memo: 'Q3 Capital Expenditure & Roof Reserve',
      source_type: 'client_contribution',
      source_id: contrib2Id,
      lines: [
        { account_id: operatingBankGl, debit_cents: 2500000, credit_cents: 0, contact_id: clientOwnerContactId, description: 'Q3 Capital Expenditure & Roof Reserve Inflow' },
        { account_id: ownerCapitalGl, debit_cents: 0, credit_cents: 2500000, contact_id: clientOwnerContactId, description: 'Owner Capital Equity Credit' }
      ]
    }, tx);

    const dist1Id = generateUUIDv7();
    const dist1Date = now - (60 * 86400000);
    const dist2Id = generateUUIDv7();
    const dist2Date = now - (15 * 86400000);

    tx.prepare(`
      INSERT INTO client_distributions (
        id, operator_id, client_contact_id, portfolio_id, amount_cents,
        distribution_date, source_account_id, disbursement_method, reference_number, memo, created_at, updated_at
      ) VALUES
        (?, ?, ?, ?, 1500000, ?, ?, 'ach', 'ACH-DIST-01', 'Q2 Net Cash Flow Owner Draw', ?, ?),
        (?, ?, ?, ?, 1000000, ?, ?, 'ach', 'ACH-DIST-02', 'Q3 Owner Draw', ?, ?)
    `).run(
      dist1Id, OPERATOR_ID, clientOwnerContactId, portfolio1Id, dist1Date, operatingBankGl, now, now,
      dist2Id, OPERATOR_ID, clientOwnerContactId, portfolio2Id, dist2Date, operatingBankGl, now, now
    );

    JournalService.postEntry({
      date_ms: dist1Date,
      memo: 'Q2 Net Cash Flow Owner Draw',
      source_type: 'client_distribution',
      source_id: dist1Id,
      lines: [
        { account_id: ownerDrawGl, debit_cents: 1500000, credit_cents: 0, contact_id: clientOwnerContactId, description: 'Owner Draw Equity Debit' },
        { account_id: operatingBankGl, debit_cents: 0, credit_cents: 1500000, contact_id: clientOwnerContactId, description: 'Operating Account Distribution Outflow' }
      ]
    }, tx);

    JournalService.postEntry({
      date_ms: dist2Date,
      memo: 'Q3 Owner Draw',
      source_type: 'client_distribution',
      source_id: dist2Id,
      lines: [
        { account_id: ownerDrawGl, debit_cents: 1000000, credit_cents: 0, contact_id: clientOwnerContactId, description: 'Owner Draw Equity Debit' },
        { account_id: operatingBankGl, debit_cents: 0, credit_cents: 1000000, contact_id: clientOwnerContactId, description: 'Operating Account Distribution Outflow' }
      ]
    }, tx);

    tx.prepare(`
      INSERT INTO management_fee_agreements (
        id, operator_id, portfolio_id, calculation_method,
        percentage_bps, flat_fee_cents, fee_gl_account_id, pass_through_expenses, created_at
      ) VALUES (?, ?, ?, 'percentage_collected_revenue', 800, 0, ?, 1, ?)
    `).run(generateUUIDv7(), OPERATOR_ID, portfolio1Id, mgmtFeeGl, now);

    // =========================================================================
    // 15. Dynamic Custom Field Sections & Definitions + Populating Entities
    // =========================================================================
    const propSecId = generateUUIDv7();
    const unitSecId = generateUUIDv7();
    const leaseSecId = generateUUIDv7();
    const contactSecId = generateUUIDv7();
    const woSecId = generateUUIDv7();
    const billSecId = generateUUIDv7();

    tx.prepare(`
      INSERT INTO custom_field_sections (id, operator_id, entity_type, title, sort_order, created_at, updated_at)
      VALUES
        (?, ?, 'property', 'Building & Access Security', 1, ?, ?),
        (?, ?, 'unit', 'Unit Mechanical & Specifications', 1, ?, ?),
        (?, ?, 'lease', 'Compliance & Policy Verification', 1, ?, ?),
        (?, ?, 'contact', 'Emergency & Verification', 1, ?, ?),
        (?, ?, 'work_order', 'Access & Vendor Dispatch', 1, ?, ?),
        (?, ?, 'bill', 'Project Accounting & CapEx Tagging', 1, ?, ?)
    `).run(
      propSecId, OPERATOR_ID, now, now,
      unitSecId, OPERATOR_ID, now, now,
      leaseSecId, OPERATOR_ID, now, now,
      contactSecId, OPERATOR_ID, now, now,
      woSecId, OPERATOR_ID, now, now,
      billSecId, OPERATOR_ID, now, now
    );

    tx.prepare(`
      INSERT INTO custom_field_definitions (
        id, operator_id, section_id, entity_type, field_name, field_label,
        data_type, is_required, default_value, options_json, sort_order, created_at, updated_at
      ) VALUES
        -- Property
        (?, ?, ?, 'property', 'gate_code', 'Gate Access Code', 'string', 0, '9876', NULL, 1, ?, ?),
        (?, ?, ?, 'property', 'lockbox_code', 'Master Lockbox Code', 'string', 0, '1234', NULL, 2, ?, ?),
        (?, ?, ?, 'property', 'roof_replacement_year', 'Roof Replacement Year', 'number', 0, '2019', NULL, 3, ?, ?),
        -- Unit
        (?, ?, ?, 'unit', 'hvac_filter_size', 'HVAC Filter Size', 'string', 0, '16x25x1', NULL, 1, ?, ?),
        (?, ?, ?, 'unit', 'water_heater_sn', 'Water Heater Serial #', 'string', 0, 'WH-884920', NULL, 2, ?, ?),
        (?, ?, ?, 'unit', 'paint_color_code', 'Interior Paint Code', 'string', 0, 'SW 7005 Pure White', NULL, 3, ?, ?),
        -- Lease
        (?, ?, ?, 'lease', 'renters_insurance_policy', 'Insurance Policy #', 'string', 0, 'POL-99281', NULL, 1, ?, ?),
        (?, ?, ?, 'lease', 'pet_deposit_cleared', 'Pet Deposit Cleared', 'boolean', 0, '1', NULL, 2, ?, ?),
        -- Contact
        (?, ?, ?, 'contact', 'emergency_contact_phone', 'Emergency Contact Phone', 'string', 0, '(555) 019-9283', NULL, 1, ?, ?),
        (?, ?, ?, 'contact', 'id_verification_status', 'ID Verification Status', 'select', 0, 'verified', '["verified", "pending", "exempt"]', 2, ?, ?),
        -- Work Order
        (?, ?, ?, 'work_order', 'access_instructions', 'Entry Permission & Alarm', 'string', 0, 'Alarm disarm: 4421. Dog in crate.', NULL, 1, ?, ?),
        (?, ?, ?, 'work_order', 'safety_hazard_noted', 'Safety Hazard Noted', 'boolean', 0, '0', NULL, 2, ?, ?),
        -- Bill
        (?, ?, ?, 'bill', 'project_code', 'CapEx Project Code', 'string', 0, 'CAPEX-2026-Q1', NULL, 1, ?, ?),
        (?, ?, ?, 'bill', 'is_1099_reportable', '1099 Reportable', 'boolean', 0, '1', NULL, 2, ?, ?)
    `).run(
      generateUUIDv7(), OPERATOR_ID, propSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, propSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, propSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, unitSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, unitSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, unitSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, leaseSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, leaseSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, contactSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, contactSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, woSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, woSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, billSecId, now, now,
      generateUUIDv7(), OPERATOR_ID, billSecId, now, now
    );

    // Populate custom field values across entities
    tx.prepare(`
      UPDATE properties SET custom_fields = json_object(
        'gate_code', '9876',
        'lockbox_code', '1234',
        'roof_replacement_year', 2019
      ) WHERE operator_id = ?
    `).run(OPERATOR_ID);

    tx.prepare(`
      UPDATE units SET custom_fields = json_object(
        'hvac_filter_size', '16x25x1',
        'water_heater_sn', 'WH-884920',
        'paint_color_code', 'SW 7005 Pure White'
      ) WHERE operator_id = ?
    `).run(OPERATOR_ID);

    tx.prepare(`
      UPDATE leases SET custom_fields = json_object(
        'renters_insurance_policy', 'POL-99281',
        'pet_deposit_cleared', 1
      ) WHERE operator_id = ?
    `).run(OPERATOR_ID);

    tx.prepare(`
      UPDATE contacts SET custom_fields = json_object(
        'emergency_contact_phone', '(555) 019-9283',
        'id_verification_status', 'verified'
      ) WHERE operator_id = ?
    `).run(OPERATOR_ID);

    tx.prepare(`
      UPDATE work_orders SET custom_fields = json_object(
        'access_instructions', 'Alarm disarm: 4421. Dog in crate.',
        'safety_hazard_noted', 0
      ) WHERE operator_id = ?
    `).run(OPERATOR_ID);

    // =========================================================================
    // 16. Amenities Catalog, Property Assignments, and Marketing Syndication
    // =========================================================================
    const amPool = generateUUIDv7();
    const amGym = generateUUIDv7();
    const amRoof = generateUUIDv7();
    const amEv = generateUUIDv7();
    const amPackage = generateUUIDv7();
    const amWasher = generateUUIDv7();
    const amStainless = generateUUIDv7();
    const amThermostat = generateUUIDv7();
    const amPetPark = generateUUIDv7();
    const amSolar = generateUUIDv7();

    tx.prepare(`
      INSERT INTO amenity_definitions (id, operator_id, category, name, icon, is_custom, created_at, updated_at)
      VALUES
        (?, ?, 'community', 'Resort-Style Swimming Pool', 'waves', 0, ?, ?),
        (?, ?, 'community', '24/7 Fitness Center', 'dumbbell', 0, ?, ?),
        (?, ?, 'community', 'Rooftop Terrace & BBQ Lounge', 'sun', 0, ?, ?),
        (?, ?, 'community', 'Electric Vehicle Charging Stations', 'zap', 0, ?, ?),
        (?, ?, 'community', 'Package Concierge Hub', 'package', 0, ?, ?),
        (?, ?, 'unit', 'In-Unit Washer/Dryer', 'disc', 0, ?, ?),
        (?, ?, 'unit', 'Stainless Steel Appliances', 'shield', 0, ?, ?),
        (?, ?, 'unit', 'Smart Thermostat', 'thermometer', 0, ?, ?),
        (?, ?, 'pet', 'Bark Park & Agility Course', 'heart', 0, ?, ?),
        (?, ?, 'eco', 'Solar-Powered Common Areas', 'sun', 0, ?, ?)
    `).run(
      amPool, OPERATOR_ID, now, now,
      amGym, OPERATOR_ID, now, now,
      amRoof, OPERATOR_ID, now, now,
      amEv, OPERATOR_ID, now, now,
      amPackage, OPERATOR_ID, now, now,
      amWasher, OPERATOR_ID, now, now,
      amStainless, OPERATOR_ID, now, now,
      amThermostat, OPERATOR_ID, now, now,
      amPetPark, OPERATOR_ID, now, now,
      amSolar, OPERATOR_ID, now, now
    );

    // Assign amenities to properties
    tx.prepare(`
      INSERT INTO property_amenities (id, operator_id, property_id, amenity_id, created_at)
      VALUES
        (?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?)
    `).run(
      generateUUIDv7(), OPERATOR_ID, thPropId, amPool, now,
      generateUUIDv7(), OPERATOR_ID, thPropId, amGym, now,
      generateUUIDv7(), OPERATOR_ID, thPropId, amPetPark, now,
      generateUUIDv7(), OPERATOR_ID, loftsPropId, amGym, now,
      generateUUIDv7(), OPERATOR_ID, loftsPropId, amRoof, now,
      generateUUIDv7(), OPERATOR_ID, loftsPropId, amEv, now
    );

    // Assign unit-level amenities
    tx.prepare(`
      INSERT INTO unit_amenities (id, operator_id, unit_id, amenity_id, is_override, is_excluded, created_at)
      VALUES
        (?, ?, ?, ?, 0, 0, ?),
        (?, ?, ?, ?, 0, 0, ?),
        (?, ?, ?, ?, 0, 0, ?)
    `).run(
      generateUUIDv7(), OPERATOR_ID, occupiedUnits[0]!.unitId, amWasher, now,
      generateUUIDv7(), OPERATOR_ID, occupiedUnits[0]!.unitId, amStainless, now,
      generateUUIDv7(), OPERATOR_ID, occupiedUnits[0]!.unitId, amThermostat, now
    );

    // Marketing syndication
    tx.prepare(`
      INSERT INTO marketing_syndication (
        id, operator_id, property_id, unit_id, headline, description,
        advertised_rent_cents, target_deposit_cents, available_date, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Charming Mountain View Townhome', 'Spacious 3-bedroom luxury townhome with modern appliances and private patio.', 190000, 190000, ?, 'active', ?, ?)
    `).run(generateUUIDv7(), OPERATOR_ID, thPropId, occupiedUnits[0]!.unitId, now + (14 * 86400000), now, now);

    // =========================================================================
    // 17. Accounts Payable (AP Bills), Allocations & General Ledger Postings
    // =========================================================================
    const apGl = glAccountMap.get('accounts_payable') || glAccountMap.get('2010');
    if (!apGl) throw new Error('Accounts Payable GL account (2010) not found in seed.');
    const repairsGl = glAccountMap.get('repairs') || glAccountMap.get('5100');
    if (!repairsGl) throw new Error('Repairs GL account (5100) not found in seed.');
    const cleaningGl = glAccountMap.get('cleaning_maintenance') || glAccountMap.get('5030');
    if (!cleaningGl) throw new Error('Cleaning & Maintenance GL account (5030) not found in seed.');
    const undepositedGl = glAccountMap.get('undeposited_funds') || glAccountMap.get('1030');
    if (!undepositedGl) throw new Error('Undeposited Funds GL account (1030) not found in seed.');
    const rentIncomeGl = glAccountMap.get('rent') || glAccountMap.get('4010');
    if (!rentIncomeGl) throw new Error('Rental Income GL account (4010) not found in seed.');

    const bill1Id = generateUUIDv7(); // Approved
    const bill2Id = generateUUIDv7(); // Draft
    const bill3Id = generateUUIDv7(); // Approved
    const bill4Id = generateUUIDv7(); // Paid
    const bill5Id = generateUUIDv7(); // Approved (Overdue)

    tx.prepare(`
      INSERT INTO bills (
        id, operator_id, vendor_id, work_order_id, invoice_number, invoice_date, due_date,
        payment_terms, reference_number, subtotal_cents, tax_cents,
        total_amount_cents, amount_paid_cents, status, approved_by, approved_at,
        notes, created_at, updated_at
      ) VALUES
        -- Bill 1: Apex Plumbing (Linked to Emergency Work Order wo1Id)
        (?, ?, ?, ?, 'INV-2026-881', ?, ?, 'net_30', 'PO-8810', 145000, 0, 145000, 145000, 'approved', ?, ?, 'Emergency pipe leak & bathroom flange replacement', ?, ?),
        -- Bill 2: VoltMaster Electric (Draft)
        (?, ?, ?, NULL, 'INV-2026-904', ?, ?, 'net_15', 'PO-9041', 280000, 0, 280000, 0, 'draft', NULL, NULL, 'Commercial panel submetering installation', ?, ?),
        -- Bill 3: Hawkins General Repair (Approved Multi-Property Split)
        (?, ?, ?, NULL, 'INV-2026-302', ?, ?, 'net_30', 'PO-3022', 320000, 0, 320000, 160000, 'approved', ?, ?, 'Quarterly exterior siding and deck restoration across 3 properties', ?, ?),
        -- Bill 4: CoolAir Climate Systems (Paid)
        (?, ?, ?, NULL, 'INV-2026-440', ?, ?, 'due_on_receipt', 'PO-4403', 185000, 0, 185000, 185000, 'paid', ?, ?, 'Dual heat pump seasonal service overhaul', ?, ?),
        -- Bill 5: Blue Ridge Pro Painters (Approved Overdue)
        (?, ?, ?, NULL, 'INV-2026-105', ?, ?, 'net_15', 'PO-1054', 450000, 0, 450000, 0, 'approved', ?, ?, 'Complete exterior trim and townhome building paint', ?, ?)
    `).run(
      bill1Id, OPERATOR_ID, vendorPlumbingId, wo1Id, now - (15 * 86400000), now + (15 * 86400000), userId, now - (10 * 86400000), now - (15 * 86400000), now,
      bill2Id, OPERATOR_ID, vendorElectricId, now - (2 * 86400000), now + (5 * 86400000), now - (2 * 86400000), now,
      bill3Id, OPERATOR_ID, vendorGeneralId, now - (20 * 86400000), now + (10 * 86400000), userId, now - (18 * 86400000), now - (20 * 86400000), now,
      bill4Id, OPERATOR_ID, vendorHvacId, now - (35 * 86400000), now - (5 * 86400000), userId, now - (30 * 86400000), now - (35 * 86400000), now,
      bill5Id, OPERATOR_ID, vendorPaintingId, now - (25 * 86400000), now - (10 * 86400000), userId, now - (20 * 86400000), now - (25 * 86400000), now
    );

    // Bill allocations
    tx.prepare(`
      INSERT INTO bill_allocations (
        id, operator_id, bill_id, portfolio_id, property_id, unit_id,
        gl_account_id, amount_cents, amount_settled_cents, description, created_at
      ) VALUES
        -- Bill 1 Allocations ($850 / $600)
        (?, ?, ?, ?, ?, ?, ?, 85000, 85000, 'Master bathroom flange repair', ?),
        (?, ?, ?, ?, ?, NULL, ?, 60000, 60000, 'Main water sewer camera inspection', ?),
        -- Bill 2 Allocations ($2,800)
        (?, ?, ?, ?, ?, NULL, ?, 280000, 0, 'Lofts panel upgrade & breaker rewiring', ?),
        -- Bill 3 Allocations ($1,200 / $1,000 / $1,000)
        (?, ?, ?, ?, ?, NULL, ?, 120000, 60000, 'Highland Pines deck refinishing', ?),
        (?, ?, ?, ?, ?, NULL, ?, 100000, 50000, 'Oakwood Terraces exterior siding powerwash', ?),
        (?, ?, ?, ?, ?, NULL, ?, 100000, 50000, 'Downtown Lofts common area maintenance', ?),
        -- Bill 4 Allocations ($1,850)
        (?, ?, ?, ?, ?, NULL, ?, 185000, 185000, 'Dual heat pump system overhaul', ?),
        -- Bill 5 Allocations ($4,500)
        (?, ?, ?, ?, ?, NULL, ?, 450000, 0, 'Townhome exterior paint and weather sealing', ?)
    `).run(
      generateUUIDv7(), OPERATOR_ID, bill1Id, portfolio1Id, occupiedUnits[0]!.propertyId, occupiedUnits[0]!.unitId, repairsGl, now,
      generateUUIDv7(), OPERATOR_ID, bill1Id, portfolio2Id, fourPlexPropId, repairsGl, now,
      generateUUIDv7(), OPERATOR_ID, bill2Id, portfolio3Id, loftsPropId, repairsGl, now,
      generateUUIDv7(), OPERATOR_ID, bill3Id, portfolio1Id, thPropId, repairsGl, now,
      generateUUIDv7(), OPERATOR_ID, bill3Id, portfolio2Id, fourPlexPropId, repairsGl, now,
      generateUUIDv7(), OPERATOR_ID, bill3Id, portfolio3Id, loftsPropId, repairsGl, now,
      generateUUIDv7(), OPERATOR_ID, bill4Id, portfolio2Id, fourPlexPropId, repairsGl, now,
      generateUUIDv7(), OPERATOR_ID, bill5Id, portfolio1Id, thPropId, cleaningGl, now
    );

    // GL Postings for approved & paid bills
    JournalService.postEntry({
      date_ms: now - (10 * 86400000),
      memo: 'Approved AP Bill INV-2026-881 (Apex Plumbing Services)',
      source_type: 'bill',
      source_id: bill1Id,
      lines: [
        { account_id: repairsGl, debit_cents: 145000, credit_cents: 0, description: 'Plumbing Repair Expense' },
        { account_id: apGl, debit_cents: 0, credit_cents: 145000, contact_id: vendorPlumbingId, description: 'Accounts Payable Accrual' }
      ]
    }, tx);

    JournalService.postEntry({
      date_ms: now - (18 * 86400000),
      memo: 'Approved AP Bill INV-2026-302 (Hawkins General Repair)',
      source_type: 'bill',
      source_id: bill3Id,
      lines: [
        { account_id: repairsGl, debit_cents: 320000, credit_cents: 0, description: 'Multi-property maintenance expense' },
        { account_id: apGl, debit_cents: 0, credit_cents: 320000, contact_id: vendorGeneralId, description: 'Accounts Payable Accrual' }
      ]
    }, tx);

    JournalService.postEntry({
      date_ms: now - (30 * 86400000),
      memo: 'Approved AP Bill INV-2026-440 (CoolAir Climate Systems)',
      source_type: 'bill',
      source_id: bill4Id,
      lines: [
        { account_id: repairsGl, debit_cents: 185000, credit_cents: 0, description: 'Heat Pump Overhaul Expense' },
        { account_id: apGl, debit_cents: 0, credit_cents: 185000, contact_id: vendorHvacId, description: 'Accounts Payable Accrual' }
      ]
    }, tx);

    JournalService.postEntry({
      date_ms: now - (20 * 86400000),
      memo: 'Approved AP Bill INV-2026-105 (Blue Ridge Pro Painters)',
      source_type: 'bill',
      source_id: bill5Id,
      lines: [
        { account_id: cleaningGl, debit_cents: 450000, credit_cents: 0, description: 'Exterior Repainting Expense' },
        { account_id: apGl, debit_cents: 0, credit_cents: 450000, contact_id: vendorPaintingId, description: 'Accounts Payable Accrual' }
      ]
    }, tx);

    // =========================================================================
    // 18. Vendor Checks & Disbursements
    // =========================================================================
    const check1Id = generateUUIDv7(); // Cleared
    const check2Id = generateUUIDv7(); // Printed
    const check3Id = generateUUIDv7(); // Draft

    tx.prepare(`
      INSERT INTO vendor_checks (
        id, operator_id, bank_account_id, vendor_id, check_number, check_date,
        amount_cents, payee_name, memo, status, cleared_at, created_at, updated_at
      ) VALUES
        (?, ?, ?, ?, '1001', ?, 185000, 'CoolAir Climate Systems', 'Disbursement for INV-2026-440', 'cleared', ?, ?, ?),
        (?, ?, ?, ?, '1002', ?, 145000, 'Apex Plumbing Services', 'Disbursement for INV-2026-881', 'printed', NULL, ?, ?),
        (?, ?, ?, ?, '1003', ?, 160000, 'Hawkins General Repair', 'Partial payment for INV-2026-302', 'draft', NULL, ?, ?)
    `).run(
      check1Id, OPERATOR_ID, operatingBankGl, vendorHvacId, now - (10 * 86400000), now - (3 * 86400000), now - (10 * 86400000), now,
      check2Id, OPERATOR_ID, operatingBankGl, vendorPlumbingId, now - (4 * 86400000), now - (4 * 86400000), now,
      check3Id, OPERATOR_ID, operatingBankGl, vendorGeneralId, now - 86400000, now - 86400000, now
    );

    tx.prepare(`
      INSERT INTO vendor_check_allocations (id, operator_id, check_id, bill_id, allocated_amount_cents, created_at)
      VALUES
        (?, ?, ?, ?, 185000, ?),
        (?, ?, ?, ?, 145000, ?),
        (?, ?, ?, ?, 160000, ?)
    `).run(
      generateUUIDv7(), OPERATOR_ID, check1Id, bill4Id, now,
      generateUUIDv7(), OPERATOR_ID, check2Id, bill1Id, now,
      generateUUIDv7(), OPERATOR_ID, check3Id, bill3Id, now
    );

    // GL Postings for checks
    JournalService.postEntry({
      date_ms: now - (10 * 86400000),
      memo: 'Vendor Check #1001 to CoolAir Climate Systems',
      source_type: 'vendor_check',
      source_id: check1Id,
      lines: [
        { account_id: apGl, debit_cents: 185000, credit_cents: 0, contact_id: vendorHvacId, description: 'Settle AP Bill INV-2026-440' },
        { account_id: operatingBankGl, debit_cents: 0, credit_cents: 185000, contact_id: vendorHvacId, description: 'Operating Account Check Disbursement' }
      ]
    }, tx);

    JournalService.postEntry({
      date_ms: now - (4 * 86400000),
      memo: 'Vendor Check #1002 to Apex Plumbing Services',
      source_type: 'vendor_check',
      source_id: check2Id,
      lines: [
        { account_id: apGl, debit_cents: 145000, credit_cents: 0, contact_id: vendorPlumbingId, description: 'Settle AP Bill INV-2026-881' },
        { account_id: operatingBankGl, debit_cents: 0, credit_cents: 145000, contact_id: vendorPlumbingId, description: 'Operating Account Check Disbursement' }
      ]
    }, tx);

    // =========================================================================
    // 19. Vendor Credits & Memos
    // =========================================================================
    const credId = generateUUIDv7();
    tx.prepare(`
      INSERT INTO vendor_credits (
        id, operator_id, vendor_id, credit_number, credit_date,
        total_amount_cents, remaining_amount_cents, gl_account_id,
        reason, reference_number, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'CR-2026-01', ?, 25000, 25000, ?, 'Overcharge discount on plumbing fittings returned to supply house', 'RET-8810', 'open', ?, ?)
    `).run(credId, OPERATOR_ID, vendorPlumbingId, now - (7 * 86400000), repairsGl, now - (7 * 86400000), now);

    // =========================================================================
    // 20. Undeposited Funds Receipts & Bank Deposits
    // =========================================================================
    // Post 5 incoming tenant payment journal entries debited to 1030 Undeposited Funds
    const receipt1 = JournalService.postEntry({
      date_ms: now - (5 * 86400000),
      memo: 'Rent Payment Check #4401 - Unit TH-1',
      source_type: 'payment',
      lines: [
        { account_id: undepositedGl, debit_cents: 190000, credit_cents: 0, property_id: thPropId, description: 'Undeposited Rent Check #4401' },
        { account_id: rentIncomeGl, debit_cents: 0, credit_cents: 190000, property_id: thPropId, description: 'Rental Income Inflow' }
      ]
    }, tx);

    const receipt2 = JournalService.postEntry({
      date_ms: now - (5 * 86400000),
      memo: 'Rent Payment Check #4402 - Unit TH-2',
      source_type: 'payment',
      lines: [
        { account_id: undepositedGl, debit_cents: 190000, credit_cents: 0, property_id: thPropId, description: 'Undeposited Rent Check #4402' },
        { account_id: rentIncomeGl, debit_cents: 0, credit_cents: 190000, property_id: thPropId, description: 'Rental Income Inflow' }
      ]
    }, tx);

    const receipt3 = JournalService.postEntry({
      date_ms: now - (4 * 86400000),
      memo: 'Rent Payment Money Order #901 - Grand Central Lofts #101',
      source_type: 'payment',
      lines: [
        { account_id: undepositedGl, debit_cents: 185000, credit_cents: 0, property_id: loftsPropId, description: 'Undeposited Rent Money Order' },
        { account_id: rentIncomeGl, debit_cents: 0, credit_cents: 185000, property_id: loftsPropId, description: 'Rental Income Inflow' }
      ]
    }, tx);

    // Undeposited receipts remaining in queue (2 unbatched receipts)
    JournalService.postEntry({
      date_ms: now - 86400000,
      memo: 'Rent Check #5512 - 425 Highland Ave',
      source_type: 'payment',
      lines: [
        { account_id: undepositedGl, debit_cents: 220000, credit_cents: 0, property_id: occupiedUnits[3]!.propertyId, description: 'Undeposited Rent Check #5512' },
        { account_id: rentIncomeGl, debit_cents: 0, credit_cents: 220000, property_id: occupiedUnits[3]!.propertyId, description: 'Rental Income Inflow' }
      ]
    }, tx);

    JournalService.postEntry({
      date_ms: now - (12 * 3600000),
      memo: 'Rent Check #3091 - 509 Willow Creek Way',
      source_type: 'payment',
      lines: [
        { account_id: undepositedGl, debit_cents: 165000, credit_cents: 0, property_id: occupiedUnits[4]!.propertyId, description: 'Undeposited Rent Check #3091' },
        { account_id: rentIncomeGl, debit_cents: 0, credit_cents: 165000, property_id: occupiedUnits[4]!.propertyId, description: 'Rental Income Inflow' }
      ]
    }, tx);

    // Group receipts 1 & 2 into Bank Deposit 1 ($3,800.00)
    const deposit1Id = generateUUIDv7();
    tx.prepare(`
      INSERT INTO bank_deposits (
        id, operator_id, bank_account_id, deposit_date, total_amount_cents,
        deposit_reference, memo, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 380000, 'DEP-2026-0901', 'Highland Pines rent batch deposit #1', 'cleared', ?, ?)
    `).run(deposit1Id, OPERATOR_ID, operatingBankGl, now - (3 * 86400000), now - (3 * 86400000), now);

    tx.prepare(`
      INSERT INTO bank_deposit_lines (id, operator_id, bank_deposit_id, source_entry_id, amount_cents, created_at)
      VALUES
        (?, ?, ?, ?, 190000, ?),
        (?, ?, ?, ?, 190000, ?)
    `).run(
      generateUUIDv7(), OPERATOR_ID, deposit1Id, receipt1.id, now,
      generateUUIDv7(), OPERATOR_ID, deposit1Id, receipt2.id, now
    );

    JournalService.postEntry({
      date_ms: now - (3 * 86400000),
      memo: 'Bank Deposit DEP-2026-0901 (Batch clearing 2 receipts to checking)',
      source_type: 'bank_deposit',
      source_id: deposit1Id,
      lines: [
        { account_id: operatingBankGl, debit_cents: 380000, credit_cents: 0, description: 'Deposit Cleared to Operating Checking' },
        { account_id: undepositedGl, debit_cents: 0, credit_cents: 380000, description: 'Clear 1030 Undeposited Receipts' }
      ]
    }, tx);

    // Group receipt 3 into Bank Deposit 2 ($1,850.00)
    const deposit2Id = generateUUIDv7();
    tx.prepare(`
      INSERT INTO bank_deposits (
        id, operator_id, bank_account_id, deposit_date, total_amount_cents,
        deposit_reference, memo, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 185000, 'DEP-2026-0902', 'Grand Central Lofts weekly rent batch', 'cleared', ?, ?)
    `).run(deposit2Id, OPERATOR_ID, operatingBankGl, now - (2 * 86400000), now - (2 * 86400000), now);

    tx.prepare(`
      INSERT INTO bank_deposit_lines (id, operator_id, bank_deposit_id, source_entry_id, amount_cents, created_at)
      VALUES (?, ?, ?, ?, 185000, ?)
    `).run(generateUUIDv7(), OPERATOR_ID, deposit2Id, receipt3.id, now);

    JournalService.postEntry({
      date_ms: now - (2 * 86400000),
      memo: 'Bank Deposit DEP-2026-0902 (Batch clearing 1 receipt to checking)',
      source_type: 'bank_deposit',
      source_id: deposit2Id,
      lines: [
        { account_id: operatingBankGl, debit_cents: 185000, credit_cents: 0, description: 'Deposit Cleared to Operating Checking' },
        { account_id: undepositedGl, debit_cents: 0, credit_cents: 185000, description: 'Clear 1030 Undeposited Receipts' }
      ]
    }, tx);

    // =========================================================================
    // 21. System Backups
    // =========================================================================
    tx.prepare(`
      INSERT INTO backups (
        id, operator_id, backup_type, filename, relative_path,
        file_size_bytes, checksum_sha256, status, created_at
      ) VALUES
        (?, ?, 'full_system', 'garrisonos-backup-20260930-full.sqlite3.gz', 'backups/garrisonos-backup-20260930-full.sqlite3.gz', 4210840, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'completed', ?),
        (?, ?, 'operator_data', 'garrisonos-backup-20261001-daily.sqlite3.gz', 'backups/garrisonos-backup-20261001-daily.sqlite3.gz', 1845200, 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb', 'completed', ?)
    `).run(
      generateUUIDv7(), OPERATOR_ID, now - (2 * 86400000),
      generateUUIDv7(), OPERATOR_ID, now - 86400000
    );
  }, db);
  });
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
