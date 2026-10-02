import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { numberToWords, generateCheckPdf } from '../lib/pdf.js';

describe('PDF Generation - ANSI Check Stock & Formatting', () => {
  it('converts cents into legal check words accurately', () => {
    assert.equal(numberToWords(0), 'ZERO AND 00/100 DOLLARS');
    assert.equal(numberToWords(100), 'ONE AND 00/100 DOLLARS');
    assert.equal(numberToWords(1250), 'TWELVE AND 50/100 DOLLARS');
    assert.equal(numberToWords(45892), 'FOUR HUNDRED FIFTY-EIGHT AND 92/100 DOLLARS');
    assert.equal(numberToWords(125000), 'ONE THOUSAND TWO HUNDRED FIFTY AND 00/100 DOLLARS');
    assert.equal(numberToWords(100000000), 'ONE MILLION AND 00/100 DOLLARS');
    assert.equal(numberToWords(123456789), 'ONE MILLION TWO HUNDRED THIRTY-FOUR THOUSAND FIVE HUNDRED SIXTY-SEVEN AND 89/100 DOLLARS');
  });

  it('generates valid PDF 1.4 byte stream matching ANSI check stock specs', () => {
    const pdfBuffer = generateCheckPdf({
      check_number: '001042',
      check_date: '2026-10-01',
      amount_cents: 125000, // $1,250.00
      payee_name: 'Apex Plumbing Contractors',
      memo: 'Repair work orders #101, #102',
      bank_name: 'First National Bank',
      bank_routing: '123456789',
      bank_account_number: '987654321',
      payer_name: 'Garrison Property Management LLC',
      payer_address: '100 North Capital St, Suite 400',
      bills: [
        {
          invoice_number: 'INV-4011',
          invoice_date: '2026-09-20',
          amount_cents: 75000,
          allocated_cents: 75000,
          description: 'Main water line valve replacement'
        },
        {
          invoice_number: 'INV-4022',
          invoice_date: '2026-09-22',
          amount_cents: 50000,
          allocated_cents: 50000,
          description: 'Boiler pressure gauge calibration'
        }
      ]
    });

    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.ok(pdfBuffer.length > 500);

    const pdfString = pdfBuffer.toString('latin1');

    // PDF 1.4 header
    assert.ok(pdfString.startsWith('%PDF-1.4'));

    // Objects and catalog
    assert.ok(pdfString.includes('/Type /Catalog'));
    assert.ok(pdfString.includes('/Type /Page'));
    assert.ok(pdfString.includes('/MediaBox [0 0 612 792]')); // 8.5 x 11 in points

    // Fonts
    assert.ok(pdfString.includes('/BaseFont /Helvetica'));
    assert.ok(pdfString.includes('/BaseFont /Helvetica-Bold'));
    assert.ok(pdfString.includes('/BaseFont /Courier-Bold'));

    // Content: Check details, MICR line, words
    assert.ok(pdfString.includes('Apex Plumbing Contractors'));
    assert.ok(pdfString.includes('CHECK #001042'));
    assert.ok(pdfString.includes('ONE THOUSAND TWO HUNDRED FIFTY AND 00/100 DOLLARS'));
    assert.ok(pdfString.includes('C001042C A123456789A 987654321C')); // MICR string
    assert.ok(pdfString.includes('REMITTANCE ADVICE'));
    assert.ok(pdfString.includes('OPERATOR COPY'));

    // Trailer and EOF
    assert.ok(pdfString.includes('startxref'));
    assert.ok(pdfString.trimEnd().endsWith('%%EOF'));
  });
});
