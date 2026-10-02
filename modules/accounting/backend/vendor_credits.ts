import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { ChartOfAccountsRepository } from './chart_of_accounts.js';
import { JournalService } from './journal.js';
import { AccountsPayableRepository } from './ap.js';

/**
 * Status types for vendor credit memos.
 */
export type VendorCreditStatus = 'open' | 'partially_applied' | 'fully_applied' | 'voided';

/**
 * Interface representing a vendor credit memo.
 */
export interface VendorCreditRecord {
  id: string;
  operator_id: string;
  vendor_id: string;
  credit_number: string;
  credit_date: number;
  total_amount_cents: number;
  remaining_amount_cents: number;
  gl_account_id: string;
  reason: string | null;
  reference_number: string | null;
  status: VendorCreditStatus;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  vendor_name?: string;
  vendor_company?: string;
  account_name?: string;
  account_number?: string;
  allocations?: VendorCreditAllocationRecord[];
}

/**
 * Interface representing an application of a credit memo against a bill.
 */
export interface VendorCreditAllocationRecord {
  id: string;
  operator_id: string;
  credit_id: string;
  bill_id: string;
  applied_amount_cents: number;
  applied_date: number;
  created_at: number;
  invoice_number?: string;
}

/**
 * Input for creating a vendor credit memo.
 */
export interface CreateVendorCreditInput {
  vendor_id: string;
  credit_number: string;
  credit_date: number;
  total_amount_cents: number;
  gl_account_id: string;
  reason?: string | null;
  reference_number?: string | null;
}

/**
 * Repository for vendor credit memos and credit bill offsets.
 */
export class VendorCreditsRepository {
  /**
   * Create a new vendor credit memo and post General Ledger adjusting entry.
   * Dr: 2010 Accounts Payable (liability reduction)
   * Cr: Expense / Return Account (expense reduction)
   *
   * @param input - Creation payload.
   * @returns Newly created VendorCreditRecord.
   */
  public static createCredit(input: CreateVendorCreditInput): VendorCreditRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    if (!input.vendor_id) {
      throw new Error('vendor_id is required.');
    }
    if (!input.credit_number || input.credit_number.trim() === '') {
      throw new Error('credit_number is required.');
    }
    if (!Number.isSafeInteger(input.credit_date) || input.credit_date <= 0) {
      throw new Error('credit_date must be a positive integer millisecond timestamp.');
    }
    if (!Number.isSafeInteger(input.total_amount_cents) || input.total_amount_cents <= 0) {
      throw new Error('total_amount_cents must be a positive integer in cents.');
    }

