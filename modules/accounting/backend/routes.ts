import { ServerResponse } from 'node:http';
import { getDatabase } from '../../../database/client.js';
import { Router, ApiRequest } from '../../../api/router.js';
import { successResponse, errorResponse } from '../../../api/response.js';
import { requirePermission, requirePortfolioAccess } from '../../../api/middleware.js';
import { AccountingRepository } from './repository.js';
import { generateMonthlyRentCharges } from './billing.js';
import { ChartOfAccountsRepository } from './chart_of_accounts.js';
import { QuickBooksService } from './quickbooks.js';
import { JournalService } from './journal.js';
import { RequestContext } from '../../../core/context.js';
import { canAccessPortfolio } from '../../../core/rbac.js';
import { ClientAccountingRepository } from './client_accounting.js';
import { AccountsPayableRepository } from './ap.js';
import { VendorCreditsRepository } from './vendor_credits.js';
import { VendorChecksRepository } from './checks.js';
import { BankDepositsRepository } from './bank_deposits.js';
import { generateCheckPdf, generateBatchCheckPdf, generateDepositSlipPdf, generateRemitterReceiptPdf } from '../../../web/lib/pdf.js';

/**
 * Strict integer query parameter parser that validates bounds and rejects NaN.
 *
 * @param req Incoming API request.
 * @param res HTTP response.
 * @param paramName Query parameter name.
 * @param options Parsing and validation options.
 * @returns Object with parsed value and error flag.
 */
function parseIntegerParam(
  req: ApiRequest,
  res: ServerResponse,
  paramName: string,
  options: {
    required?: boolean;
    defaultValue?: number;
    min?: number;
    max?: number;
  } = {}
): { value?: number; hasError: boolean } {
  const raw = req.query[paramName];
  if (raw === undefined || raw === '') {
    if (options.required) {
      errorResponse(res, 'VALIDATION_ERROR', `Query parameter "${paramName}" is required`, 400);
      return { hasError: true };
    }
    return { value: options.defaultValue, hasError: false };
  }

  // Strict integer check (digits with optional leading sign)
  if (!/^-?\d+$/.test(raw)) {
    errorResponse(
      res,
      'VALIDATION_ERROR',
      `Query parameter "${paramName}" must be a valid integer`,
      400
    );
    return { hasError: true };
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    errorResponse(
      res,
      'VALIDATION_ERROR',
      `Query parameter "${paramName}" must be a safe integer`,
      400
    );
    return { hasError: true };
  }

  if (options.min !== undefined && parsed < options.min) {
    errorResponse(
      res,
      'VALIDATION_ERROR',
      `Query parameter "${paramName}" cannot be less than ${options.min}`,
      400
    );
    return { hasError: true };
  }

  if (options.max !== undefined && parsed > options.max) {
    errorResponse(
      res,
      'VALIDATION_ERROR',
      `Query parameter "${paramName}" cannot be greater than ${options.max}`,
      400
    );
    return { hasError: true };
  }

  return { value: parsed, hasError: false };
}

/**
 * Ensures caller is authenticated with a valid user session.
 *
 * @param req Incoming API request.
 * @param res HTTP response.
 * @returns True if caller is authenticated; false if response was written.
 */
function requireAuth(req: ApiRequest, res: ServerResponse): boolean {
  if (!req.userId) {
    errorResponse(res, 'UNAUTHORIZED', 'Authentication is required for this endpoint', 401);
    return false;
  }
  return true;
}

/**
 * Registers all accounting module HTTP routes with the application router.
 *
 * @param router Application router instance.
 */
