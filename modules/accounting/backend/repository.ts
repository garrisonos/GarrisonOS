import type { DatabaseSync } from 'node:sqlite';
import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import {
  TransactionRecord,
  calculateTenantBalance,
  calculateScheduleE,
  ScheduleEReport
} from './ledger.js';
import { JournalService, CreateJournalLineInput } from './journal.js';
import { ChartOfAccountsRepository } from './chart_of_accounts.js';

export interface CreateTransactionData {
  transaction_type: TransactionRecord['transaction_type'];
  category: string;
  amount_cents: number;
  transaction_date: number;
  description: string;
  payment_method?: string | null;
  reference_number?: string | null;
  property_id?: string | null;
  unit_id?: string | null;
  lease_id?: string | null;
  payer_contact_id?: string | null;
  payee_contact_id?: string | null;
  gl_account_id?: string | null;
}

export interface RentRollItem {
  lease_id: string;
  property_id: string;
  property_name: string;
  unit_id: string;
  unit_number: string;
  status: string;
  tenant_name: string;
  monthly_rent_cents: number;
  deposit_held_cents: number;
  balance_cents: number;
}

export class AccountingRepository {
  public static listTransactions(filter?: {
    lease_id?: string;
    property_id?: string;
    unit_id?: string;
    transaction_type?: string;
    category?: string;
    start_date?: number;
    end_date?: number;
    qb_unexported_only?: boolean;
  }): TransactionRecord[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    let sql = 'SELECT * FROM transactions WHERE operator_id = ? AND deleted_at IS NULL';
    const params: any[] = [operatorId];

    if (filter?.lease_id) {
      sql += ' AND lease_id = ?';
      params.push(filter.lease_id);
    }
    if (filter?.property_id) {
      sql += ' AND property_id = ?';
      params.push(filter.property_id);
    }
    if (filter?.unit_id) {
      sql += ' AND unit_id = ?';
      params.push(filter.unit_id);
    }
    if (filter?.transaction_type) {
      sql += ' AND transaction_type = ?';
      params.push(filter.transaction_type);
    }
    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }
    if (filter?.start_date) {
      sql += ' AND transaction_date >= ?';
      params.push(filter.start_date);
    }
    if (filter?.end_date) {
      sql += ' AND transaction_date <= ?';
      params.push(filter.end_date);
    }
    if (filter?.qb_unexported_only) {
      sql += ' AND qb_exported_at IS NULL';
    }

