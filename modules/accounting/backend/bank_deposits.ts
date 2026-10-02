import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { ChartOfAccountsRepository } from './chart_of_accounts.js';
import { JournalService } from './journal.js';

/**
 * Status types for bank deposit records.
 */
export type BankDepositStatus = 'cleared' | 'voided';

/**
 * Interface representing a bank deposit slip.
 */
export interface BankDepositRecord {
  id: string;
  operator_id: string;
  bank_account_id: string;
  deposit_date: number;
  total_amount_cents: number;
  deposit_reference: string | null;
  memo: string | null;
  status: BankDepositStatus;
  voided_at: number | null;
  void_reason: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  bank_account_name?: string;
  bank_account_number?: string;
  lines?: BankDepositLineRecord[];
}

/**
 * Interface representing a line item in a bank deposit batch.
 */
export interface BankDepositLineRecord {
  id: string;
  operator_id: string;
  bank_deposit_id: string;
  source_entry_id: string;
  amount_cents: number;
  created_at: number;
  source_memo?: string;
  source_date_ms?: number;
}

/**
 * Interface representing an undeposited receipt waiting for deposit grouping.
 */
export interface UndepositedReceiptItem {
  journal_entry_id: string;
  journal_line_id: string;
  date_ms: number;
  memo: string;
  source_type: string;
  source_id: string | null;
  amount_cents: number;
  property_id: string | null;
  unit_id: string | null;
}

/**
 * Input for creating a grouped bank deposit slip.
 */
export interface CreateBankDepositInput {
  bank_account_id: string;
  deposit_date: number;
  deposit_reference?: string | null;
  memo?: string | null;
  receipt_entry_ids: string[];
  custom_amount_cents?: number;
}

/**
 * Repository for managing grouped bank deposits, batch clearing, and undeposited funds.
 */
export class BankDepositsRepository {
  /**
   * Query all receipts currently in 1030 Undeposited Funds awaiting batch deposit.
   *
   * @returns Array of UndepositedReceiptItem objects.
   */
  public static listUndepositedReceipts(): UndepositedReceiptItem[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    // Resolve 1030 Undeposited Funds account
    const undepositedAccount = db.prepare(`
      SELECT id FROM chart_of_accounts
      WHERE operator_id = ? AND (account_number = '1030' OR category_mapping = 'undeposited_funds') AND deleted_at IS NULL
    `).get(operatorId) as { id: string } | undefined;

    if (!undepositedAccount) {
      return [];
    }

    // Find all debit lines to 1030 where the entry has not been batched into a cleared deposit
    const rows = db.prepare(`
      SELECT jl.id as journal_line_id, je.id as journal_entry_id, je.date_ms, je.memo,
             je.source_type, je.source_id, jl.debit_cents as amount_cents,
             jl.property_id, jl.unit_id
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id
      WHERE jl.operator_id = ? AND jl.account_id = ? AND jl.debit_cents > 0
        AND je.reversed_by_entry_id IS NULL AND je.deleted_at IS NULL
        AND je.source_type NOT IN ('bank_deposit', 'reversal')
        AND NOT EXISTS (
          SELECT 1 FROM bank_deposit_lines bdl
          JOIN bank_deposits bd ON bdl.bank_deposit_id = bd.id
          WHERE bdl.source_entry_id = je.id AND bd.status = 'cleared' AND bd.deleted_at IS NULL
        )
      ORDER BY je.date_ms ASC, je.created_at ASC
    `).all(operatorId, undepositedAccount.id) as unknown as UndepositedReceiptItem[];

    return rows;
  }

  /**
   * Create a batched bank deposit slip, grouping undeposited receipts into cash in bank.
   * Dr: Bank Account (e.g. 1010 Operating Checking)
   * Cr: 1030 Undeposited Funds (clearing account)
   *
   * @param input - Creation payload.
   * @returns Newly created BankDepositRecord with itemized lines.
   */
  public static createDeposit(input: CreateBankDepositInput): BankDepositRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    if (!input.bank_account_id) {
      throw new Error('bank_account_id is required.');
    }
    if (!Number.isSafeInteger(input.deposit_date) || input.deposit_date <= 0) {
      throw new Error('deposit_date must be a positive integer millisecond timestamp.');
    }

    // Verify target bank account
    const bankAccount = ChartOfAccountsRepository.getAccountById(input.bank_account_id);
    if (!bankAccount || bankAccount.is_active === 0) {
      throw new Error(`Bank account "${input.bank_account_id}" not found or inactive.`);
    }
    if (bankAccount.account_type !== 'Bank') {
      throw new Error(`Target account "${bankAccount.account_name}" must be a Bank account.`);
    }