export function registerRoutes(router: Router): void {
  // --- Rent Roll ---
  router.getBatchSafe('/api/v1/accounting/rent-roll', (req, res) => {
    const propertyId = req.query.property_id || undefined;
    const portfolio = req.query.portfolio || undefined;
    let rentRoll = AccountingRepository.getRentRoll();
    if (propertyId) {
      rentRoll = rentRoll.filter(r => r.property_id === propertyId);
    }
    if (portfolio) {
      rentRoll = rentRoll.filter(r => r.portfolio_id === portfolio);
    }
    const totalScheduledRentCents = rentRoll.reduce((sum, r) => sum + r.monthly_rent_cents, 0);
    const totalDelinquencyCents = rentRoll.reduce((sum, r) => sum + Math.max(0, r.balance_cents), 0);
    const delinquentUnitsCount = rentRoll.filter(r => r.balance_cents > 0).length;

    successResponse(res, {
      rentRoll,
      summary: {
        totalUnits: rentRoll.length,
        totalScheduledRentCents,
        totalDelinquencyCents,
        delinquentUnitsCount
      }
    });
  });

  // --- Schedule E Report ---
  router.get('/api/v1/accounting/schedule-e', (req, res) => {
    const yearRes = parseIntegerParam(req, res, 'year', {
      defaultValue: new Date().getUTCFullYear(),
      min: 1900,
      max: 2100
    });
    if (yearRes.hasError) return;
    const propertyId = req.query.property_id || undefined;
    const report = AccountingRepository.getScheduleEReport({ year: yearRes.value!, property_id: propertyId });
    successResponse(res, { year: yearRes.value, property_id: propertyId, report });
  });

  // --- Lease Balance & Ledger ---
  router.get('/api/v1/accounting/balance/:lease_id', (req, res) => {
    const leaseId = req.params.lease_id || req.params.leaseId;
    const balance = AccountingRepository.getLeaseBalance(leaseId!);
    const transactions = AccountingRepository.getLeaseTransactions(leaseId!);
    successResponse(res, { balance, transactions });
  });

  // --- Automated Recurring Rent Charges ---
  router.post('/api/v1/accounting/generate-rent-charges', (req, res) => {
    const targetMonth = req.body?.month; // e.g. "2026-09"
    const result = generateMonthlyRentCharges(targetMonth);
    successResponse(res, { result });
  });

  // --- Move-Out Deposit Disposition ---
  router.post('/api/v1/accounting/deposit-disposition', (req, res) => {
    const { lease_id, deductions } = req.body || {};
    if (!lease_id) {
      return errorResponse(res, 'VALIDATION_ERROR', 'lease_id is required', 400);
    }
    try {
      const result = AccountingRepository.processDepositDisposition(lease_id, deductions || []);
      successResponse(res, { result });
    } catch (err: any) {
      errorResponse(res, 'DISPOSITION_FAILED', err.message, 400);
    }
  });

  // --- Statutory Trust Three-Way Reconciliation ---
  router.getBatchSafe('/api/v1/accounting/reconciliation/three-way', (req, res) => {
    if (!requireAuth(req, res)) return;
    const asOfRes = parseIntegerParam(req, res, 'as_of', { min: 1 });
    if (asOfRes.hasError) return;
    const bankRes = parseIntegerParam(req, res, 'bank_balance', { min: 0 });
    if (bankRes.hasError) return;
    const reconciliation = AccountingRepository.getThreeWayReconciliation(asOfRes.value, bankRes.value);
    successResponse(res, reconciliation);
  });

  // --- IRS Form 1099-NEC Vendor Expense Report ---
  router.getBatchSafe('/api/v1/accounting/reports/1099-nec', (req, res) => {
    if (!requireAuth(req, res)) return;
    const yearRes = parseIntegerParam(req, res, 'year', {
      defaultValue: new Date().getUTCFullYear(),
      min: 1900,
      max: 2100
    });
    if (yearRes.hasError) return;
    const report = AccountingRepository.getVendor1099Report(yearRes.value!);
    successResponse(res, report);
  });

  // --- Statutory Move-Out Disposition Timeline ---
  router.getBatchSafe('/api/v1/accounting/disposition/timeline', (req, res) => {
    if (!requireAuth(req, res)) return;
    const moveOutRes = parseIntegerParam(req, res, 'move_out_date', {
      defaultValue: Date.now(),
      min: 1
    });
    if (moveOutRes.hasError) return;
    const state = req.query.state || 'US';
    try {
      const timeline = AccountingRepository.getStatutoryDispositionTimeline(moveOutRes.value!, state);
      successResponse(res, timeline);
    } catch (err: any) {
      errorResponse(res, 'VALIDATION_ERROR', err.message, 400);
    }
  });

  // --- Transactions CRUD ---
  router.getBatchSafe('/api/v1/accounting/transactions', (req, res) => {
    const startRes = parseIntegerParam(req, res, 'start_date', { min: 1 });
    if (startRes.hasError) return;
    const endRes = parseIntegerParam(req, res, 'end_date', { min: 1 });
    if (endRes.hasError) return;
    const limitRes = parseIntegerParam(req, res, 'limit', { min: 1, max: 1000 });
    if (limitRes.hasError) return;

    const transactions = AccountingRepository.listTransactions({
      lease_id: req.query.lease_id,
      property_id: req.query.property_id,
      portfolio: req.query.portfolio,
      unit_id: req.query.unit_id,
      transaction_type: req.query.transaction_type,
      category: req.query.category,
      start_date: startRes.value,
      end_date: endRes.value,
      limit: limitRes.value
    });
    successResponse(res, { transactions });
  });

  router.post('/api/v1/accounting/transactions', (req, res) => {
    const { transaction_type, category, amount_cents, description } = req.body || {};
    if (!transaction_type || !category || amount_cents === undefined || !description) {
      return errorResponse(res, 'VALIDATION_ERROR', 'transaction_type, category, amount_cents, and description are required', 400);
    }
    try {
      const transaction = AccountingRepository.createTransaction({
        transaction_type,
        category,
        amount_cents: parseInt(amount_cents, 10),
        transaction_date: req.body.transaction_date ? parseInt(req.body.transaction_date, 10) : Date.now(),
        description,
        payment_method: req.body.payment_method || null,
        reference_number: req.body.reference_number || null,
        property_id: req.body.property_id || null,
        unit_id: req.body.unit_id || null,
        lease_id: req.body.lease_id || null,
        payer_contact_id: req.body.payer_contact_id || null,
        payee_contact_id: req.body.payee_contact_id || null
      });
      successResponse(res, { transaction }, 201);
    } catch (err: any) {
      errorResponse(res, 'TRANSACTION_POST_FAILED', err.message, 400);
    }
  });

  router.get('/api/v1/accounting/transactions/:id', (req, res) => {
    const transaction = AccountingRepository.getTransactionById(req.params.id!);
    if (!transaction) {
      return errorResponse(res, 'NOT_FOUND', 'Transaction not found', 404);
    }
    successResponse(res, { transaction });
  });

  router.delete('/api/v1/accounting/transactions/:id', (req, res) => {
    const deleted = AccountingRepository.deleteTransaction(req.params.id!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Transaction not found', 404);
    }
    successResponse(res, { deleted: true });
  });

  // ==========================================
  // --- Native Double-Entry General Ledger ---
  // ==========================================

  // Trial Balance Report
  router.get('/api/v1/accounting/trial-balance', (req, res) => {
    const asOfRes = parseIntegerParam(req, res, 'as_of_date', { min: 1 });
    if (asOfRes.hasError) return;
    const propertyId = req.query.property_id || undefined;
    const trialBalance = JournalService.getTrialBalance(asOfRes.value, propertyId);
    successResponse(res, { trialBalance });
  });

  // List General Ledger Journal Entries
  router.get('/api/v1/accounting/journal-entries', (req, res) => {
    const limitRes = parseIntegerParam(req, res, 'limit', { defaultValue: 50, min: 1, max: 200 });
    if (limitRes.hasError) return;
    const offsetRes = parseIntegerParam(req, res, 'offset', { defaultValue: 0, min: 0 });
    if (offsetRes.hasError) return;
    const startRes = parseIntegerParam(req, res, 'start_date', { min: 1 });
    if (startRes.hasError) return;
    const endRes = parseIntegerParam(req, res, 'end_date', { min: 1 });
    if (endRes.hasError) return;

    const { entries, total } = JournalService.listEntries({
      source_type: req.query.source_type,
      source_id: req.query.source_id,
      start_date: startRes.value,
      end_date: endRes.value,
      limit: limitRes.value!,
      offset: offsetRes.value!
    });
    successResponse(res, { entries, total });
  });

  // Get Journal Entry by ID
  router.get('/api/v1/accounting/journal-entries/:id', (req, res) => {
    const entry = JournalService.getEntryById(req.params.id!);
    if (!entry) {
      return errorResponse(res, 'NOT_FOUND', 'Journal entry not found', 404);
    }
    successResponse(res, { entry });
  });

  // Post Manual Balanced Journal Entry
  router.post('/api/v1/accounting/journal-entries', (req, res) => {
    const { memo, source_type, lines, date_ms } = req.body || {};
    if (!memo || !lines || !Array.isArray(lines)) {
      return errorResponse(res, 'VALIDATION_ERROR', 'memo and lines array are required', 400);
    }

    try {
      const entry = JournalService.postEntry({
        memo,
        source_type: source_type || 'manual_journal',
        date_ms: date_ms ? parseInt(date_ms, 10) : Date.now(),
        lines
      });
      successResponse(res, { entry }, 201);
    } catch (err: any) {
      errorResponse(res, 'JOURNAL_POST_FAILED', err.message, 400);
    }
  });

  // Reverse a Journal Entry
  router.post('/api/v1/accounting/journal-entries/:id/reverse', (req, res) => {
    const reason = req.body?.reason || 'Reversal requested';
    try {
      const reversal = JournalService.reverseEntry(req.params.id!, reason);
      successResponse(res, { reversal });
    } catch (err: any) {
      errorResponse(res, 'REVERSAL_FAILED', err.message, 400);
    }
  });

  // Backfill Legacy Transactions into General Ledger
  router.post('/api/v1/accounting/backfill-ledger', (_req, res) => {
    try {
      const result = JournalService.backfillLegacyTransactions();
      successResponse(res, { result });
    } catch (err: any) {
      errorResponse(res, 'BACKFILL_FAILED', err.message, 500);
    }
  });

  // --- CSV Exports ---
  router.get('/api/v1/accounting/export/rent-roll.csv', (_req, res) => {
    const roll = AccountingRepository.getRentRoll();
    let csv = 'Property,Unit,Status,Tenant,Monthly Rent,Deposit Held,Outstanding Balance\n';
    for (const r of roll) {
      csv += `"${r.property_name}","${r.unit_number}","${r.status}","${r.tenant_name}",${(r.monthly_rent_cents / 100).toFixed(2)},${(r.deposit_held_cents / 100).toFixed(2)},${(r.balance_cents / 100).toFixed(2)}\n`;
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="rent-roll-${Date.now()}.csv"`
    });
    res.end(csv);
  });

  router.get('/api/v1/accounting/export/schedule-e.csv', (req, res) => {
    const yearRes = parseIntegerParam(req, res, 'year', {
      defaultValue: new Date().getUTCFullYear(),
      min: 1900,
      max: 2100
    });
    if (yearRes.hasError) return;
    const year = yearRes.value!;
    const report = AccountingRepository.getScheduleEReport({ year });
    let csv = `IRS Schedule E Summary - Year ${year}\n\n`;
    csv += 'Category Type,Line Item,Amount ($)\n';
    csv += 'INCOME\n';
    for (const [cat, cents] of Object.entries(report.incomeByCategory)) {
      csv += `Income,"${cat}",${(cents / 100).toFixed(2)}\n`;
    }
    csv += `Total Income,,${(report.totalIncomeCents / 100).toFixed(2)}\n\n`;
    csv += 'OPERATING EXPENSES\n';
    for (const [cat, cents] of Object.entries(report.expenseByCategory)) {
      csv += `Expense,"${cat}",${(cents / 100).toFixed(2)}\n`;
    }
    csv += `Total Expenses,,${(report.totalOperatingExpenseCents / 100).toFixed(2)}\n\n`;
    csv += `NET OPERATING INCOME (NOI),,${(report.netOperatingIncomeCents / 100).toFixed(2)}\n`;

    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="schedule-e-${year}-${Date.now()}.csv"`
    });
    res.end(csv);
  });

  router.get('/api/v1/accounting/export/ledger/:lease_id.csv', (req, res) => {
    const leaseId = req.params.lease_id || req.params.leaseId;
    const transactions = AccountingRepository.getLeaseTransactions(leaseId!);
    let csv = 'Date,Type,Category,Description,Amount ($),Running Balance ($)\n';
    let running = 0;
    for (const tx of transactions) {
      if (tx.transaction_type === 'charge' || tx.transaction_type === 'deposit_return' || tx.transaction_type === 'deposit_deduction') {
        running += tx.amount_cents;
      } else if (tx.transaction_type === 'payment' || tx.transaction_type === 'refund') {
        running -= tx.amount_cents;
      }
      const d = new Date(tx.transaction_date).toISOString().split('T')[0];
      csv += `"${d}","${tx.transaction_type}","${tx.category}","${tx.description.replace(/"/g, '""')}",${(tx.amount_cents / 100).toFixed(2)},${(running / 100).toFixed(2)}\n`;
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="ledger-${leaseId}-${Date.now()}.csv"`
    });
    res.end(csv);
  });

  // ==========================================
  // --- Chart of Accounts & QuickBooks Sync ---
  // ==========================================

  // List Chart of Accounts
  router.get('/api/v1/accounting/chart-of-accounts', (req, res) => {
    const includeInactive = req.query.include_inactive === 'true';
    const accounts = ChartOfAccountsRepository.listAccounts(includeInactive);
    successResponse(res, { accounts });
  });

  // Create new Account
  router.post('/api/v1/accounting/chart-of-accounts', (req, res) => {
    const { account_name, account_type, qb_account_type, account_number, category_mapping, description } = req.body || {};
    if (!account_name || !account_type || !qb_account_type) {
      return errorResponse(res, 'VALIDATION_ERROR', 'account_name, account_type, and qb_account_type are required', 400);
    }
    const account = ChartOfAccountsRepository.createAccount({
      account_name,
      account_type,
      qb_account_type,
      account_number,
      category_mapping,
      description
    });
    successResponse(res, { account }, 201);
  });

  // Update Account
  router.put('/api/v1/accounting/chart-of-accounts/:id', (req, res) => {
    const updated = ChartOfAccountsRepository.updateAccount(req.params.id!, req.body || {});
    if (!updated) {
      return errorResponse(res, 'NOT_FOUND', 'Chart of account item not found', 404);
    }
    successResponse(res, { account: updated });
  });

  // Preview QuickBooks Journal Entries before export
  router.get('/api/v1/accounting/quickbooks/preview', (req, res) => {
    const startRes = parseIntegerParam(req, res, 'start_date', { min: 1 });
    if (startRes.hasError) return;
    const endRes = parseIntegerParam(req, res, 'end_date', { min: 1 });
    if (endRes.hasError) return;

    const transactions = AccountingRepository.listTransactions({
      property_id: req.query.property_id,
      transaction_type: req.query.transaction_type,
      category: req.query.category,
      start_date: startRes.value,
      end_date: endRes.value,
      qb_unexported_only: req.query.unexported_only === 'true'
    });

    const entries = QuickBooksService.generateJournalEntries(transactions);
    const totalDebitCents = entries.reduce((sum, e) => sum + e.lines.reduce((lSum, l) => lSum + l.debit_cents, 0), 0);
    const totalCreditCents = entries.reduce((sum, e) => sum + e.lines.reduce((lSum, l) => lSum + l.credit_cents, 0), 0);

    successResponse(res, {
      entries,
      summary: {
        transactionCount: transactions.length,
        entryCount: entries.length,
        totalDebitCents,
        totalCreditCents,
        isBalanced: totalDebitCents === totalCreditCents
      }
    });
  });

  // Download QuickBooks Online (QBO) Journal CSV
  router.get('/api/v1/accounting/export/quickbooks/qbo-journal.csv', (req, res) => {
    const startRes = parseIntegerParam(req, res, 'start_date', { min: 1 });
    if (startRes.hasError) return;
    const endRes = parseIntegerParam(req, res, 'end_date', { min: 1 });
    if (endRes.hasError) return;

    const transactions = AccountingRepository.listTransactions({
      property_id: req.query.property_id,
      start_date: startRes.value,
      end_date: endRes.value,
      qb_unexported_only: req.query.unexported_only === 'true'
    });

    const entries = QuickBooksService.generateJournalEntries(transactions);
    const exportResult = QuickBooksService.exportQboJournalCsv(entries);

    if (req.query.mark_exported === 'true') {
      QuickBooksService.recordExport('qbo_csv', exportResult);
    }

    res.writeHead(200, {
      'Content-Type': exportResult.mimeType,
      'Content-Disposition': `attachment; filename="${exportResult.filename}"`
    });
    res.end(exportResult.content);
  });

  // Download QuickBooks Desktop IIF File
  router.get('/api/v1/accounting/export/quickbooks/desktop.iif', (req, res) => {
    const startRes = parseIntegerParam(req, res, 'start_date', { min: 1 });
    if (startRes.hasError) return;
    const endRes = parseIntegerParam(req, res, 'end_date', { min: 1 });
    if (endRes.hasError) return;

    const transactions = AccountingRepository.listTransactions({
      property_id: req.query.property_id,
      start_date: startRes.value,
      end_date: endRes.value,
      qb_unexported_only: req.query.unexported_only === 'true'
    });

    const entries = QuickBooksService.generateJournalEntries(transactions);
    const exportResult = QuickBooksService.exportDesktopIif(entries);

    if (req.query.mark_exported === 'true') {
      QuickBooksService.recordExport('iif', exportResult);
    }

    res.writeHead(200, {
      'Content-Type': exportResult.mimeType,
      'Content-Disposition': `attachment; filename="${exportResult.filename}"`
    });
    res.end(exportResult.content);
  });

  // Download Web Connect / QBO Banking File
  router.get('/api/v1/accounting/export/quickbooks/bank-feed.qbo', (req, res) => {
    const startRes = parseIntegerParam(req, res, 'start_date', { min: 1 });
    if (startRes.hasError) return;
    const endRes = parseIntegerParam(req, res, 'end_date', { min: 1 });
    if (endRes.hasError) return;

    const transactions = AccountingRepository.listTransactions({
      property_id: req.query.property_id,
      start_date: startRes.value,
      end_date: endRes.value,
      qb_unexported_only: req.query.unexported_only === 'true'
    });

    const exportResult = QuickBooksService.exportOfxWebConnect(transactions);

    if (req.query.mark_exported === 'true') {
      QuickBooksService.recordExport('ofx', exportResult);
    }

    res.writeHead(200, {
      'Content-Type': exportResult.mimeType,
      'Content-Disposition': `attachment; filename="${exportResult.filename}"`
    });
    res.end(exportResult.content);
  });

  // ==========================================
  // --- Client Accounting & Management Fees ---
  // ==========================================

  // --- Client Capital Contributions ---
  router.get('/api/v1/accounting/client_contributions', requirePermission('accounting:view'), requirePortfolioAccess((req) => req.query['portfolio_id']), (req, res) => {
    const startRes = parseIntegerParam(req, res, 'start_date', { min: 1 });
    if (startRes.hasError) return;
    const endRes = parseIntegerParam(req, res, 'end_date', { min: 1 });
    if (endRes.hasError) return;

    const operatorId = RequestContext.getOperatorId();
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;

    let contributions = ClientAccountingRepository.listCapitalContributions({
      portfolio_id: req.query.portfolio_id,
      property_id: req.query.property_id,
      client_contact_id: req.query.client_contact_id,
      start_date: startRes.value,
      end_date: endRes.value
    });

    if (userId && userId !== 'system') {
      contributions = contributions.filter((c) => canAccessPortfolio(userId, c.portfolio_id, operatorId));
    }

    successResponse(res, { contributions });
  });

  router.post('/api/v1/accounting/client_contributions', requirePermission('accounting:transact'), requirePortfolioAccess((req) => req.body?.portfolio_id), (req, res) => {
    const { client_contact_id, portfolio_id, amount_cents } = req.body || {};
    if (!client_contact_id || !portfolio_id || amount_cents === undefined) {
      return errorResponse(res, 'VALIDATION_ERROR', 'client_contact_id, portfolio_id, and amount_cents are required', 400);
    }
    const parsedAmount = Number(amount_cents);
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'amount_cents must be a positive integer in cents', 400);
    }
    try {
      const contribution = ClientAccountingRepository.createCapitalContribution({
        client_contact_id,
        portfolio_id,
        property_id: req.body.property_id || null,
        amount_cents: parsedAmount,
        contribution_date: req.body.contribution_date ? Number(req.body.contribution_date) : undefined,
        destination_account_id: req.body.destination_account_id,
        reference_number: req.body.reference_number || null,
        memo: req.body.memo || null
      });
      successResponse(res, { contribution }, 201);
    } catch (err: any) {
      errorResponse(res, 'CONTRIBUTION_FAILED', err.message, 400);
    }
  });

  router.get('/api/v1/accounting/client_contributions/:id', requirePermission('accounting:view'), (req, res) => {
    const contribution = ClientAccountingRepository.getCapitalContributionById(req.params.id!);
    if (!contribution) {
      return errorResponse(res, 'NOT_FOUND', 'Client capital contribution not found', 404);
    }
    const operatorId = RequestContext.getOperatorId();
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    if (userId && userId !== 'system' && !canAccessPortfolio(userId, contribution.portfolio_id, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }
    successResponse(res, { contribution });
  });

  // --- Client Distributions / Draws ---
  router.get('/api/v1/accounting/client_distributions', requirePermission('accounting:view'), requirePortfolioAccess((req) => req.query['portfolio_id']), (req, res) => {
    const startRes = parseIntegerParam(req, res, 'start_date', { min: 1 });
    if (startRes.hasError) return;
    const endRes = parseIntegerParam(req, res, 'end_date', { min: 1 });
    if (endRes.hasError) return;

    const operatorId = RequestContext.getOperatorId();
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;

    let distributions = ClientAccountingRepository.listDistributions({
      portfolio_id: req.query.portfolio_id,
      property_id: req.query.property_id,
      client_contact_id: req.query.client_contact_id,
      start_date: startRes.value,
      end_date: endRes.value
    });

    if (userId && userId !== 'system') {
      distributions = distributions.filter((d) => canAccessPortfolio(userId, d.portfolio_id, operatorId));
    }

    successResponse(res, { distributions });
  });

  router.post('/api/v1/accounting/client_distributions', requirePermission('accounting:disburse'), requirePortfolioAccess((req) => req.body?.portfolio_id), (req, res) => {
    const { client_contact_id, portfolio_id, amount_cents, disbursement_method } = req.body || {};
    if (!client_contact_id || !portfolio_id || amount_cents === undefined || !disbursement_method) {
      return errorResponse(res, 'VALIDATION_ERROR', 'client_contact_id, portfolio_id, amount_cents, and disbursement_method are required', 400);
    }
    const parsedAmount = Number(amount_cents);
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'amount_cents must be a positive integer in cents', 400);
    }
    try {
      const distribution = ClientAccountingRepository.createDistribution({
        client_contact_id,
        portfolio_id,
        property_id: req.body.property_id || null,
        amount_cents: parsedAmount,
        distribution_date: req.body.distribution_date ? Number(req.body.distribution_date) : undefined,
        source_account_id: req.body.source_account_id,
        disbursement_method,
        check_number: req.body.check_number || null,
        reference_number: req.body.reference_number || null,
        memo: req.body.memo || null
      });
      successResponse(res, { distribution }, 201);
    } catch (err: any) {
      errorResponse(res, 'DISTRIBUTION_FAILED', err.message, 400);
    }
  });

  router.get('/api/v1/accounting/client_distributions/:id', requirePermission('accounting:view'), (req, res) => {
    const distribution = ClientAccountingRepository.getDistributionById(req.params.id!);
    if (!distribution) {
      return errorResponse(res, 'NOT_FOUND', 'Client distribution not found', 404);
    }
    const operatorId = RequestContext.getOperatorId();
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    if (userId && userId !== 'system' && !canAccessPortfolio(userId, distribution.portfolio_id, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }
    successResponse(res, { distribution });
  });

  // --- Portfolio Cash Summary ---
  router.get(
    '/api/v1/accounting/portfolios/:portfolio_id/cash_summary',
    requirePermission('accounting:view'),
    requirePortfolioAccess((req) => req.params['portfolio_id']),
    (req, res) => {
      const asOfRes = parseIntegerParam(req, res, 'as_of', { min: 1 });
      if (asOfRes.hasError) return;

      const rawBasis = req.query['basis'];
      let basis: 'cash' | 'accrual' = 'cash';
      if (rawBasis !== undefined) {
        if (rawBasis === 'accrual') {
          basis = 'accrual';
        } else if (rawBasis !== 'cash') {
          return errorResponse(res, 'VALIDATION_ERROR', 'Query parameter "basis" must be "cash" or "accrual"', 400);
        }
      }

      try {
        const summary = ClientAccountingRepository.getPortfolioCashSummary(req.params.portfolio_id!, asOfRes.value, basis);
        successResponse(res, { summary });
      } catch (err: any) {
        if (err.message && err.message.toLowerCase().includes('not found')) {
          errorResponse(res, 'NOT_FOUND', err.message, 404);
        } else {
          errorResponse(res, 'INTERNAL_ERROR', err.message || 'Internal server error', 500);
        }
      }
    }
  );

  // --- Management Fee Agreements ---
  router.get('/api/v1/accounting/management_fee_agreements', requirePermission('accounting:view'), requirePortfolioAccess((req) => req.query['portfolio_id']), (req, res) => {
    const operatorId = RequestContext.getOperatorId();
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;

    let agreements = ClientAccountingRepository.listManagementFeeAgreements({
      portfolio_id: req.query.portfolio_id,
      property_id: req.query.property_id
    });

    if (userId && userId !== 'system') {
      agreements = agreements.filter((a) => !a.portfolio_id || canAccessPortfolio(userId, a.portfolio_id, operatorId));
    }

    successResponse(res, { agreements });
  });

  router.post('/api/v1/accounting/management_fee_agreements', requirePermission('accounting:manage'), requirePortfolioAccess((req) => req.body?.portfolio_id), (req, res) => {
    const { calculation_method } = req.body || {};
    if (!calculation_method) {
      return errorResponse(res, 'VALIDATION_ERROR', 'calculation_method is required', 400);
    }
    try {
      const agreement = ClientAccountingRepository.createManagementFeeAgreement({
        portfolio_id: req.body.portfolio_id || null,
        property_id: req.body.property_id || null,
        calculation_method,
        percentage_bps: req.body.percentage_bps ? Number(req.body.percentage_bps) : 0,
        flat_fee_cents: req.body.flat_fee_cents ? Number(req.body.flat_fee_cents) : 0,
        fee_gl_account_id: req.body.fee_gl_account_id,
        pass_through_expenses: req.body.pass_through_expenses ? 1 : 0
      });
      successResponse(res, { agreement }, 201);
    } catch (err: any) {
      errorResponse(res, 'AGREEMENT_CREATION_FAILED', err.message, 400);
    }
  });

  router.get('/api/v1/accounting/management_fee_agreements/:id', requirePermission('accounting:view'), (req, res) => {
    const agreement = ClientAccountingRepository.getManagementFeeAgreement(req.params.id!);
    if (!agreement) {
      return errorResponse(res, 'NOT_FOUND', 'Management fee agreement not found', 404);
    }
    const operatorId = RequestContext.getOperatorId();
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    if (userId && userId !== 'system' && agreement.portfolio_id && !canAccessPortfolio(userId, agreement.portfolio_id, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }
    successResponse(res, { agreement });
  });

  router.delete('/api/v1/accounting/management_fee_agreements/:id', requirePermission('accounting:manage'), (req, res) => {
    const agreement = ClientAccountingRepository.getManagementFeeAgreement(req.params.id!);
    if (!agreement) {
      return errorResponse(res, 'NOT_FOUND', 'Management fee agreement not found', 404);
    }
    const operatorId = RequestContext.getOperatorId();
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    if (userId && userId !== 'system' && agreement.portfolio_id && !canAccessPortfolio(userId, agreement.portfolio_id, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }
    const deleted = ClientAccountingRepository.deleteManagementFeeAgreement(req.params.id!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Management fee agreement not found', 404);
    }
    successResponse(res, { deleted: true });
  });

  router.get('/api/v1/accounting/management_fee_agreements/:id/calculate', requirePermission('accounting:view'), (req, res) => {
    const agreement = ClientAccountingRepository.getManagementFeeAgreement(req.params.id!);
    if (!agreement) {
      return errorResponse(res, 'NOT_FOUND', 'Management fee agreement not found', 404);
    }
    const operatorId = RequestContext.getOperatorId();
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    if (userId && userId !== 'system' && agreement.portfolio_id && !canAccessPortfolio(userId, agreement.portfolio_id, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }
    try {
      const calculation = ClientAccountingRepository.calculateManagementFee(req.params.id!, req.query.month);
      successResponse(res, { calculation });
    } catch (err: any) {
      errorResponse(res, 'CALCULATION_FAILED', err.message, 400);
    }
  });

  router.post('/api/v1/accounting/management_fee_agreements/:id/post', requirePermission('accounting:transact'), (req, res) => {
    const agreement = ClientAccountingRepository.getManagementFeeAgreement(req.params.id!);
    if (!agreement) {
      return errorResponse(res, 'NOT_FOUND', 'Management fee agreement not found', 404);
    }
    const operatorId = RequestContext.getOperatorId();
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    if (userId && userId !== 'system' && agreement.portfolio_id && !canAccessPortfolio(userId, agreement.portfolio_id, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }
    try {
      const result = ClientAccountingRepository.postManagementFee(req.params.id!, req.body?.month);
      successResponse(res, { result }, 201);
    } catch (err: any) {
      errorResponse(res, 'POSTING_FAILED', err.message, 400);
    }
  });

  /**
   * Verifies whether a subuser is authorized to access all portfolios allocated to a bill.
   */
  function canAccessBillPortfolios(bill: any, userId: string, operatorId: string): boolean {
    if (!bill || !bill.allocations || !Array.isArray(bill.allocations) || bill.allocations.length === 0) {
      return true;
    }
    for (const alloc of bill.allocations) {
      if (alloc.portfolio_id && !canAccessPortfolio(userId, alloc.portfolio_id, operatorId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Verifies whether a subuser is authorized to access all portfolios linked to a vendor check.
   */
  function canAccessCheckPortfolios(check: any, userId: string, operatorId: string): boolean {
    if (!check || !check.allocations || !Array.isArray(check.allocations) || check.allocations.length === 0) {
      return true;
    }
    for (const alloc of check.allocations) {
      const bill = AccountsPayableRepository.getBillById(alloc.bill_id);
      if (bill && !canAccessBillPortfolios(bill, userId, operatorId)) {
        return false;
      }
    }
    return true;
  }

  // ==========================================
  // Accounts Payable (AP): Vendor Bills
  // ==========================================

  router.getBatchSafe('/api/v1/accounting/bills', requirePermission('accounting:view'), (req, res) => {
    let dueStart: number | undefined;
    let dueEnd: number | undefined;
    let invStart: number | undefined;
    let invEnd: number | undefined;

    if (req.query.due_date_start !== undefined) {
      const p = parseIntegerParam(req, res, 'due_date_start', { min: 1 });
      if (p.hasError) return;
      dueStart = p.value;
    }
    if (req.query.due_date_end !== undefined) {
      const p = parseIntegerParam(req, res, 'due_date_end', { min: 1 });
      if (p.hasError) return;
      dueEnd = p.value;
    }
    if (req.query.invoice_date_start !== undefined) {
      const p = parseIntegerParam(req, res, 'invoice_date_start', { min: 1 });
      if (p.hasError) return;
      invStart = p.value;
    }
    if (req.query.invoice_date_end !== undefined) {
      const p = parseIntegerParam(req, res, 'invoice_date_end', { min: 1 });
      if (p.hasError) return;
      invEnd = p.value;
    }

    const limitParsed = parseIntegerParam(req, res, 'limit', { defaultValue: 50, min: 1, max: 200 });
    if (limitParsed.hasError) return;
    const offsetParsed = parseIntegerParam(req, res, 'offset', { defaultValue: 0, min: 0 });
    if (offsetParsed.hasError) return;

    try {
      const result = AccountsPayableRepository.listBills({
        status: req.query.status as any,
        vendor_id: req.query.vendor_id,
        work_order_id: req.query.work_order_id,
        property_id: req.query.property_id,
        portfolio_id: req.query.portfolio_id,
        due_date_start: dueStart,
        due_date_end: dueEnd,
        invoice_date_start: invStart,
        invoice_date_end: invEnd,
        limit: limitParsed.value,
        offset: offsetParsed.value
      });

      let bills = result.bills;
      const userId = RequestContext.tryGet()?.userId || (req as any).userId;
      const operatorId = RequestContext.getOperatorId();
      if (userId && userId !== 'system') {
        bills = bills.filter((b) => canAccessBillPortfolios(b, userId, operatorId));
      }

      successResponse(res, bills, 200, {
        total: userId && userId !== 'system' ? bills.length : result.total,
        page: Math.floor((offsetParsed.value || 0) / (limitParsed.value || 50)) + 1,
        limit: limitParsed.value || 50
      });
    } catch (err: any) {
      errorResponse(res, 'FETCH_FAILED', err.message, 500);
    }
  });

  router.post('/api/v1/accounting/bills', requirePermission('accounting:transact'), (req, res) => {
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    const operatorId = RequestContext.getOperatorId();
    if (userId && userId !== 'system' && Array.isArray(req.body?.allocations)) {
      for (const alloc of req.body.allocations) {
        if (alloc.portfolio_id && !canAccessPortfolio(userId, alloc.portfolio_id, operatorId)) {
          return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
        }
      }
    }
    try {
      const bill = AccountsPayableRepository.createBill(req.body);
      successResponse(res, bill, 201);
    } catch (err: any) {
      errorResponse(res, 'VALIDATION_ERROR', err.message, 400);
    }
  });

  router.get('/api/v1/accounting/bills/:id', requirePermission('accounting:view'), (req, res) => {
    const bill = AccountsPayableRepository.getBillById(req.params.id!);
    if (!bill) {
      return errorResponse(res, 'NOT_FOUND', 'Vendor bill not found', 404);
    }
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    const operatorId = RequestContext.getOperatorId();
    if (userId && userId !== 'system' && !canAccessBillPortfolios(bill, userId, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }
    successResponse(res, bill);
  });

  router.put('/api/v1/accounting/bills/:id', requirePermission('accounting:transact'), (req, res) => {
    const existing = AccountsPayableRepository.getBillById(req.params.id!);
    if (!existing) {
      return errorResponse(res, 'NOT_FOUND', 'Vendor bill not found', 404);
    }
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    const operatorId = RequestContext.getOperatorId();
    if (userId && userId !== 'system') {
      if (!canAccessBillPortfolios(existing, userId, operatorId)) {
        return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
      }
      if (Array.isArray(req.body?.allocations)) {
        for (const alloc of req.body.allocations) {
          if (alloc.portfolio_id && !canAccessPortfolio(userId, alloc.portfolio_id, operatorId)) {
            return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
          }
        }
      }
    }
    try {
      const updated = AccountsPayableRepository.updateBill(req.params.id!, req.body);
      successResponse(res, updated);
    } catch (err: any) {
      errorResponse(res, 'UPDATE_FAILED', err.message, 400);
    }
  });

  router.post('/api/v1/accounting/bills/:id/approve', requirePermission('accounting:disburse'), (req, res) => {
    const bill = AccountsPayableRepository.getBillById(req.params.id!);
    if (!bill) {
      return errorResponse(res, 'NOT_FOUND', 'Vendor bill not found', 404);
    }
    const userId = RequestContext.tryGet()?.userId || (req as any).userId || 'system';
    const operatorId = RequestContext.getOperatorId();
    if (userId && userId !== 'system' && !canAccessBillPortfolios(bill, userId, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }
    try {
      const approved = AccountsPayableRepository.approveBill(req.params.id!, userId);
      successResponse(res, approved);
    } catch (err: any) {
      errorResponse(res, 'APPROVAL_FAILED', err.message, 400);
    }
  });

  router.post('/api/v1/accounting/bills/:id/void', requirePermission('accounting:manage'), (req, res) => {
    const bill = AccountsPayableRepository.getBillById(req.params.id!);
    if (!bill) {
      return errorResponse(res, 'NOT_FOUND', 'Vendor bill not found', 404);
    }
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    const operatorId = RequestContext.getOperatorId();
    if (userId && userId !== 'system' && !canAccessBillPortfolios(bill, userId, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }
    try {
      const voided = AccountsPayableRepository.voidBill(req.params.id!, req.body?.reason);
      successResponse(res, voided);
    } catch (err: any) {
      errorResponse(res, 'VOID_FAILED', err.message, 400);
    }
  });

  // Recurring Bills
  router.get('/api/v1/accounting/recurring_bills', requirePermission('accounting:view'), (_req, res) => {
    try {
      const list = AccountsPayableRepository.listRecurringBills();
      successResponse(res, list);
    } catch (err: any) {
      errorResponse(res, 'FETCH_FAILED', err.message, 500);
    }
  });

  router.post('/api/v1/accounting/recurring_bills', requirePermission('accounting:manage'), (req, res) => {
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    const operatorId = RequestContext.getOperatorId();
    if (userId && userId !== 'system' && Array.isArray(req.body?.allocations)) {
      for (const alloc of req.body.allocations) {
        if (alloc.portfolio_id && !canAccessPortfolio(userId, alloc.portfolio_id, operatorId)) {
          return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
        }
      }
    }
    try {
      const created = AccountsPayableRepository.createRecurringBill(req.body);
      successResponse(res, created, 201);
    } catch (err: any) {
      errorResponse(res, 'CREATION_FAILED', err.message, 400);
    }
  });

  router.post('/api/v1/accounting/recurring_bills/run', requirePermission('accounting:manage'), (req, res) => {
    let asOf: number | undefined;
    if (req.body?.as_of !== undefined) {
      const parsed = Number(req.body.as_of);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        return errorResponse(res, 'VALIDATION_ERROR', 'as_of must be a positive integer millisecond timestamp', 400);
      }
      asOf = parsed;
    }
    try {
      const generated = AccountsPayableRepository.generateDueRecurringBills(asOf);
      const failures = (generated as any).failures || [];
      successResponse(res, { count: generated.length, bills: generated, failures });
    } catch (err: any) {
      errorResponse(res, 'EXECUTION_FAILED', err.message, 500);
    }
  });

  // ==========================================
  // Vendor Credit Memos & Bill Offsets
  // ==========================================

  router.getBatchSafe('/api/v1/accounting/vendor_credits', requirePermission('accounting:view'), (req, res) => {
    const limitParsed = parseIntegerParam(req, res, 'limit', { defaultValue: 50, min: 1, max: 200 });
    if (limitParsed.hasError) return;
    const offsetParsed = parseIntegerParam(req, res, 'offset', { defaultValue: 0, min: 0 });
    if (offsetParsed.hasError) return;

    try {
      const result = VendorCreditsRepository.listCredits({
        vendor_id: req.query.vendor_id,
        status: req.query.status as any,
        limit: limitParsed.value,
        offset: offsetParsed.value
      });

      successResponse(res, result.credits, 200, {
        total: result.total,
        page: Math.floor((offsetParsed.value || 0) / (limitParsed.value || 50)) + 1,
        limit: limitParsed.value || 50
      });
    } catch (err: any) {
      errorResponse(res, 'FETCH_FAILED', err.message, 500);
    }
  });

  router.post('/api/v1/accounting/vendor_credits', requirePermission('accounting:transact'), (req, res) => {
    try {
      const credit = VendorCreditsRepository.createCredit(req.body);
      successResponse(res, credit, 201);
    } catch (err: any) {
      errorResponse(res, 'CREATION_FAILED', err.message, 400);
    }
  });

  router.get('/api/v1/accounting/vendor_credits/:id', requirePermission('accounting:view'), (req, res) => {
    const credit = VendorCreditsRepository.getCreditById(req.params.id!);
    if (!credit) {
      return errorResponse(res, 'NOT_FOUND', 'Vendor credit not found', 404);
    }
    successResponse(res, credit);
  });

  router.post('/api/v1/accounting/vendor_credits/:id/apply', requirePermission('accounting:transact'), (req, res) => {
    const { bill_id, amount_cents } = req.body || {};
    if (!bill_id || !Number.isSafeInteger(amount_cents) || amount_cents <= 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'bill_id and a positive integer amount_cents are required', 400);
    }
    const targetBill = AccountsPayableRepository.getBillById(bill_id);
    if (!targetBill) {
      return errorResponse(res, 'NOT_FOUND', 'Target bill not found', 404);
    }
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    const operatorId = RequestContext.getOperatorId();
    if (userId && userId !== 'system' && !canAccessBillPortfolios(targetBill, userId, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }
    try {
      const updated = VendorCreditsRepository.applyCredit(req.params.id!, bill_id, amount_cents);
      successResponse(res, updated);
    } catch (err: any) {
      errorResponse(res, 'APPLY_FAILED', err.message, 400);
    }
  });

  router.post('/api/v1/accounting/vendor_credits/:id/void', requirePermission('accounting:manage'), (req, res) => {
    try {
      const voided = VendorCreditsRepository.voidCredit(req.params.id!, req.body?.reason);
      successResponse(res, voided);
    } catch (err: any) {
      errorResponse(res, 'VOID_FAILED', err.message, 400);
    }
  });

  // ==========================================
  // Vendor Check Register & PDF Check Printing
  // ==========================================

  router.getBatchSafe('/api/v1/accounting/checks', requirePermission('accounting:view'), (req, res) => {
    let start: number | undefined;
    let end: number | undefined;
    if (req.query.check_date_start !== undefined) {
      const p = parseIntegerParam(req, res, 'check_date_start', { min: 1 });
      if (p.hasError) return;
      start = p.value;
    }
    if (req.query.check_date_end !== undefined) {
      const p = parseIntegerParam(req, res, 'check_date_end', { min: 1 });
      if (p.hasError) return;
      end = p.value;
    }

    const limitParsed = parseIntegerParam(req, res, 'limit', { defaultValue: 50, min: 1, max: 200 });
    if (limitParsed.hasError) return;
    const offsetParsed = parseIntegerParam(req, res, 'offset', { defaultValue: 0, min: 0 });
    if (offsetParsed.hasError) return;

    try {
      const result = VendorChecksRepository.listChecks({
        bank_account_id: req.query.bank_account_id,
        vendor_id: req.query.vendor_id,
        status: req.query.status as any,
        check_date_start: start,
        check_date_end: end,
        limit: limitParsed.value,
        offset: offsetParsed.value
      });

      successResponse(res, result.checks, 200, {
        total: result.total,
        page: Math.floor((offsetParsed.value || 0) / (limitParsed.value || 50)) + 1,
        limit: limitParsed.value || 50
      });
    } catch (err: any) {
      errorResponse(res, 'FETCH_FAILED', err.message, 500);
    }
  });

  router.post('/api/v1/accounting/checks', requirePermission('accounting:disburse'), (req, res) => {
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    const operatorId = RequestContext.getOperatorId();
    if (userId && userId !== 'system' && Array.isArray(req.body?.bill_allocations)) {
      for (const item of req.body.bill_allocations) {
        const b = AccountsPayableRepository.getBillById(item.bill_id);
        if (b && !canAccessBillPortfolios(b, userId, operatorId)) {
          return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
        }
      }
    }
    try {
      const check = VendorChecksRepository.issueCheck(req.body);
      successResponse(res, check, 201);
    } catch (err: any) {
      errorResponse(res, 'CREATION_FAILED', err.message, 400);
    }
  });

  router.get('/api/v1/accounting/checks/:id', requirePermission('accounting:view'), (req, res) => {
    const check = VendorChecksRepository.getCheckById(req.params.id!);
    if (!check) {
      return errorResponse(res, 'NOT_FOUND', 'Vendor check not found', 404);
    }
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    const operatorId = RequestContext.getOperatorId();
    if (userId && userId !== 'system' && !canAccessCheckPortfolios(check, userId, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }
    successResponse(res, check);
  });

  router.get('/api/v1/accounting/checks/:id/pdf', requirePermission('accounting:view'), (req, res) => {
    const check = VendorChecksRepository.getCheckById(req.params.id!);
    if (!check) {
      return errorResponse(res, 'NOT_FOUND', 'Vendor check not found', 404);
    }

    const operatorId = RequestContext.getOperatorId();
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    if (userId && userId !== 'system' && !canAccessCheckPortfolios(check, userId, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }

    const db = getDatabase();
    const opRow = db.prepare('SELECT name FROM operators WHERE id = ? AND deleted_at IS NULL').get(operatorId) as { name: string } | undefined;

    const payerName = (typeof req.query['payer_name'] === 'string' && req.query['payer_name'].trim()) || opRow?.name;
    const payerAddress = typeof req.query['payer_address'] === 'string' && req.query['payer_address'].trim();
    const bankRouting = (typeof req.query['bank_routing'] === 'string' && req.query['bank_routing'].trim()) ||
                        (typeof req.query['routing_number'] === 'string' && req.query['routing_number'].trim());
    const bankAccountNumber = (typeof req.query['bank_account_number'] === 'string' && req.query['bank_account_number'].trim()) ||
                              (typeof req.query['account_number'] === 'string' && req.query['account_number'].trim());

    if (!payerName || !payerAddress || !bankRouting || !bankAccountNumber) {
      return errorResponse(
        res,
        'VALIDATION_ERROR',
        'Check printing requires payer_address, bank_routing, and bank_account_number query parameters',
        400
      );
    }

    try {
      const checkDateStr = new Date(check.check_date).toISOString().slice(0, 10);
      const billsData = (check.allocations || []).map((a) => ({
        invoice_number: a.invoice_number || 'N/A',
        invoice_date: a.invoice_date ? new Date(a.invoice_date).toISOString().slice(0, 10) : checkDateStr,
        amount_cents: a.total_amount_cents || a.allocated_amount_cents,
        allocated_cents: a.allocated_amount_cents,
        description: `Bill ${a.invoice_number || ''}`
      }));

      const pdfBuffer = generateCheckPdf({
        check_number: check.check_number,
        check_date: checkDateStr,
        amount_cents: check.amount_cents,
        payee_name: check.payee_name,
        memo: check.memo,
        bank_name: check.bank_account_name || 'Operating Checking',
        bank_routing: bankRouting,
        bank_account_number: bankAccountNumber,
        payer_name: payerName,
        payer_address: payerAddress,
        bills: billsData
      });

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="check-${check.check_number}.pdf"`,
        'Content-Length': pdfBuffer.length
      });
      res.end(pdfBuffer);
    } catch (err: any) {
      errorResponse(res, 'PDF_GENERATION_FAILED', err.message, 500);
    }
  });

  router.get('/api/v1/accounting/checks/batch-pdf', requirePermission('accounting:view'), (req, res) => {
    const rawIds = typeof req.query['ids'] === 'string' ? req.query['ids'].split(',').map((s) => s.trim()).filter(Boolean) : [];
    if (rawIds.length === 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'ids query parameter with at least one check ID is required', 400);
    }

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const opRow = db.prepare('SELECT name FROM operators WHERE id = ? AND deleted_at IS NULL').get(operatorId) as { name: string } | undefined;

    const payerName = (typeof req.query['payer_name'] === 'string' && req.query['payer_name'].trim()) || opRow?.name || 'GarrisonOS Management';
    const payerAddress = (typeof req.query['payer_address'] === 'string' && req.query['payer_address'].trim()) || '100 Main St, Suite 200';
    const bankRouting = (typeof req.query['bank_routing'] === 'string' && req.query['bank_routing'].trim()) || undefined;
    const bankAccountNumber = (typeof req.query['bank_account_number'] === 'string' && req.query['bank_account_number'].trim()) || undefined;

    try {
      const checksData: any[] = [];
      for (const id of rawIds) {
        const check = VendorChecksRepository.getCheckById(id);
        if (!check) continue;

        const checkDateStr = new Date(check.check_date).toISOString().slice(0, 10);
        const billsData = (check.allocations || []).map((a) => ({
          invoice_number: a.invoice_number || 'N/A',
          invoice_date: a.invoice_date ? new Date(a.invoice_date).toISOString().slice(0, 10) : checkDateStr,
          amount_cents: a.total_amount_cents || a.allocated_amount_cents,
          allocated_cents: a.allocated_amount_cents,
          description: `Bill ${a.invoice_number || ''}`
        }));

        checksData.push({
          check_number: check.check_number,
          check_date: checkDateStr,
          amount_cents: check.amount_cents,
          payee_name: check.payee_name,
          memo: check.memo,
          bank_name: check.bank_account_name || 'Operating Checking',
          bank_routing: bankRouting,
          bank_account_number: bankAccountNumber,
          payer_name: payerName,
          payer_address: payerAddress,
          bills: billsData
        });
      }

      if (checksData.length === 0) {
        return errorResponse(res, 'NOT_FOUND', 'No valid checks found for the provided IDs', 404);
      }

      const pdfBuffer = generateBatchCheckPdf(checksData);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="batch-checks.pdf"',
        'Content-Length': pdfBuffer.length
      });
      res.end(pdfBuffer);
    } catch (err: any) {
      errorResponse(res, 'PDF_GENERATION_FAILED', err.message, 500);
    }
  });

  router.post('/api/v1/accounting/checks/:id/void', requirePermission('accounting:manage'), (req, res) => {
    const check = VendorChecksRepository.getCheckById(req.params.id!);
    if (!check) {
      return errorResponse(res, 'NOT_FOUND', 'Vendor check not found', 404);
    }
    const userId = RequestContext.tryGet()?.userId || (req as any).userId;
    const operatorId = RequestContext.getOperatorId();
    if (userId && userId !== 'system' && !canAccessCheckPortfolios(check, userId, operatorId)) {
      return errorResponse(res, 'FORBIDDEN', 'User lacks permission to access resources in this portfolio', 403);
    }
    try {
      const voided = VendorChecksRepository.voidCheck(req.params.id!, req.body?.reason);
      successResponse(res, voided);
    } catch (err: any) {
      errorResponse(res, 'VOID_FAILED', err.message, 400);
    }
  });

  // ==========================================
  // Bank Deposits & Batched Clearing
  // ==========================================

  router.get('/api/v1/accounting/deposits/undeposited', requirePermission('accounting:view'), (_req, res) => {
    try {
      const items = BankDepositsRepository.listUndepositedReceipts();
      successResponse(res, { items, count: items.length });
    } catch (err: any) {
      errorResponse(res, 'FETCH_FAILED', err.message, 500);
    }
  });

  router.getBatchSafe('/api/v1/accounting/deposits', requirePermission('accounting:view'), (req, res) => {
    let start: number | undefined;
    let end: number | undefined;
    if (req.query.deposit_date_start !== undefined) {
      const p = parseIntegerParam(req, res, 'deposit_date_start', { min: 1 });
      if (p.hasError) return;
      start = p.value;
    }
    if (req.query.deposit_date_end !== undefined) {
      const p = parseIntegerParam(req, res, 'deposit_date_end', { min: 1 });
      if (p.hasError) return;
      end = p.value;
    }

    const limitParsed = parseIntegerParam(req, res, 'limit', { defaultValue: 50, min: 1, max: 200 });
    if (limitParsed.hasError) return;
    const offsetParsed = parseIntegerParam(req, res, 'offset', { defaultValue: 0, min: 0 });
    if (offsetParsed.hasError) return;

    try {
      const result = BankDepositsRepository.listDeposits({
        bank_account_id: req.query.bank_account_id,
        status: req.query.status as any,
        deposit_date_start: start,
        deposit_date_end: end,
        limit: limitParsed.value,
        offset: offsetParsed.value
      });

      successResponse(res, result.deposits, 200, {
        total: result.total,
        page: Math.floor((offsetParsed.value || 0) / (limitParsed.value || 50)) + 1,
        limit: limitParsed.value || 50
      });
    } catch (err: any) {
      errorResponse(res, 'FETCH_FAILED', err.message, 500);
    }
  });

  router.post('/api/v1/accounting/deposits', requirePermission('accounting:reconcile'), (req, res) => {
    try {
      const deposit = BankDepositsRepository.createDeposit(req.body);
      successResponse(res, deposit, 201);
    } catch (err: any) {
      errorResponse(res, 'CREATION_FAILED', err.message, 400);
    }
  });

  router.get('/api/v1/accounting/deposits/:id', requirePermission('accounting:view'), (req, res) => {
    const deposit = BankDepositsRepository.getDepositById(req.params.id!);
    if (!deposit) {
      return errorResponse(res, 'NOT_FOUND', 'Bank deposit not found', 404);
    }
    successResponse(res, deposit);
  });

  router.post('/api/v1/accounting/deposits/:id/void', requirePermission('accounting:manage'), (req, res) => {
    try {
      const voided = BankDepositsRepository.voidDeposit(req.params.id!, req.body?.reason);
      successResponse(res, voided);
    } catch (err: any) {
      errorResponse(res, 'VOID_FAILED', err.message, 400);
    }
  });

  router.get('/api/v1/accounting/deposits/:id/pdf', requirePermission('accounting:view'), (req, res) => {
    const deposit = BankDepositsRepository.getDepositById(req.params.id!);
    if (!deposit) {
      return errorResponse(res, 'NOT_FOUND', 'Bank deposit not found', 404);
    }

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const opRow = db.prepare('SELECT name FROM operators WHERE id = ? AND deleted_at IS NULL').get(operatorId) as { name: string } | undefined;

    try {
      const items = (deposit.lines || []).map((line: any) => ({
        receipt_id: line.source_entry_id,
        remitter_name: line.remitter_name || 'Tenant / Remitter',
        payment_method: line.payment_method || 'Check',
        reference: line.reference || line.id?.slice(0, 8),
        amount_cents: line.amount_cents
      }));

      const pdfBuffer = generateDepositSlipPdf({
        deposit_number: (deposit as any).deposit_number || deposit.id.slice(0, 8),
        deposit_date: new Date(deposit.deposit_date).toISOString().slice(0, 10),
        bank_name: deposit.bank_account_name || 'Operating Checking',
        bank_routing: (deposit as any).bank_routing_number || undefined,
        bank_account_number: (deposit as any).bank_account_number || undefined,
        payer_name: opRow?.name || 'GarrisonOS Management',
        memo: deposit.memo,
        total_amount_cents: deposit.total_amount_cents,
        items
      });

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="deposit-slip-${(deposit as any).deposit_number || deposit.id.slice(0, 8)}.pdf"`,
        'Content-Length': pdfBuffer.length
      });
      res.end(pdfBuffer);
    } catch (err: any) {
      errorResponse(res, 'PDF_FAILED', err.message, 500);
    }
  });

  router.get('/api/v1/accounting/deposits/receipts/:id/pdf', requirePermission('accounting:view'), (req, res) => {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT bdl.*, bd.deposit_date, bd.deposit_number
      FROM bank_deposit_lines bdl
      JOIN bank_deposits bd ON bdl.bank_deposit_id = bd.id
      WHERE bdl.operator_id = ? AND (bdl.id = ? OR bdl.source_entry_id = ?) AND bdl.deleted_at IS NULL
    `).get(operatorId, req.params.id!, req.params.id!) as any;

    if (!row) {
      return errorResponse(res, 'NOT_FOUND', 'Receipt line not found', 404);
    }

    const opRow = db.prepare('SELECT name FROM operators WHERE id = ? AND deleted_at IS NULL').get(operatorId) as { name: string } | undefined;

    try {
      const pdfBuffer = generateRemitterReceiptPdf({
        receipt_number: row.id.slice(0, 8).toUpperCase(),
        receipt_date: new Date(row.deposit_date).toISOString().slice(0, 10),
        operator_name: opRow?.name || 'GarrisonOS Management',
        remitter_name: row.remitter_name || 'Remitter',
        property_name: 'Property Portfolio',
        payment_method: row.payment_method || 'Check',
        reference: row.reference,
        amount_cents: row.amount_cents,
        memo: `Bank Deposit ${row.deposit_number || ''}`
      });

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="receipt-${row.id.slice(0, 8)}.pdf"`,
        'Content-Length': pdfBuffer.length
      });
      res.end(pdfBuffer);
    } catch (err: any) {
      errorResponse(res, 'PDF_FAILED', err.message, 500);
    }
  });
}


