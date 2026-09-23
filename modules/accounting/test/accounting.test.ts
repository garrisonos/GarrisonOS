import { test, describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { AccountingRepository } from '../backend/repository.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';
import { ChartOfAccountsRepository } from '../backend/chart_of_accounts.js';

describe('Accounting Module - Repository & Financial Workflows', () => {
  before(() => {
    getDatabase({ inMemory: true });
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('creates and lists financial transactions with category and date filtering', () => {
    runInOperatorContext('tenant-acct-test', () => {
      const now = Date.now();

      // Create income transaction
      const tx1 = AccountingRepository.createTransaction({
        transaction_type: 'payment',
        category: 'rent',
        amount_cents: 175000,
        transaction_date: now - 5000,
        description: 'October Rent Payment'
      });
      assert.ok(tx1.id);
      assert.equal(tx1.amount_cents, 175000);

      // Create expense transaction
      const tx2 = AccountingRepository.createTransaction({
        transaction_type: 'expense',
        category: 'repairs',
        amount_cents: 32000,
        transaction_date: now - 2000,
        description: 'Plumbing Repair'
      });
      assert.ok(tx2.id);

      // List all transactions
      const allTx = AccountingRepository.listTransactions();
      assert.ok(allTx.length >= 2);

      // Filter by transaction type
      const payments = AccountingRepository.listTransactions({ transaction_type: 'payment' });
      assert.ok(payments.some((t) => t.id === tx1.id));
      assert.ok(!payments.some((t) => t.id === tx2.id));

      // Verify double-entry General Ledger linkage on created transactions
      assert.ok(tx1.journal_entry_id, 'Payment transaction should have linked journal_entry_id');
      assert.ok(tx2.journal_entry_id, 'Expense transaction should have linked journal_entry_id');

      // Calculate Schedule E report
      const scheduleE = AccountingRepository.getScheduleEReport();
      assert.ok(scheduleE.totalIncomeCents >= 175000);
      assert.ok(scheduleE.totalOperatingExpenseCents >= 32000);
      assert.equal(scheduleE.incomeByCategory['rent'], 175000);
      assert.equal(scheduleE.expenseByCategory['repairs'], 32000);
    });
  });

  it('executes processDepositDisposition atomically with deductions and refund', () => {
    runInOperatorContext('tenant-acct-test', () => {
      const db = getDatabase();
      const now = Date.now();
      const leaseId = 'lease-disp-test';
      const propId = 'prop-disp-1';
      const unitId = 'unit-disp-1';

      // Insert property & unit for FK constraints
      db.prepare(`
        INSERT INTO properties (
          id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at
        ) VALUES (?, 'tenant-acct-test', 'Test Building', 'single_family', '123 Main', 'City', 'ST', '12345', ?, ?)
      `).run(propId, now, now);

      db.prepare(`
        INSERT INTO units (
          id, operator_id, property_id, unit_number, status, market_rent_cents, created_at, updated_at
        ) VALUES (?, 'tenant-acct-test', ?, '101', 'occupied', 200000, ?, ?)
      `).run(unitId, propId, now, now);

      // Insert dummy lease with deposit held
      db.prepare(`
        INSERT INTO leases (
          id, operator_id, unit_id, start_date, end_date, rent_amount_cents,
          deposit_held_cents, status, created_at, updated_at
        ) VALUES (?, 'tenant-acct-test', ?, ?, ?, 200000, 200000, 'active', ?, ?)
      `).run(leaseId, unitId, now - 1000000, now + 1000000, now, now);

      // Process disposition with $500 damage deduction and $1500 refund
      const disposition = AccountingRepository.processDepositDisposition(leaseId, [
        { category: 'repairs', amount_cents: 50000, description: 'Wall repair' }
      ]);

      assert.equal(disposition.leaseId, leaseId);
      assert.equal(disposition.depositHeldCents, 200000);
      assert.equal(disposition.damageDeductionsCents, 50000);
      assert.equal(disposition.finalRefundCents, 150000);

      // Verify lease is terminated and deposit_held_cents is 0
      const updatedLease = db.prepare(`SELECT * FROM leases WHERE id = ?`).get(leaseId) as any;
      assert.equal(updatedLease.deposit_held_cents, 0);
      assert.equal(updatedLease.status, 'terminated');
    });
  });

  it('fails deleteTransaction and rolls back if linked journal entry does not exist', () => {
    runInOperatorContext('tenant-acct-test', () => {
      const now = Date.now();
      const db = getDatabase();

      // Create a valid transaction with balanced journal entry
      const tx = AccountingRepository.createTransaction({
        transaction_type: 'payment',
        category: 'rent',
        amount_cents: 100000,
        transaction_date: now,
        description: 'Test payment'
      });

      // Temporarily disable FK to simulate an orphaned journal_entry_id reference
      db.exec('PRAGMA foreign_keys = OFF;');
      assert.ok(tx.journal_entry_id);
      db.prepare(`DELETE FROM journal_entries WHERE id = ?`).run(tx.journal_entry_id);
      db.exec('PRAGMA foreign_keys = ON;');

      assert.throws(() => {
        AccountingRepository.deleteTransaction(tx.id);
      }, /Linked journal entry not found/);

      // Verify transaction was NOT soft-deleted
      const txAfter = AccountingRepository.getTransactionById(tx.id);
      assert.ok(txAfter);
      assert.equal(txAfter.deleted_at, null);
    });
  });

  it('throws and preserves state if processDepositDisposition targets nonexistent lease', () => {
    runInOperatorContext('tenant-acct-test', () => {
      assert.throws(() => {
        AccountingRepository.processDepositDisposition('non-existent-lease');
      }, /Lease not found/);
    });
  });

  it('rejects inactive explicit charge accounts while preserving soft-delete fallback', () => {
    runInOperatorContext('tenant-acct-gl-test', () => {
      const db = getDatabase();
      const rentAccount = ChartOfAccountsRepository.getAccountByMapping('rent')!;

      db.prepare(`
        UPDATE chart_of_accounts SET is_active = 0
        WHERE id = ? AND operator_id = ?
      `).run(rentAccount.id, 'tenant-acct-gl-test');

      assert.throws(() => {
        AccountingRepository.createTransaction({
          transaction_type: 'charge',
          category: 'rent',
          amount_cents: 100000,
          transaction_date: Date.now(),
          description: 'Charge with inactive explicit account',
          gl_account_id: rentAccount.id
        });
      }, /is inactive/);

      db.prepare(`
        UPDATE chart_of_accounts SET deleted_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(Date.now(), rentAccount.id, 'tenant-acct-gl-test');

      const transaction = AccountingRepository.createTransaction({
        transaction_type: 'charge',
        category: 'rent',
        amount_cents: 100000,
        transaction_date: Date.now(),
        description: 'Charge falling back from soft-deleted account',
        gl_account_id: rentAccount.id
      });
      assert.ok(transaction.journal_entry_id);
    });
  });
});