    // Resolve 1030 Undeposited Funds account
    const undepositedAccount = db.prepare(`
      SELECT id FROM chart_of_accounts
      WHERE operator_id = ? AND (account_number = '1030' OR category_mapping = 'undeposited_funds') AND deleted_at IS NULL
    `).get(operatorId) as { id: string } | undefined;

    if (!undepositedAccount) {
      throw new Error('Account 1030 Undeposited Funds is missing from Chart of Accounts.');
    }

    // Calculate total and prepare lines
    let totalCents = 0;
    const validatedReceipts: { entry_id: string; amount_cents: number; property_id?: string | null }[] = [];

    if (input.receipt_entry_ids && input.receipt_entry_ids.length > 0) {
      const seenReceiptIds = new Set<string>();
      for (const entryId of input.receipt_entry_ids) {
        if (seenReceiptIds.has(entryId)) {
          throw new Error(`Duplicate receipt entry "${entryId}" in deposit batch.`);
        }
        seenReceiptIds.add(entryId);
        // Fetch debit amount to 1030
        const lineRow = db.prepare(`
          SELECT jl.debit_cents, jl.property_id
          FROM journal_lines jl
          JOIN journal_entries je ON jl.journal_entry_id = je.id
          WHERE jl.operator_id = ? AND jl.journal_entry_id = ? AND jl.account_id = ?
            AND je.reversed_by_entry_id IS NULL AND je.deleted_at IS NULL
        `).get(operatorId, entryId, undepositedAccount.id) as { debit_cents: number; property_id?: string | null } | undefined;

        if (!lineRow || lineRow.debit_cents <= 0) {
          throw new Error(`Receipt entry "${entryId}" does not have an active undeposited balance.`);
        }

        // Check if already deposited
        const existingDeposit = db.prepare(`
          SELECT bdl.id FROM bank_deposit_lines bdl
          JOIN bank_deposits bd ON bdl.bank_deposit_id = bd.id
          WHERE bdl.operator_id = ? AND bdl.source_entry_id = ? AND bd.status = 'cleared' AND bd.deleted_at IS NULL
        `).get(operatorId, entryId);

        if (existingDeposit) {
          throw new Error(`Receipt entry "${entryId}" is already included in an active bank deposit.`);
        }

        totalCents += lineRow.debit_cents;
        validatedReceipts.push({
          entry_id: entryId,
          amount_cents: lineRow.debit_cents,
          property_id: lineRow.property_id
        });
      }
    } else if (input.custom_amount_cents && Number.isSafeInteger(input.custom_amount_cents) && input.custom_amount_cents > 0) {
      // Manual bulk batch without tracking discrete entry IDs
      totalCents = input.custom_amount_cents;
    } else {
      throw new Error('Either receipt_entry_ids or a positive custom_amount_cents must be provided.');
    }

    const depositId = generateUUIDv7();
    const now = Date.now();
    const depositRef = input.deposit_reference?.trim() || `DEP-${new Date(input.deposit_date).toISOString().slice(0, 10)}`;

