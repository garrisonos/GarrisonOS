import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../helpers.js';
import { generateUUIDv7 } from '../../core/crypto.js';
import { EntityPreviewService } from '../../api/preview.js';
import { PropertiesRepository } from '../../modules/properties/backend/repository.js';
import { MaintenanceRepository } from '../../modules/maintenance/backend/repository.js';

describe('EntityPreviewService & Modal Preview System', () => {
  beforeEach(() => {
    createTestDb();
  });

  it('resolves property entity preview with summary and fullUrl', () => {
    const operatorA = generateUUIDv7();
    runInOperatorContext(operatorA, () => {
      const prop = PropertiesRepository.createProperty({
        name: 'Oakwood Manor',
        property_type: 'multi_family',
        address_line1: '123 Oak St',
        city: 'Asheville',
        state: 'NC',
        postal_code: '28801'
      });

      const preview = EntityPreviewService.getPreview(prop.id);
      assert.ok(preview);
      assert.equal(preview.entityType, 'property');
      assert.equal(preview.title, 'Oakwood Manor');
      assert.equal(preview.badge, 'MULTI FAMILY');
      assert.equal(preview.fullUrl, `/properties/show?id=${prop.id}`);
      assert.ok(preview.summary.some((s) => s.label === 'Address' && s.value.includes('Asheville')));
    });
  });

  it('resolves unit entity preview with rent and status', () => {
    const operatorA = generateUUIDv7();
    runInOperatorContext(operatorA, () => {
      const prop = PropertiesRepository.createProperty({
        name: 'Highland Condos',
        property_type: 'condo',
        address_line1: '456 Ridge Rd',
        city: 'Boone',
        state: 'NC',
        postal_code: '28607'
      });

      const unit = PropertiesRepository.createUnit({
        property_id: prop.id,
        unit_number: '3B',
        bedrooms: 2,
        bathrooms: 2,
        market_rent_cents: 185000,
        status: 'vacant'
      });

      const preview = EntityPreviewService.getPreview(unit.id);
      assert.ok(preview);
      assert.equal(preview.entityType, 'unit');
      assert.ok(preview.title.includes('Unit 3B'));
      assert.equal(preview.badge, 'VACANT');
      assert.equal(preview.fullUrl, `/properties/show?id=${prop.id}`);
      assert.ok(preview.summary.some((s) => s.label === 'Market Rent' && s.value.includes('$1,850.00')));
    });
  });

  it('resolves work order entity preview with WO-entropy title', () => {
    const operatorA = generateUUIDv7();
    runInOperatorContext(operatorA, () => {
      const prop = PropertiesRepository.createProperty({
        name: 'Valley Heights',
        property_type: 'single_family',
        address_line1: '789 Valley St',
        city: 'Canton',
        state: 'NC',
        postal_code: '28716'
      });

      const wo = MaintenanceRepository.createWorkOrder({
        property_id: prop.id,
        title: 'AC Condenser Fan Replacement',
        description: 'Compressor fan is humming loudly and failing to spin.',
        priority: 'high',
        category: 'hvac'
      });

      const preview = EntityPreviewService.getPreview(wo.id);
      assert.ok(preview);
      assert.equal(preview.entityType, 'work_order');
      assert.ok(preview.title.includes('WO-'));
      assert.equal(preview.badge, 'OPEN • HIGH');
      assert.equal(preview.fullUrl, `/maintenance/show?id=${wo.id}`);
      assert.ok(preview.summary.some((s) => s.label === 'Category' && s.value === 'HVAC'));
    });
  });

  it('enforces operator isolation: operator B cannot preview operator A entities', () => {
    const operatorA = generateUUIDv7();
    const operatorB = generateUUIDv7();

    let propIdA = '';
    runInOperatorContext(operatorA, () => {
      const prop = PropertiesRepository.createProperty({
        name: 'Operator A Secret Estate',
        property_type: 'single_family',
        address_line1: '100 Private Way',
        city: 'Charlotte',
        state: 'NC',
        postal_code: '28202'
      });
      propIdA = prop.id;
    });

    runInOperatorContext(operatorB, () => {
      const preview = EntityPreviewService.getPreview(propIdA);
      assert.equal(preview, null);
    });
  });

  it('returns null on invalid or non-existent entity IDs', () => {
    const operatorA = generateUUIDv7();
    runInOperatorContext(operatorA, () => {
      assert.equal(EntityPreviewService.getPreview(''), null);
      assert.equal(EntityPreviewService.getPreview(generateUUIDv7()), null);
    });
  });
});
