import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../../../database/client.js';
import { runMigrations } from '../../../database/migrator.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { ConversationsRepository } from '../backend/repository.js';

describe('Universal Conversations & Notes Subsystem Suite', () => {
  let db: any;
  const operatorA = generateUUIDv7();
  const operatorB = generateUUIDv7();
  let repo: ConversationsRepository;

  const userStaffA = generateUUIDv7();
  const contactTenantA = generateUUIDv7();
  const contactVendorA = generateUUIDv7();
  const contactUnrelatedA = generateUUIDv7();
  const propertyA = generateUUIDv7();
  const leaseA = generateUUIDv7();

  before(() => {
    db = getDatabase({ inMemory: true });
    runMigrations(db);

    const now = Date.now();
    db.prepare(`
      INSERT INTO operators (id, name, created_at, updated_at)
      VALUES (?, 'Operator A', ?, ?), (?, 'Operator B', ?, ?)
    `).run(operatorA, now, now, operatorB, now, now);

    // Seed staff user in Operator A
    db.prepare(`
      INSERT INTO users (id, operator_id, email, password_hash, first_name, last_name, role, token_version, created_at, updated_at)
      VALUES (?, ?, 'staff@operator-a.test', 'hash', 'Alice', 'Admin', 'manager', 1, ?, ?)
    `).run(userStaffA, operatorA, now, now);

    // Seed contacts in Operator A
    db.prepare(`
      INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, email, created_at, updated_at)
      VALUES
        (?, ?, 'tenant', 'Bob', 'Tenant', 'tenant@test.local', ?, ?),
        (?, ?, 'vendor', 'Victor', 'Plumber', 'vendor@test.local', ?, ?),
        (?, ?, 'tenant', 'Charlie', 'Unrelated', 'unrelated@test.local', ?, ?)
    `).run(
      contactTenantA, operatorA, now, now,
      contactVendorA, operatorA, now, now,
      contactUnrelatedA, operatorA, now, now
    );

    // Seed property and lease
    db.prepare(`
      INSERT INTO properties (id, operator_id, name, address_line1, city, state, postal_code, property_type, created_at, updated_at)
      VALUES (?, ?, 'Highland Oaks', '100 Main St', 'Raleigh', 'NC', '27601', 'multi_family', ?, ?)
    `).run(propertyA, operatorA, now, now);

    const unitA = generateUUIDv7();
    db.prepare(`
      INSERT INTO units (id, operator_id, property_id, unit_number, status, market_rent_cents, created_at, updated_at)
      VALUES (?, ?, ?, '101', 'occupied', 150000, ?, ?)
    `).run(unitA, operatorA, propertyA, now, now);

    db.prepare(`
      INSERT INTO leases (id, operator_id, unit_id, status, start_date, end_date, rent_amount_cents, security_deposit_cents, deposit_held_cents, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, 150000, 150000, 150000, ?, ?)
    `).run(leaseA, operatorA, unitA, now, now + 31536000000, now, now);

    repo = new ConversationsRepository(db);
  });

  after(() => {
    closeDatabase();
  });

  it('creates conversation thread with initial message and staff authorship', () => {
    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr-id', userId: userStaffA }, () => {
      const conv = repo.createConversation(
        {
          entity_type: 'property',
          entity_id: propertyA,
          subject: 'Roof inspection report notes',
          is_private: true,
          initial_message: 'Inspector noted minor flashing repair required on east slope.'
        },
        { userId: userStaffA, isStaff: true }
      );

      assert.ok(conv.id, 'Must generate UUIDv7 id');
      assert.equal(conv.operator_id, operatorA);
      assert.equal(conv.entity_type, 'property');
      assert.equal(conv.entity_id, propertyA);
      assert.equal(conv.is_private, 1);
      assert.equal(conv.message_count, 1);
      assert.equal(conv.creator_name, 'Alice Admin');

      const messages = repo.listMessages(conv.id);
      assert.equal(messages.length, 1);
      assert.equal(messages[0]!.body, 'Inspector noted minor flashing repair required on east slope.');
      assert.equal(messages[0]!.author_name, 'Alice Admin');
    });
  });

  it('enforces multi-operator row-level isolation', () => {
    let convAId = '';
    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr-id', userId: userStaffA }, () => {
      const conv = repo.createConversation(
        {
          entity_type: 'lease',
          entity_id: leaseA,
          subject: 'Confidential lease concession'
        },
        { userId: userStaffA, isStaff: true }
      );
      convAId = conv.id;
    });

    // Querying under Operator B must fail closed
    RequestContext.run({ operatorId: operatorB, correlationId: 'test-corr-id' }, () => {
      const retrieved = repo.getConversation(convAId);
      assert.equal(retrieved, null, 'Operator B cannot access Operator A conversation');

      const listResult = repo.listConversations();
      assert.equal(listResult.items.length, 0, 'Operator B listing must return 0 items');
    });
  });

  it('shields internal operator notes from external contacts (fail-closed participant privacy)', () => {
    let privateConvId = '';
    let publicConvId = '';

    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr-id', userId: userStaffA }, () => {
      // 1. Private note: internal operator conversation about tenant Bob
      const privateConv = repo.createConversation(
        {
          entity_type: 'contact',
          entity_id: contactTenantA,
          subject: 'Internal Note: Late payment reminder history',
          is_private: true,
          initial_message: 'Tenant requested 3-day grace period for rent.'
        },
        { userId: userStaffA, isStaff: true }
      );
      privateConvId = privateConv.id;

      // 2. Public thread with tenant Bob as participant
      const publicConv = repo.createConversation(
        {
          entity_type: 'lease',
          entity_id: leaseA,
          subject: 'Move-in key pickup instructions',
          is_private: false,
          initial_message: 'Keys will be ready in lockbox at 9am.',
          participant_contact_ids: [contactTenantA]
        },
        { userId: userStaffA, isStaff: true }
      );
      publicConvId = publicConv.id;
    });

    // Requester Bob Tenant (External Contact, isStaff: false)
    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr-id' }, () => {
      const tenantContext = { contactId: contactTenantA, isStaff: false };

      // Bob should NOT be able to view private conversation
      const privateAttempt = repo.getConversation(privateConvId, tenantContext);
      assert.equal(privateAttempt, null, 'Tenant must never see private intra-company notes');

      // Bob SHOULD be able to view public thread where he is an explicit participant
      const publicAttempt = repo.getConversation(publicConvId, tenantContext);
      assert.ok(publicAttempt, 'Tenant must see conversation where he is an explicit participant');
      assert.equal(publicAttempt.id, publicConvId);

      // Unrelated contact Charlie must NOT see Bob's public thread
      const unrelatedContext = { contactId: contactUnrelatedA, isStaff: false };
      const unrelatedAttempt = repo.getConversation(publicConvId, unrelatedContext);
      assert.equal(unrelatedAttempt, null, 'Unrelated contact cannot see conversation they are not part of');

      // Listing conversations for Bob only returns publicConvId
      const listBob = repo.listConversations({}, tenantContext);
      assert.equal(listBob.items.length, 1);
      assert.equal(listBob.items[0]!.id, publicConvId);
    });
  });

  it('appends messages and tracks timestamp progression and authorship', () => {
    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr-id', userId: userStaffA }, () => {
      const conv = repo.createConversation(
        {
          entity_type: 'property',
          entity_id: propertyA,
          subject: 'Vendor work inquiry',
          participant_contact_ids: [contactVendorA]
        },
        { userId: userStaffA, isStaff: true }
      );

      const msg1 = repo.addMessage(conv.id, 'Dispatched Victor Plumber for repair.', {
        userId: userStaffA,
        isStaff: true
      });
      assert.ok(msg1.id);
      assert.equal(msg1.body, 'Dispatched Victor Plumber for repair.');

      const msg2 = repo.addMessage(conv.id, 'Parts ordered, returning tomorrow morning.', {
        contactId: contactVendorA,
        isStaff: false
      });
      assert.ok(msg2.id);
      assert.equal(msg2.author_name, 'Victor Plumber');

      const messages = repo.listMessages(conv.id);
      assert.equal(messages.length, 2);
      assert.equal(messages[0]!.author_user_id, userStaffA);
      assert.equal(messages[1]!.author_contact_id, contactVendorA);
    });
  });

  it('soft-deletes conversation thread and marks messages deleted', () => {
    RequestContext.run({ operatorId: operatorA, correlationId: 'test-corr-id', userId: userStaffA }, () => {
      const conv = repo.createConversation(
        {
          entity_type: 'property',
          entity_id: propertyA,
          subject: 'Temporary discussion to be deleted',
          initial_message: 'Some ephemeral note'
        },
        { userId: userStaffA, isStaff: true }
      );

      assert.equal(repo.listMessages(conv.id).length, 1);

      const deleted = repo.deleteConversation(conv.id, { userId: userStaffA, isStaff: true });
      assert.equal(deleted, true);

      assert.equal(repo.getConversation(conv.id), null);
      assert.equal(repo.listMessages(conv.id).length, 0);
    });
  });
});
