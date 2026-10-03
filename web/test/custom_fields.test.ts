import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../test/helpers.js';
import { closeDatabase } from '../../database/client.js';
import { CustomFieldsService } from '../../core/custom-fields.js';
import { renderCustomFieldsSSR } from '../templates/custom-fields.js';

describe('Custom Fields Subsystem - Dynamic Metadata & SSR Presentation', () => {
  beforeEach(() => {
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('creates sections and field definitions with strict entity isolation', () => {
    runInOperatorContext('custom-fields-op-1', () => {
      // 1. Create a section for property
      const section = CustomFieldsService.createSection({
        entity_type: 'property',
        title: 'Utility & Energy Metadata',
        sort_order: 1
      });
      assert.equal(section.title, 'Utility & Energy Metadata');
      assert.equal(section.entity_type, 'property');

      // 2. Define custom fields
      const meterField = CustomFieldsService.createDefinition({
        entity_type: 'property',
        section_id: section.id,
        field_name: 'electric_meter_id',
        field_label: 'Electric Meter Number',
        data_type: 'string',
        is_required: true
      });
      assert.equal(meterField.field_name, 'electric_meter_id');
      assert.equal(meterField.is_required, 1);

      const solarField = CustomFieldsService.createDefinition({
        entity_type: 'property',
        section_id: section.id,
        field_name: 'has_solar_panels',
        field_label: 'Solar System Installed',
        data_type: 'boolean',
        is_required: false,
        default_value: '0'
      });
      assert.equal(solarField.data_type, 'boolean');

      const tariffField = CustomFieldsService.createDefinition({
        entity_type: 'property',
        section_id: section.id,
        field_name: 'energy_tariff_plan',
        field_label: 'Energy Tariff Tier',
        data_type: 'select',
        options: ['Tier 1 Standard', 'Tier 2 Time-of-Use', 'Green Energy 100%']
      });
      assert.equal(tariffField.options ? tariffField.options.length : 0, 3);

      // Verify list Definitions
      const defs = CustomFieldsService.listDefinitions('property');
      assert.equal(defs.length, 3);
      assert.equal(defs[0]?.section_title, 'Utility & Energy Metadata');
    });
  });

  it('validates and formats custom field values according to declared data types', () => {
    runInOperatorContext('custom-fields-op-1', () => {
      CustomFieldsService.createDefinition({
        entity_type: 'unit',
        field_name: 'hvac_filter_size',
        field_label: 'HVAC Filter Dimensions',
        data_type: 'string',
        is_required: true
      });

      CustomFieldsService.createDefinition({
        entity_type: 'unit',
        field_name: 'utility_fee_cents',
        field_label: 'Monthly Utility Surcharge',
        data_type: 'currency',
        is_required: false
      });

      // Valid inputs
      const validCheck = CustomFieldsService.validateAndFormatCustomFields('unit', {
        hvac_filter_size: '20x25x1',
        utility_fee_cents: '45.50'
      });
      assert.equal(validCheck.valid, true);
      assert.equal(validCheck.errors.length, 0);
      assert.equal(validCheck.formatted['hvac_filter_size'], '20x25x1');
      assert.equal(validCheck.formatted['utility_fee_cents'], 4550);

      // Missing required field
      const missingRequired = CustomFieldsService.validateAndFormatCustomFields('unit', {
        utility_fee_cents: '25.00'
      });
      assert.equal(missingRequired.valid, false);
      assert.ok(missingRequired.errors.some((e) => e.includes('HVAC Filter Dimensions') && e.includes('is required')));
    });
  });

  it('renders custom fields SSR component into semantic HTML cards with typed inputs', () => {
    runInOperatorContext('custom-fields-op-1', () => {
      const section = CustomFieldsService.createSection({
        entity_type: 'lease',
        title: 'Move-in Concessions',
        sort_order: 1
      });

      CustomFieldsService.createDefinition({
        entity_type: 'lease',
        section_id: section.id,
        field_name: 'concession_months',
        field_label: 'Free Months Granted',
        data_type: 'number'
      });

      const renderedHtml = renderCustomFieldsSSR('lease', { concession_months: 2 }, { disabled: false }).toString();

      assert.ok(renderedHtml.includes('Move-in Concessions'));
      assert.ok(renderedHtml.includes('Free Months Granted'));
      assert.ok(renderedHtml.includes('type="number"'));
      assert.ok(renderedHtml.includes('value="2"'));
      assert.ok(renderedHtml.includes('name="cf_concession_months"'));
    });
  });
});