    return withTransaction((tx) => {
      // 1. Insert deposit slip
      tx.prepare(`
        INSERT INTO bank_deposits (
          id, operator_id, bank_account_id, deposit_date, total_amount_cents,
          deposit_reference, memo, status, voided_at, void_reason,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'cleared', NULL, NULL, ?, ?, NULL)
      `).run(
        depositId,
        operatorId,
        input.bank_account_id,
        input.deposit_date,
        totalCents,
        depositRef,
        input.memo || null,
        now,
        now
      );

      // 2. Insert line items
      for (const item of validatedReceipts) {
        const lineId = generateUUIDv7();
        tx.prepare(`
          INSERT INTO bank_deposit_lines (
            id, operator_id, bank_deposit_id, source_entry_id, amount_cents, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(lineId, operatorId, depositId, item.entry_id, item.amount_cents, now);
      }

      // 3. Post consolidated General Ledger clearing entry:
      // Dr: input.bank_account_id (increases bank cash balance)
      // Cr: 1030 Undeposited Funds (clears clearing account)
      JournalService.postEntry({
        date_ms: input.deposit_date,
        memo: `Bank Deposit: ${depositRef}`,
        source_type: 'bank_deposit',
        source_id: depositId,
        lines: [
          {
            account_id: input.bank_account_id,
            debit_cents: totalCents,
            credit_cents: 0,
            property_id: validatedReceipts[0]?.property_id || null,
            description: `Bank Deposit: ${depositRef} into ${bankAccount.account_name}`
          },
          {
            account_id: undepositedAccount.id,
            debit_cents: 0,
            credit_cents: totalCents,
            property_id: validatedReceipts[0]?.property_id || null,
            description: `Clear Undeposited Funds - Deposit: ${depositRef}`
          }
        ]
      }, tx);

      return this.getDepositById(depositId)!;
    });
  }

  /**
   * Fetch a bank deposit by ID with itemized lines.
   *
   * @param id - Deposit identifier.
   * @returns BankDepositRecord or null.
   */
  public static getDepositById(id: string): BankDepositRecord | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT bd.*, coa.account_name as bank_account_name, coa.account_number as bank_account_number
      FROM bank_deposits bd
      LEFT JOIN chart_of_accounts coa ON bd.bank_account_id = coa.id
      WHERE bd.id = ? AND bd.operator_id = ? AND bd.deleted_at IS NULL
    `).get(id, operatorId) as unknown as (BankDepositRecord & { bank_account_name?: string; bank_account_number?: string }) | undefined;

    if (!row) {
      return null;
    }

    const lines = db.prepare(`
      SELECT bdl.*, je.memo as source_memo, je.date_ms as source_date_ms
      FROM bank_deposit_lines bdl
      LEFT JOIN journal_entries je ON bdl.source_entry_id = je.id
      WHERE bdl.bank_deposit_id = ? AND bdl.operator_id = ?
      ORDER BY bdl.created_at ASC
    `).all(id, operatorId) as unknown as BankDepositLineRecord[];

    return {
      ...row,
      lines
    };
  }

  /**
   * List bank deposits filtered by bank account, status, or date intervals.
   *
   * @param filters - Query filters.
   * @returns Array of BankDepositRecord items.
   */
  public static listDeposits(filters: {
    bank_account_id?: string;
    status?: BankDepositStatus;
    deposit_date_start?: number;
    deposit_date_end?: number;
    limit?: number;
    offset?: number;
  } = {}): { deposits: BankDepositRecord[]; total: number } {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const whereClauses: string[] = ['bd.operator_id = ?', 'bd.deleted_at IS NULL'];
    const params: (string | number)[] = [operatorId];

    if (filters.bank_account_id) {
      whereClauses.push('bd.bank_account_id = ?');
      params.push(filters.bank_account_id);
    }
    if (filters.status) {
      whereClauses.push('bd.status = ?');
      params.push(filters.status);
    }
    if (filters.deposit_date_start !== undefined) {
      whereClauses.push('bd.deposit_date >= ?');
      params.push(filters.deposit_date_start);
    }
    if (filters.deposit_date_end !== undefined) {
      whereClauses.push('bd.deposit_date <= ?');
      params.push(filters.deposit_date_end);
    }

    const whereSql = whereClauses.join(' AND ');

    const countRow = db.prepare(`
      SELECT COUNT(*) as total FROM bank_deposits bd WHERE ${whereSql}
    `).get(...params) as { total: number };

    const limit = Math.min(Math.max(filters.limit || 50, 1), 200);
    const offset = Math.max(filters.offset || 0, 0);

    const rows = db.prepare(`
      SELECT bd.*, coa.account_name as bank_account_name, coa.account_number as bank_account_number
      FROM bank_deposits bd
      LEFT JOIN chart_of_accounts coa ON bd.bank_account_id = coa.id
      WHERE ${whereSql}
      ORDER BY bd.deposit_date DESC, bd.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as unknown as BankDepositRecord[];

    return {
      deposits: rows,
      total: countRow?.total || 0
    };
  }

  /**
   * Void a bank deposit slip, reversing the General Ledger entry and returning receipts to undeposited status.
   *
   * @param id - Deposit identifier.
   * @param reason - Reason for voiding.
   * @returns Voided BankDepositRecord.
   */
  public static voidDeposit(id: string, reason?: string): BankDepositRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const deposit = this.getDepositById(id);
    if (!deposit) {
      throw new Error(`Bank deposit "${id}" not found.`);
    }

    if (deposit.status === 'voided') {
      return deposit;
    }

    const now = Date.now();

    return withTransaction((tx) => {
      // 1. Reverse the deposit journal entry
      const entryRow = tx.prepare(`
        SELECT id FROM journal_entries
        WHERE operator_id = ? AND source_type = 'bank_deposit' AND source_id = ? AND reversed_by_entry_id IS NULL
      `).get(operatorId, id) as { id: string } | undefined;

      if (entryRow) {
        JournalService.reverseEntry(entryRow.id, reason || `Voided Deposit ${deposit.deposit_reference || id}`, tx);
      }

      // 2. Mark deposit voided
      tx.prepare(`
        UPDATE bank_deposits SET
          status = 'voided', voided_at = ?, void_reason = ?, updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(now, reason || 'Voided by user', now, id, operatorId);

      return this.getDepositById(id)!;
    });
  }
}
