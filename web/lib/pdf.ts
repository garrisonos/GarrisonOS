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
 * Data contract for generating an official bank deposit slip PDF.
 */
export interface DepositSlipPdfData {
  deposit_number?: string;
  deposit_date: string;
  bank_name: string;
  bank_routing?: string | null;
  bank_account_number?: string | null;
  payer_name: string;
  memo?: string | null;
  total_amount_cents: number;
  items: {
    receipt_id?: string;
    remitter_name: string;
    payment_method: string;
    reference?: string | null;
    amount_cents: number;
  }[];
}

/**
 * Data contract for generating a tenant/remitter payment receipt PDF.
 */
export interface RemitterReceiptPdfData {
  receipt_number: string;
  receipt_date: string;
  operator_name: string;
  operator_address?: string | null;
  remitter_name: string;
  property_name?: string | null;
  unit_number?: string | null;
  payment_method: string;
  reference?: string | null;
  amount_cents: number;
  memo?: string | null;
}

/**
 * Data contract for generating a marketing property/unit flyer PDF.
 */
export interface MarketingFlyerPdfData {
  property_name: string;
  unit_number?: string | null;
  property_type: string;
  address: string;
  headline?: string | null;
  description?: string | null;
  market_rent_cents?: number | null;
  target_deposit_cents?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  square_feet?: number | null;
  available_date?: string | null;
  amenities: { name: string; category: string }[];
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
}

/**
 * Data contract for generating a printable field technician work order dispatch PDF.
 */
export interface WorkOrderDispatchPdfData {
  work_order_id: string;
  ticket_number: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  property_name: string;
  property_address: string;
  unit_number?: string | null;
  permission_to_enter: boolean | number;
  entry_instructions?: string | null;
  requester_name?: string | null;
  requester_phone?: string | null;
  requester_email?: string | null;
  vendor_name?: string | null;
  vendor_company?: string | null;
  vendor_phone?: string | null;
  vendor_specialty?: string | null;
  scheduled_date?: string | null;
  created_date?: string | null;
  estimated_cost_cents?: number;
  actual_cost_cents?: number;
  tasks?: { title: string; completed?: boolean }[];
  operator_name?: string;
  operator_phone?: string;
  operator_email?: string;
  assigned_vendors?: {
    name: string;
    company?: string | null;
    role: string;
    phone?: string | null;
  }[];
}

/**
 * Convert integer cents to written dollar amount string for checks.
 * e.g., 125000 -> "ONE THOUSAND TWO HUNDRED FIFTY AND 00/100 DOLLARS"
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
 * Helper to build stream content for a single ANSI check page.
 */
