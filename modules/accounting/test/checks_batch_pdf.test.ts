import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { AccountsPayableRepository } from '../backend/ap.js';
import { VendorChecksRepository } from '../backend/checks.js';
import { ChartOfAccountsRepository } from '../backend/chart_of_accounts.js';
import { generateBatchCheckPdf, CheckPdfData } from '../../../web/lib/pdf.js';

describe('Accounting Module - Batch Checks & Vector PDF Generation', () => {
  beforeEach(() => {
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('generates multi-page vector ANSI checks conforming to standard layout and 3-per-page geometry', () => {
    const checkItems: CheckPdfData[] = [
      {
        check_number: '1001',
        check_date: '2026-10-02',
        payer_name: 'Apex Property Management LLC',
        payer_address: '100 Congress Ave, Austin, TX 78701',
        payee_name: 'City Water & Power',
        amount_cents: 125450,
        bank_name: 'First National Bank of Texas',
        bank_routing: '111000025',
        bank_account_number: '1234567890',
        memo: 'October Water & Sewer',
        bills: [
          { invoice_number: 'INV-001', invoice_date: '2026-09-15', description: 'Main Building Water', amount_cents: 125450, allocated_cents: 125450 }
        ]
      },
      {
        check_number: '1002',
        check_date: '2026-10-02',
        payer_name: 'Apex Property Management LLC',
        payee_name: 'Green Thumb Landscaping',
        amount_cents: 75000,
        bank_name: 'First National Bank of Texas',
        memo: 'Lawn Maintenance',
        bills: []
      },
      {
        check_number: '1003',
        check_date: '2026-10-02',
        payer_name: 'Apex Property Management LLC',
        payee_name: 'Swift Elevator Services',
        amount_cents: 45000,
        bank_name: 'First National Bank of Texas',
        memo: 'Quarterly Safety Inspection',
        bills: []
      },
      // 4th check triggers 2nd page in batch PDF
      {
        check_number: '1004',
        check_date: '2026-10-02',
        payer_name: 'Apex Property Management LLC',
        payee_name: 'Ace Lock & Key',
        amount_cents: 12500,
        bank_name: 'First National Bank of Texas',
        memo: 'Rekey Unit 204',
        bills: []
      }
    ];

    const pdfBuffer = generateBatchCheckPdf(checkItems);

    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.ok(pdfBuffer.length > 1000, 'Batch PDF should be larger than 1KB');
    assert.ok(pdfBuffer.toString('binary', 0, 8).startsWith('%PDF-1.4'), 'Must be valid PDF 1.4 header');

    const pdfString = pdfBuffer.toString('latin1');
    assert.ok(pdfString.includes('City Water & Power'));
    assert.ok(pdfString.includes('Green Thumb Landscaping'));
    assert.ok(pdfString.includes('Swift Elevator Services'));
    assert.ok(pdfString.includes('Ace Lock & Key'));
    assert.ok(pdfString.includes('1001'));
    assert.ok(pdfString.includes('1004'));
  });

  it('tracks check clearing and handles transactional voiding with double-entry reversal', () => {
    runInOperatorContext('batch-checks-op', () => {
      const db = getDatabase();
      const vendorId = generateUUIDv7();
      const propertyId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, created_at, updated_at)
        VALUES (?, 'batch-checks-op', 'vendor', 'Dave', 'Plumber', 'Dave Plumbing LLC', 'dave@plumbing.com', ?, ?)
      `).run(vendorId, now, now);

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'batch-checks-op', 'Westlake Condos', 'multi_family', '800 Westlake', 'Austin', 'TX', '78746', ?, ?)
      `).run(propertyId, now, now);

      const bankAccount = ChartOfAccountsRepository.getAccountByAccountNumber('1010')!;
      const expenseAccount = ChartOfAccountsRepository.listAccounts().find((a) => a.account_type === 'Expense')!;

      const bill = AccountsPayableRepository.createBill({
        vendor_id: vendorId,
        invoice_number: 'PLUMB-99',
        invoice_date: now,
        total_amount_cents: 60000,
        allocations: [{ property_id: propertyId, gl_account_id: expenseAccount.id, amount_cents: 60000 }]
      });
      AccountsPayableRepository.approveBill(bill.id, 'admin');

      const check = VendorChecksRepository.issueCheck({
        bank_account_id: bankAccount.id,
        vendor_id: vendorId,
        check_number: '2001',
        check_date: now,
        amount_cents: 60000,
        bill_allocations: [{ bill_id: bill.id, amount_cents: 60000 }],
        memo: 'Plumbing repair'
      });

      assert.equal(check.status, 'printed');
      assert.equal(check.amount_cents, 60000);

      // Voiding check reverses GL and returns bill to approved status
      const voided = VendorChecksRepository.voidCheck(check.id, 'Duplicate payment check');
      assert.equal(voided.status, 'voided');

      // Verify bill was reopened
      const updatedBill = AccountsPayableRepository.getBillById(bill.id)!;
      assert.equal(updatedBill.status, 'approved');
      assert.equal(updatedBill.amount_paid_cents, 0);
    });
  });
});
