import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from './helpers.js';
import { CustomFieldsService } from '../core/custom-fields.js';
import { PropertiesRepository } from '../modules/properties/backend/repository.js';
import { ContactsRepository } from '../modules/contacts/backend/repository.js';
import { closeDatabase, getDatabase } from '../database/client.js';

describe('Core - Dynamic Custom Fields Engine', () => {
  before(() => {
    getDatabase({ inMemory: true });
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('manages custom field definitions CRUD and enforces constraints', () => {
    runInOperatorContext('op-custom-fields-1', () => {
      // 1. Create definitions across types
      const textDef = CustomFieldsService.createDefinition({
        entity_type: 'property',
        field_name: 'hoa_contact',
        field_label: 'HOA Contact Person',
        data_type: 'string',
        is_required: false
      });
      assert.ok(textDef.id);
      assert.equal(textDef.field_name, 'hoa_contact');
      assert.equal(textDef.data_type, 'string');

      const numDef = CustomFieldsService.createDefinition({
        entity_type: 'unit',
        field_name: 'ceiling_height_feet',
        field_label: 'Ceiling Height (ft)',
        data_type: 'number',
        is_required: true
      });
      assert.ok(numDef.id);
      assert.equal(numDef.is_required, 1);

      const dateDef = CustomFieldsService.createDefinition({
        entity_type: 'property',
        field_name: 'roof_replacement_date',
        field_label: 'Last Roof Replacement Date',
        data_type: 'date',
        is_required: false
      });
      assert.ok(dateDef.id);
      assert.equal(dateDef.data_type, 'date');

      const selectDef = CustomFieldsService.createDefinition({
        entity_type: 'property',
        field_name: 'waste_collection_day',
        field_label: 'Trash Collection Day',
        data_type: 'select',
        options: ['Monday', 'Wednesday', 'Friday']
      });
      assert.ok(selectDef.id);
      assert.equal(selectDef.data_type, 'select');
      assert.deepEqual(JSON.parse(selectDef.options_json!), ['Monday', 'Wednesday', 'Friday']);

      // 2. Reject select without options
      assert.throws(() => {
        CustomFieldsService.createDefinition({
          entity_type: 'property',
          field_name: 'bad_select',
          field_label: 'Bad Select',
          data_type: 'select'
        });
      }, /options array is required/);

      // 3. Reject duplicate field_name for same entity_type
      assert.throws(() => {
        CustomFieldsService.createDefinition({
          entity_type: 'property',
          field_name: 'hoa_contact',
          field_label: 'Duplicate HOA Contact',
          data_type: 'string'
        });
      }, /already exists/);

      // 4. List definitions filtered by entity_type
      const propDefs = CustomFieldsService.listDefinitions('property');
      assert.equal(propDefs.length, 3);
      const unitDefs = CustomFieldsService.listDefinitions('unit');
      assert.equal(unitDefs.length, 1);

      // 5. Update definition
      const updated = CustomFieldsService.updateDefinition(textDef.id, {
        field_label: 'HOA Representative',
        is_required: true
      });
      assert.ok(updated);
      assert.equal(updated?.field_label, 'HOA Representative');
      assert.equal(updated?.is_required, 1);

      // 6. Delete definition
      const deleted = CustomFieldsService.deleteDefinition(numDef.id);
      assert.equal(deleted, true);
      assert.equal(CustomFieldsService.getDefinitionById(numDef.id), null);
    });
  });

  it('validates and formats custom field values across all types', () => {
    runInOperatorContext('op-validation-test', () => {
      CustomFieldsService.createDefinition({
        entity_type: 'contact',
        field_name: 'vip_status',
        field_label: 'VIP Status',
        data_type: 'boolean'
      });

      CustomFieldsService.createDefinition({
        entity_type: 'contact',
        field_name: 'inspection_date',
        field_label: 'Inspection Date',
        data_type: 'date'
      });

      CustomFieldsService.createDefinition({
        entity_type: 'contact',
        field_name: 'parking_tier',
        field_label: 'Parking Tier',
        data_type: 'select',
        options: ['Bronze', 'Silver', 'Gold']
      });

      CustomFieldsService.createDefinition({
        entity_type: 'contact',
        field_name: 'years_experience',
        field_label: 'Years of Experience',
        data_type: 'number'
      });

      // 1. Valid inputs
      const validated = CustomFieldsService.validateAndFormat('contact', {
        vip_status: true,
        inspection_date: '2026-10-15',
        parking_tier: 'Silver',
        years_experience: 5
      });
      assert.equal(validated.valid, true);
      assert.equal(validated.formatted['vip_status'], true);
      assert.equal(validated.formatted['inspection_date'], '2026-10-15');
      assert.equal(validated.formatted['parking_tier'], 'Silver');
      assert.equal(validated.formatted['years_experience'], 5);

      // 2. Strict Date format: rejects non-ISO format
      const nonIso = CustomFieldsService.validateAndFormat('contact', {
        inspection_date: '10/15/2026'
      });
      assert.equal(nonIso.valid, false);
      assert.ok(nonIso.errors.some((e) => /YYYY-MM-DD/.test(e)));

      // 3. Strict Date format: rejects invalid calendar date
      const invalidCal = CustomFieldsService.validateAndFormat('contact', {
        inspection_date: '2026-02-31'
      });
      assert.equal(invalidCal.valid, false);
      assert.ok(invalidCal.errors.some((e) => /YYYY-MM-DD/.test(e)));

      // 4. Strict Date format: rejects non-leap year Feb 29
      const nonLeap = CustomFieldsService.validateAndFormat('contact', {
        inspection_date: '2025-02-29'
      });
      assert.equal(nonLeap.valid, false);
      assert.ok(nonLeap.errors.some((e) => /YYYY-MM-DD/.test(e)));

      // 5. Strict Date format: accepts leap year Feb 29
      const leapValid = CustomFieldsService.validateAndFormat('contact', {
        inspection_date: '2024-02-29'
      });
      assert.equal(leapValid.valid, true);
      assert.equal(leapValid.formatted['inspection_date'], '2024-02-29');

      // 6. Select validation: rejects invalid option
      const badSelect = CustomFieldsService.validateAndFormat('contact', {
        parking_tier: 'Platinum'
      });
      assert.equal(badSelect.valid, false);
      assert.ok(badSelect.errors.some((e) => /is invalid/.test(e)));

      // 7. Number validation: rejects NaN
      const badNum = CustomFieldsService.validateAndFormat('contact', {
        years_experience: 'not-a-number' as any
      });
      assert.equal(badNum.valid, false);
      assert.ok(badNum.errors.some((e) => /must be a valid finite number/.test(e)));
    });
  });

  it('enforces required custom fields and handles entity updates', () => {
    runInOperatorContext('op-required-test', () => {
      CustomFieldsService.createDefinition({
        entity_type: 'property',
        field_name: 'asset_code',
        field_label: 'Asset Code',
        data_type: 'string',
        is_required: true
      });

      // 1. Validation fails if required field missing
      const missing = CustomFieldsService.validateAndFormat('property', {});
      assert.equal(missing.valid, false);
      assert.ok(missing.errors.some((e) => /is required/.test(e)));

      // 2. Validation fails if required field empty string
      const emptyStr = CustomFieldsService.validateAndFormat('property', { asset_code: '   ' });
      assert.equal(emptyStr.valid, false);
      assert.ok(emptyStr.errors.some((e) => /is required/.test(e)));

      // 3. Validation succeeds when provided
      const res = CustomFieldsService.validateAndFormat('property', { asset_code: 'PROP-999' });
      assert.equal(res.valid, true);
      assert.equal(res.formatted['asset_code'], 'PROP-999');

      // 4. Create property with custom fields
      const prop = PropertiesRepository.createProperty({
        name: 'Asset Alpha',
        property_type: 'multi_family',
        address_line1: '100 Main St',
        city: 'Dallas',
        state: 'TX',
        postal_code: '75001',
        custom_fields: res.formatted
      });
      assert.ok(prop.id);
      assert.deepEqual(JSON.parse(prop.custom_fields as string), { asset_code: 'PROP-999' });

      // 5. Update entity custom fields via updateEntityCustomFields
      const updateResult = CustomFieldsService.updateEntityCustomFields('property', prop.id, {
        asset_code: 'PROP-1000'
      });
      assert.deepEqual(updateResult.custom_fields, { asset_code: 'PROP-1000' });

      // 6. updateEntityCustomFields throws when required field is cleared/invalid
      assert.throws(() => {
        CustomFieldsService.updateEntityCustomFields('property', prop.id, {
          asset_code: ''
        });
      }, /is required/);

      const fetched = PropertiesRepository.getPropertyById(prop.id);
      assert.deepEqual(JSON.parse(fetched!.custom_fields as string), { asset_code: 'PROP-1000' });
    });
  });
});