function buildCheckStreamOps(check: CheckPdfData): string[] {
  const ops: string[] = [];
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
  text(40, 755, 'F2', 11, check.payer_name);
  if (check.payer_address) {
    text(40, 742, 'F1', 8, check.payer_address);
  }

  text(460, 755, 'F2', 13, `CHECK #${check.check_number}`);
  text(460, 738, 'F1', 9, `DATE: ${check.check_date}`);
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

  // MICR Line
  if (check.bank_routing && check.bank_account_number) {
    const micr = `C${check.check_number}C A${check.bank_routing}A ${check.bank_account_number}C`;
    text(120, 550, 'F3', 11, micr);
  }

  // Perforation 1 (y: 530)
  line(20, 530, 592, 530, 0.5, true);
  text(280, 533, 'F1', 6, 'FOLD OR TEAR ALONG PERFORATION');

  // --- MIDDLE PANEL: REMITTANCE VOUCHER (VENDOR COPY) ---
  text(40, 510, 'F2', 10, check.payer_name);
  text(440, 510, 'F2', 9, 'REMITTANCE ADVICE');
  text(40, 496, 'F1', 8, `Payee: ${check.payee_name}`);
  text(250, 496, 'F1', 8, `Check #: ${check.check_number}`);
  text(360, 496, 'F1', 8, `Date: ${check.check_date}`);
  text(460, 496, 'F2', 8, `Amount: $${(check.amount_cents / 100).toFixed(2)}`);

  rect(40, 470, 532, 16, 0.5);
  text(48, 474, 'F2', 7, 'INVOICE #');
  text(160, 474, 'F2', 7, 'DATE');
  text(240, 474, 'F2', 7, 'DESCRIPTION');
  text(420, 474, 'F2', 7, 'TOTAL');
  text(500, 474, 'F2', 7, 'PAID');

  let rowY = 452;
  for (const bill of (check.bills || []).slice(0, 6)) {
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

  // --- BOTTOM PANEL: REMITTANCE VOUCHER (OPERATOR COPY) ---
  text(40, 245, 'F2', 10, check.payer_name);
  text(440, 245, 'F2', 9, 'OPERATOR COPY');
  text(40, 231, 'F1', 8, `Payee: ${check.payee_name}`);
  text(250, 231, 'F1', 8, `Check #: ${check.check_number}`);
  text(360, 231, 'F1', 8, `Date: ${check.check_date}`);
  text(460, 231, 'F2', 8, `Amount: $${(check.amount_cents / 100).toFixed(2)}`);

  rect(40, 205, 532, 16, 0.5);
  text(48, 209, 'F2', 7, 'INVOICE #');
  text(160, 209, 'F2', 7, 'DATE');
  text(240, 209, 'F2', 7, 'DESCRIPTION');
  text(420, 209, 'F2', 7, 'TOTAL');
  text(500, 209, 'F2', 7, 'PAID');

  let bottomRowY = 187;
  for (const bill of (check.bills || []).slice(0, 6)) {
    text(48, bottomRowY, 'F1', 7, bill.invoice_number);
    text(160, bottomRowY, 'F1', 7, bill.invoice_date);
    text(240, bottomRowY, 'F1', 7, (bill.description || 'Bill payment').slice(0, 30));
    text(420, bottomRowY, 'F1', 7, `$${(bill.amount_cents / 100).toFixed(2)}`);
    text(500, bottomRowY, 'F1', 7, `$${(bill.allocated_cents / 100).toFixed(2)}`);
    bottomRowY -= 15;
  }

  return ops;
}

/**
 * Pure TypeScript zero-dependency PDF 1.4 vector generator for a single ANSI standard check stock.
 */
export function generateCheckPdf(check: CheckPdfData): Buffer {
  return generateBatchCheckPdf([check]);
}

/**
 * Generates a consolidated multi-page PDF document containing multiple checks (1 check per 8.5" x 11" page).
 */
export function generateBatchCheckPdf(checks: CheckPdfData[]): Buffer {
  if (checks.length === 0) {
    throw new Error('At least one check is required for batch check PDF generation.');
  }

  const objects: string[] = [];
  let nextObjId = 1;

  const catalogObjId = nextObjId++;
  const pagesObjId = nextObjId++;

  const fontF1Id = nextObjId++;
  const fontF2Id = nextObjId++;
  const fontF3Id = nextObjId++;

  const pageIds: number[] = [];
  const pageObjectStrings: string[] = [];
  const contentObjectStrings: string[] = [];

  for (const check of checks) {
    const pageId = nextObjId++;
    const contentId = nextObjId++;
    pageIds.push(pageId);

    const ops = buildCheckStreamOps(check);
    const streamContent = ops.join('\n');
    const streamLen = Buffer.byteLength(streamContent, 'latin1');

    pageObjectStrings.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontF1Id} 0 R /F2 ${fontF2Id} 0 R /F3 ${fontF3Id} 0 R >> >> >>\nendobj\n`
    );

    contentObjectStrings.push(
      `${contentId} 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj\n`
    );
  }

  // Catalog & Pages
  const kidsStr = pageIds.map((id) => `${id} 0 R`).join(' ');
  objects.push(`${catalogObjId} 0 obj\n<< /Type /Catalog /Pages ${pagesObjId} 0 R >>\nendobj\n`);
  objects.push(`${pagesObjId} 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageIds.length} >>\nendobj\n`);

  // Fonts
  objects.push(`${fontF1Id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  objects.push(`${fontF2Id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`);
  objects.push(`${fontF3Id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>\nendobj\n`);

  // Append pages and content streams
  for (let i = 0; i < pageObjectStrings.length; i++) {
    const pObj = pageObjectStrings[i];
    const cObj = contentObjectStrings[i];
    if (pObj) objects.push(pObj);
    if (cObj) objects.push(cObj);
  }

  return assemblePdf(objects);
}

/**
 * Generates an official vector PDF bank deposit slip.
 */
export function generateDepositSlipPdf(data: DepositSlipPdfData): Buffer {
  const ops: string[] = [];
  const text = (x: number, y: number, font: string, size: number, str: string) => {
    ops.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfString(str)}) Tj ET`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, width: number = 0.5) => {
    ops.push(`q ${width} w [] 0 d ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`);
  };
  const rect = (x: number, y: number, w: number, h: number, width: number = 0.5) => {
    ops.push(`q ${width} w [] 0 d ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S Q`);
  };

  // Header Box
  text(40, 740, 'F2', 16, 'OFFICIAL BANK DEPOSIT SLIP');
  text(40, 722, 'F1', 9, `Depositor: ${data.payer_name}`);
  text(40, 710, 'F1', 9, `Bank: ${data.bank_name}`);
  text(40, 698, 'F1', 9, `Account #: ${data.bank_account_number || ''}`);

  text(420, 740, 'F2', 11, `DATE: ${data.deposit_date}`);
  if (data.deposit_number) {
    text(420, 726, 'F1', 9, `DEPOSIT REF: ${data.deposit_number}`);
  }
  text(420, 712, 'F2', 11, `TOTAL: $${(data.total_amount_cents / 100).toFixed(2)}`);

  line(40, 680, 572, 680, 1);

  // Table
  rect(40, 650, 532, 18, 0.75);
  text(48, 655, 'F2', 8, 'REMITTER / PAYER');
  text(220, 655, 'F2', 8, 'METHOD');
  text(320, 655, 'F2', 8, 'REFERENCE');
  text(480, 655, 'F2', 8, 'AMOUNT ($)');

  let y = 630;
  for (const item of (data.items || []).slice(0, 25)) {
    text(48, y, 'F1', 8, item.remitter_name.slice(0, 30));
    text(220, y, 'F1', 8, item.payment_method.toUpperCase());
    text(320, y, 'F1', 8, (item.reference || '-').slice(0, 20));
    text(480, y, 'F2', 8, `$${(item.amount_cents / 100).toFixed(2)}`);
    line(40, y - 4, 572, y - 4, 0.25);
    y -= 18;
  }

  // Summary box at bottom
  y = Math.min(y - 20, 160);
  rect(320, y - 10, 252, 40, 0.75);
  text(330, y + 14, 'F1', 9, `Total Items Count: ${data.items.length}`);
  text(330, y, 'F2', 11, `Net Bank Deposit: $${(data.total_amount_cents / 100).toFixed(2)}`);

  // Teller / Signature section
  text(40, y + 10, 'F1', 8, 'TELLER VERIFICATION SIGNATURE:');
  line(40, y - 5, 260, y - 5, 0.5);

  const streamContent = ops.join('\n');
  const streamLen = Buffer.byteLength(streamContent, 'latin1');

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n'
  ];

  return assemblePdf(objects);
}

