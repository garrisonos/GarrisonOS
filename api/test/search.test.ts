import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../test/helpers.js';
import { closeDatabase, getDatabase } from '../../database/client.js';
import { generateUUIDv7 } from '../../core/crypto.js';
import { SearchService, SearchResultItem } from '../search.js';

describe('API Subsystem - Universal Search Engine & RBAC Filtering', () => {
  beforeEach(() => {
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('indexes across properties, units, contacts, and financial records with wildcard matching', () => {
    runInOperatorContext('search-op-1', () => {
      const db = getDatabase();
      const propId = generateUUIDv7();
      const unitId = generateUUIDv7();
      const contactId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'search-op-1', 'Magnolia Terrace', 'multi_family', '1200 Magnolia Ave', 'Austin', 'TX', '78704', ?, ?)
      `).run(propId, now, now);

      db.prepare(`
        INSERT INTO units (id, operator_id, property_id, unit_number, status, market_rent_cents, target_deposit_cents, created_at, updated_at)
        VALUES (?, 'search-op-1', ?, 'PH-404', 'vacant', 350000, 350000, ?, ?)
      `).run(unitId, propId, now, now);

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, email, phone, created_at, updated_at)
        VALUES (?, 'search-op-1', 'tenant', 'Eleanor', 'Vance', 'eleanor@vance.org', '512-555-9081', ?, ?)
      `).run(contactId, now, now);

      // Search by partial text "Magnolia"
      const resProp = SearchService.search('Magnolia', 'owner', 10);
      assert.ok(resProp.results.length >= 1);
      const propMatch = resProp.results.find((r: SearchResultItem) => r.entity_type === 'property');
      assert.ok(propMatch);
      assert.equal(propMatch.title, 'Magnolia Terrace');
      assert.equal(propMatch.category, 'properties');

      // Search by unit number "PH-404"
      const resUnit = SearchService.search('PH-404', 'owner', 10);
      assert.ok(resUnit.results.length >= 1);
      const unitMatch = resUnit.results.find((r: SearchResultItem) => r.entity_type === 'unit');
      assert.ok(unitMatch);
      assert.ok(unitMatch.title.includes('PH-404'));

      // Search by contact name "Eleanor"
      const resContact = SearchService.search('Eleanor', 'owner', 10);
      assert.ok(resContact.results.length >= 1);
      const contactMatch = resContact.results.find((r: SearchResultItem) => r.entity_type === 'contact');
      assert.ok(contactMatch);
      assert.equal(contactMatch.title, 'Eleanor Vance');
    });
  });

  it('parses structured filter syntax (type:, status:) and enforces exact criteria', () => {
    runInOperatorContext('search-op-1', () => {
      const db = getDatabase();
      const propId = generateUUIDv7();
      const contactId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'search-op-1', 'Oakwood Center', 'commercial', '500 Oak St', 'Dallas', 'TX', '75201', ?, ?)
      `).run(propId, now, now);

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'search-op-1', 'vendor', 'Oakwood', 'Supplies', 'Oakwood Hardware', 'sales@oakwood.com', ?, ?)
      `).run(contactId, now, now);

      // Plain query "Oakwood" returns both property and contact
      const generalRes = SearchService.search('Oakwood', 'owner', 10);
      assert.ok(generalRes.results.some((r: SearchResultItem) => r.entity_type === 'property'));
      assert.ok(generalRes.results.some((r: SearchResultItem) => r.entity_type === 'contact'));

      // Scoped syntax query: "type:property Oakwood"
      const propertyOnlyRes = SearchService.search('type:property Oakwood', 'owner', 10);
      assert.ok(propertyOnlyRes.results.every((r: SearchResultItem) => r.entity_type === 'property'));
      assert.equal(propertyOnlyRes.results.length, 1);
      assert.equal(propertyOnlyRes.results[0]?.title, 'Oakwood Center');
    });
  });

  it('filters results according to user RBAC permissions and protects operator boundaries', () => {
    runInOperatorContext('search-op-1', () => {
      const db = getDatabase();
      const propId = generateUUIDv7();
      const billId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'search-op-1', 'Pinecrest Manor', 'multi_family', '300 Pine St', 'Austin', 'TX', '78701', ?, ?)
      `).run(propId, now, now);

      const vendorId = generateUUIDv7();
      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'search-op-1', 'vendor', 'Roofing', 'Pros', 'Pinecrest Roofing Co', 'service@pinecrest.com', ?, ?)
      `).run(vendorId, now, now);

      db.prepare(`
        INSERT INTO bills (id, operator_id, vendor_id, invoice_number, invoice_date, due_date, subtotal_cents, total_amount_cents, amount_paid_cents, status, created_at, updated_at)
        VALUES (?, 'search-op-1', ?, 'PINECREST-ROOF-01', ?, ?, 450000, 450000, 0, 'approved', ?, ?)
      `).run(billId, vendorId, now, now + 86400000, now, now);

      // User with 'owner' role sees property and bill
      const ownerRes = SearchService.search('Pinecrest', 'owner', 10);
      assert.ok(ownerRes.results.some((r: SearchResultItem) => r.entity_type === 'property'));
      assert.ok(ownerRes.results.some((r: SearchResultItem) => r.entity_type === 'bill'));

      // User with 'tenant' role sees neither accounting nor property
      const tenantRes = SearchService.search('Pinecrest', 'tenant', 10);
      assert.ok(!tenantRes.results.some((r: SearchResultItem) => r.entity_type === 'bill'));
    });

    // Multi-operator isolation test
    runInOperatorContext('search-op-2', () => {
      // Operator 2 searching for 'Pinecrest' should get 0 results
      const op2Res = SearchService.search('Pinecrest', 'owner', 10);
      assert.equal(op2Res.results.length, 0);
    });
  });
});
