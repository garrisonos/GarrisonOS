import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { AccountsPayableRepository } from '../backend/ap.js';
import { ChartOfAccountsRepository } from '../backend/chart_of_accounts.js';
import { JournalService } from '../backend/journal.js';

describe('Accounting Module - Accounts Payable (AP) Core Subsystem', () => {
  beforeEach(() => {
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('creates a draft bill with itemized multi-unit allocations and computes due date', () => {
    runInOperatorContext('ap-test-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const propertyId = generateUUIDv7();
      const unit1Id = generateUUIDv7();
      const unit2Id = generateUUIDv7();
      const now = Date.now();

      // Seed vendor and property/units
      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'ap-test-op', 'vendor', 'Apex', 'Plumber', 'Apex Plumbing Services', 'service@apexplumbing.com', ?, ?)
      `).run(vendorId, now, now);

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'ap-test-op', 'Oakridge Apartments', 'multi_family', '500 Oak St', 'Dallas', 'TX', '75201', ?, ?)
      `).run(propertyId, now, now);

      db.prepare(`
        INSERT INTO units (id, operator_id, property_id, unit_number, status, market_rent_cents, created_at, updated_at)
        VALUES (?, 'ap-test-op', ?, '101', 'vacant', 120000, ?, ?),
               (?, 'ap-test-op', ?, '102', 'vacant', 125000, ?, ?)
      `).run(unit1Id, propertyId, now, now, unit2Id, propertyId, now, now);

      // Resolve 5100 Repairs & Maintenance
      const repairsAccount = ChartOfAccountsRepository.getAccountByAccountNumber('5100') ||
        ChartOfAccountsRepository.getAccountByAccountNumber('5040') ||
        ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      const invoiceDate = 1759276800000; // 2025-10-01
      const bill = AccountsPayableRepository.createBill({
        vendor_id: vendorId,
        invoice_number: 'INV-2026-001',
        invoice_date: invoiceDate,
        payment_terms: 'net_30',
        total_amount_cents: 45000, // $450.00
        tax_cents: 0,
        allocations: [
          {
            property_id: propertyId,
            unit_id: unit1Id,
            gl_account_id: repairsAccount.id,
            amount_cents: 25000, // $250.00
            description: 'Fix kitchen sink leak'
          },
          {
            property_id: propertyId,
            unit_id: unit2Id,
            gl_account_id: repairsAccount.id,
            amount_cents: 20000, // $200.00
            description: 'Replace bathroom faucet'
          }
        ]
      });

      assert.ok(bill.id);
      assert.equal(bill.invoice_number, 'INV-2026-001');
      assert.equal(bill.status, 'draft');
      assert.equal(bill.total_amount_cents, 45000);
      assert.equal(bill.due_date, invoiceDate + 30 * 86400000);
      assert.equal(bill.allocations?.length, 2);
    });
  });

  it('rejects bill creation when allocation sum does not equal total_amount_cents', () => {
    runInOperatorContext('ap-test-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'ap-test-op', 'vendor', 'City', 'Cleaners', 'City Cleaners', 'info@cleaners.com', ?, ?)
      `).run(vendorId, now, now);

      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      assert.throws(() => {
        AccountsPayableRepository.createBill({
          vendor_id: vendorId,
          invoice_number: 'INV-MISMATCH',
          invoice_date: now,
          total_amount_cents: 50000,
          allocations: [
            {
              gl_account_id: expenseAccount.id,
              amount_cents: 40000
            }
          ]
        });
      }, /must equal total_amount_cents/);
    });
  });

  it('approves a bill and posts balanced double-entry GL accrual (Dr Expense / Cr 2010 AP)', () => {
    runInOperatorContext('ap-test-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const propertyId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'ap-test-op', 'vendor', 'Summit', 'HVAC', 'Summit HVAC LLC', 'hvac@summit.com', ?, ?)
      `).run(vendorId, now, now);

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'ap-test-op', 'Piedmont Towers', 'commercial', '100 Main St', 'Atlanta', 'GA', '30303', ?, ?)
      `).run(propertyId, now, now);

      db.prepare(`
        INSERT INTO users (id, operator_id, email, password_hash, first_name, last_name, role, created_at, updated_at)
        VALUES ('user-admin-1', 'ap-test-op', 'admin@example.com', 'dummy_hash', 'Admin', 'User', 'manager', ?, ?)
      `).run(now, now);

      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      const bill = AccountsPayableRepository.createBill({
        vendor_id: vendorId,
        invoice_number: 'HVAC-7789',
        invoice_date: now,
        total_amount_cents: 120000, // $1,200.00
        allocations: [
          {
            property_id: propertyId,
            gl_account_id: expenseAccount.id,
            amount_cents: 120000,
            description: 'Commercial chiller inspection'
          }
        ]
      });

      assert.equal(bill.status, 'draft');

      const approved = AccountsPayableRepository.approveBill(bill.id, 'user-admin-1');
      assert.equal(approved.status, 'approved');
      assert.equal(approved.approved_by, 'user-admin-1');
      assert.ok(approved.approved_at);

      // Verify General Ledger entry
      const glEntry = JournalService.listEntries({ source_type: 'bill' }).entries[0];
      assert.ok(glEntry);
      assert.equal(glEntry.source_id, bill.id);
      assert.equal(glEntry.lines?.length, 2);

      const expenseLine = glEntry.lines?.find((l) => l.account_id === expenseAccount.id);
      const apLine = glEntry.lines?.find((l) => l.account_number === '2010');

      assert.ok(expenseLine);
      assert.equal(expenseLine.debit_cents, 120000);
      assert.equal(expenseLine.credit_cents, 0);
      assert.equal(expenseLine.property_id, propertyId);

      assert.ok(apLine);
      assert.equal(apLine.debit_cents, 0);
      assert.equal(apLine.credit_cents, 120000);
    });
  });

  it('voids an approved bill and reverses the General Ledger accrual', () => {
    runInOperatorContext('ap-test-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'ap-test-op', 'vendor', 'Pest', 'Defense', 'Pest Defense Co', 'contact@pestdefense.com', ?, ?)
      `).run(vendorId, now, now);

      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      const bill = AccountsPayableRepository.createBill({
        vendor_id: vendorId,
        invoice_number: 'PEST-001',
        invoice_date: now,
        total_amount_cents: 15000,
        allocations: [
          {
            gl_account_id: expenseAccount.id,
            amount_cents: 15000,
            description: 'Quarterly extermination'
          }
        ]
      });

      AccountsPayableRepository.approveBill(bill.id, 'admin-1');

      // Void bill
      const voided = AccountsPayableRepository.voidBill(bill.id, 'Duplicate invoice');
      assert.equal(voided.status, 'voided');

      // Verify GL reversal
      const allEntries = JournalService.listEntries({ source_type: 'bill' }).entries;
      const originalEntry = allEntries.find((e) => e.source_id === bill.id && e.reversed_by_entry_id !== null);
      assert.ok(originalEntry);
      assert.ok(originalEntry.reversed_by_entry_id);
    });
  });

  it('creates and runs recurring scheduled bills', () => {
    runInOperatorContext('ap-test-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const propertyId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'ap-test-op', 'vendor', 'Waste', 'Management', 'Waste Management Corp', 'billing@wm.com', ?, ?)
      `).run(vendorId, now, now);

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'ap-test-op', 'Oakridge Apartments', 'multi_family', '500 Oak St', 'Dallas', 'TX', '75201', ?, ?)
      `).run(propertyId, now, now);

      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      const recurring = AccountsPayableRepository.createRecurringBill({
        vendor_id: vendorId,
        template_reference: 'Monthly Trash Service',
        start_date: now - 1000,
        interval_unit: 'month',
        interval_count: 1,
        total_occurrences: 12,
        invoice_amount_cents: 35000,
        allocations: [
          {
            property_id: propertyId,
            gl_account_id: expenseAccount.id,
            amount_cents: 35000,
            description: 'Dumpster service monthly fee'
          }
        ]
      });

      assert.ok(recurring.id);
      assert.equal(recurring.remaining_occurrences, 12);

      // Run due recurring bills pass
      const generated = AccountsPayableRepository.generateDueRecurringBills(now);
      assert.equal(generated.length, 1);
      assert.equal(generated[0]!.total_amount_cents, 35000);
      assert.equal(generated[0]!.vendor_id, vendorId);

      // Verify schedule advanced
      const updatedRecurring = AccountsPayableRepository.listRecurringBills()[0];
      assert.ok(updatedRecurring);
      assert.equal(updatedRecurring.remaining_occurrences, 11);
      assert.ok(updatedRecurring.next_run_date > now);
    });
  });
});
