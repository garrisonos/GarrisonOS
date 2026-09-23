import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../database/client.js';
import { seedDatabase } from '../database/seed.js';
import { runInOperatorContext } from './helpers.js';
import { AccountingRepository } from '../modules/accounting/backend/repository.js';

describe('Seed Dataset Verification & Integrity (50-Unit Portfolio)', () => {
  let db: any;
  const operatorId = 'operator-demo';

  before(async () => {
    db = getDatabase({ inMemory: true });
    await seedDatabase(db);
  });

  after(() => {
    closeDatabase();
  });

  it('populates operator, branding, user, and 3 portfolios', () => {
    const operator = db.prepare('SELECT * FROM operators WHERE id = ?').get(operatorId) as any;
    assert.ok(operator);
    assert.equal(operator.name, 'Garrison Heritage Properties');

    const branding = db.prepare('SELECT * FROM operator_branding WHERE operator_id = ?').get(operatorId) as any;
    assert.ok(branding);
    assert.equal(branding.brand_name, 'Garrison Heritage Properties');
    assert.equal(branding.theme_preset, 'classic_blue');

    const user = db.prepare('SELECT * FROM users WHERE operator_id = ?').get(operatorId) as any;
    assert.ok(user);
    assert.equal(user.email, 'operator@garrisonos.local');
    assert.equal(user.role, 'owner');

    const portfolios = db.prepare('SELECT * FROM portfolios WHERE operator_id = ?').all(operatorId);
    assert.equal(portfolios.length, 3, 'Must seed 3 portfolios (Blue Ridge, Piedmont, Downtown Lofts)');
  });

  it('populates 50 total rentable units representing all 4 unit statuses', () => {
    const units = db.prepare('SELECT * FROM units WHERE operator_id = ?').all(operatorId) as any[];
    assert.equal(units.length, 50, 'Must seed exactly 50 rentable units');

    const statuses = units.map(u => u.status);
    const occupiedCount = statuses.filter(s => s === 'occupied').length;
    const vacantCount = statuses.filter(s => s === 'vacant').length;
    const turnoverCount = statuses.filter(s => s === 'turnover').length;
    const holdCount = statuses.filter(s => s === 'maintenance_hold').length;

    assert.equal(occupiedCount, 42, 'Must seed 42 occupied units');
    assert.equal(vacantCount, 4, 'Must seed 4 vacant units');
    assert.equal(turnoverCount, 2, 'Must seed 2 turnover units (Broadview 201 & Lofts 304)');
    assert.equal(holdCount, 2, 'Must seed 2 maintenance hold units (Sycamore & Riverbend 106)');
  });

  it('populates 7 vendors with trades, W-9 statuses, and tax classifications', () => {
    const vendors = db.prepare('SELECT * FROM contacts WHERE operator_id = ? AND contact_type = ?').all(operatorId, 'vendor') as any[];
    assert.equal(vendors.length, 7);

    const w9Verified = vendors.filter(v => v.w9_received === 1);
    const w9Pending = vendors.filter(v => v.w9_received === 0);

    assert.equal(w9Verified.length, 6, 'Must seed 6 verified W-9 vendors');
    assert.equal(w9Pending.length, 1, 'Must seed 1 pending W-9 vendor to demonstrate unverified state');
    assert.equal(w9Pending[0].company_name, 'Blue Ridge Pro Painters');

    const apex = vendors.find(v => v.company_name === 'Apex Plumbing Services');
    assert.ok(apex);
    assert.equal(apex.tax_classification, 'llc');
    assert.equal(apex.vendor_specialty, 'Plumbing');
  });

  it('persists historical terminated leases with notice_date and move_out_date', () => {
    const terminatedLeases = db.prepare(`
      SELECT l.*, u.unit_number
      FROM leases l
      JOIN units u ON l.unit_id = u.id
      WHERE l.operator_id = ? AND l.status = 'terminated'
      ORDER BY l.created_at ASC
    `).all(operatorId) as any[];

    assert.equal(terminatedLeases.length, 2, 'Must seed 2 terminated leases for turnover units');
    for (const lease of terminatedLeases) {
      assert.ok(lease.notice_date, 'notice_date must be populated');
      assert.ok(lease.move_out_date, 'move_out_date must be populated');
      assert.ok(lease.notice_date < lease.move_out_date, 'notice_date must precede move_out_date');
    }
  });

  it('populates recurring lease charges, preventative schedules, and conversations', () => {
    const recurringCharges = db.prepare('SELECT * FROM recurring_lease_charges WHERE operator_id = ?').all(operatorId);
    assert.ok(recurringCharges.length >= 4, 'Must seed itemized recurring charges');

    const schedules = db.prepare('SELECT * FROM preventative_maintenance_schedules WHERE operator_id = ?').all(operatorId);
    assert.ok(schedules.length >= 3, 'Must seed preventative maintenance schedules');

    const conversations = db.prepare('SELECT * FROM conversations WHERE operator_id = ?').all(operatorId);
    assert.ok(conversations.length >= 2, 'Must seed universal conversation threads');

    const contributions = db.prepare('SELECT * FROM client_capital_contributions WHERE operator_id = ?').all(operatorId);
    assert.ok(contributions.length >= 2, 'Must seed client capital contributions');

    const distributions = db.prepare('SELECT * FROM client_distributions WHERE operator_id = ?').all(operatorId);
    assert.ok(distributions.length >= 2, 'Must seed owner distributions');
  });

  it('populates 8 diverse work orders across categories, priorities, and statuses', () => {
    const workOrders = db.prepare('SELECT * FROM work_orders WHERE operator_id = ?').all(operatorId) as any[];
    assert.equal(workOrders.length, 8);

    const statuses = new Set(workOrders.map(w => w.status));
    assert.ok(statuses.has('open'));
    assert.ok(statuses.has('assigned'));
    assert.ok(statuses.has('in_progress'));
    assert.ok(statuses.has('completed'));
    assert.ok(statuses.has('cancelled'));

    const priorities = new Set(workOrders.map(w => w.priority));
    assert.ok(priorities.has('emergency'));
    assert.ok(priorities.has('high'));
    assert.ok(priorities.has('medium'));
    assert.ok(priorities.has('low'));
  });

  it('aggregates annual 1099-NEC vendor report correctly from seeded operating expenses', () => {
    runInOperatorContext(operatorId, () => {
      const report = AccountingRepository.getVendor1099Report(2026);
      assert.ok(report);
      assert.equal(report.tax_year, 2026);
      assert.equal(report.threshold_cents, 200000); // $2,000 threshold for 2026

      const qualifying = report.vendors.filter(v => v.threshold_met);
      assert.equal(qualifying.length, 2, 'Two vendors should qualify for 1099-NEC: Apex and Hawkins');

      const apexRecord = qualifying.find(v => v.company_name === 'Apex Plumbing Services');
      assert.ok(apexRecord);
      assert.equal(apexRecord.total_payments_cents, 232000); // $2,320.00 >= $2,000.00
      assert.equal(apexRecord.tax_id_last4, '4401');

      const hawkinsRecord = qualifying.find(v => v.company_name === 'Hawkins General Repair');
      assert.ok(hawkinsRecord);
      assert.equal(hawkinsRecord.total_payments_cents, 215000); // $2,150.00 >= $2,000.00
      assert.equal(hawkinsRecord.tax_id_last4, '4404');
    });
  });

  it('re-seeding is idempotent without primary key or foreign key collisions', async () => {
    await seedDatabase(db);
    const unitCount = db.prepare('SELECT COUNT(*) as cnt FROM units WHERE operator_id = ?').get(operatorId) as any;
    assert.equal(unitCount.cnt, 50, 'Must remain exactly 50 units after idempotent re-seed');
  });
});
