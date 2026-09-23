import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { ChartOfAccountsRepository, ChartOfAccountRecord } from './chart_of_accounts.js';

export interface CreateJournalLineInput {
  account_id: string;
  debit_cents: number;
  credit_cents: number;
  property_id?: string | null;
  unit_id?: string | null;
  contact_id?: string | null;
  lease_id?: string | null;
  description?: string | null;
}

export interface CreateJournalEntryInput {
  date_ms?: number;
  memo: string;
  source_type: string;
  source_id?: string | null;
  lines: CreateJournalLineInput[];
}

export interface JournalLineRecord {
  id: string;
  operator_id: string;
  tenant_id?: string;
  journal_entry_id: string;
  account_id: string;
  debit_cents: number;
  credit_cents: number;
  property_id: string | null;
  unit_id: string | null;
  contact_id: string | null;
  lease_id?: string | null;
  description: string | null;
  created_at: number;
  account_number?: string | null;
  account_name?: string | null;
  account_type?: string | null;
}

export interface JournalEntryRecord {
  id: string;
  operator_id: string;
  tenant_id?: string;
  entry_number: number;
  date_ms: number;
  memo: string;
  source_type: string;
  source_id: string | null;
  posted_at: number;
  reversed_by_entry_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  lines?: JournalLineRecord[];
  total_debit_cents?: number;
  total_credit_cents?: number;
}

export interface TrialBalanceItem {
  account_id: string;
  account_number: string | null;
  account_name: string;
  account_type: string;
  total_debit_cents: number;
  total_credit_cents: number;
  net_balance_cents: number;
}

export interface TrialBalanceReport {
  asOfDateMs: number;
  accounts: TrialBalanceItem[];
  totalDebitCents: number;
  totalCreditCents: number;
  isBalanced: boolean;
}

export class JournalService {
  /**
   * Post an immutable, balanced double-entry journal entry.
   * Enforces invariant: Sum(Debits) == Sum(Credits) > 0.
   */
  public static postEntry(
    input: CreateJournalEntryInput,
    dbInstance?: any,
    options?: { historicalReferenceMode?: boolean }
  ): JournalEntryRecord {
    const operatorId = RequestContext.getOperatorId();
    const isDatabaseInstance = !!dbInstance && typeof dbInstance === 'object' && typeof dbInstance.prepare === 'function';
    const db = isDatabaseInstance ? dbInstance : getDatabase();
    const historicalReferenceMode =
      options?.historicalReferenceMode === true ||
      (typeof dbInstance === 'boolean' && dbInstance === true) ||
      (!!dbInstance && typeof dbInstance === 'object' && !isDatabaseInstance && dbInstance.historicalReferenceMode === true);

    if (!input.lines || input.lines.length < 2) {
      throw new Error('A journal entry requires at least two lines.');
    }

    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of input.lines) {
      const debit = Math.round(line.debit_cents || 0);
      const credit = Math.round(line.credit_cents || 0);

      if (debit < 0 || credit < 0) {
        throw new Error('Debit and credit amounts must be non-negative integer cents.');
      }

      if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        throw new Error('Each line must have either a positive debit or positive credit, never both or neither.');
      }

      if (!line.account_id) {
        throw new Error('account_id is required for every journal line.');
      }

