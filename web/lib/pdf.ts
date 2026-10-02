import { Buffer } from 'node:buffer';

/**
 * Data contract required for rendering an ANSI X9.100-140 standard check.
 */
export interface CheckPdfData {
  check_number: string;
  check_date: string;
  amount_cents: number;
  payee_name: string;
  memo?: string | null;
  bank_name: string;
  bank_routing?: string | null;
  bank_account_number?: string | null;
  payer_name: string;
  payer_address?: string | null;
  bills: {
    invoice_number: string;
    invoice_date: string;
    amount_cents: number;
    allocated_cents: number;
    description?: string | null;
  }[];
}

/**
 * Convert integer cents to written dollar amount string for checks.
 * e.g., 125000 -> "ONE THOUSAND TWO HUNDRED FIFTY AND 00/100 DOLLARS"
 *
 * @param cents - Total amount in integer cents.
 * @returns Formal written currency representation.
 */
export function numberToWords(cents: number): string {
  if (cents <= 0) return 'ZERO AND 00/100 DOLLARS';
  if (cents > 999_999_999_99) {
    throw new Error('Amount exceeds maximum check print limit of $999,999,999.99');
  }

  const dollars = Math.floor(cents / 100);
  const remainingCents = cents % 100;
  const centsStr = String(remainingCents).padStart(2, '0');

  const ones = [
    '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN',
    'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'
  ];
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

  function convertHundreds(n: number): string {
    let str = '';
    if (n >= 100) {
      str += ones[Math.floor(n / 100)] + ' HUNDRED ';
      n %= 100;
    }
    if (n >= 20) {
      str += tens[Math.floor(n / 10)] + (n % 10 !== 0 ? '-' + ones[n % 10] : '') + ' ';
    } else if (n > 0) {
      str += ones[n] + ' ';
    }
    return str.trim();
  }

  const thousands = Math.floor((dollars % 1000000) / 1000);
  const millions = Math.floor(dollars / 1000000);
  const remainder = dollars % 1000;

  let parts: string[] = [];
  if (millions > 0) {
    parts.push(convertHundreds(millions) + ' MILLION');
  }
  if (thousands > 0) {
    parts.push(convertHundreds(thousands) + ' THOUSAND');
  }
  if (remainder > 0 || parts.length === 0) {
    parts.push(convertHundreds(remainder));
  }

  const words = parts.join(' ').trim();
  return `${words} AND ${centsStr}/100 DOLLARS`;
}

/**
 * Escapes characters for PDF literal strings `( ... )`, sanitizing unicode and newlines.
 */
