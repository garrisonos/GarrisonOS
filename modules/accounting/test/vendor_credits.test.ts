import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { AccountsPayableRepository } from '../backend/ap.js';
import { VendorCreditsRepository } from '../backend/vendor_credits.js';
import { ChartOfAccountsRepository } from '../backend/chart_of_accounts.js';
import { JournalService } from '../backend/journal.js';

describe('Accounting Module - Vendor Credit Memos & Bill Offsets', () => {
  beforeEach(() => {
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('creates vendor credit and posts double-entry GL (Dr: 2010 AP, Cr: Expense)', () => {
    runInOperatorContext('credit-test-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'credit-test-op', 'vendor', 'Sherwin', 'Williams', 'Sherwin Williams Paints', 'pro@sherwin.com', ?, ?)
      `).run(vendorId, now, now);

      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      const credit = VendorCreditsRepository.createCredit({
        vendor_id: vendorId,
        credit_number: 'CM-9011',
        credit_date: now,
        total_amount_cents: 18000, // $180.00
        gl_account_id: expenseAccount.id,
        reason: 'Return unused primer buckets'
      });

      assert.ok(credit.id);
      assert.equal(credit.credit_number, 'CM-9011');
      assert.equal(credit.status, 'open');
      assert.equal(credit.total_amount_cents, 18000);
      assert.equal(credit.remaining_amount_cents, 18000);

      // Verify GL entry
      const glEntry = JournalService.listEntries({ source_type: 'vendor_credit' }).entries[0];
      assert.ok(glEntry);
      assert.equal(glEntry.source_id, credit.id);

      const apLine = glEntry.lines?.find((l) => l.account_number === '2010');
      const expLine = glEntry.lines?.find((l) => l.account_id === expenseAccount.id);

      assert.ok(apLine);
      assert.equal(apLine.debit_cents, 18000);
      assert.equal(apLine.credit_cents, 0);

      assert.ok(expLine);
      assert.equal(expLine.debit_cents, 0);
      assert.equal(expLine.credit_cents, 18000);
    });
  });

  it('applies vendor credit to offset an approved bill atomically', () => {
    runInOperatorContext('credit-test-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const propertyId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'credit-test-op', 'vendor', 'Grainger', 'Supply', 'Grainger Industrial', 'supply@grainger.com', ?, ?)
      `).run(vendorId, now, now);

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'credit-test-op', 'Warehouse Plaza', 'commercial', '200 Supply Way', 'Dallas', 'TX', '75201', ?, ?)
      `).run(propertyId, now, now);

      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      // 1. Create and approve bill for $500.00
      const bill = AccountsPayableRepository.createBill({
        vendor_id: vendorId,
        invoice_number: 'GRN-4450',
        invoice_date: now,
        total_amount_cents: 50000,
        allocations: [
          {
            property_id: propertyId,
            gl_account_id: expenseAccount.id,
            amount_cents: 50000,
            description: 'Lighting ballasts'
          }
        ]
      });
      AccountsPayableRepository.approveBill(bill.id, 'admin');

      // 2. Create vendor credit for $200.00
      const credit = VendorCreditsRepository.createCredit({
        vendor_id: vendorId,
        credit_number: 'CM-GRN-12',
        credit_date: now,
        total_amount_cents: 20000,
        gl_account_id: expenseAccount.id,
        reason: 'Restocking credit'
      });

      // 3. Apply $200.00 credit to bill
      const updatedCredit = VendorCreditsRepository.applyCredit(credit.id, bill.id, 20000);
      assert.equal(updatedCredit.remaining_amount_cents, 0);
      assert.equal(updatedCredit.status, 'fully_applied');
      assert.equal(updatedCredit.allocations?.length, 1);

      // 4. Verify bill state
      const updatedBill = AccountsPayableRepository.getBillById(bill.id)!;
      assert.equal(updatedBill.amount_paid_cents, 20000);
      assert.equal(updatedBill.status, 'partially_paid');
      assert.equal(updatedBill.allocations?.[0]?.amount_settled_cents, 20000);
    });
  });

  it('rejects cross-vendor credit application and over-allocation', () => {
    runInOperatorContext('credit-test-op', () => {
      const db = getDatabase();
      const vendorA = generateUUIDv7();
      const vendorB = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'credit-test-op', 'vendor', 'Vendor', 'Alpha', 'Vendor Alpha', 'a@alpha.com', ?, ?),
               (?, 'credit-test-op', 'vendor', 'Vendor', 'Beta', 'Vendor Beta', 'b@beta.com', ?, ?)
      `).run(vendorA, now, now, vendorB, now, now);

      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      const bill = AccountsPayableRepository.createBill({
        vendor_id: vendorA,
        invoice_number: 'INV-A-1',
        invoice_date: now,
        total_amount_cents: 10000,
        allocations: [{ gl_account_id: expenseAccount.id, amount_cents: 10000 }]
      });
      AccountsPayableRepository.approveBill(bill.id, 'admin');

      const creditB = VendorCreditsRepository.createCredit({
        vendor_id: vendorB,
        credit_number: 'CM-B-1',
        credit_date: now,
        total_amount_cents: 10000,
        gl_account_id: expenseAccount.id
      });

      // Cross-vendor rejected
      assert.throws(() => {
        VendorCreditsRepository.applyCredit(creditB.id, bill.id, 5000);
      }, /Cross-vendor credit offset is prohibited/);
    });
  });

  it('voids unapplied credit and reverses General Ledger adjusting entry', () => {
    runInOperatorContext('credit-test-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'credit-test-op', 'vendor', 'Vendor', 'Prime', 'Vendor Prime', 'prime@test.com', ?, ?)
      `).run(vendorId, now, now);

      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      const credit = VendorCreditsRepository.createCredit({
        vendor_id: vendorId,
        credit_number: 'CM-VOID-1',
        credit_date: now,
        total_amount_cents: 10000,
        gl_account_id: expenseAccount.id
      });

      const voided = VendorCreditsRepository.voidCredit(credit.id, 'Entered in error');
      assert.equal(voided.status, 'voided');

      const originalEntry = JournalService.listEntries({ source_type: 'vendor_credit' }).entries[0];
      assert.ok(originalEntry);
      assert.ok(originalEntry!.reversed_by_entry_id);
    });
  });
});