      totalDebit += debit;
      totalCredit += credit;
    }

    if (totalDebit !== totalCredit) {
      throw new Error(`Unbalanced journal entry: Total debits (${totalDebit}) must equal total credits (${totalCredit}).`);
    }

    if (totalDebit <= 0) {
      throw new Error('Total entry amount must be greater than 0 cents.');
    }

    const entryId = generateUUIDv7();
    const now = Date.now();
    const entryDate = input.date_ms || now;

    const executeInsert = (conn: any) => {
      // Validate operator ownership of account_id, property_id, unit_id, and contact_id.
      // Historical-reference mode is reserved for internal reversal/backfill flows that
      // must preserve operator validation while allowing soft-deleted references to remain readable.
      const deletedFilter = historicalReferenceMode ? '' : ' AND deleted_at IS NULL';
      const checkAccount = conn.prepare(`
        SELECT id, account_number, account_name, account_type, category_mapping
        FROM chart_of_accounts
        WHERE id = ? AND operator_id = ?${deletedFilter}
      `);
      const checkProperty = conn.prepare(`
        SELECT 1 FROM properties
        WHERE id = ? AND operator_id = ?${deletedFilter}
      `);
      const checkUnit = conn.prepare(`
        SELECT 1 FROM units
        WHERE id = ? AND operator_id = ?${deletedFilter}
      `);
      const checkContact = conn.prepare(`
        SELECT 1 FROM contacts
        WHERE id = ? AND operator_id = ?${deletedFilter}
      `);
      const checkLease = conn.prepare(`
        SELECT 1 FROM leases
        WHERE id = ? AND operator_id = ?${deletedFilter}
      `);

      const lineAccounts: Array<{ line: CreateJournalLineInput; account: any }> = [];
      for (const line of input.lines) {
        const acc = checkAccount.get(line.account_id, operatorId) as any;
        if (!acc) {
          throw new Error(`Account '${line.account_id}' does not exist or does not belong to the current operator.`);
        }
        lineAccounts.push({ line, account: acc });

        if (line.property_id && !checkProperty.get(line.property_id, operatorId)) {
          throw new Error(`Property '${line.property_id}' does not exist or does not belong to the current operator.`);
        }
        if (line.unit_id && !checkUnit.get(line.unit_id, operatorId)) {
          throw new Error(`Unit '${line.unit_id}' does not exist or does not belong to the current operator.`);
        }
        if (line.contact_id && !checkContact.get(line.contact_id, operatorId)) {
          throw new Error(`Contact '${line.contact_id}' does not exist or does not belong to the current operator.`);
        }
        if (line.lease_id && !checkLease.get(line.lease_id, operatorId)) {
          throw new Error(`Lease '${line.lease_id}' does not exist or does not belong to the current operator.`);
        }
      }

      // Statutory Trust Accounting Non-Commingling Invariant:
      // Fiduciary funds held in Security Deposit Trust Checking (Account 1020 / category_mapping 'trust_bank')
      // must never be commingled with operating accounts (Income, Expense, CostOfGoodsSold, or operating_bank)
      // without an exactly matching and offsetting tenant deposit liability movement (Account 2100 / category_mapping 'security_deposit').
      let netTrustMovement = 0;
      let netLiabilityMovement = 0;
      let hasTrustBankLines = false;
      let hasOperatingLines = false;

      for (const { line, account } of lineAccounts) {
        const isTrustBank = account.account_number === '1020' || account.category_mapping === 'trust_bank';
        const isDepositLiability = account.account_number === '2100' || account.category_mapping === 'security_deposit';
        const isOperating = (
          account.account_type === 'Income' ||
          account.account_type === 'Expense' ||
          account.account_type === 'CostOfGoodsSold' ||
          account.category_mapping === 'operating_bank'
        );

        if (isTrustBank) {
          hasTrustBankLines = true;
          netTrustMovement += (line.debit_cents - line.credit_cents);
        }
        if (isDepositLiability) {
          netLiabilityMovement += (line.credit_cents - line.debit_cents);
        }
        if (isOperating) {
          hasOperatingLines = true;
        }
      }

      if (hasTrustBankLines && hasOperatingLines) {
        if (netTrustMovement !== netLiabilityMovement || netTrustMovement !== 0) {
          throw new Error(
            'Trust accounting violation: Security Deposit Trust funds (Account 1020) cannot be directly commingled with operating income or operating expenses. Deposits must balance against Tenant Security Deposits Held (Account 2100).'
          );
        }
      }

      // Obtain next sequential entry_number for this operator
      const maxRow = conn.prepare(`
        SELECT COALESCE(MAX(entry_number), 0) as max_num
        FROM journal_entries
        WHERE operator_id = ?
      `).get(operatorId) as { max_num: number };

      const entryNumber = (maxRow?.max_num || 0) + 1;

      conn.prepare(`
        INSERT INTO journal_entries (
          id, operator_id, entry_number, date_ms, memo, source_type, source_id,
          posted_at, reversed_by_entry_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        entryId,
        operatorId,
        entryNumber,
        entryDate,
        input.memo,
        input.source_type,
        input.source_id || null,
        now,
        now,
        now
      );

      const lineStmt = conn.prepare(`
        INSERT INTO journal_lines (
          id, operator_id, journal_entry_id, account_id, debit_cents, credit_cents,
          property_id, unit_id, contact_id, lease_id, description, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of input.lines) {
        lineStmt.run(
          generateUUIDv7(),
          operatorId,
          entryId,
          line.account_id,
          Math.round(line.debit_cents || 0),
          Math.round(line.credit_cents || 0),
          line.property_id || null,
          line.unit_id || null,
          line.contact_id || null,
          line.lease_id || null,
          line.description || null,
          now
        );
      }
    };

    if (dbInstance) {
      executeInsert(dbInstance);
    } else {
      withTransaction((tx) => {
        executeInsert(tx);
      }, db);
    }

    const createdEntry = this.getEntryById(entryId, db);
    if (!createdEntry) {
      throw new Error('Failed to retrieve created journal entry.');
    }
    return createdEntry;
  }

  /**
   * Reverse a posted journal entry by generating an exact opposite entry
   * and linking reversed_by_entry_id.
   */
  public static reverseEntry(entryId: string, reason: string, dbInstance?: any): JournalEntryRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = dbInstance || getDatabase();

    let reversalEntry: JournalEntryRecord;

    const executeReversal = (conn: any) => {
      // Re-read original entry inside write lock / transaction
      const original = this.getEntryById(entryId, conn);
      if (!original) {
        throw new Error('Journal entry not found.');
      }

      if (original.reversed_by_entry_id) {
        throw new Error('Journal entry has already been reversed.');
      }

      if (!original.lines || original.lines.length === 0) {
        throw new Error('Journal entry has no lines to reverse.');
      }

      // Prepare swapped reversal lines
      const reversalLines: CreateJournalLineInput[] = original.lines.map((line) => ({
        account_id: line.account_id,
        debit_cents: line.credit_cents,
        credit_cents: line.debit_cents,
        property_id: line.property_id,
        unit_id: line.unit_id,
        contact_id: line.contact_id,
        lease_id: line.lease_id ?? null,
        description: `Reversal: ${line.description || original.memo}`
      }));

      // Post reversal entry
      reversalEntry = this.postEntry({
        date_ms: Date.now(),
        memo: `Reversal of Entry #${original.entry_number}: ${reason}`,
        source_type: 'reversal',
        source_id: original.id,
        lines: reversalLines
      }, conn, { historicalReferenceMode: true });

      // Mark original entry as reversed
      conn.prepare(`
        UPDATE journal_entries
        SET reversed_by_entry_id = ?, updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(reversalEntry.id, Date.now(), original.id, operatorId);
    };

    if (dbInstance) {
      executeReversal(dbInstance);
    } else {
      withTransaction((tx) => {
        executeReversal(tx);
      }, db);
    }

    return reversalEntry!;
  }

  /**
   * Retrieve a single journal entry with all lines.
   */
  public static getEntryById(id: string, dbInstance?: any): JournalEntryRecord | null {
    const operatorId = RequestContext.getOperatorId();
    const db = dbInstance || getDatabase();

    const entry = db.prepare(`
      SELECT * FROM journal_entries
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(id, operatorId) as JournalEntryRecord | undefined;

    if (!entry) return null;

    const lines = db.prepare(`
      SELECT
        jl.*,
        coa.account_number,
        coa.account_name,
        coa.account_type
      FROM journal_lines jl
      JOIN chart_of_accounts coa ON jl.account_id = coa.id AND coa.operator_id = jl.operator_id
      WHERE jl.journal_entry_id = ? AND jl.operator_id = ?
      ORDER BY jl.debit_cents DESC, jl.credit_cents DESC, jl.created_at ASC
    `).all(id, operatorId) as unknown as JournalLineRecord[];

    const totalDebit = lines.reduce((sum, l) => sum + l.debit_cents, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit_cents, 0);

    return {
      ...entry,
      lines,
      total_debit_cents: totalDebit,
      total_credit_cents: totalCredit
    };
  }

  /**
   * List journal entries with optional filtering.
   */
  public static listEntries(filter?: {
    source_type?: string;
    source_id?: string;
    start_date?: number;
    end_date?: number;
    limit?: number;
    offset?: number;
  }): { entries: JournalEntryRecord[]; total: number } {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    let sql = `SELECT * FROM journal_entries WHERE operator_id = ? AND deleted_at IS NULL`;
    const params: any[] = [operatorId];

    if (filter?.source_type) {
      sql += ` AND source_type = ?`;
      params.push(filter.source_type);
    }
    if (filter?.source_id) {
      sql += ` AND source_id = ?`;
      params.push(filter.source_id);
    }
    if (filter?.start_date) {
      sql += ` AND date_ms >= ?`;
      params.push(filter.start_date);
    }
    if (filter?.end_date) {
      sql += ` AND date_ms <= ?`;
      params.push(filter.end_date);
    }

    // hygiene-exempt: subquery composition using parameterized placeholders
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM (${sql})`).get(...params) as { count: number };
    const total = countRow?.count || 0;

    sql += ` ORDER BY date_ms DESC, entry_number DESC`;

    if (filter?.limit) {
      sql += ` LIMIT ?`;
      params.push(filter.limit);
      if (filter?.offset) {
        sql += ` OFFSET ?`;
        params.push(filter.offset);
      }
    }

    const entries = db.prepare(sql).all(...params) as unknown as JournalEntryRecord[];

    // Hydrate each entry with lines
    for (const entry of entries) {
      const lines = db.prepare(`
        SELECT
          jl.*,
          coa.account_number,
          coa.account_name,
          coa.account_type
        FROM journal_lines jl
        JOIN chart_of_accounts coa ON jl.account_id = coa.id AND coa.operator_id = jl.operator_id
        WHERE jl.journal_entry_id = ? AND jl.operator_id = ?
        ORDER BY jl.debit_cents DESC, jl.credit_cents DESC, jl.created_at ASC
      `).all(entry.id, operatorId) as unknown as JournalLineRecord[];

      entry.lines = lines;
      entry.total_debit_cents = lines.reduce((sum, l) => sum + l.debit_cents, 0);
      entry.total_credit_cents = lines.reduce((sum, l) => sum + l.credit_cents, 0);
    }

    return { entries, total };
  }

  /**
   * Generate a Trial Balance report aggregating debit/credit totals across all accounts.
   */
  public static getTrialBalance(asOfDateMs?: number, propertyId?: string): TrialBalanceReport {
    ChartOfAccountsRepository.ensureDefaultAccounts();
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const cutoffDate = asOfDateMs || Date.now();

    let sql = `
      SELECT
        coa.id as account_id,
        coa.account_number,
        coa.account_name,
        coa.account_type,
        COALESCE(SUM(jl.debit_cents), 0) as total_debit_cents,
        COALESCE(SUM(jl.credit_cents), 0) as total_credit_cents
      FROM chart_of_accounts coa
      LEFT JOIN (
        SELECT jl.*
        FROM journal_lines jl
        JOIN journal_entries je
          ON jl.journal_entry_id = je.id
         AND jl.operator_id = je.operator_id
        WHERE je.deleted_at IS NULL
          AND je.date_ms <= ?
      ) jl ON coa.id = jl.account_id AND coa.operator_id = jl.operator_id
      WHERE coa.operator_id = ? AND coa.deleted_at IS NULL
    `;
    const params: any[] = [cutoffDate, operatorId];

    if (propertyId) {
      sql += ` AND (jl.property_id = ? OR jl.property_id IS NULL)`;
      params.push(propertyId);
    }

    sql += `
      GROUP BY coa.id, coa.account_number, coa.account_name, coa.account_type
      ORDER BY coa.account_number ASC, coa.account_name ASC
    `;

    const rows = db.prepare(sql).all(...params) as Array<{
      account_id: string;
      account_number: string | null;
      account_name: string;
      account_type: string;
      total_debit_cents: number;
      total_credit_cents: number;
    }>;

    let grandTotalDebit = 0;
    let grandTotalCredit = 0;

    const accounts: TrialBalanceItem[] = rows.map((r) => {
      grandTotalDebit += r.total_debit_cents;
      grandTotalCredit += r.total_credit_cents;

      // Net balance calculation based on account normal balance
      let netBalance = 0;
      switch (r.account_type) {
        case 'Bank':
        case 'AccountsReceivable':
        case 'OtherCurrentAsset':
        case 'Expense':
        case 'CostOfGoodsSold':
          // Normal Debit
          netBalance = r.total_debit_cents - r.total_credit_cents;
          break;
        case 'AccountsPayable':
        case 'OtherCurrentLiability':
        case 'Equity':
        case 'Income':
        default:
          // Normal Credit
          netBalance = r.total_credit_cents - r.total_debit_cents;
          break;
      }

      return {
        account_id: r.account_id,
        account_number: r.account_number,
        account_name: r.account_name,
        account_type: r.account_type,
        total_debit_cents: r.total_debit_cents,
        total_credit_cents: r.total_credit_cents,
        net_balance_cents: netBalance
      };
    });

    return {
      asOfDateMs: cutoffDate,
      accounts,
      totalDebitCents: grandTotalDebit,
      totalCreditCents: grandTotalCredit,
      isBalanced: grandTotalDebit === grandTotalCredit
    };
  }

  /**
   * Backfill single-entry transactions into balanced double-entry journal entries.
   * Can be run safely and idempotently.
   */
  public static backfillLegacyTransactions(): { migrated: number; skipped: number } {
    ChartOfAccountsRepository.ensureDefaultAccounts();
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    // Find active transactions that do not yet have a journal_entry_id
    const unmigrated = db.prepare(`
      SELECT * FROM transactions
      WHERE operator_id = ? AND deleted_at IS NULL
        AND (journal_entry_id IS NULL OR journal_entry_id = '')
      ORDER BY transaction_date ASC, created_at ASC
    `).all(operatorId) as any[];

    if (unmigrated.length === 0) {
      return { migrated: 0, skipped: 0 };
    }

    const operatingBank = ChartOfAccountsRepository.getAccountByMapping('operating_bank')!;
    const trustBank = ChartOfAccountsRepository.getAccountByMapping('trust_bank')!;
    const accountsReceivable = ChartOfAccountsRepository.getAccountByMapping('accounts_receivable')!;
    const depositLiability = ChartOfAccountsRepository.getAccountByMapping('security_deposit')!;

    let migrated = 0;
    let skipped = 0;

    withTransaction((tx) => {
      for (const t of unmigrated) {
        // Re-read candidate transaction inside transaction to guarantee idempotency
        const current = tx.prepare(`
          SELECT id, journal_entry_id, deleted_at FROM transactions
          WHERE id = ? AND operator_id = ?
        `).get(t.id, operatorId) as { id: string; journal_entry_id: string | null; deleted_at: number | null } | undefined;

        if (!current || current.deleted_at !== null || (current.journal_entry_id && current.journal_entry_id !== '')) {
          skipped++;
          continue;
        }

        if (!t.amount_cents || t.amount_cents <= 0) {
          skipped++;
          continue;
        }

        const lines: CreateJournalLineInput[] = [];
        const mappedAccount = ChartOfAccountsRepository.getAccountByMapping(t.category);

        switch (t.transaction_type) {
          case 'charge': {
            // Dr: Accounts Receivable, Cr: Revenue
            const revAccount = mappedAccount || ChartOfAccountsRepository.getAccountByMapping('rent')!;
            lines.push(
              {
                account_id: accountsReceivable.id,
                debit_cents: t.amount_cents,
                credit_cents: 0,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payer_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              },
              {
                account_id: revAccount.id,
                debit_cents: 0,
                credit_cents: t.amount_cents,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payer_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              }
            );
            break;
          }
          case 'payment': {
            // Dr: Operating Checking, Cr: Accounts Receivable
            lines.push(
              {
                account_id: operatingBank.id,
                debit_cents: t.amount_cents,
                credit_cents: 0,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payer_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              },
              {
                account_id: accountsReceivable.id,
                debit_cents: 0,
                credit_cents: t.amount_cents,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payer_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              }
            );
            break;
          }
          case 'expense': {
            // Dr: Expense Account, Cr: Operating Checking
            const expAccount = mappedAccount || ChartOfAccountsRepository.getAccountByMapping('repairs')!;
            lines.push(
              {
                account_id: expAccount.id,
                debit_cents: t.amount_cents,
                credit_cents: 0,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payee_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              },
              {
                account_id: operatingBank.id,
                debit_cents: 0,
                credit_cents: t.amount_cents,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payee_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              }
            );
            break;
          }
          case 'refund': {
            // Dr: Accounts Receivable, Cr: Operating Checking
            lines.push(
              {
                account_id: accountsReceivable.id,
                debit_cents: t.amount_cents,
                credit_cents: 0,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payee_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              },
              {
                account_id: operatingBank.id,
                debit_cents: 0,
                credit_cents: t.amount_cents,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payee_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              }
            );
            break;
          }
          case 'deposit_inflow': {
            // Dr: Security Deposit Trust Checking, Cr: Tenant Security Deposits Held
            lines.push(
              {
                account_id: trustBank.id,
                debit_cents: t.amount_cents,
                credit_cents: 0,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payer_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              },
              {
                account_id: depositLiability.id,
                debit_cents: 0,
                credit_cents: t.amount_cents,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payer_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              }
            );
            break;
          }
          case 'deposit_return': {
            // Dr: Tenant Security Deposits Held, Cr: Security Deposit Trust Checking
            lines.push(
              {
                account_id: depositLiability.id,
                debit_cents: t.amount_cents,
                credit_cents: 0,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payee_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              },
              {
                account_id: trustBank.id,
                debit_cents: 0,
                credit_cents: t.amount_cents,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payee_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              }
            );
            break;
          }
          case 'deposit_deduction': {
            // Dr: Tenant Security Deposits Held, Cr: Accounts Receivable (or Repairs)
            lines.push(
              {
                account_id: depositLiability.id,
                debit_cents: t.amount_cents,
                credit_cents: 0,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payer_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              },
              {
                account_id: accountsReceivable.id,
                debit_cents: 0,
                credit_cents: t.amount_cents,
                property_id: t.property_id,
                unit_id: t.unit_id,
                contact_id: t.payer_contact_id,
                lease_id: t.lease_id || null,
                description: t.description
              }
            );
            break;
          }
          default:
            skipped++;
            continue;
        }

        const entry = this.postEntry({
          date_ms: t.transaction_date,
          memo: t.description,
          source_type: t.transaction_type,
          source_id: t.id,
          lines
        }, tx, { historicalReferenceMode: true });

        tx.prepare(`
          UPDATE transactions
          SET journal_entry_id = ?
          WHERE id = ? AND operator_id = ?
        `).run(entry.id, t.id, operatorId);

        migrated++;
      }
    }, db);

    return { migrated, skipped };
  }
}
