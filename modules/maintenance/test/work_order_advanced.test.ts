import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { PropertiesRepository } from '../../properties/backend/repository.js';
import { ContactsRepository } from '../../contacts/backend/repository.js';
import { MaintenanceRepository } from '../backend/repository.js';
import { ChartOfAccountsRepository } from '../../accounting/backend/chart_of_accounts.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';

describe('Work Order Multi-Vendor Assignment & Spend Policy Auto-Hold', () => {
  before(() => {
    getDatabase({ inMemory: true });
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('allows linking, listing, and removing multiple vendors on a work order', () => {
    runInOperatorContext('op-wo-adv-1', () => {
      const prop = PropertiesRepository.createProperty({
        name: 'Evergreen Commons',
        property_type: 'multi_family',
        address_line1: '100 Evergreen Blvd',
        city: 'Seattle',
        state: 'WA',
        postal_code: '98101'
      });

      const wo = MaintenanceRepository.createWorkOrder({
        property_id: prop.id,
        title: 'Roof Leak & Water Damage Remediation',
        description: 'Requires structural contractor for roof and drying specialist for interior ceiling',
        category: 'structural',
        priority: 'high',
        estimated_cost_cents: 250000
      });

      const vendor1 = ContactsRepository.createContact({
        contact_type: 'vendor',
        first_name: 'Marcus',
        last_name: 'Vance',
        company_name: 'Vance Roofing LLC',
        email: 'marcus@vanceroofing.test',
        vendor_specialty: 'structural',
        w9_received: 1
      });

      const vendor2 = ContactsRepository.createContact({
        contact_type: 'vendor',
        first_name: 'Elena',
        last_name: 'Rostova',
        company_name: 'Apex Dryout Pros',
        email: 'elena@apexdry.test',
        vendor_specialty: 'other',
        w9_received: 1
      });

      // 1. Assign first vendor
      const assignment1 = MaintenanceRepository.assignWorkOrderVendor(
        wo.id,
        vendor1.id,
        'Lead Roofing Specialist',
        'Inspect and repair damaged roof membrane'
      );
      assert.equal(assignment1.work_order_id, wo.id);
      assert.equal(assignment1.vendor_contact_id, vendor1.id);
      assert.equal(assignment1.role, 'Lead Roofing Specialist');

      // 2. Assign second vendor
      const assignment2 = MaintenanceRepository.assignWorkOrderVendor(
        wo.id,
        vendor2.id,
        'Remediation Specialist',
        'Deploy dehumidifiers and check moisture levels'
      );
      assert.equal(assignment2.work_order_id, wo.id);
      assert.equal(assignment2.vendor_contact_id, vendor2.id);

      // 3. List assigned vendors
      const vendors = MaintenanceRepository.listWorkOrderVendors(wo.id);
      assert.equal(vendors.length, 2);
      const companies = vendors.map((v) => v.company_name);
      assert.ok(companies.includes('Vance Roofing LLC'));
      assert.ok(companies.includes('Apex Dryout Pros'));

      // 4. Verify getWorkOrderById returns assigned_vendors
      const woWithVendors = MaintenanceRepository.getWorkOrderById(wo.id);
      assert.ok(woWithVendors);
      assert.equal(woWithVendors.assigned_vendors?.length, 2);

      // 5. Remove one vendor
      const removed = MaintenanceRepository.removeWorkOrderVendor(wo.id, vendor1.id);
      assert.equal(removed, true);

      const remainingVendors = MaintenanceRepository.listWorkOrderVendors(wo.id);
      assert.equal(remainingVendors.length, 1);
      assert.equal(remainingVendors[0]?.vendor_contact_id, vendor2.id);
    });
  });

  it('automatically places work order on hold when estimated cost exceeds portfolio spend threshold', () => {
    runInOperatorContext('op-wo-adv-2', () => {
      // 1. Create portfolio with a $1,000.00 (100000 cents) spend threshold
      const portfolio = PropertiesRepository.createPortfolio({
        name: 'Northwest Commercial Portfolio',
        notes: 'Commercial and light industrial properties'
      });

      // Update spend threshold
      const db = getDatabase();
      db.prepare('UPDATE portfolios SET spend_threshold_cents = ? WHERE id = ?').run(100000, portfolio.id);

      // 2. Create property in portfolio
      const prop = PropertiesRepository.createProperty({
        name: 'Industrial Park Unit B',
        property_type: 'commercial',
        portfolio_id: portfolio.id,
        address_line1: '900 Industrial Way',
        city: 'Bellevue',
        state: 'WA',
        postal_code: '98004'
      });

      // 3. Create work order under the threshold ($800) -> should be 'open'
      const woUnder = MaintenanceRepository.createWorkOrder({
        property_id: prop.id,
        title: 'Minor Lighting Replacement',
        description: 'Replace standard warehouse fluorescent tubes with LEDs',
        category: 'electrical',
        priority: 'low',
        estimated_cost_cents: 80000
      });
      assert.equal(woUnder.status, 'open');
      assert.equal(woUnder.hold_reason, null);

      // 4. Create work order exceeding the threshold ($1,500 > $1,000) -> should be 'on_hold'
      const woOver = MaintenanceRepository.createWorkOrder({
        property_id: prop.id,
        title: 'Main HVAC Compressor Overhaul',
        description: 'Complete replacement of 5-ton rooftop unit',
        category: 'hvac',
        priority: 'high',
        estimated_cost_cents: 150000
      });
      assert.equal(woOver.status, 'on_hold');
      assert.ok(woOver.hold_reason);
      assert.ok(woOver.hold_reason.includes('permissible spend threshold of $1000.00'));

      // 5. Updating an existing open work order with an estimated cost above the threshold puts it on hold
      const woUpdated = MaintenanceRepository.updateWorkOrder(woUnder.id, {
        estimated_cost_cents: 220000
      });
      assert.ok(woUpdated);
      assert.equal(woUpdated.status, 'on_hold');
      assert.ok(woUpdated.hold_reason?.includes('permissible spend threshold of $1000.00'));
    });
  });

  it('automatically places work order on hold when estimated cost exceeds available portfolio operating funds', () => {
    runInOperatorContext('op-wo-adv-3', () => {
      const db = getDatabase();
      const portfolio = PropertiesRepository.createPortfolio({
        name: 'Cascade Residential Portfolio'
      });

      const client = ContactsRepository.createContact({
        contact_type: 'owner',
        first_name: 'Genevieve',
        last_name: 'Sterling',
        email: 'genevieve@sterlingholdings.test'
      });

      // Ensure default accounts exist for this operator
      ChartOfAccountsRepository.ensureDefaultAccounts();
      const bankAcct = ChartOfAccountsRepository.getAccountByAccountNumber('1010')!;

      // Record $500.00 available funds via capital contribution
      const now = Date.now();
      db.prepare(`
        INSERT INTO client_capital_contributions (id, operator_id, portfolio_id, client_contact_id, destination_account_id, amount_cents, contribution_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('contrib-adv-1', 'op-wo-adv-3', portfolio.id, client.id, bankAcct.id, 50000, now, now, now);

      const prop = PropertiesRepository.createProperty({
        name: 'Cascade View Apartments',
        property_type: 'multi_family',
        portfolio_id: portfolio.id,
        address_line1: '123 Cascade St',
        city: 'Tacoma',
        state: 'WA',
        postal_code: '98402'
      });

      // 1. Work order for $300 (< $500 available funds) -> open
      const woPass = MaintenanceRepository.createWorkOrder({
        property_id: prop.id,
        title: 'Hallway Light Fixture Replacement',
        description: 'LED retrofit in corridor',
        category: 'electrical',
        priority: 'low',
        estimated_cost_cents: 30000
      });
      assert.equal(woPass.status, 'open');
      assert.equal(woPass.hold_reason, null);

      // 2. Work order for $800 (> $500 available funds) -> on_hold
      const woHold = MaintenanceRepository.createWorkOrder({
        property_id: prop.id,
        title: 'Boiler Pipe Pressure Relief Valve',
        description: 'Valve failure causing hot water leakage',
        category: 'plumbing',
        priority: 'high',
        estimated_cost_cents: 80000
      });
      assert.equal(woHold.status, 'on_hold');
      assert.ok(woHold.hold_reason);
      assert.ok(woHold.hold_reason.includes('exceeds available portfolio operating funds ($500.00)'));
    });
  });
});
