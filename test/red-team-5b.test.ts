import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from './helpers.js';
import { closeDatabase, getDatabase } from '../database/client.js';
import { parseOrderByClause, validateTemporalParams } from '../api/query-parser.js';
import { PropertiesRepository } from '../modules/properties/backend/repository.js';
import { CustomFieldsService } from '../core/custom-fields.js';
import { executeBulkIngestion } from '../api/bulk.js';

describe('Red Team Security & Invariant Audit - Batch 5B', () => {
  before(() => {
    getDatabase({ inMemory: true });
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  describe('1. Cross-Operator Isolation / BOLA / IDOR Verification', () => {
    it('prevents Operator B from accessing, modifying, or linking Operator A amenities', () => {
      let opAAmenityId = '';
      let opAPropertyId = '';

      // Operator A creates resources
      runInOperatorContext('attacker-target-op-a', () => {
        const amenity = PropertiesRepository.createAmenity({
          name: 'Target VIP Pool',
          category: 'community'
        });
        opAAmenityId = amenity.id;

        const property = PropertiesRepository.createProperty({
          name: 'Target Fortress Estates',
          property_type: 'multi_family',
          address_line1: '1 Protected Rd',
          city: 'Fortress',
          state: 'TX',
          postal_code: '75001'
        });
        opAPropertyId = property.id;
      });

      // Operator B (Attacker) attempts IDOR
      runInOperatorContext('attacker-rogue-op-b', () => {
        // 1. Direct ID lookup returns null
        const amenityAccess = PropertiesRepository.getAmenityById(opAAmenityId);
        assert.equal(amenityAccess, null);

        const propertyAccess = PropertiesRepository.getPropertyById(opAPropertyId);
        assert.equal(propertyAccess, null);

        // 2. Direct mutation attempt returns null (fail-closed)
        const updateAttempt = PropertiesRepository.updateAmenity(opAAmenityId, {
          name: 'Compromised Amenity'
        });
        assert.equal(updateAttempt, null);

        // 3. Deletion attempt returns false
        const deleteAttempt = PropertiesRepository.deleteAmenity(opAAmenityId);
        assert.equal(deleteAttempt, false);

        // 4. Create property in Op B context and attempt to associate Op A's amenity
        const rogueProperty = PropertiesRepository.createProperty({
          name: 'Rogue Property',
          property_type: 'single_family',
          address_line1: '2 Rogue St',
          city: 'Rogue',
          state: 'TX',
          postal_code: '75002'
        });

        // Association with another operator's amenity must fail
        assert.throws(() => {
          PropertiesRepository.setPropertyAmenities(rogueProperty.id, [opAAmenityId]);
        }, /belong to another operator/);

        // 5. Attacker tries to update custom fields of Op A's property
        assert.throws(() => {
          CustomFieldsService.updateEntityCustomFields('property', opAPropertyId, {
            hacked: true
          });
        }, /not found/);
      });
    });
  });

  describe('2. SQL Injection Resistance in Order By Parsing', () => {
    const allowed = ['name', 'created_at', 'category', 'updated_at'];

    it('rejects classic and advanced SQL injection payloads in order_by', () => {
      const maliciousPayloads = [
        'name; DROP TABLE properties; --',
        'name ASC; SELECT * FROM users; --',
        'name, (SELECT CASE WHEN (1=1) THEN 1 ELSE 0 END)',
        'created_at DESC, SLEEP(5)',
        '1=1',
        "' OR '1'='1",
        'name union select 1,2,3',
        'name/**/asc',
        'name||category',
        'admin --',
        'name:asc; --'
      ];

      for (const payload of maliciousPayloads) {
        const result = parseOrderByClause(payload, allowed);
        assert.ok(
          result.error !== undefined,
          `Expected SQL injection payload to be rejected: "${payload}"`
        );
      }
    });

    it('strictly enforces allowed direction keywords to ASC and DESC only', () => {
      const invalidDirections = [
        'name:sideways',
        'name:ascending',
        'name:descending',
        'name:null',
        'name:true',
        'name:1'
      ];

      for (const item of invalidDirections) {
        const result = parseOrderByClause(item, allowed);
        assert.ok(result.error !== undefined, `Expected invalid direction to be rejected: "${item}"`);
      }
    });
  });

  describe('3. Transactional Integrity & Zero State Pollution on Failure', () => {
    it('guarantees 100% rollback when the final item in a bulk ingestion batch fails', () => {
      runInOperatorContext('op-redteam-rollback', () => {
        // Pre-create 1 property to ensure table has baseline record
        PropertiesRepository.createProperty({
          name: 'Baseline Property',
          property_type: 'multi_family',
          address_line1: '100 Base St',
          city: 'Austin',
          state: 'TX',
          postal_code: '78701'
        });

        const initialProperties = PropertiesRepository.listProperties().length;
        assert.equal(initialProperties, 1);

        // Batch of 5 items: first 4 items are valid, 5th item violates required fields
        const batch = [
          {
            name: 'Valid Prop 1',
            property_type: 'multi_family',
            address_line1: '101 Base St',
            city: 'Austin',
            state: 'TX',
            postal_code: '78701'
          },
          {
            name: 'Valid Prop 2',
            property_type: 'multi_family',
            address_line1: '102 Base St',
            city: 'Austin',
            state: 'TX',
            postal_code: '78701'
          },
          {
            name: 'Valid Prop 3',
            property_type: 'multi_family',
            address_line1: '103 Base St',
            city: 'Austin',
            state: 'TX',
            postal_code: '78701'
          },
          {
            name: 'Valid Prop 4',
            property_type: 'multi_family',
            address_line1: '104 Base St',
            city: 'Austin',
            state: 'TX',
            postal_code: '78701'
          },
          {
            // Missing name, property_type, and address_line1!
            city: 'Austin',
            state: 'TX',
            postal_code: '78701'
          }
        ];

        assert.throws(() => {
          executeBulkIngestion('properties', batch);
        });

        // Verify that NONE of the 4 valid properties were committed
        const afterProperties = PropertiesRepository.listProperties();
        assert.equal(afterProperties.length, initialProperties);
        assert.equal(afterProperties[0]!.name, 'Baseline Property');
      });
    });
  });

  describe('4. Custom Fields Date Parsing & Evasion Resistance', () => {
    it('verifies strict leap year, month length, and boundary enforcement', () => {
      runInOperatorContext('op-redteam-date', () => {
        CustomFieldsService.createDefinition({
          entity_type: 'property',
          field_name: 'compliance_audit_date',
          field_label: 'Audit Date',
          data_type: 'date'
        });

        const testCases: Array<{ input: any; shouldPass: boolean; reason: string }> = [
          // Valid dates
          { input: '2024-02-29', shouldPass: true, reason: 'Leap year 2024 has 29 days' },
          { input: '2000-02-29', shouldPass: true, reason: 'Century leap year 2000 has 29 days' },
          { input: '2026-12-31', shouldPass: true, reason: 'Dec 31 is valid' },
          { input: '2026-01-01', shouldPass: true, reason: 'Jan 1 is valid' },

          // Invalid leap years
          { input: '2025-02-29', shouldPass: false, reason: '2025 is not a leap year' },
          { input: '2100-02-29', shouldPass: false, reason: '2100 is not a leap year (divisible by 100 but not 400)' },
          { input: '1900-02-29', shouldPass: false, reason: '1900 is not a leap year' },

          // 30-day month violations (day 31 invalid)
          { input: '2026-04-31', shouldPass: false, reason: 'April only has 30 days' },
          { input: '2026-06-31', shouldPass: false, reason: 'June only has 30 days' },
          { input: '2026-09-31', shouldPass: false, reason: 'September only has 30 days' },
          { input: '2026-11-31', shouldPass: false, reason: 'November only has 30 days' },
          { input: '2026-02-30', shouldPass: false, reason: 'February never has 30 days' },
          { input: '2026-02-31', shouldPass: false, reason: 'February never has 31 days' },

          // Month out of range
          { input: '2026-00-15', shouldPass: false, reason: 'Month 0 is invalid' },
          { input: '2026-13-15', shouldPass: false, reason: 'Month 13 is invalid' },

          // Day out of range
          { input: '2026-05-00', shouldPass: false, reason: 'Day 0 is invalid' },
          { input: '2026-05-32', shouldPass: false, reason: 'Day 32 is invalid' },

          // Formatting evasions
          { input: '05/15/2026', shouldPass: false, reason: 'US slashes format prohibited' },
          { input: '2026.05.15', shouldPass: false, reason: 'Dots format prohibited' },
          { input: '15-05-2026', shouldPass: false, reason: 'DD-MM-YYYY prohibited' },
          { input: '2026-5-15', shouldPass: false, reason: 'Single digit month prohibited' },
          { input: '2026-05-5', shouldPass: false, reason: 'Single digit day prohibited' },
          { input: '999-05-15', shouldPass: false, reason: '3 digit year prohibited' },
          { input: '10000-05-15', shouldPass: false, reason: '5 digit year prohibited' }
        ];

        for (const tc of testCases) {
          const res = CustomFieldsService.validateAndFormat('property', {
            compliance_audit_date: tc.input
          });

          if (tc.shouldPass) {
            assert.equal(
              res.valid,
              true,
              `Expected "${tc.input}" to be valid: ${tc.reason}. Got errors: ${res.errors.join(', ')}`
            );
          } else {
            assert.equal(
              res.valid,
              false,
              `Expected "${tc.input}" to be rejected: ${tc.reason}`
            );
          }
        }
      });
    });
  });

  describe('5. Temporal Filter Invariant & Parameter Bounding', () => {
    it('rejects floats, NaN, negative timestamps, and inverted intervals', () => {
      const allowed = ['created_at'];

      // Non-integer float
      const resFloat = validateTemporalParams({ created_at_start: '1700000000.123' }, allowed);
      assert.ok(resFloat.error);

      // Negative timestamp
      const resNeg = validateTemporalParams({ created_at_start: '-1' }, allowed);
      assert.ok(resNeg.error);

      // Alphabetic string
      const resAlpha = validateTemporalParams({ created_at_start: 'now' }, allowed);
      assert.ok(resAlpha.error);

      // Inverted interval: start > end
      const resInverted = validateTemporalParams(
        {
          created_at_start: '1700000500000',
          created_at_end: '1700000100000'
        },
        allowed
      );
      assert.ok(resInverted.error);
      assert.match(resInverted.error!, /cannot be greater than/);
    });
  });
});