/**
 * Generates an official payment receipt PDF for a tenant/remitter.
 */
export function generateRemitterReceiptPdf(data: RemitterReceiptPdfData): Buffer {
  const ops: string[] = [];
  const text = (x: number, y: number, font: string, size: number, str: string) => {
    ops.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfString(str)}) Tj ET`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, width: number = 0.5) => {
    ops.push(`q ${width} w [] 0 d ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`);
  };
  const rect = (x: number, y: number, w: number, h: number, width: number = 0.5) => {
    ops.push(`q ${width} w [] 0 d ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S Q`);
  };

  // Header Box
  text(40, 740, 'F2', 18, 'PAYMENT RECEIPT');
  text(40, 720, 'F1', 10, data.operator_name);
  if (data.operator_address) {
    text(40, 706, 'F1', 9, data.operator_address);
  }

  text(420, 740, 'F2', 11, `RECEIPT #: ${data.receipt_number}`);
  text(420, 724, 'F1', 9, `DATE: ${data.receipt_date}`);

  line(40, 685, 572, 685, 1);

  // Remitter Info Box
  rect(40, 610, 532, 60, 0.5);
  text(50, 650, 'F2', 9, 'RECEIVED FROM:');
  text(160, 650, 'F1', 9, data.remitter_name);
  text(50, 634, 'F2', 9, 'PROPERTY / UNIT:');
  text(160, 634, 'F1', 9, `${data.property_name || 'General Portfolio'} ${data.unit_number ? '- Unit ' + data.unit_number : ''}`);
  text(50, 618, 'F2', 9, 'PAYMENT METHOD:');
  text(160, 618, 'F1', 9, `${data.payment_method.toUpperCase()} ${data.reference ? '(Ref: ' + data.reference + ')' : ''}`);

  // Amount Block
  rect(40, 530, 532, 60, 0.75);
  text(50, 565, 'F2', 12, 'TOTAL AMOUNT RECEIVED:');
  text(380, 565, 'F2', 16, `$${(data.amount_cents / 100).toFixed(2)}`);
  const words = numberToWords(data.amount_cents);
  text(50, 542, 'F1', 8, `Legal Amount: *** ${words} ***`);

  if (data.memo) {
    text(40, 500, 'F1', 9, `Memo / Notes: ${data.memo}`);
  }

  text(40, 440, 'F1', 8, 'Thank you for your prompt payment.');
  text(40, 428, 'F1', 8, 'This electronic receipt confirms funds collected into GarrisonOS Property Management.');

  const streamContent = ops.join('\n');
  const streamLen = Buffer.byteLength(streamContent, 'latin1');

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n'
  ];

  return assemblePdf(objects);
}

