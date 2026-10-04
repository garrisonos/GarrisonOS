import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from './helpers.js';
import { CustomFieldsService } from '../core/custom-fields.js';
import { PropertiesRepository } from '../modules/properties/backend/repository.js';
import { ContactsRepository } from '../modules/contacts/backend/repository.js';
import { closeDatabase, getDatabase, withTransaction } from '../database/client.js';

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

      // 5b. Strict Date format: accepts valid ISO datetime
      const isoValid = CustomFieldsService.validateAndFormat('contact', {
        inspection_date: '2026-10-15T14:30:00Z'
      });
      assert.equal(isoValid.valid, true);
      assert.equal(isoValid.formatted['inspection_date'], '2026-10-15');

      // 5c. Strict Date format: rejects invalid calendar ISO datetime (e.g., Feb 31 rollover)
      const isoInvalidCal = CustomFieldsService.validateAndFormat('contact', {
        inspection_date: '2026-02-31T12:00:00Z'
      });
      assert.equal(isoInvalidCal.valid, false);
      assert.ok(isoInvalidCal.errors.some((e) => /YYYY-MM-DD/.test(e)));

      // 5d. Strict Date format: rejects non-leap Feb 29 ISO datetime
      const isoNonLeap = CustomFieldsService.validateAndFormat('contact', {
        inspection_date: '2025-02-29T12:00:00Z'
      });
      assert.equal(isoNonLeap.valid, false);
      assert.ok(isoNonLeap.errors.some((e) => /YYYY-MM-DD/.test(e)));

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

  describe('CustomFieldsService.prepareForWrite and Definition Retrieval', () => {
    it('retrieves definition by ID and returns null for non-existent ID', () => {
      runInOperatorContext('op-cf-get-by-id', () => {
        const def = CustomFieldsService.createDefinition({
          entity_type: 'contact',
          field_name: 'alt_id',
          field_label: 'Alt ID',
          data_type: 'string'
        });

        const found = CustomFieldsService.getDefinitionById(def.id);
        assert.ok(found);
        assert.equal(found.id, def.id);
        assert.equal(found.field_name, 'alt_id');

        const notFound = CustomFieldsService.getDefinitionById('018f0000-0000-7000-8000-000000000000');
        assert.equal(notFound, null);
      });
    });

    it('validates, formats, and merges custom fields with prepareForWrite', () => {
      runInOperatorContext('op-cf-prepare-write', () => {
        CustomFieldsService.createDefinition({
          entity_type: 'property',
          field_name: 'zone_code',
          field_label: 'Zone Code',
          data_type: 'string',
          is_required: true
        });

        // 1. Throws on create if required field is omitted
        assert.throws(() => {
          CustomFieldsService.prepareForWrite('property', {});
        }, /is required/);

        // 2. Throws on invalid JSON string
        assert.throws(() => {
          CustomFieldsService.prepareForWrite('property', '{bad-json');
        }, /must be a valid JSON object/);

        // 3. Throws on non-object / array
        assert.throws(() => {
          CustomFieldsService.prepareForWrite('property', [1, 2, 3]);
        }, /must be a JSON object/);

        // 4. Throws on null for update
        assert.throws(() => {
          CustomFieldsService.prepareForWrite('property', null, '{"zone_code":"Z-1"}');
        }, /cannot be null/);

        // 5. Merges existing fields on update
        const mergedJson = CustomFieldsService.prepareForWrite(
          'property',
          { extra_info: 'test' },
          '{"zone_code":"Z-1"}'
        );
        const parsed = JSON.parse(mergedJson);
        assert.equal(parsed.zone_code, 'Z-1');
        assert.equal(parsed.extra_info, 'test');

        // 6. Direct repository call enforces prepareForWrite
        assert.throws(() => {
          PropertiesRepository.createProperty({
            name: 'Invalid Direct Prop',
            property_type: 'single_family',
            address_line1: '123 Test St',
            city: 'Austin',
            state: 'TX',
            postal_code: '78701',
            custom_fields: {} // missing required zone_code!
          });
        }, /is required/);
      });
    });

    it('attaches statusCode 400 and VALIDATION_ERROR code to prepareForWrite errors', () => {
      runInOperatorContext('op-cf-status-code', () => {
        CustomFieldsService.createDefinition({
          entity_type: 'building',
          field_name: 'inspector_id',
          field_label: 'Inspector ID',
          data_type: 'string',
          is_required: true
        });

        try {
          CustomFieldsService.prepareForWrite('building', {});
          assert.fail('Expected prepareForWrite to throw');
        } catch (err: any) {
          assert.equal(err.code, 'VALIDATION_ERROR');
          assert.equal(err.statusCode, 400);
          assert.ok(Array.isArray(err.details));
        }
      });
    });

    it('ensures transactionDepth in withTransaction resets properly even if COMMIT fails', () => {
      const db = getDatabase();
      const originalExec = db.exec.bind(db);
      let caught = false;
      try {
        withTransaction((tx) => {
          tx.exec = (sql: string) => {
            if (typeof sql === 'string' && sql.includes('COMMIT')) {
              throw new Error('Simulated COMMIT failure');
            }
            return originalExec(sql);
          };
        });
      } catch (err: any) {
        caught = true;
        assert.equal(err.message, 'Simulated COMMIT failure');
      } finally {
        db.exec = originalExec;
      }
      assert.ok(caught);

      // Verify that subsequent transactions still work as top-level transactions
      const res = withTransaction(() => {
        return 42;
      });
      assert.equal(res, 42);
    });
  });
});
