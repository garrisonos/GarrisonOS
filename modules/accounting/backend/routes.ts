import { ServerResponse } from 'node:http';
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
  router.getBatchSafe('/api/v1/accounting/rent-roll', (_req, res) => {
    const rentRoll = AccountingRepository.getRentRoll();
    const totalScheduledRentCents = rentRoll.reduce((sum, r) => sum + r.monthly_rent_cents, 0);
    const totalDelinquencyCents = rentRoll.reduce((sum, r) => sum + Math.max(0, r.balance_cents), 0);

    successResponse(res, {
      rentRoll,
      summary: {
        totalUnits: rentRoll.length,
        totalScheduledRentCents,
        totalDelinquencyCents
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

    const transactions = AccountingRepository.listTransactions({
      lease_id: req.query.lease_id,
      property_id: req.query.property_id,
      unit_id: req.query.unit_id,
      transaction_type: req.query.transaction_type,
      category: req.query.category,
      start_date: startRes.value,
      end_date: endRes.value
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
  router.get('/api/v1/accounting/management_fee_agreements', requirePermission('accounting:view'), (req, res) => {
    const agreements = ClientAccountingRepository.listManagementFeeAgreements({
      portfolio_id: req.query.portfolio_id,
      property_id: req.query.property_id
    });
    successResponse(res, { agreements });
  });

  router.post('/api/v1/accounting/management_fee_agreements', requirePermission('accounting:manage'), (req, res) => {
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
    successResponse(res, { agreement });
  });

  router.delete('/api/v1/accounting/management_fee_agreements/:id', requirePermission('accounting:manage'), (req, res) => {
    const deleted = ClientAccountingRepository.deleteManagementFeeAgreement(req.params.id!);
    if (!deleted) {
      return errorResponse(res, 'NOT_FOUND', 'Management fee agreement not found', 404);
    }
    successResponse(res, { deleted: true });
  });

  router.get('/api/v1/accounting/management_fee_agreements/:id/calculate', requirePermission('accounting:view'), (req, res) => {
    try {
      const calculation = ClientAccountingRepository.calculateManagementFee(req.params.id!, req.query.month);
      successResponse(res, { calculation });
    } catch (err: any) {
      errorResponse(res, 'CALCULATION_FAILED', err.message, 400);
    }
  });

  router.post('/api/v1/accounting/management_fee_agreements/:id/post', requirePermission('accounting:transact'), (req, res) => {
    try {
      const result = ClientAccountingRepository.postManagementFee(req.params.id!, req.body?.month);
      successResponse(res, { result }, 201);
    } catch (err: any) {
      errorResponse(res, 'POSTING_FAILED', err.message, 400);
    }
  });
}