    sql += ' ORDER BY transaction_date DESC, created_at DESC';
    return db.prepare(sql).all(...params) as unknown as TransactionRecord[];
  }

  public static getTransactionById(id: string): TransactionRecord | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM transactions
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(id, operatorId) as TransactionRecord | undefined;
    return row || null;
  }

  /**
   * Create a financial transaction and automatically post its corresponding
   * balanced double-entry journal entry atomically.
   */
  public static createTransaction(data: CreateTransactionData, dbInstance?: any): TransactionRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = dbInstance || getDatabase();
    ChartOfAccountsRepository.ensureDefaultAccounts(dbInstance);
    const id = generateUUIDv7();
    const now = Date.now();
    const amount = Math.abs(data.amount_cents);

    if (amount <= 0) {
      throw new Error('Transaction amount must be greater than 0 cents.');
    }

    const requireAccount = (mapping: string) => {
      const account = ChartOfAccountsRepository.getAccountByMapping(mapping, dbInstance);
      if (!account) {
        throw new Error(`Chart of accounts is missing an active account mapped to '${mapping}'.`);
      }
      return account;
    };

    const mappedAccount = ChartOfAccountsRepository.getAccountByMapping(data.category, dbInstance);
    const lines: CreateJournalLineInput[] = [];

    switch (data.transaction_type) {
      case 'charge': {
        const accountsReceivable = requireAccount('accounts_receivable');
        const revAccount = (data.gl_account_id ? ChartOfAccountsRepository.getAccountById(data.gl_account_id, dbInstance) : null)
          || mappedAccount
          || requireAccount('rent');
        lines.push(
          {
            account_id: accountsReceivable.id,
            debit_cents: amount,
            credit_cents: 0,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payer_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          },
          {
            account_id: revAccount.id,
            debit_cents: 0,
            credit_cents: amount,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payer_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          }
        );
        break;
      }
      case 'payment': {
        const operatingBank = requireAccount('operating_bank');
        const accountsReceivable = requireAccount('accounts_receivable');
        lines.push(
          {
            account_id: operatingBank.id,
            debit_cents: amount,
            credit_cents: 0,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payer_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          },
          {
            account_id: accountsReceivable.id,
            debit_cents: 0,
            credit_cents: amount,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payer_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          }
        );
        break;
      }
      case 'expense': {
        const operatingBank = requireAccount('operating_bank');
        const expAccount = mappedAccount || requireAccount('repairs');
        lines.push(
          {
            account_id: expAccount.id,
            debit_cents: amount,
            credit_cents: 0,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payee_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          },
          {
            account_id: operatingBank.id,
            debit_cents: 0,
            credit_cents: amount,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payee_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          }
        );
        break;
      }
      case 'refund': {
        const operatingBank = requireAccount('operating_bank');
        const accountsReceivable = requireAccount('accounts_receivable');
        lines.push(
          {
            account_id: accountsReceivable.id,
            debit_cents: amount,
            credit_cents: 0,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payee_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          },
          {
            account_id: operatingBank.id,
            debit_cents: 0,
            credit_cents: amount,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payee_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          }
        );
        break;
      }
      case 'deposit_inflow': {
        const trustBank = requireAccount('trust_bank');
        const depositLiability = requireAccount('security_deposit');
        lines.push(
          {
            account_id: trustBank.id,
            debit_cents: amount,
            credit_cents: 0,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payer_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          },
          {
            account_id: depositLiability.id,
            debit_cents: 0,
            credit_cents: amount,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payer_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          }
        );
        break;
      }
      case 'deposit_return': {
        const trustBank = requireAccount('trust_bank');
        const depositLiability = requireAccount('security_deposit');
        lines.push(
          {
            account_id: depositLiability.id,
            debit_cents: amount,
            credit_cents: 0,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payee_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          },
          {
            account_id: trustBank.id,
            debit_cents: 0,
            credit_cents: amount,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payee_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          }
        );
        break;
      }
      case 'deposit_deduction': {
        const accountsReceivable = requireAccount('accounts_receivable');
        const depositLiability = requireAccount('security_deposit');
        lines.push(
          {
            account_id: depositLiability.id,
            debit_cents: amount,
            credit_cents: 0,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payer_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          },
          {
            account_id: accountsReceivable.id,
            debit_cents: 0,
            credit_cents: amount,
            property_id: data.property_id,
            unit_id: data.unit_id,
            contact_id: data.payer_contact_id,
            lease_id: data.lease_id || null,
            description: data.description
          }
        );
        break;
      }
      default:
        throw new Error(`Unsupported transaction type: ${data.transaction_type}`);
    }

    let journalEntryId: string | null = null;

    const executeCreate = (conn: any) => {
      // 1. Post double-entry journal entry atomically
      const journalEntry = JournalService.postEntry({
        date_ms: data.transaction_date,
        memo: data.description,
        source_type: data.transaction_type,
        source_id: id,
        lines
      }, conn);
      journalEntryId = journalEntry.id;

      conn.prepare(`
        INSERT INTO transactions (
          id, operator_id, transaction_type, category, amount_cents,
          transaction_date, description, payment_method, reference_number,
          property_id, unit_id, lease_id, payer_contact_id, payee_contact_id,
          journal_entry_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        operatorId,
        data.transaction_type,
        data.category,
        amount,
        data.transaction_date,
        data.description,
        data.payment_method || null,
        data.reference_number || null,
        data.property_id || null,
        data.unit_id || null,
        data.lease_id || null,
        data.payer_contact_id || null,
        data.payee_contact_id || null,
        journalEntryId,
        now,
        now
      );
    };

    if (dbInstance) {
      executeCreate(dbInstance);
    } else {
      withTransaction((tx) => {
        executeCreate(tx);
      }, db);
    }

    return AccountingRepository.getTransactionById(id)!;
  }

  /**
   * Reverse a transaction and its double-entry journal entry.
   */
  public static deleteTransaction(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const txRecord = this.getTransactionById(id);
    if (!txRecord) return false;

    withTransaction((tx) => {
      if (txRecord.journal_entry_id) {
        const entry = JournalService.getEntryById(txRecord.journal_entry_id, tx);
        if (!entry) {
          throw new Error('Linked journal entry not found.');
        }
        if (!entry.reversed_by_entry_id) {
          JournalService.reverseEntry(txRecord.journal_entry_id, `Transaction deleted/voided`, tx);
        }
      }

      tx.prepare(`
        UPDATE transactions SET deleted_at = ?
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(now, id, operatorId);
    }, db);

    return true;
  }

  public static getLeaseTransactions(leaseId: string, dbInstance?: DatabaseSync): TransactionRecord[] {
    const operatorId = RequestContext.getOperatorId();
    const db = dbInstance || getDatabase();
    return db.prepare(`
      SELECT * FROM transactions
      WHERE lease_id = ? AND operator_id = ? AND deleted_at IS NULL
      ORDER BY transaction_date ASC, created_at ASC
    `).all(leaseId, operatorId) as unknown as TransactionRecord[];
  }

  public static getLeaseBalance(leaseId: string, dbInstance?: DatabaseSync): {
    leaseId: string;
    balanceCents: number;
    transactionCount: number;
  } {
    const operatorId = RequestContext.getOperatorId();
    const db = dbInstance || getDatabase();

    // Primary: calculate directly from double-entry journal_lines
    const arAccount = ChartOfAccountsRepository.getAccountByMapping('accounts_receivable', db);
    let arBalanceCents = 0;
    let lineCount = 0;

    if (arAccount) {
      const row = db.prepare(`
        SELECT
          COALESCE(SUM(jl.debit_cents - jl.credit_cents), 0) as balance_cents,
          COUNT(*) as line_count
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.deleted_at IS NULL
        JOIN chart_of_accounts coa ON jl.account_id = coa.id AND coa.deleted_at IS NULL
        WHERE jl.operator_id = ? AND jl.lease_id = ? AND jl.account_id = ?
      `).get(operatorId, leaseId, arAccount.id) as { balance_cents: number; line_count: number } | undefined;
      arBalanceCents = row ? Number(row.balance_cents) : 0;
      lineCount = row ? Number(row.line_count) : 0;
    }

    // If no journal entries exist, fall back to single-entry transactions for legacy compatibility
    if (lineCount === 0) {
      const transactions = AccountingRepository.getLeaseTransactions(leaseId, dbInstance);
      const balanceCents = calculateTenantBalance(transactions);
      return {
        leaseId,
        balanceCents,
        transactionCount: transactions.length
      };
    }

    return {
      leaseId,
      balanceCents: arBalanceCents,
      transactionCount: lineCount
    };
  }

  public static getRentRoll(): RentRollItem[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const rows = db.prepare(`
      SELECT
        l.id as lease_id,
        p.id as property_id,
        p.name as property_name,
        u.id as unit_id,
        u.unit_number,
        l.status,
        l.rent_amount_cents as monthly_rent_cents,
        l.deposit_held_cents,
        c.first_name || ' ' || c.last_name as tenant_name
      FROM leases l
      JOIN units u ON l.unit_id = u.id AND u.deleted_at IS NULL
      JOIN properties p ON u.property_id = p.id AND p.deleted_at IS NULL
      LEFT JOIN lease_contacts lc ON l.id = lc.lease_id AND lc.role = 'primary_tenant' AND lc.deleted_at IS NULL
      LEFT JOIN contacts c ON lc.contact_id = c.id AND c.deleted_at IS NULL
      WHERE l.operator_id = ? AND l.deleted_at IS NULL AND l.status IN ('active', 'renewed', 'month_to_month', 'expiring')
      ORDER BY p.name ASC, u.unit_number ASC
    `).all(operatorId) as unknown as Array<Omit<RentRollItem, 'balance_cents'>>;

    return rows.map((r) => {
      const balance = AccountingRepository.getLeaseBalance(r.lease_id).balanceCents;
      return {
        ...r,
        tenant_name: r.tenant_name || 'No Primary Tenant',
        balance_cents: balance
      };
    });
  }

  public static getScheduleEReport(filter?: { year?: number; property_id?: string }): ScheduleEReport {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    let yearStart: number | undefined;
    let yearEnd: number | undefined;
    if (filter?.year) {
      yearStart = Date.UTC(filter.year, 0, 1, 0, 0, 0, 0);
      yearEnd = Date.UTC(filter.year, 11, 31, 23, 59, 59, 999);
    }

    // Primary: calculate from double-entry journal_lines
    let glSql = `
      SELECT
        coa.category_mapping,
        coa.account_type,
        SUM(CASE WHEN coa.account_type = 'Income' THEN (jl.credit_cents - jl.debit_cents) ELSE (jl.debit_cents - jl.credit_cents) END) as total_cents
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.deleted_at IS NULL
      JOIN chart_of_accounts coa ON jl.account_id = coa.id AND coa.deleted_at IS NULL
      WHERE jl.operator_id = ?
        AND coa.account_type IN ('Income', 'Expense', 'CostOfGoodsSold')
    `;
    const glParams: any[] = [operatorId];

    if (filter?.property_id) {
      glSql += ' AND jl.property_id = ?';
      glParams.push(filter.property_id);
    }
    if (yearStart !== undefined && yearEnd !== undefined) {
      glSql += ' AND je.date_ms >= ? AND je.date_ms <= ?';
      glParams.push(yearStart, yearEnd);
    }
    glSql += ' GROUP BY coa.category_mapping, coa.account_type';

    const glRows = db.prepare(glSql).all(...glParams) as Array<{
      category_mapping: string | null;
      account_type: string;
      total_cents: number;
    }>;

    let totalIncomeCents = 0;
    let totalOperatingExpenseCents = 0;
    const incomeByCategory: Record<string, number> = {};
    const expenseByCategory: Record<string, number> = {};

    for (const r of glRows) {
      const cat = r.category_mapping || (r.account_type === 'Income' ? 'rent' : 'repairs');
      const amt = Number(r.total_cents);
      if (r.account_type === 'Income') {
        totalIncomeCents += amt;
        incomeByCategory[cat] = (incomeByCategory[cat] || 0) + amt;
      } else {
        totalOperatingExpenseCents += amt;
        expenseByCategory[cat] = (expenseByCategory[cat] || 0) + amt;
      }
    }

    // If no GL income lines were found (e.g. transactions were recorded as cash payments without an accrual charge),
    // augment income from cash-basis payment transactions.
    if (totalIncomeCents === 0) {
      let pSql = "SELECT * FROM transactions WHERE operator_id = ? AND transaction_type = 'payment' AND deleted_at IS NULL";
      const pParams: any[] = [operatorId];
      if (filter?.property_id) {
        pSql += ' AND property_id = ?';
        pParams.push(filter.property_id);
      }
      if (yearStart !== undefined && yearEnd !== undefined) {
        pSql += ' AND transaction_date >= ? AND transaction_date <= ?';
        pParams.push(yearStart, yearEnd);
      }
      const paymentTxs = db.prepare(pSql).all(...pParams) as unknown as TransactionRecord[];
      for (const p of paymentTxs) {
        totalIncomeCents += p.amount_cents;
        incomeByCategory[p.category] = (incomeByCategory[p.category] || 0) + p.amount_cents;
      }
    }

    return {
      totalIncomeCents,
      totalOperatingExpenseCents,
      netOperatingIncomeCents: totalIncomeCents - totalOperatingExpenseCents,
      incomeByCategory,
      expenseByCategory
    };
  }

  public static processDepositDisposition(
    leaseId: string,
    deductions: Array<{ description: string; amount_cents: number; category?: string }> = []
  ): {
    leaseId: string;
    depositHeldCents: number;
    unpaidChargesCents: number;
    damageDeductionsCents: number;
    finalRefundCents: number;
    createdTransactions: TransactionRecord[];
  } {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    return withTransaction((tx) => {
      const lease = tx.prepare(`
        SELECT l.*, u.property_id
        FROM leases l
        LEFT JOIN units u ON l.unit_id = u.id AND u.operator_id = l.operator_id
        WHERE l.id = ? AND l.operator_id = ? AND l.deleted_at IS NULL
      `).get(leaseId, operatorId) as any;

      if (!lease) {
        throw new Error('Lease not found');
      }

      const currentBalance = AccountingRepository.getLeaseBalance(leaseId, tx).balanceCents;
      const unpaidRentCents = Math.max(0, currentBalance);
      const depositHeldCents = lease.deposit_held_cents || 0;

      const damageTotalCents = deductions.reduce((sum, d) => sum + Math.abs(d.amount_cents), 0);
      const totalDeductionsCents = unpaidRentCents + damageTotalCents;
      const finalRefundCents = Math.max(0, depositHeldCents - totalDeductionsCents);

      const createdTxs: TransactionRecord[] = [];
      const now = Date.now();

      // 1. Post damage deduction transactions if any
      for (const d of deductions) {
        const created = AccountingRepository.createTransaction({
          transaction_type: 'deposit_deduction',
          category: d.category || 'repairs',
          amount_cents: Math.abs(d.amount_cents),
          transaction_date: now,
          description: `Deposit Deduction: ${d.description}`,
          property_id: lease.property_id || null,
          unit_id: lease.unit_id || null,
          lease_id: leaseId
        }, tx);
        createdTxs.push(created);
      }

      // 2. Post deposit return transaction if refund remains
      if (finalRefundCents > 0) {
        const created = AccountingRepository.createTransaction({
          transaction_type: 'deposit_return',
          category: 'security_deposit',
          amount_cents: finalRefundCents,
          transaction_date: now,
          description: 'Security Deposit Refund Return',
          property_id: lease.property_id || null,
          unit_id: lease.unit_id || null,
          lease_id: leaseId
        }, tx);
        createdTxs.push(created);
      }

      // 3. Update lease deposit held to 0 and terminate lease if active
      tx.prepare(`
        UPDATE leases SET deposit_held_cents = 0, status = 'terminated', updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(now, leaseId, operatorId);

      return {
        leaseId,
        depositHeldCents,
        unpaidChargesCents: unpaidRentCents,
        damageDeductionsCents: damageTotalCents,
        finalRefundCents,
        createdTransactions: createdTxs
      };
    }, db);
  }

  /**
   * Generates a statutory Three-Way Bank Reconciliation report for trust accounts.
   * Proves parity between Bank Statement Balance, GL Trust Cash (Account 1020),
   * Tenant Security Deposits Held (Account 2100), and individual active lease deposit subledgers.
   *
   * @param asOfDateMs Optional cutoff epoch timestamp in milliseconds (defaults to current time).
   * @param bankStatementBalanceCents Optional empirical bank statement balance in cents for full 3-way reconciliation.
   * @param tx Optional database transaction connection.
   * @returns ThreeWayReconciliationResult proving trust parity across bank, books, and subledgers.
   */
  public static getThreeWayReconciliation(
    asOfDateMs?: number,
    bankStatementBalanceCents?: number,
    tx?: any
  ): ThreeWayReconciliationResult {
    const operatorId = RequestContext.getOperatorId();
    const db = tx || getDatabase();
    const asOf = asOfDateMs || Date.now();

    // 1. Calculate GL Trust Cash from Account 1020
    const trustAccount = db.prepare(`
      SELECT id FROM chart_of_accounts
      WHERE operator_id = ? AND (account_number = '1020' OR category_mapping = 'trust_bank') AND deleted_at IS NULL
      LIMIT 1
    `).get(operatorId) as { id: string } | undefined;

    let glTrustCashCents = 0;
    if (trustAccount) {
      const glRow = db.prepare(`
        SELECT COALESCE(SUM(jl.debit_cents - jl.credit_cents), 0) AS balance_cents
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE jl.operator_id = ? AND jl.account_id = ? AND je.date_ms <= ? AND je.deleted_at IS NULL
      `).get(operatorId, trustAccount.id, asOf) as { balance_cents: number };
      glTrustCashCents = glRow ? Number(glRow.balance_cents) : 0;
    }

    // 2. Calculate Tenant Deposits Liability from Account 2100
    const liabilityAccount = db.prepare(`
      SELECT id FROM chart_of_accounts
      WHERE operator_id = ? AND (account_number = '2100' OR category_mapping = 'security_deposit') AND deleted_at IS NULL
      LIMIT 1
    `).get(operatorId) as { id: string } | undefined;

    let tenantDepositsLiabilityCents = 0;
    if (liabilityAccount) {
      const liabRow = db.prepare(`
        SELECT COALESCE(SUM(jl.credit_cents - jl.debit_cents), 0) AS balance_cents
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id
        WHERE jl.operator_id = ? AND jl.account_id = ? AND je.date_ms <= ? AND je.deleted_at IS NULL
      `).get(operatorId, liabilityAccount.id, asOf) as { balance_cents: number };
      tenantDepositsLiabilityCents = liabRow ? Number(liabRow.balance_cents) : 0;
    }

    // If no journal entries exist, fall back to single-entry transactions
    if (glTrustCashCents === 0 && tenantDepositsLiabilityCents === 0) {
      const txRow = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type = 'deposit_inflow' THEN amount_cents ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN transaction_type IN ('deposit_return', 'deposit_deduction') THEN amount_cents ELSE 0 END), 0) AS net_trust
        FROM transactions
        WHERE operator_id = ? AND transaction_date <= ? AND deleted_at IS NULL
      `).get(operatorId, asOf) as { net_trust: number };
      const netTrust = txRow ? Number(txRow.net_trust) : 0;
      glTrustCashCents = netTrust;
      tenantDepositsLiabilityCents = netTrust;
    }

    // 3. Query individual active lease deposit subledgers as of cutoff date
    const leaseRows = db.prepare(`
      SELECT
        l.id AS lease_id,
        l.deposit_held_cents AS current_deposit_held_cents,
        p.name AS property_name,
        u.unit_number,
        (
          SELECT c.first_name || ' ' || c.last_name
          FROM lease_contacts lc
          JOIN contacts c ON lc.contact_id = c.id
          WHERE lc.lease_id = l.id AND lc.role = 'primary_tenant' AND lc.deleted_at IS NULL AND c.deleted_at IS NULL
          LIMIT 1
        ) AS primary_tenant_name,
        (
          SELECT
            COALESCE(SUM(CASE WHEN t.transaction_type = 'deposit_inflow' THEN t.amount_cents ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN t.transaction_type IN ('deposit_return', 'deposit_deduction') THEN t.amount_cents ELSE 0 END), 0)
          FROM transactions t
          WHERE t.lease_id = l.id
            AND t.operator_id = l.operator_id
            AND t.transaction_date <= ?
            AND t.deleted_at IS NULL
        ) AS tx_deposit_held_cents,
        (
          SELECT COUNT(*)
          FROM transactions t
          WHERE t.lease_id = l.id
            AND t.operator_id = l.operator_id
            AND t.transaction_type IN ('deposit_inflow', 'deposit_return', 'deposit_deduction')
            AND t.deleted_at IS NULL
        ) AS has_deposit_txs
      FROM leases l
      LEFT JOIN units u ON l.unit_id = u.id AND u.operator_id = l.operator_id
      LEFT JOIN properties p ON u.property_id = p.id AND p.operator_id = l.operator_id
      WHERE l.operator_id = ?
        AND l.deleted_at IS NULL
        AND l.status IN ('active', 'pending')
        AND l.start_date <= ?
      ORDER BY p.name ASC, u.unit_number ASC
    `).all(asOf, operatorId, asOf) as Array<{
      lease_id: string;
      current_deposit_held_cents: number;
      property_name: string | null;
      unit_number: string | null;
      primary_tenant_name: string | null;
      tx_deposit_held_cents: number;
      has_deposit_txs: number;
    }>;

    const activeLeaseItems: ReconciliationLeaseItem[] = leaseRows
      .map((r) => {
        const deposit = r.has_deposit_txs > 0 ? Number(r.tx_deposit_held_cents) : Number(r.current_deposit_held_cents);
        return {
          lease_id: r.lease_id,
          property_name: r.property_name || null,
          unit_number: r.unit_number || null,
          primary_tenant_name: r.primary_tenant_name || null,
          deposit_held_cents: deposit
        };
      })
      .filter((item) => item.deposit_held_cents > 0);

    const leaseDepositsTotalCents = activeLeaseItems.reduce((sum, r) => sum + r.deposit_held_cents, 0);
    const booksInBalance = glTrustCashCents === tenantDepositsLiabilityCents &&
      tenantDepositsLiabilityCents === leaseDepositsTotalCents;
    const bankInBalance = bankStatementBalanceCents !== undefined
      ? bankStatementBalanceCents === glTrustCashCents
      : true;
    const inBalance = booksInBalance && bankInBalance;
    const diffCents = bankStatementBalanceCents !== undefined
      ? bankStatementBalanceCents - leaseDepositsTotalCents
      : glTrustCashCents - leaseDepositsTotalCents;

    return {
      as_of_date_ms: asOf,
      ...(bankStatementBalanceCents !== undefined ? { bank_statement_balance_cents: bankStatementBalanceCents } : {}),
      gl_trust_cash_cents: glTrustCashCents,
      tenant_deposits_liability_cents: tenantDepositsLiabilityCents,
      lease_deposits_total_cents: leaseDepositsTotalCents,
      in_balance: inBalance,
      reconciliation_difference_cents: diffCents,
      leases: activeLeaseItems
    };
  }

  /**
   * Generates an IRS Form 1099-NEC vendor expense summary report for a given tax year.
   * Aggregates all operating and maintenance expense payments to vendors and flags those
   * meeting or exceeding the statutory $600.00 (60,000 cents) threshold.
   *
   * @param taxYear Calendar tax year (e.g. 2026).
   * @param tx Optional database transaction connection.
   * @returns Vendor1099ReportResult containing qualifying vendor records and totals.
   */
  public static getVendor1099Report(
    taxYear: number,
    tx?: any
  ): Vendor1099ReportResult {
    const operatorId = RequestContext.getOperatorId();
    const db = tx || getDatabase();
    const yearStart = Date.UTC(taxYear, 0, 1, 0, 0, 0, 0);
    const yearEnd = Date.UTC(taxYear, 11, 31, 23, 59, 59, 999);
    const THRESHOLD_CENTS = taxYear >= 2026 ? 200000 : 60000; // $2,000.00 for 2026+, $600.00 for pre-2026

    // Collect payments by vendor contact
    const vendorMap = new Map<string, number>();

    // 1. Check journal_lines where account is Expense/COGS and contact_id is set (netting reversals)
    const journalVendorRows = db.prepare(`
      SELECT jl.contact_id, SUM(jl.debit_cents - jl.credit_cents) AS total_cents
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.deleted_at IS NULL
      JOIN chart_of_accounts coa ON jl.account_id = coa.id AND coa.deleted_at IS NULL
      WHERE jl.operator_id = ?
        AND jl.contact_id IS NOT NULL
        AND coa.account_type IN ('Expense', 'CostOfGoodsSold')
        AND je.date_ms >= ? AND je.date_ms <= ?
      GROUP BY jl.contact_id
    `).all(operatorId, yearStart, yearEnd) as Array<{ contact_id: string; total_cents: number }>;

    for (const r of journalVendorRows) {
      if (r.contact_id) {
        const current = vendorMap.get(r.contact_id) || 0;
        vendorMap.set(r.contact_id, current + Number(r.total_cents));
      }
    }

    // 2. Also check single-entry transactions where payee_contact_id is set and category is expense
    // Exclude transactions already converted to journal entries to avoid double counting
    const txVendorRows = db.prepare(`
      SELECT payee_contact_id AS contact_id, SUM(amount_cents) AS total_cents
      FROM transactions
      WHERE operator_id = ?
        AND payee_contact_id IS NOT NULL
        AND transaction_type = 'expense'
        AND journal_entry_id IS NULL
        AND transaction_date >= ? AND transaction_date <= ?
        AND deleted_at IS NULL
      GROUP BY payee_contact_id
    `).all(operatorId, yearStart, yearEnd) as Array<{ contact_id: string; total_cents: number }>;

    for (const r of txVendorRows) {
      if (r.contact_id) {
        const current = vendorMap.get(r.contact_id) || 0;
        vendorMap.set(r.contact_id, current + Number(r.total_cents));
      }
    }

    // 3. Fetch contact profiles for all discovered vendors or contacts marked as 'vendor'
    const allVendors = db.prepare(`
      SELECT id, first_name, last_name, company_name, tax_id_last4, email, phone
      FROM contacts
      WHERE operator_id = ? AND contact_type = 'vendor' AND deleted_at IS NULL
    `).all(operatorId) as Array<{
      id: string;
      first_name: string;
      last_name: string;
      company_name: string | null;
      tax_id_last4: string | null;
      email: string | null;
      phone: string | null;
    }>;

    const vendorRecords: Vendor1099Record[] = [];
    const processedIds = new Set<string>();

    for (const v of allVendors) {
      processedIds.add(v.id);
      const total = vendorMap.get(v.id) || 0;
      const vendorName = v.company_name || `${v.first_name} ${v.last_name}`.trim();
      vendorRecords.push({
        vendor_id: v.id,
        vendor_name: vendorName,
        company_name: v.company_name,
        tax_id_last4: v.tax_id_last4,
        email: v.email,
        phone: v.phone,
        total_payments_cents: total,
        threshold_met: total >= THRESHOLD_CENTS
      });
    }

    // Include any contacts not explicitly marked as 'vendor' but having payments
    for (const [contactId, total] of vendorMap.entries()) {
      if (!processedIds.has(contactId)) {
        const contact = db.prepare(`
          SELECT id, first_name, last_name, company_name, tax_id_last4, email, phone
          FROM contacts
          WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
        `).get(contactId, operatorId) as any;
        if (contact) {
          const vendorName = contact.company_name || `${contact.first_name} ${contact.last_name}`.trim();
          vendorRecords.push({
            vendor_id: contact.id,
            vendor_name: vendorName,
            company_name: contact.company_name,
            tax_id_last4: contact.tax_id_last4,
            email: contact.email,
            phone: contact.phone,
            total_payments_cents: total,
            threshold_met: total >= THRESHOLD_CENTS
          });
        }
      }
    }

    vendorRecords.sort((a, b) => b.total_payments_cents - a.total_payments_cents);

    const qualifying = vendorRecords.filter((v) => v.threshold_met);
    const totalQualifyingCents = qualifying.reduce((sum, v) => sum + v.total_payments_cents, 0);

    return {
      tax_year: taxYear,
      threshold_cents: THRESHOLD_CENTS,
      total_vendors_count: vendorRecords.length,
      qualifying_vendors_count: qualifying.length,
      total_qualifying_payments_cents: totalQualifyingCents,
      vendors: vendorRecords
    };
  }

  /**
   * Computes statutory deduction deadline and remaining timeline for tenant deposit disposition.
   * Based on jurisdiction state statutory periods (e.g. CA 21 days, NY 14 days, TX 30 days).
   *
   * @param moveOutDateMs Epoch timestamp of tenant move-out date.
   * @param stateCode US state postal abbreviation (defaults to 'US' standard 30-day window).
   * @returns StatutoryDispositionTimelineResult with computed deadlines and overdue status.
   */
  public static getStatutoryDispositionTimeline(
    moveOutDateMs: number,
    stateCode: string = 'US'
  ): StatutoryDispositionTimelineResult {
    const STATE_LIMITS: Record<string, number> = {
      NY: 14,
      AZ: 14,
      FL: 15,
      CA: 21,
      WA: 21,
      CO: 30,
      TX: 30,
      IL: 30,
      MA: 30,
      NJ: 30,
      PA: 30
    };

    const upperState = (stateCode || 'US').trim().toUpperCase();
    const limitDays = upperState === 'US' ? 30 : STATE_LIMITS[upperState];
    if (limitDays === undefined) {
      throw new Error(
        `Unsupported jurisdiction '${stateCode}'. Statutory deposit disposition timeline is only maintained for supported states (${Object.keys(STATE_LIMITS).join(', ')}) or generic 'US'.`
      );
    }
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const deadlineMs = moveOutDateMs + limitDays * MS_PER_DAY;
    const now = Date.now();
    const daysRemaining = Math.ceil((deadlineMs - now) / MS_PER_DAY);
    const isPastDue = now > deadlineMs;

    return {
      move_out_date_ms: moveOutDateMs,
      state_code: upperState,
      statutory_limit_days: limitDays,
      deadline_date_ms: deadlineMs,
      days_remaining: daysRemaining,
      is_past_due: isPastDue
    };
  }
}