/**
 * Generates a branded marketing flyer PDF for a property or unit.
 */
export function generateMarketingFlyerPdf(data: MarketingFlyerPdfData): Buffer {
  const ops: string[] = [];
  const text = (x: number, y: number, font: string, size: number, str: string) => {
    ops.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfString(str)}) Tj ET`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, width: number = 0.5) => {
    ops.push(`q ${width} w [] 0 d ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`);
  };
  const rect = (x: number, y: number, w: number, h: number, width: number = 0.5) => {
    ops.push(`q ${width} w [] 0 d ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S Q`);
  };

  // Header Banner
  rect(30, 700, 552, 62, 1);
  text(45, 735, 'F2', 20, data.property_name);
  if (data.unit_number) {
    text(45, 715, 'F1', 12, `Unit ${data.unit_number} – ${data.property_type.replace(/_/g, ' ').toUpperCase()}`);
  } else {
    text(45, 715, 'F1', 12, data.property_type.replace(/_/g, ' ').toUpperCase());
  }
  if (data.market_rent_cents) {
    text(420, 725, 'F2', 18, `$${(data.market_rent_cents / 100).toFixed(0)} / mo`);
  }

  // Location & Specs
  text(35, 675, 'F1', 10, `Location: ${data.address}`);
  const specs: string[] = [];
  if (data.bedrooms !== undefined && data.bedrooms !== null) specs.push(`Bedrooms: ${data.bedrooms}`);
  if (data.bathrooms !== undefined && data.bathrooms !== null) specs.push(`Bathrooms: ${data.bathrooms}`);
  if (data.target_deposit_cents) specs.push(`Deposit: $${(data.target_deposit_cents / 100).toFixed(0)}`);
  if (data.square_feet) specs.push(`Sq Ft: ${data.square_feet}`);
  if (specs.length > 0) {
    text(35, 655, 'F2', 10, specs.join('   |   '));
  }

  line(30, 640, 582, 640, 0.5);

  // Marketing Headline & Description
  if (data.headline) {
    text(35, 620, 'F2', 13, data.headline);
  }
  if (data.description) {
    const descLines = data.description.slice(0, 400).split('\n');
    let descY = 600;
    for (const dLine of descLines) {
      text(35, descY, 'F1', 9, dLine.slice(0, 95));
      descY -= 14;
    }
  }

  // Amenities Section
  text(35, 480, 'F2', 12, 'PROPERTY & RESIDENCE HIGHLIGHTS');
  line(35, 472, 575, 472, 0.5);

  let amY = 450;
  let amX = 40;
  const amList = data.amenities || [];
  for (let i = 0; i < Math.min(amList.length, 16); i++) {
    const a = amList[i];
    if (a) {
      text(amX, amY, 'F1', 8, `* ${a.name} (${a.category})`);
    }
    if (i % 2 === 1) {
      amY -= 16;
      amX = 40;
    } else {
      amX = 300;
    }
  }

  // Contact Footer Box
  rect(30, 80, 552, 60, 0.75);
  text(45, 120, 'F2', 11, 'FOR INQUIRIES & TO SCHEDULE A TOUR:');
  text(45, 102, 'F1', 10, `Contact: ${data.contact_name || 'Leasing Office'}`);
  text(320, 102, 'F1', 10, `Phone: ${data.contact_phone || 'Call Manager'}   |   Email: ${data.contact_email || 'leasing@garrisonos.local'}`);

  const streamContent = ops.join('\n');
  const streamLen = Buffer.byteLength(streamContent, 'latin1');

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n'
  ];

  return assemblePdf(objects);
}

/**
 * Generate a printable, zero-dependency field maintenance work order dispatch PDF.
 * Formatted for standard 8.5" x 11" Letter page.
 *
 * @param data - Work order dispatch details.
 * @returns PDF 1.4 binary buffer.
 */
export function generateWorkOrderPdf(data: WorkOrderDispatchPdfData): Buffer {
  const ops: string[] = [];

  const text = (x: number, y: number, font: string, size: number, str: string) => {
    ops.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfString(str || '')}) Tj ET`);
  };

  const line = (x1: number, y1: number, x2: number, y2: number, width = 1) => {
    ops.push(`q ${width} w [] 0 d ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`);
  };

  const rect = (x: number, y: number, w: number, h: number, width = 1) => {
    ops.push(`q ${width} w [] 0 d ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S Q`);
  };

  const filledRect = (x: number, y: number, w: number, h: number, gray = 0.9) => {
    ops.push(`q ${gray} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q`);
  };

  // Header Banner
  text(35, 750, 'F2', 17, data.operator_name || 'GARRISON PROPERTY MANAGEMENT');
  text(35, 735, 'F1', 9, 'FIELD MAINTENANCE DISPATCH & WORK ORDER SHEET');
  text(35, 722, 'F1', 8, `Printed: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}   |   Reported: ${data.created_date || 'Active'}`);

  // Ticket Box (Right Header)
  filledRect(390, 715, 185, 48, 0.95);
  rect(390, 715, 185, 48, 1);
  text(400, 745, 'F2', 13, `TICKET #${data.ticket_number}`);
  text(400, 730, 'F2', 9, `PRIORITY: ${(data.priority || 'NORMAL').toUpperCase()}`);
  text(495, 730, 'F2', 9, `STATUS: ${(data.status || 'OPEN').toUpperCase()}`);

  line(35, 706, 575, 706, 1.25);

  // 1. Location & Entry Instructions Box
  filledRect(35, 625, 540, 72, 0.96);
  rect(35, 625, 540, 72, 0.75);
  text(45, 683, 'F2', 10, 'PROPERTY LOCATION & ACCESS / ENTRY INSTRUCTIONS');
  text(45, 668, 'F2', 9.5, `Property: ${data.property_name}`);
  text(45, 655, 'F1', 8.5, `Address: ${data.property_address}`);
  text(340, 668, 'F2', 9.5, `Unit / Space: ${data.unit_number ? 'Unit ' + data.unit_number : 'Common Area / Entire Property'}`);
  const enterAllowed = Boolean(data.permission_to_enter);
  text(45, 640, 'F2', 8.5, `Permission to Enter: ${enterAllowed ? 'GRANTED - OK to enter if resident absent' : 'APPOINTMENT REQUIRED - Call resident first'}`);
  text(45, 630, 'F1', 8, `Access / Lockbox Notes: ${data.entry_instructions || 'Standard key / lockbox on site. Contact property manager if locked.'}`);

  // 2. Requester / Resident & Assigned Contractor (Side-by-Side Boxes)
  // Left: Resident / Requester Box
  rect(35, 555, 265, 62, 0.75);
  text(45, 603, 'F2', 9, 'RESIDENT / OCCUPANT CONTACT');
  text(45, 589, 'F1', 8.5, `Name: ${data.requester_name || 'Resident on record'}`);
  text(45, 576, 'F1', 8.5, `Phone: ${data.requester_phone || 'On file with property manager'}`);
  text(45, 563, 'F1', 8, `Email: ${data.requester_email || '—'}`);

  // Right: Assigned Contractor / Tech Box
  rect(310, 555, 265, 62, 0.75);
  const vendorCount = data.assigned_vendors?.length || 0;
  text(320, 603, 'F2', 9, vendorCount > 1 ? `ASSIGNED CONTRACTORS (${vendorCount})` : 'ASSIGNED TECHNICIAN / VENDOR');
  if (data.assigned_vendors && data.assigned_vendors.length > 1) {
    const v1 = data.assigned_vendors[0];
    const v2 = data.assigned_vendors[1];
    if (v1 && v2) {
      text(320, 589, 'F1', 8, `1. ${v1.name}${v1.company ? ` (${v1.company})` : ''} - ${v1.role}`);
      text(320, 576, 'F1', 8, `2. ${v2.name}${v2.company ? ` (${v2.company})` : ''} - ${v2.role}`);
      text(320, 563, 'F1', 8, `Sched: ${data.scheduled_date || 'Immediate'}${vendorCount > 2 ? ` (+${vendorCount - 2} more on file)` : ''}`);
    }
  } else {
    text(320, 589, 'F1', 8.5, `Contractor: ${data.vendor_company || data.vendor_name || 'In-House Maintenance Staff'}`);
    text(320, 576, 'F1', 8.5, `Contact / Phone: ${data.vendor_phone || 'Call Operations Office'}`);
    text(320, 563, 'F1', 8, `Trade Specialty: ${(data.vendor_specialty || data.category || 'General').toUpperCase()}   |   Sched: ${data.scheduled_date || 'Immediate'}`);
  }

  // 3. Work Order Scope & Description
  rect(35, 440, 540, 105, 0.75);
  text(45, 530, 'F2', 10, 'ISSUE SCOPE & TECHNICIAN WORK INSTRUCTIONS');
  text(380, 530, 'F2', 9, `TRADE: ${(data.category || 'GENERAL').toUpperCase()}`);
  text(45, 514, 'F2', 9.5, `Subject: ${data.title}`);
  line(45, 508, 565, 508, 0.5);

  const rawDesc = (data.description || 'No detailed instructions entered.');
  const descWords = rawDesc.replace(/\r?\n/g, ' ').split(' ');
  let descLine = '';
  let lineY = 494;
  for (const w of descWords) {
    if ((descLine + ' ' + w).length > 88) {
      text(45, lineY, 'F1', 8.5, descLine);
      lineY -= 12;
      descLine = w;
      if (lineY < 448) break;
    } else {
      descLine = descLine ? descLine + ' ' + w : w;
    }
  }
  if (descLine && lineY >= 448) {
    text(45, lineY, 'F1', 8.5, descLine);
  }

  // 4. Checklist & Task Inspection Items
  rect(35, 335, 540, 95, 0.75);
  text(45, 417, 'F2', 9.5, 'FIELD CHECKLIST & SERVICE VERIFICATION ITEMS');
  line(45, 411, 565, 411, 0.5);

  const tasksList = (data.tasks && data.tasks.length > 0)
    ? data.tasks
    : [
        { title: 'Locate unit, inspect reported issue, and isolate utilities if required' },
        { title: 'Complete repair, parts installation, or component servicing per specs' },
        { title: 'Test equipment under active load, verify zero leaks or circuit faults' },
        { title: 'Clean work area, remove debris, and ensure resident door is securely locked' }
      ];

  let taskY = 397;
  for (let i = 0; i < Math.min(tasksList.length, 4); i++) {
    const t = tasksList[i];
    if (t) {
      rect(45, taskY - 1, 9, 9, 0.75);
      text(60, taskY, 'F1', 8.5, t.title.slice(0, 92));
    }
    taskY -= 17;
  }

  // 5. Materials, Parts & Van Expense Log
  rect(35, 195, 540, 130, 0.75);
  text(45, 312, 'F2', 9.5, 'PARTS, MATERIALS & LABOR EXPENSE TRACKING (LOG FOR INVOICE)');
  const estBudget = data.estimated_cost_cents ? `$${(data.estimated_cost_cents / 100).toFixed(2)}` : 'Open';
  text(380, 312, 'F2', 9, `APPROVED BUDGET: ${estBudget}`);
  line(45, 306, 565, 306, 0.5);

  text(45, 294, 'F2', 8, 'QTY');
  text(80, 294, 'F2', 8, 'PART # / MATERIAL DESCRIPTION');
  text(380, 294, 'F2', 8, 'UNIT COST');
  text(480, 294, 'F2', 8, 'TOTAL COST');

  line(45, 276, 565, 276, 0.5);
  line(45, 258, 565, 258, 0.5);
  line(45, 240, 565, 240, 0.5);
  line(45, 222, 565, 222, 0.5);

  text(45, 206, 'F1', 8, 'Labor: Start: _________ End: _________ Total Tech Hours: _______ Rate: $_______ Total Labor: $_______');

  // 6. Sign-off, Completion & Van Invoicing Box
  rect(35, 45, 540, 140, 0.75);
  text(45, 172, 'F2', 9.5, 'WORK ORDER SIGN-OFF & FIELD COMPLETION CERTIFICATE');
  line(45, 166, 565, 166, 0.5);

  text(45, 150, 'F1', 8.5, 'Technician Signature: _____________________________________   Date Completed: _______________');
  text(45, 132, 'F1', 8.5, 'Technician Printed Name: _________________________________   Total Billable Time: ___________');
  text(45, 114, 'F1', 8.5, 'Resident / Site Acceptance: _______________________________   Resident Present: [  ] Yes  [  ] No');
  text(45, 96, 'F2', 9, `Final Work Order Total: $____________________   Invoice/Ref: ${data.ticket_number}`);
  text(45, 78, 'F1', 8, 'Notes on Completion / Follow-Up Needed: ____________________________________________________');
  text(45, 58, 'F1', 7, `GarrisonOS Zero-Dependency Operations   |   Emergency Contact: ${data.operator_phone || 'Property Office'}   |   Document ID: ${data.work_order_id}`);

  const streamContent = ops.join('\n');
  const streamLen = Buffer.byteLength(streamContent, 'latin1');

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n'
  ];

  return assemblePdf(objects);
}

/**
 * Internal helper to assemble objects into a valid PDF stream.
 */
function assemblePdf(objects: string[]): Buffer {
  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  let currentOffset = Buffer.byteLength(header, 'latin1');
  const offsets: number[] = [0];

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