    // Verify vendor
    const vendorRow = db.prepare(`
      SELECT id, COALESCE(company_name, first_name || ' ' || last_name) as name FROM contacts
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(input.vendor_id, operatorId) as { id: string; name: string } | undefined;

    if (!vendorRow) {
      throw new Error(`Vendor contact "${input.vendor_id}" not found or unauthorized.`);
    }

    // Verify GL account
    const glAccount = ChartOfAccountsRepository.getAccountById(input.gl_account_id);
    if (!glAccount || glAccount.is_active === 0) {
      throw new Error(`GL Account "${input.gl_account_id}" not found or inactive.`);
    }

    // Resolve 2010 Accounts Payable
    const apAccount = db.prepare(`
      SELECT id FROM chart_of_accounts
      WHERE operator_id = ? AND (account_number = '2010' OR category_mapping = 'accounts_payable') AND deleted_at IS NULL
    `).get(operatorId) as { id: string } | undefined;

    if (!apAccount) {
      throw new Error('Default Accounts Payable account (2010) not found in Chart of Accounts.');
    }

    const creditId = generateUUIDv7();
    const now = Date.now();

    return withTransaction((tx) => {
      // Insert credit record
      tx.prepare(`
        INSERT INTO vendor_credits (
          id, operator_id, vendor_id, credit_number, credit_date,
          total_amount_cents, remaining_amount_cents, gl_account_id,
          reason, reference_number, status, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL)
      `).run(
        creditId,
        operatorId,
        input.vendor_id,
        input.credit_number.trim(),
        input.credit_date,
        input.total_amount_cents,
        input.total_amount_cents,
        input.gl_account_id,
        input.reason || null,
        input.reference_number || null,
        now,
        now
      );

      // Post General Ledger journal entry:
      // Dr: 2010 Accounts Payable (reduces liability)
      // Cr: input.gl_account_id (reduces expense)
      JournalService.postEntry({
        date_ms: input.credit_date,
        memo: `Vendor Credit: ${vendorRow.name} Ref# ${input.credit_number.trim()}`,
        source_type: 'vendor_credit',
        source_id: creditId,
        lines: [
          {
            account_id: apAccount.id,
            debit_cents: input.total_amount_cents,
            credit_cents: 0,
            description: `Credit AP Liability: ${vendorRow.name}`
          },
          {
            account_id: input.gl_account_id,
            debit_cents: 0,
            credit_cents: input.total_amount_cents,
            description: input.reason || `Vendor credit refund/return`
          }
        ]
      }, tx);

      return this.getCreditById(creditId)!;
    });
  }

  /**
   * Fetch a vendor credit memo by ID.
   *
   * @param id - Credit memo identifier.
   * @returns VendorCreditRecord or null.
   */
  public static getCreditById(id: string): VendorCreditRecord | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT vc.*, COALESCE(c.company_name, c.first_name || ' ' || c.last_name) as vendor_name, c.company_name as vendor_company,
             coa.account_name, coa.account_number
      FROM vendor_credits vc
      LEFT JOIN contacts c ON vc.vendor_id = c.id AND c.operator_id = vc.operator_id AND c.deleted_at IS NULL
      LEFT JOIN chart_of_accounts coa ON vc.gl_account_id = coa.id
      WHERE vc.id = ? AND vc.operator_id = ? AND vc.deleted_at IS NULL
    `).get(id, operatorId) as unknown as (VendorCreditRecord & {
      vendor_name?: string;
      vendor_company?: string;
      account_name?: string;
      account_number?: string;
    }) | undefined;

    if (!row) {
      return null;
    }

    const allocs = db.prepare(`
      SELECT vca.*, b.invoice_number
      FROM vendor_credit_allocations vca
      JOIN bills b ON vca.bill_id = b.id
      WHERE vca.credit_id = ? AND vca.operator_id = ?
      ORDER BY vca.created_at ASC
    `).all(id, operatorId) as unknown as VendorCreditAllocationRecord[];

    return {
      ...row,
      allocations: allocs
    };
  }

  /**
   * List vendor credit memos filtered by status, vendor, or date range.
   *
   * @param filters - Query filters.
   * @returns Array of VendorCreditRecord items.
   */
  public static listCredits(filters: {
    vendor_id?: string;
    status?: VendorCreditStatus;
    limit?: number;
    offset?: number;
  } = {}): { credits: VendorCreditRecord[]; total: number } {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const whereClauses: string[] = ['vc.operator_id = ?', 'vc.deleted_at IS NULL'];
    const params: (string | number)[] = [operatorId];

    if (filters.vendor_id) {
      whereClauses.push('vc.vendor_id = ?');
      params.push(filters.vendor_id);
    }
    if (filters.status) {
      whereClauses.push('vc.status = ?');
      params.push(filters.status);
    }

    const whereSql = whereClauses.join(' AND ');

    const countRow = db.prepare(`
      SELECT COUNT(*) as total FROM vendor_credits vc WHERE ${whereSql}
    `).get(...params) as { total: number };

    const limit = Math.min(Math.max(filters.limit || 50, 1), 200);
    const offset = Math.max(filters.offset || 0, 0);

    const rows = db.prepare(`
      SELECT vc.*, COALESCE(c.company_name, c.first_name || ' ' || c.last_name) as vendor_name, c.company_name as vendor_company,
             coa.account_name, coa.account_number
      FROM vendor_credits vc
      LEFT JOIN contacts c ON vc.vendor_id = c.id AND c.operator_id = vc.operator_id AND c.deleted_at IS NULL
      LEFT JOIN chart_of_accounts coa ON vc.gl_account_id = coa.id
      WHERE ${whereSql}
      ORDER BY vc.credit_date DESC, vc.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as unknown as VendorCreditRecord[];

    return {
      credits: rows,
      total: countRow?.total || 0
    };
  }

  /**
   * Apply a vendor credit memo to offset an approved open bill.
   *
   * @param creditId - Vendor credit identifier.
   * @param billId - Target bill identifier.
   * @param amountCents - Amount of credit in integer cents to apply.
   * @returns Updated VendorCreditRecord.
   */
  public static applyCredit(creditId: string, billId: string, amountCents: number): VendorCreditRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new Error('amountCents must be a positive integer in cents.');
    }

    const credit = this.getCreditById(creditId);
    if (!credit) {
      throw new Error(`Vendor credit "${creditId}" not found.`);
    }

    if (credit.status !== 'open' && credit.status !== 'partially_applied') {
      throw new Error(`Vendor credit cannot be applied because its status is "${credit.status}".`);
    }

    if (amountCents > credit.remaining_amount_cents) {
      throw new Error(
        `Applied amount ($${(amountCents / 100).toFixed(2)}) exceeds credit remaining balance ($${(credit.remaining_amount_cents / 100).toFixed(2)}).`
      );
    }

    const bill = AccountsPayableRepository.getBillById(billId);
    if (!bill) {
      throw new Error(`Bill "${billId}" not found.`);
    }

    if (bill.status !== 'approved' && bill.status !== 'partially_paid') {
      throw new Error(`Cannot apply credit to a bill with status "${bill.status}". Bill must be approved.`);
    }

    if (bill.vendor_id !== credit.vendor_id) {
      throw new Error('Cross-vendor credit offset is prohibited. Credit vendor must match bill vendor.');
    }

    const billBalance = bill.total_amount_cents - bill.amount_paid_cents;
    if (amountCents > billBalance) {
      throw new Error(
        `Applied amount ($${(amountCents / 100).toFixed(2)}) exceeds bill remaining balance ($${(billBalance / 100).toFixed(2)}).`
      );
    }

    const now = Date.now();
    const allocId = generateUUIDv7();

    return withTransaction((tx) => {
      // 1. Insert credit allocation
      tx.prepare(`
        INSERT INTO vendor_credit_allocations (
          id, operator_id, credit_id, bill_id, applied_amount_cents, applied_date, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(allocId, operatorId, creditId, billId, amountCents, now, now);

      // 2. Update credit record
      const newCreditRemaining = credit.remaining_amount_cents - amountCents;
      const newCreditStatus: VendorCreditStatus = newCreditRemaining === 0 ? 'fully_applied' : 'partially_applied';

      tx.prepare(`
        UPDATE vendor_credits SET
          remaining_amount_cents = ?, status = ?, updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(newCreditRemaining, newCreditStatus, now, creditId, operatorId);

      // 3. Update bill record
      const newBillPaid = bill.amount_paid_cents + amountCents;
      const newBillStatus = newBillPaid === bill.total_amount_cents ? 'paid' : 'partially_paid';

      tx.prepare(`
        UPDATE bills SET
          amount_paid_cents = ?, status = ?, updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(newBillPaid, newBillStatus, now, billId, operatorId);

      // 4. Update bill allocations settled amounts
      let remainingToSettle = amountCents;
      const allocations = bill.allocations || [];
      for (const ba of allocations) {
        if (remainingToSettle <= 0) break;
        const availableInLine = ba.amount_cents - ba.amount_settled_cents;
        if (availableInLine > 0) {
          const settleThisLine = Math.min(remainingToSettle, availableInLine);
          tx.prepare(`
            UPDATE bill_allocations SET
              amount_settled_cents = amount_settled_cents + ?
            WHERE id = ? AND operator_id = ?
          `).run(settleThisLine, ba.id, operatorId);
          remainingToSettle -= settleThisLine;
        }
      }

      return this.getCreditById(creditId)!;
    });
  }

  /**
   * Void a vendor credit memo and reverse its General Ledger adjusting entry.
   *
   * @param id - Credit memo identifier.
   * @param reason - Optional audit explanation.
   * @returns Voided VendorCreditRecord.
   */
  public static voidCredit(id: string, reason?: string): VendorCreditRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const credit = this.getCreditById(id);
    if (!credit) {
      throw new Error(`Vendor credit "${id}" not found.`);
    }

    if (credit.status === 'voided') {
      return credit;
    }

    if (credit.remaining_amount_cents < credit.total_amount_cents || (credit.allocations && credit.allocations.length > 0)) {
      throw new Error('Cannot void a vendor credit that has already been applied to bills.');
    }

    const now = Date.now();

    return withTransaction((tx) => {
      // Reverse General Ledger entry
      const entryRow = tx.prepare(`
        SELECT id FROM journal_entries
        WHERE operator_id = ? AND source_type = 'vendor_credit' AND source_id = ? AND reversed_by_entry_id IS NULL
      `).get(operatorId, id) as { id: string } | undefined;

      if (entryRow) {
        JournalService.reverseEntry(entryRow.id, reason || `Voided Vendor Credit #${credit.credit_number}`, tx);
      }

      tx.prepare(`
        UPDATE vendor_credits SET status = 'voided', updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(now, id, operatorId);

      return this.getCreditById(id)!;
    });
  }
}