/**
 * Itemized lease deposit detail for three-way reconciliation.
 */
export interface ReconciliationLeaseItem {
  lease_id: string;
  property_name: string | null;
  unit_number: string | null;
  primary_tenant_name: string | null;
  deposit_held_cents: number;
}

/**
 * Result envelope for statutory three-way bank reconciliation.
 * Proves equality between bank statement balance, GL trust account balance,
 * and individual tenant deposit liabilities held on active leases.
 */
export interface ThreeWayReconciliationResult {
  as_of_date_ms: number;
  bank_statement_balance_cents?: number;
  gl_trust_cash_cents: number;
  tenant_deposits_liability_cents: number;
  lease_deposits_total_cents: number;
  in_balance: boolean;
  reconciliation_difference_cents: number;
  leases: ReconciliationLeaseItem[];
}

/**
 * Vendor record for annual IRS Form 1099-NEC aggregation.
 */
export interface Vendor1099Record {
  vendor_id: string;
  vendor_name: string;
  company_name: string | null;
  tax_id_last4: string | null;
  email: string | null;
  phone: string | null;
  total_payments_cents: number;
  threshold_met: boolean;
}

/**
 * Result envelope for annual IRS Form 1099-NEC vendor reporting.
 */
export interface Vendor1099ReportResult {
  tax_year: number;
  threshold_cents: number;
  total_vendors_count: number;
  qualifying_vendors_count: number;
  total_qualifying_payments_cents: number;
  vendors: Vendor1099Record[];
}

/**
 * Result envelope for statutory move-out deposit disposition timelines.
 */
export interface StatutoryDispositionTimelineResult {
  move_out_date_ms: number;
  state_code: string;
  statutory_limit_days: number;
  deadline_date_ms: number;
  days_remaining: number;
  is_past_due: boolean;
}

export * from './client_accounting.js';