function escapePdfString(str: string): string {
  return str
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\xFF]/g, '?')
    .replace(/\r\n/g, ' ')
    .replace(/[\r\n]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Pure TypeScript zero-dependency PDF 1.4 vector generator for ANSI standard check stock.
 * Top Check with Two Remittance Vouchers (8.5" x 11" Letter).
 *
 * @param check - Check data payload.
 * @returns Buffer containing valid binary PDF stream.
 */
export function generateCheckPdf(check: CheckPdfData): Buffer {
  const ops: string[] = [];

  // Helper operators
  const text = (x: number, y: number, font: string, size: number, str: string) => {
    ops.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfString(str)}) Tj ET`);
  };

  const line = (x1: number, y1: number, x2: number, y2: number, width: number = 0.5, dashed: boolean = false) => {
    if (dashed) {
      ops.push(`q ${width} w [3 3] 0 d ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`);
    } else {
      ops.push(`q ${width} w [] 0 d ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`);
    }
  };

  const rect = (x: number, y: number, w: number, h: number, width: number = 0.5) => {
    ops.push(`q ${width} w [] 0 d ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S Q`);
  };

  // --- TOP PANEL: CHECK (y: 535 to 765) ---
  // Payer
  text(40, 755, 'F2', 11, check.payer_name);
  if (check.payer_address) {
    text(40, 742, 'F1', 8, check.payer_address);
  }

  // Check Number & Date (Top Right)
  text(460, 755, 'F2', 13, `CHECK #${check.check_number}`);
  text(460, 738, 'F1', 9, `DATE: ${check.check_date}`);

  // Bank Info
  text(40, 715, 'F1', 8, check.bank_name);

  // Payee Box
  text(40, 680, 'F1', 7, 'PAY TO THE');
  text(40, 672, 'F1', 7, 'ORDER OF');
  rect(100, 665, 340, 24, 0.75);
  text(108, 673, 'F2', 10, check.payee_name);

  // Dollar Box
  rect(455, 665, 120, 24, 0.75);
  text(462, 673, 'F2', 11, `$***${(check.amount_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`);

  // Legal Amount in Words
  const words = numberToWords(check.amount_cents);
  rect(40, 632, 535, 20, 0.5);
  text(48, 638, 'F2', 8, `*** ${words} ***`);

  // Memo Line
  text(40, 595, 'F1', 8, 'MEMO:');
  line(80, 595, 280, 595, 0.5);
  text(85, 598, 'F1', 8, check.memo || 'Disbursement');

  // Signature Line
  line(360, 595, 560, 595, 0.75);
  text(410, 584, 'F1', 7, 'AUTHORIZED SIGNATURE');

  // MICR Line (Courier Bold emulation)
  const routing = check.bank_routing || '123456789';
  const account = check.bank_account_number || '987654321';
  const micr = `C${check.check_number}C A${routing}A ${account}C`;
  text(120, 550, 'F3', 11, micr);

  // Perforation 1 (y: 530)
  line(20, 530, 592, 530, 0.5, true);
  text(280, 533, 'F1', 6, 'FOLD OR TEAR ALONG PERFORATION');

  // --- MIDDLE PANEL: REMITTANCE VOUCHER (VENDOR COPY) (y: 275 to 515) ---
  text(40, 510, 'F2', 10, check.payer_name);
  text(440, 510, 'F2', 9, 'REMITTANCE ADVICE');
  text(40, 496, 'F1', 8, `Payee: ${check.payee_name}`);
  text(250, 496, 'F1', 8, `Check #: ${check.check_number}`);
  text(360, 496, 'F1', 8, `Date: ${check.check_date}`);
  text(460, 496, 'F2', 8, `Amount: $${(check.amount_cents / 100).toFixed(2)}`);

  // Table header
  rect(40, 470, 532, 16, 0.5);
  text(48, 474, 'F2', 7, 'INVOICE #');
  text(160, 474, 'F2', 7, 'DATE');
  text(240, 474, 'F2', 7, 'DESCRIPTION');
  text(420, 474, 'F2', 7, 'TOTAL');
  text(500, 474, 'F2', 7, 'PAID');

  let rowY = 452;
  for (const bill of check.bills.slice(0, 6)) {
    text(48, rowY, 'F1', 7, bill.invoice_number);
    text(160, rowY, 'F1', 7, bill.invoice_date);
    text(240, rowY, 'F1', 7, (bill.description || 'Bill payment').slice(0, 30));
    text(420, rowY, 'F1', 7, `$${(bill.amount_cents / 100).toFixed(2)}`);
    text(500, rowY, 'F1', 7, `$${(bill.allocated_cents / 100).toFixed(2)}`);
    rowY -= 15;
  }

  // Perforation 2 (y: 265)
  line(20, 265, 592, 265, 0.5, true);
  text(280, 268, 'F1', 6, 'FOLD OR TEAR ALONG PERFORATION');

  // --- BOTTOM PANEL: REMITTANCE VOUCHER (OPERATOR COPY) (y: 15 to 255) ---
  text(40, 245, 'F2', 10, check.payer_name);
  text(440, 245, 'F2', 9, 'OPERATOR COPY');
  text(40, 231, 'F1', 8, `Payee: ${check.payee_name}`);
  text(250, 231, 'F1', 8, `Check #: ${check.check_number}`);
  text(360, 231, 'F1', 8, `Date: ${check.check_date}`);
  text(460, 231, 'F2', 8, `Amount: $${(check.amount_cents / 100).toFixed(2)}`);

  // Table header
  rect(40, 205, 532, 16, 0.5);
  text(48, 209, 'F2', 7, 'INVOICE #');
  text(160, 209, 'F2', 7, 'DATE');
  text(240, 209, 'F2', 7, 'DESCRIPTION');
  text(420, 209, 'F2', 7, 'TOTAL');
  text(500, 209, 'F2', 7, 'PAID');

  let bottomRowY = 187;
  for (const bill of check.bills.slice(0, 6)) {
    text(48, bottomRowY, 'F1', 7, bill.invoice_number);
    text(160, bottomRowY, 'F1', 7, bill.invoice_date);
    text(240, bottomRowY, 'F1', 7, (bill.description || 'Bill payment').slice(0, 30));
    text(420, bottomRowY, 'F1', 7, `$${(bill.amount_cents / 100).toFixed(2)}`);
    text(500, bottomRowY, 'F1', 7, `$${(bill.allocated_cents / 100).toFixed(2)}`);
    bottomRowY -= 15;
  }

  const streamContent = ops.join('\n');
  const streamLength = Buffer.byteLength(streamContent, 'latin1');

  // Build PDF 1.4 objects
  const objects: string[] = [];

  // Obj 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // Obj 3: Page (8.5 x 11 in points: 612 x 792)
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>\nendobj\n'
  );

  // Obj 4: Content Stream
  objects.push(
    `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj\n`
  );

  // Obj 5: Font F1 (Helvetica)
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  // Obj 6: Font F2 (Helvetica-Bold)
  objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

  // Obj 7: Font F3 (Courier-Bold for MICR emulation)
  objects.push('7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>\nendobj\n');

  // Assemble full PDF with byte offsets
  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  let currentOffset = Buffer.byteLength(header, 'latin1');
  const offsets: number[] = [0]; // 0th object

  for (const obj of objects) {
    offsets.push(currentOffset);
    currentOffset += Buffer.byteLength(obj, 'latin1');
  }

  const startXref = currentOffset;
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

  const fullPdf = header + objects.join('') + xref + trailer;
  return Buffer.from(fullPdf, 'latin1');
}
