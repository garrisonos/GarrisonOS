import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { AccountsPayableRepository } from '../backend/ap.js';
import { VendorChecksRepository } from '../backend/checks.js';
import { ChartOfAccountsRepository } from '../backend/chart_of_accounts.js';
import { JournalService } from '../backend/journal.js';

describe('Accounting Module - Vendor Check Register & Disbursements', () => {
  beforeEach(() => {
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('issues check settling approved bills and posts double-entry GL (Dr: 2010 AP, Cr: 1010 Bank)', () => {
    runInOperatorContext('checks-test-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const propertyId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'checks-test-op', 'vendor', 'John', 'Electrician', 'City Electric Co', 'john@cityelectric.com', ?, ?)
      `).run(vendorId, now, now);

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'checks-test-op', 'Highland Park Lofts', 'multi_family', '700 Highland', 'Austin', 'TX', '78702', ?, ?)
      `).run(propertyId, now, now);

      const bankAccount = ChartOfAccountsRepository.getAccountByAccountNumber('1010')!;
      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      // Create two bills for this vendor
      const bill1 = AccountsPayableRepository.createBill({
        vendor_id: vendorId,
        invoice_number: 'ELEC-101',
        invoice_date: now,
        total_amount_cents: 30000,
        allocations: [{ property_id: propertyId, gl_account_id: expenseAccount.id, amount_cents: 30000 }]
      });
      AccountsPayableRepository.approveBill(bill1.id, 'admin');

      const bill2 = AccountsPayableRepository.createBill({
        vendor_id: vendorId,
        invoice_number: 'ELEC-102',
        invoice_date: now,
        total_amount_cents: 20000,
        allocations: [{ property_id: propertyId, gl_account_id: expenseAccount.id, amount_cents: 20000 }]
      });
      AccountsPayableRepository.approveBill(bill2.id, 'admin');

      // Issue single check for both bills ($500.00)
      const check = VendorChecksRepository.issueCheck({
        bank_account_id: bankAccount.id,
        vendor_id: vendorId,
        check_number: '10045',
        check_date: now,
        amount_cents: 50000,
        memo: 'Electrical service for units 101 & 102',
        bill_allocations: [
          { bill_id: bill1.id, amount_cents: 30000 },
          { bill_id: bill2.id, amount_cents: 20000 }
        ]
      });

      assert.ok(check.id);
      assert.equal(check.check_number, '10045');
      assert.equal(check.amount_cents, 50000);
      assert.equal(check.payee_name, 'City Electric Co');
      assert.equal(check.status, 'printed');
      assert.equal(check.allocations?.length, 2);

      // Verify bills updated to paid
      const b1 = AccountsPayableRepository.getBillById(bill1.id)!;
      assert.equal(b1.status, 'paid');
      assert.equal(b1.amount_paid_cents, 30000);

      const b2 = AccountsPayableRepository.getBillById(bill2.id)!;
      assert.equal(b2.status, 'paid');
      assert.equal(b2.amount_paid_cents, 20000);

      // Verify General Ledger entry
      const glEntry = JournalService.listEntries({ source_type: 'vendor_check' }).entries[0];
      assert.ok(glEntry);
      assert.equal(glEntry.source_id, check.id);

      const apLine = glEntry.lines?.find((l) => l.account_number === '2010');
      const bankLine = glEntry.lines?.find((l) => l.account_number === '1010');

      assert.ok(apLine);
      assert.equal(apLine.debit_cents, 50000);
      assert.equal(apLine.credit_cents, 0);

      assert.ok(bankLine);
      assert.equal(bankLine.debit_cents, 0);
      assert.equal(bankLine.credit_cents, 50000);
    });
  });

  it('rejects duplicate check number on the same bank account', () => {
    runInOperatorContext('checks-test-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'checks-test-op', 'vendor', 'Supplier', 'One', 'Supplier One', 'supp@one.com', ?, ?)
      `).run(vendorId, now, now);

      const bankAccount = ChartOfAccountsRepository.getAccountByAccountNumber('1010')!;
      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      const bill = AccountsPayableRepository.createBill({
        vendor_id: vendorId,
        invoice_number: 'SUPP-1',
        invoice_date: now,
        total_amount_cents: 10000,
        allocations: [{ gl_account_id: expenseAccount.id, amount_cents: 10000 }]
      });
      AccountsPayableRepository.approveBill(bill.id, 'admin');

      VendorChecksRepository.issueCheck({
        bank_account_id: bankAccount.id,
        vendor_id: vendorId,
        check_number: '2001',
        check_date: now,
        amount_cents: 10000,
        bill_allocations: [{ bill_id: bill.id, amount_cents: 10000 }]
      });

      // Second check with same check_number '2001' on bankAccount
      assert.throws(() => {
        VendorChecksRepository.issueCheck({
          bank_account_id: bankAccount.id,
          vendor_id: vendorId,
          check_number: '2001',
          check_date: now,
          amount_cents: 10000,
          bill_allocations: [{ bill_id: bill.id, amount_cents: 10000 }]
        });
      }, /Check number "2001" has already been issued/);
    });
  });

  it('voids an issued check, re-opening bills and reversing the GL payment entry', () => {
    runInOperatorContext('checks-test-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'checks-test-op', 'vendor', 'Lawn Care', 'Pros', 'Lawn Care Pros', 'lawn@pros.com', ?, ?)
      `).run(vendorId, now, now);

      const bankAccount = ChartOfAccountsRepository.getAccountByAccountNumber('1010')!;
      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      const bill = AccountsPayableRepository.createBill({
        vendor_id: vendorId,
        invoice_number: 'LAWN-550',
        invoice_date: now,
        total_amount_cents: 25000,
        allocations: [{ gl_account_id: expenseAccount.id, amount_cents: 25000 }]
      });
      AccountsPayableRepository.approveBill(bill.id, 'admin');

      const check = VendorChecksRepository.issueCheck({
        bank_account_id: bankAccount.id,
        vendor_id: vendorId,
        check_number: '3005',
        check_date: now,
        amount_cents: 25000,
        bill_allocations: [{ bill_id: bill.id, amount_cents: 25000 }]
      });

      assert.equal(AccountsPayableRepository.getBillById(bill.id)!.status, 'paid');

      // Void check
      const voided = VendorChecksRepository.voidCheck(check.id, 'Stop payment requested - lost in mail');
      assert.equal(voided.status, 'voided');
      assert.equal(voided.void_reason, 'Stop payment requested - lost in mail');

      // Bill should be re-opened to approved
      const reOpenedBill = AccountsPayableRepository.getBillById(bill.id)!;
      assert.equal(reOpenedBill.status, 'approved');
      assert.equal(reOpenedBill.amount_paid_cents, 0);

      // GL payment reversed
      const originalEntry = JournalService.listEntries({ source_type: 'vendor_check' }).entries[0];
      assert.ok(originalEntry);
      assert.ok(originalEntry!.reversed_by_entry_id);
    });
  });

  it('prohibits issuing vendor checks from the Security Deposit Trust bank account (1020)', () => {
    runInOperatorContext('checks-test-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'checks-test-op', 'vendor', 'Roofing', 'Specialists', 'Roofing Specialists', 'roof@spec.com', ?, ?)
      `).run(vendorId, now, now);

      const trustAccount = ChartOfAccountsRepository.getAccountByAccountNumber('1020')!;
      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      const bill = AccountsPayableRepository.createBill({
        vendor_id: vendorId,
        invoice_number: 'ROOF-1',
        invoice_date: now,
        total_amount_cents: 40000,
        allocations: [{ gl_account_id: expenseAccount.id, amount_cents: 40000 }]
      });
      AccountsPayableRepository.approveBill(bill.id, 'admin');

      assert.throws(() => {
        VendorChecksRepository.issueCheck({
          bank_account_id: trustAccount.id,
          vendor_id: vendorId,
          check_number: '9901',
          check_date: now,
          amount_cents: 40000,
          bill_allocations: [{ bill_id: bill.id, amount_cents: 40000 }]
        });
      }, /Vendor bills cannot be paid from the Security Deposit Trust account/);
    });
  });
});
