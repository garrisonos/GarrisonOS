import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from './helpers.js';
import { closeDatabase, getDatabase } from '../database/client.js';
import { executeBulkIngestion } from '../api/bulk.js';
import { validateTemporalParams, parseOrderByClause, buildTemporalSqlConditions } from '../api/query-parser.js';
import { PropertiesRepository } from '../modules/properties/backend/repository.js';
import { ContactsRepository } from '../modules/contacts/backend/repository.js';
import { LeasesRepository } from '../modules/leases/backend/repository.js';
import { CustomFieldsService } from '../core/custom-fields.js';

describe('Bulk Ingestion & Temporal Query Conventions', () => {
  before(() => {
    getDatabase({ inMemory: true });
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  describe('Bulk Ingestion Transactional Engine', () => {
    it('successfully ingests a batch of valid resources and returns created IDs', () => {
      runInOperatorContext('op-bulk-success', () => {
        const items = [
          { name: 'Bulk Amenity 1', category: 'community', description: 'Desc 1' },
          { name: 'Bulk Amenity 2', category: 'unit', description: 'Desc 2' },
          { name: 'Bulk Amenity 3', category: 'eco', description: 'Desc 3' }
        ];

        const result = executeBulkIngestion('amenities', items);
        assert.equal(result.count, 3);
        assert.equal(result.ids.length, 3);

        const list = PropertiesRepository.listAmenities();
        assert.equal(list.length, 3);
      });
    });

    it('rolls back ENTIRE batch when an item fails validation (all-or-nothing rollback)', () => {
      runInOperatorContext('op-bulk-rollback', () => {
        // Pre-create an amenity so that creating another with same name causes conflict
        PropertiesRepository.createAmenity({
          name: 'Existing Unique Amenity',
          category: 'community'
        });
        const initialCount = PropertiesRepository.listAmenities().length;
        assert.equal(initialCount, 1);

        // Batch of 4 items: items 0, 1, 2 are valid, item 3 will fail due to duplicate name conflict
        const batchWithConflict = [
          { name: 'Batch Item A', category: 'community' },
          { name: 'Batch Item B', category: 'unit' },
          { name: 'Batch Item C', category: 'pet' },
          { name: 'Existing Unique Amenity', category: 'community' } // duplicate!
        ];

        assert.throws(() => {
          executeBulkIngestion('amenities', batchWithConflict);
        });

        // Verify all-or-nothing rollback: NONE of items A, B, C should exist!
        const afterCount = PropertiesRepository.listAmenities().length;
        assert.equal(afterCount, 1);
        assert.equal(PropertiesRepository.listAmenities()[0]!.name, 'Existing Unique Amenity');
      });
    });

    it('rolls back batch if custom fields validation fails for any item', () => {
      runInOperatorContext('op-bulk-cf-rollback', () => {
        // Define required custom field for contact
        CustomFieldsService.createDefinition({
          entity_type: 'contact',
          field_name: 'license_number',
          field_label: 'License Number',
          data_type: 'string',
          is_required: true
        });

        const initialContacts = ContactsRepository.listContacts().length;

        // Batch of 2 contacts: 1st has license_number, 2nd is missing it
        const batch = [
          {
            contact_type: 'vendor',
            first_name: 'John',
            last_name: 'Vendor',
            custom_fields: { license_number: 'LIC-12345' }
          },
          {
            contact_type: 'vendor',
            first_name: 'Jane',
            last_name: 'Vendor',
            custom_fields: {} // missing required license_number!
          }
        ];

        assert.throws(() => {
          executeBulkIngestion('contacts', batch);
        }, /is required/);

        // Verify all-or-nothing: John Vendor was NOT committed
        const afterContacts = ContactsRepository.listContacts().length;
        assert.equal(afterContacts, initialContacts);
      });
    });

    it('rejects batches exceeding maximum size limit or empty payload', () => {
      runInOperatorContext('op-bulk-limits', () => {
        // Empty batch
        assert.throws(() => {
          executeBulkIngestion('amenities', []);
        }, /between 1 and 100 items/);

        // Oversized batch (>100)
        const oversized = Array.from({ length: 101 }, (_, i) => ({
          name: `Amenity ${i}`,
          category: 'community'
        }));
        assert.throws(() => {
          executeBulkIngestion('amenities', oversized);
        }, /between 1 and 100 items/);
      });
    });

    it('handles bulk ingestion of leases with nested transactions seamlessly', () => {
      runInOperatorContext('op-bulk-leases', () => {
        const prop = PropertiesRepository.createProperty({
          name: 'Bulk Lease Prop',
          property_type: 'multi_family',
          address_line1: '100 Lease St',
          city: 'Austin',
          state: 'TX',
          postal_code: '78701'
        });
        const unit1 = PropertiesRepository.createUnit({
          property_id: prop.id,
          unit_number: 'L-101',
          bedrooms: 1,
          bathrooms: 1,
          market_rent_cents: 120000
        });
        const unit2 = PropertiesRepository.createUnit({
          property_id: prop.id,
          unit_number: 'L-102',
          bedrooms: 2,
          bathrooms: 2,
          market_rent_cents: 150000
        });

        const batch = [
          {
            unit_id: unit1.id,
            start_date: 1700000000000,
            end_date: 1731536000000,
            rent_amount_cents: 120000,
            status: 'active'
          },
          {
            unit_id: unit2.id,
            start_date: 1700000000000,
            end_date: 1731536000000,
            rent_amount_cents: 150000,
            status: 'draft'
          }
        ];

        const result = executeBulkIngestion('leases', batch);
        assert.equal(result.count, 2);
        assert.equal(result.ids.length, 2);

        const leases = LeasesRepository.listLeases();
        assert.equal(leases.length, 2);
      });
    });

    it('persists formatted and validated custom fields during bulk ingestion and rejects non-object custom_fields', () => {
      runInOperatorContext('op-bulk-cf-persist', () => {
        CustomFieldsService.createDefinition({
          entity_type: 'property',
          field_name: 'inspection_date',
          field_label: 'Inspection Date',
          data_type: 'date'
        });

        // 1. Reject non-object custom_fields
        assert.throws(() => {
          executeBulkIngestion('properties', [
            {
              name: 'Invalid CF Prop',
              property_type: 'single_family',
              address_line1: '111 Err St',
              city: 'Austin',
              state: 'TX',
              postal_code: '78701',
              custom_fields: 'not-an-object'
            }
          ]);
        }, /must be a JSON object/);

        // 2. Persists formatted normalized date value
        const result = executeBulkIngestion('properties', [
          {
            name: 'Valid CF Prop',
            property_type: 'single_family',
            address_line1: '222 Good St',
            city: 'Austin',
            state: 'TX',
            postal_code: '78701',
            custom_fields: { inspection_date: '2026-05-15' }
          }
        ]);

        assert.equal(result.count, 1);
        const prop = PropertiesRepository.getPropertyById(result.ids[0]!);
        assert.ok(prop);
        const cf = typeof prop.custom_fields === 'string' ? JSON.parse(prop.custom_fields) : prop.custom_fields;
        assert.equal(cf.inspection_date, '2026-05-15');
      });
    });
  });

  describe('Temporal Query Parameter Validation & SQL Builder', () => {
    it('validates integer millisecond timestamps and enforces start <= end', () => {
      // 1. Valid range
      const valid = validateTemporalParams({
        created_at_start: '1700000000000',
        created_at_end: '1700000500000'
      }, ['created_at', 'updated_at']);

      assert.equal(valid.error, undefined);
      assert.equal(valid.params['created_at_start'], 1700000000000);
      assert.equal(valid.params['created_at_end'], 1700000500000);

      // 2. Reject non-integer float
      const nonInt = validateTemporalParams({
        created_at_start: '1700000000000.5'
      }, ['created_at']);
      assert.ok(nonInt.error);
      assert.match(nonInt.error!, /non-negative integer millisecond timestamp/);

      // 3. Reject NaN string
      const nanStr = validateTemporalParams({
        created_at_start: 'not-a-timestamp'
      }, ['created_at']);
      assert.ok(nanStr.error);
      assert.match(nanStr.error!, /non-negative integer millisecond timestamp/);

      // 4. Reject negative integer
      const negative = validateTemporalParams({
        created_at_start: '-500'
      }, ['created_at']);
      assert.ok(negative.error);

      // 5. Cross-field: reject start > end
      const inverted = validateTemporalParams({
        created_at_start: '1700000500000',
        created_at_end: '1700000000000'
      }, ['created_at']);
      assert.ok(inverted.error);
      assert.match(inverted.error!, /cannot be greater than/);
    });

    it('builds parameterized SQL temporal conditions with optional table alias', () => {
      const params = {
        created_at_start: 1700000000000,
        created_at_end: 1700000500000
      };

      // Without alias
      const noAlias = buildTemporalSqlConditions(params);
      assert.equal(noAlias.sql, ' AND created_at >= ? AND created_at <= ?');
      assert.deepEqual(noAlias.params, [1700000000000, 1700000500000]);

      // With alias
      const withAlias = buildTemporalSqlConditions(params, 'p');
      assert.equal(withAlias.sql, ' AND p.created_at >= ? AND p.created_at <= ?');
      assert.deepEqual(withAlias.params, [1700000000000, 1700000500000]);
    });
  });

  describe('Multi-Key Order By Parsing & Whitelisting', () => {
    const allowed = ['name', 'category', 'created_at', 'updated_at'];

    it('parses multi-key order_by clauses safely', () => {
      const parsed = parseOrderByClause('category:asc,name:desc', allowed);
      assert.equal(parsed.error, undefined);
      assert.equal(parsed.clause, 'category ASC, name DESC');
    });

    it('defaults direction to ASC when direction is omitted', () => {
      const parsed = parseOrderByClause('name', allowed);
      assert.equal(parsed.error, undefined);
      assert.equal(parsed.clause, 'name ASC');
    });

    it('rejects unwhitelisted columns', () => {
      const parsed = parseOrderByClause('secret_col:desc', allowed);
      assert.ok(parsed.error);
      assert.match(parsed.error!, /Invalid sort column "secret_col"/);
    });

    it('rejects invalid directions', () => {
      const parsed = parseOrderByClause('name:sideways', allowed);
      assert.ok(parsed.error);
      assert.match(parsed.error!, /Invalid sort direction "sideways"/);
    });

    it('falls back to default clause if order_by is empty or omitted', () => {
      const parsed = parseOrderByClause(undefined, allowed, 'created_at DESC');
      assert.equal(parsed.clause, 'created_at DESC');
    });
  });
});
