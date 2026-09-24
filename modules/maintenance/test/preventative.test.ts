import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../../../database/client.js';
import { runMigrations } from '../../../database/migrator.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { MaintenanceRepository } from '../backend/repository.js';

describe('Preventative Maintenance Scheduling Engine Suite', () => {
  let db: any;
  const operatorA = generateUUIDv7();
  const operatorB = generateUUIDv7();
  const propertyA = generateUUIDv7();
  const propertyB = generateUUIDv7();
  const vendorContactA = generateUUIDv7();

  before(() => {
    db = getDatabase({ inMemory: true });
    runMigrations(db);

    const now = Date.now();
    db.prepare(`
      INSERT INTO operators (id, name, created_at, updated_at)
      VALUES (?, 'Operator A', ?, ?), (?, 'Operator B', ?, ?)
    `).run(operatorA, now, now, operatorB, now, now);

    db.prepare(`
      INSERT INTO properties (id, operator_id, name, address_line1, city, state, postal_code, property_type, created_at, updated_at)
      VALUES (?, ?, 'Highland Oaks', '100 Main St', 'Raleigh', 'NC', '27601', 'multi_family', ?, ?),
             (?, ?, 'Pine Grove', '200 Oak St', 'Raleigh', 'NC', '27601', 'multi_family', ?, ?)
    `).run(propertyA, operatorA, now, now, propertyB, operatorB, now, now);

    db.prepare(`
      INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, email, created_at, updated_at)
      VALUES (?, ?, 'vendor', 'Frank', 'HVAC Specialist', 'hvac@test.local', ?, ?)
    `).run(vendorContactA, operatorA, now, now);
  });

  after(() => {
    closeDatabase();
  });

  it('creates and retrieves a preventative maintenance schedule', () => {
    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr' }, () => {
      const schedule = MaintenanceRepository.createPreventativeSchedule({
        property_id: propertyA,
        title: 'Quarterly HVAC Filter & Coil Inspection',
        description: 'Replace standard air filters and clean condenser coils.',
        category: 'hvac',
        priority: 'medium',
        frequency: 'quarterly',
        lead_days: 7,
        assigned_vendor_contact_id: vendorContactA,
        estimated_cost_cents: 12500,
        next_due_date: Date.now() + 86400000 * 30
      });

      assert.ok(schedule.id);
      assert.equal(schedule.operator_id, operatorA);
      assert.equal(schedule.category, 'hvac');
      assert.equal(schedule.frequency, 'quarterly');
      assert.equal(schedule.lead_days, 7);
      assert.equal(schedule.property_name, 'Highland Oaks');
      assert.equal(schedule.vendor_name, 'Frank HVAC Specialist');

      const fetched = MaintenanceRepository.getPreventativeSchedule(schedule.id);
      assert.ok(fetched);
      assert.equal(fetched.title, 'Quarterly HVAC Filter & Coil Inspection');
    });
  });

  it('enforces multi-operator isolation on preventative schedules', () => {
    let scheduleAId = '';
    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr' }, () => {
      const schedule = MaintenanceRepository.createPreventativeSchedule({
        property_id: propertyA,
        title: 'Roof Winterization & Gutter Cleaning',
        description: 'Clean fall foliage from all roof gutters.',
        category: 'roofing',
        priority: 'high',
        frequency: 'seasonal',
        seasonal_month: 11,
        lead_days: 14,
        next_due_date: Date.now() + 86400000 * 60
      });
      scheduleAId = schedule.id;
    });

    RequestContext.run({ operatorId: operatorB, correlationId: 'test-corr' }, () => {
      const scheduleB = MaintenanceRepository.getPreventativeSchedule(scheduleAId);
      assert.equal(scheduleB, null, 'Operator B cannot access Operator A preventative schedule');

      const listB = MaintenanceRepository.listPreventativeSchedules();
      assert.equal(listB.length, 0, 'Operator B list must return 0 schedules');
    });
  });

  it('triggers immediate work order generation and advances next due date', () => {
    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr' }, () => {
      const initialDue = Date.now() + 86400000 * 10;
      const schedule = MaintenanceRepository.createPreventativeSchedule({
        property_id: propertyA,
        title: 'Annual Fire Alarm & Extinguisher Inspection',
        description: 'Certify fire extinguishers and test pull stations.',
        category: 'fire_safety',
        priority: 'high',
        frequency: 'annually',
        lead_days: 14,
        next_due_date: initialDue
      });

      const workOrder = MaintenanceRepository.triggerPreventativeSchedule(schedule.id);
      assert.ok(workOrder.id);
      assert.equal(workOrder.title, '[PM] Annual Fire Alarm & Extinguisher Inspection');
      assert.equal(workOrder.status, 'open');
      assert.equal(workOrder.priority, 'high');

      // Verify schedule was updated with advanced next_due_date and last_generated_at
      const updatedSchedule = MaintenanceRepository.getPreventativeSchedule(schedule.id);
      assert.ok(updatedSchedule);
      assert.ok(updatedSchedule.last_generated_at);
      assert.ok(updatedSchedule.next_due_date > initialDue, 'Next due date must be advanced into future');
    });
  });

  it('runs batch preventative maintenance check for due schedules', () => {
    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr' }, () => {
      // Schedule due tomorrow with 7 lead days (so it is currently within threshold)
      const dueSchedule = MaintenanceRepository.createPreventativeSchedule({
        property_id: propertyA,
        title: 'Immediate Due Schedule',
        description: 'Task is due immediately.',
        category: 'plumbing',
        priority: 'emergency',
        frequency: 'monthly',
        lead_days: 7,
        next_due_date: Date.now() + 86400000 // 1 day in future, within 7 lead days
      });

      const generated = MaintenanceRepository.runPreventativeMaintenanceCheck();
      const match = generated.find((wo) => wo.title.includes('Immediate Due Schedule'));
      assert.ok(match, 'Must generate work order for schedule within lead day threshold');
    });
  });

  it('rejects cross-operator vendor contact or property IDOR', () => {
    RequestContext.run({ operatorId: operatorB, correlationId: 'test-corr' }, () => {
      // Operator B trying to reference Operator A's property or vendor
      assert.throws(() => {
        MaintenanceRepository.createPreventativeSchedule({
          property_id: propertyA, // belongs to Operator A
          title: 'Malicious Schedule',
          description: 'Accessing Operator A property',
          category: 'general',
          priority: 'low',
          frequency: 'monthly',
          next_due_date: Date.now() + 86400000
        });
      }, /not found or does not belong to the active operator/);

      assert.throws(() => {
        MaintenanceRepository.createPreventativeSchedule({
          property_id: propertyB,
          assigned_vendor_contact_id: vendorContactA, // belongs to Operator A
          title: 'Malicious Vendor Schedule',
          description: 'Accessing Operator A vendor',
          category: 'general',
          priority: 'low',
          frequency: 'monthly',
          next_due_date: Date.now() + 86400000
        });
      }, /not found or does not belong to the active operator/);
    });
  });

  it('correctly clamps month-end date rollovers and computes seasonal frequency', () => {
    // Jan 31 + 1 month should clamp to Feb 28 or 29
    const jan31 = new Date(2025, 0, 31).getTime();
    const nextMonth = MaintenanceRepository.computeNextDueDate(jan31, 'monthly');
    const dMonth = new Date(nextMonth);
    assert.equal(dMonth.getMonth(), 1, 'Should roll to February (month index 1)');
    assert.equal(dMonth.getDate(), 28, 'Should clamp to Feb 28 in non-leap year');

    // Seasonal month test
    const nextSeasonal = MaintenanceRepository.computeNextDueDate(jan31, 'seasonal', 10); // target October
    const dSeason = new Date(nextSeasonal);
    assert.equal(dSeason.getMonth(), 9, 'Should target October (month index 9)');
  });

  it('strictly requires property_id on creation and prevents clearing on update', () => {
    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr' }, () => {
      assert.throws(() => {
        MaintenanceRepository.createPreventativeSchedule({
          property_id: '',
          title: 'Schedule Without Property',
          description: 'No property attached',
          category: 'general',
          priority: 'low',
          frequency: 'monthly',
          next_due_date: Date.now() + 86400000
        });
      }, /Field "property_id" is required/);

      const created = MaintenanceRepository.createPreventativeSchedule({
        property_id: propertyA,
        title: 'Schedule With Property',
        description: 'Property attached',
        category: 'general',
        priority: 'low',
        frequency: 'monthly',
        next_due_date: Date.now() + 86400000
      });

      assert.throws(() => {
        MaintenanceRepository.updatePreventativeSchedule(created.id, {
          property_id: ''
        });
      }, /Field "property_id" cannot be cleared/);
    });
  });
});
