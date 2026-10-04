import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { closeDatabase } from '../../../database/client.js';
import { generateDepositSlipPdf, generateRemitterReceiptPdf } from '../../../web/lib/pdf.js';

describe('Accounting Module - Bank Deposits & Receipt PDF Generation', () => {
  beforeEach(() => {
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('generates compliant vector PDF deposit slip with currency itemization', () => {
    const depositPdfBuffer = generateDepositSlipPdf({
      deposit_number: 'DEP-2026-001',
      deposit_date: '2026-10-02',
      bank_name: 'JPMorgan Chase Bank',
      bank_account_number: '987654321',
      payer_name: 'Apex Property Trust',
      total_amount_cents: 425000,
      items: [
        { remitter_name: 'Alice Cooper', payment_method: 'check', reference: 'Check #501', amount_cents: 150000 },
        { remitter_name: 'Bob Martin', payment_method: 'money_order', reference: 'MO #1022', amount_cents: 150000 },
        { remitter_name: 'Carol White', payment_method: 'cash', amount_cents: 125000 }
      ]
    });

    assert.ok(Buffer.isBuffer(depositPdfBuffer));
    assert.ok(depositPdfBuffer.length > 500, 'Deposit slip PDF should be non-empty');
    assert.ok(depositPdfBuffer.toString('binary', 0, 8).startsWith('%PDF-1.4'), 'Must be valid PDF 1.4');

    const pdfString = depositPdfBuffer.toString('latin1');
    assert.ok(pdfString.includes('DEP-2026-001'));
    assert.ok(pdfString.includes('Alice Cooper'));
    assert.ok(pdfString.includes('Bob Martin'));
    assert.ok(pdfString.includes('Carol White'));
    assert.ok(pdfString.includes('4250.00'));
  });

  it('generates printable remitter receipt PDF with legal word amounts', () => {
    const receiptPdfBuffer = generateRemitterReceiptPdf({
      receipt_number: 'RCP-8801',
      receipt_date: '2026-10-02',
      operator_name: 'Apex Property Trust',
      operator_address: '100 Congress Ave, Austin, TX 78701',
      remitter_name: 'Alice Cooper',
      property_name: 'Sunset Apts',
      unit_number: '101',
      payment_method: 'check',
      reference: 'Check #501',
      amount_cents: 150000,
      memo: 'October 2026 Rent'
    });

    assert.ok(Buffer.isBuffer(receiptPdfBuffer));
    assert.ok(receiptPdfBuffer.length > 500);
    assert.ok(receiptPdfBuffer.toString('binary', 0, 8).startsWith('%PDF-1.4'));

    const pdfString = receiptPdfBuffer.toString('latin1');
    assert.ok(pdfString.includes('RCP-8801'));
    assert.ok(pdfString.includes('Alice Cooper'));
    assert.ok(pdfString.includes('1500.00'));
    assert.ok(pdfString.includes('ONE THOUSAND FIVE HUNDRED'));
  });
});
