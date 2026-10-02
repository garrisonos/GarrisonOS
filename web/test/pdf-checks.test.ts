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

  it('handles accented payee names and ensures declared stream length matches stream byte length', () => {
    const pdfBuffer = generateCheckPdf({
      check_number: '005501',
      check_date: '2026-10-02',
      amount_cents: 84000,
      payee_name: 'José & Niño Contractors — Specialty Café',
      memo: 'HVAC repair & café maintenance',
      bank_name: 'Guaranty Trust Bank',
      bank_routing: '111000025',
      bank_account_number: '554433221',
      payer_name: 'Garrison Operators LLC',
      payer_address: '450 Oak Blvd, Suite 200',
      bills: [
        {
          invoice_number: 'INV-9099',
          invoice_date: '2026-10-01',
          amount_cents: 84000,
          allocated_cents: 84000,
          description: 'Café ductwork replacement'
        }
      ]
    });

    assert.ok(Buffer.isBuffer(pdfBuffer));
    const pdfString = pdfBuffer.toString('latin1');

    // Extract stream and verify /Length
    const lengthMatch = pdfString.match(/\/Length (\d+)/);
    assert.ok(lengthMatch);
    const declaredLength = parseInt(lengthMatch[1]!, 10);

    const streamStartMarker = 'stream\n';
    const streamEndMarker = '\nendstream';
    const streamStartIndex = pdfString.indexOf(streamStartMarker) + streamStartMarker.length;
    const streamEndIndex = pdfString.indexOf(streamEndMarker, streamStartIndex);
    assert.ok(streamStartIndex > streamStartMarker.length);
    assert.ok(streamEndIndex > streamStartIndex);

    const actualStreamString = pdfString.substring(streamStartIndex, streamEndIndex);
    const actualStreamLength = Buffer.byteLength(actualStreamString, 'latin1');

    assert.equal(declaredLength, actualStreamLength);
    // Em dash was replaced with - and accented latin-1 letters preserved
    assert.ok(pdfString.includes('Jos\xe9 & Ni\xf1o Contractors - Specialty Caf\xe9'));
  });
});
