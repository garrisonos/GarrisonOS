import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { ChartOfAccountsRepository } from './chart_of_accounts.js';
import { JournalService } from './journal.js';
import { AccountsPayableRepository } from './ap.js';

/**
 * Status types for vendor checks in the check register.
 */
export type VendorCheckStatus = 'draft' | 'printed' | 'cleared' | 'voided' | 'reissued';

/**
 * Interface representing a vendor check register record.
 */
export interface VendorCheckRecord {
  id: string;
  operator_id: string;
  bank_account_id: string;
  vendor_id: string;
  check_number: string;
  check_date: number;
  amount_cents: number;
  payee_name: string;
  memo: string | null;
  status: VendorCheckStatus;
  voided_at: number | null;
  void_reason: string | null;
  cleared_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  vendor_name?: string;
  vendor_company?: string;
  bank_account_name?: string;
  bank_account_number?: string;
  allocations?: VendorCheckAllocationRecord[];
}

/**
 * Interface representing an allocation of a check against a specific bill.
 */
export interface VendorCheckAllocationRecord {
  id: string;
  operator_id: string;
  check_id: string;
  bill_id: string;
  allocated_amount_cents: number;
  created_at: number;
  invoice_number?: string;
  invoice_date?: number;
  total_amount_cents?: number;
}

/**
 * Input for issuing a vendor check.
 */
export interface IssueVendorCheckInput {
  bank_account_id: string;
  vendor_id: string;
  check_number: string;
  check_date: number;
  amount_cents: number;
  payee_name?: string;
  memo?: string | null;
  bill_allocations: {
    bill_id: string;
    amount_cents: number;
  }[];
}

/**
 * Repository managing the vendor check register, disbursements, and check voiding.
 */
export class VendorChecksRepository {
  /**
   * Issue a vendor disbursement check, settling bills and posting double-entry General Ledger.
   * Dr: 2010 Accounts Payable (liability reduction)
   * Cr: Bank Account (cash reduction, e.g. 1010 Operating Checking)
   *
   * @param input - Issue check payload.
   * @returns Newly recorded VendorCheckRecord.
   */
  public static issueCheck(input: IssueVendorCheckInput): VendorCheckRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    if (!input.bank_account_id) {
      throw new Error('bank_account_id is required.');
    }
    if (!input.vendor_id) {
      throw new Error('vendor_id is required.');
    }
    if (!input.check_number || input.check_number.trim() === '') {
      throw new Error('check_number is required.');
    }
    if (!Number.isSafeInteger(input.check_date) || input.check_date <= 0) {
      throw new Error('check_date must be a positive integer millisecond timestamp.');
    }
    if (!Number.isSafeInteger(input.amount_cents) || input.amount_cents <= 0) {
      throw new Error('amount_cents must be a positive integer in cents.');
    }

    const checkNumber = input.check_number.trim();

    // Verify bank account
    const bankAccount = ChartOfAccountsRepository.getAccountById(input.bank_account_id);
    if (!bankAccount || bankAccount.is_active === 0) {
      throw new Error(`Bank account "${input.bank_account_id}" not found or inactive.`);
    }
    if (bankAccount.account_type !== 'Bank') {
      throw new Error(`Disbursement account "${bankAccount.account_name}" must be of type Bank.`);
    }
    if (bankAccount.account_number === '1020' || bankAccount.category_mapping === 'trust_bank') {
      throw new Error('Vendor bills cannot be paid from the Security Deposit Trust account (1020).');
    }

    // Verify unique check number for this bank account
    const existingCheck = db.prepare(`
      SELECT id FROM vendor_checks
      WHERE operator_id = ? AND bank_account_id = ? AND check_number = ? AND deleted_at IS NULL
    `).get(operatorId, input.bank_account_id, checkNumber);

    if (existingCheck) {
      throw new Error(`Check number "${checkNumber}" has already been issued for this bank account.`);
    }

    // Verify vendor
    const vendorRow = db.prepare(`
      SELECT id, COALESCE(company_name, first_name || ' ' || last_name) as name, company_name as company FROM contacts
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(input.vendor_id, operatorId) as { id: string; name: string; company?: string } | undefined;

    if (!vendorRow) {
      throw new Error(`Vendor contact "${input.vendor_id}" not found or unauthorized.`);
    }

    const payeeName = input.payee_name?.trim() || vendorRow.company || vendorRow.name;

    // Verify bill allocations
    if (!input.bill_allocations || input.bill_allocations.length === 0) {
      throw new Error('A check must be allocated to at least one approved bill.');
    }

    let allocTotal = 0;
    const seenBillIds = new Set<string>();
    for (const alloc of input.bill_allocations) {
      if (!alloc.bill_id) {
        throw new Error('bill_id is required for each allocation.');
      }
      if (seenBillIds.has(alloc.bill_id)) {
        throw new Error(`Duplicate bill allocation for bill "${alloc.bill_id}". Combine amounts into a single allocation.`);
      }
      seenBillIds.add(alloc.bill_id);
      if (!Number.isSafeInteger(alloc.amount_cents) || alloc.amount_cents <= 0) {
        throw new Error('Bill allocation amount_cents must be a positive integer in cents.');
      }
      allocTotal += alloc.amount_cents;
    }

    if (allocTotal !== input.amount_cents) {
      throw new Error(
        `Total of bill allocations ($${(allocTotal / 100).toFixed(2)}) must equal check amount ($${(input.amount_cents / 100).toFixed(2)}).`
      );
    }

    // Resolve 2010 Accounts Payable
    const apAccount = db.prepare(`
      SELECT id FROM chart_of_accounts
      WHERE operator_id = ? AND (account_number = '2010' OR category_mapping = 'accounts_payable') AND deleted_at IS NULL
    `).get(operatorId) as { id: string } | undefined;

    if (!apAccount) {
      throw new Error('Default Accounts Payable account (2010) not found in Chart of Accounts.');
    }

    // Validate bills
    for (const alloc of input.bill_allocations) {
      const bill = AccountsPayableRepository.getBillById(alloc.bill_id);
      if (!bill) {
        throw new Error(`Bill "${alloc.bill_id}" not found.`);
      }
      if (bill.status !== 'approved' && bill.status !== 'partially_paid') {
        throw new Error(`Cannot pay bill "${bill.invoice_number}" because its status is "${bill.status}".`);
      }
      if (bill.vendor_id !== input.vendor_id) {
        throw new Error(`Bill "${bill.invoice_number}" belongs to a different vendor.`);
      }
      const remaining = bill.total_amount_cents - bill.amount_paid_cents;
      if (alloc.amount_cents > remaining) {
        throw new Error(
          `Allocated payment ($${(alloc.amount_cents / 100).toFixed(2)}) exceeds bill "${bill.invoice_number}" balance ($${(remaining / 100).toFixed(2)}).`
        );
      }
    }

    const checkId = generateUUIDv7();
    const now = Date.now();

    return withTransaction((tx) => {
      // 1. Insert check register record
      tx.prepare(`
        INSERT INTO vendor_checks (
          id, operator_id, bank_account_id, vendor_id, check_number, check_date,
          amount_cents, payee_name, memo, status, voided_at, void_reason,
          cleared_at, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'printed', NULL, NULL, NULL, ?, ?, NULL)
      `).run(
        checkId,
        operatorId,
        input.bank_account_id,
        input.vendor_id,
        checkNumber,
        input.check_date,
        input.amount_cents,
        payeeName,
        input.memo || null,
        now,
        now
      );

      // 2. Insert check allocations and update bills
      for (const alloc of input.bill_allocations) {
        const allocId = generateUUIDv7();
        tx.prepare(`
          INSERT INTO vendor_check_allocations (
            id, operator_id, check_id, bill_id, allocated_amount_cents, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(allocId, operatorId, checkId, alloc.bill_id, alloc.amount_cents, now);

        const bill = AccountsPayableRepository.getBillById(alloc.bill_id)!;
        const newPaid = bill.amount_paid_cents + alloc.amount_cents;
        const newStatus = newPaid === bill.total_amount_cents ? 'paid' : 'partially_paid';

        tx.prepare(`
          UPDATE bills SET amount_paid_cents = ?, status = ?, updated_at = ?
          WHERE id = ? AND operator_id = ?
        `).run(newPaid, newStatus, now, alloc.bill_id, operatorId);

        // Update bill allocation lines
        let remainingSettle = alloc.amount_cents;
        for (const ba of bill.allocations || []) {
          if (remainingSettle <= 0) break;
          const available = ba.amount_cents - ba.amount_settled_cents;
          if (available > 0) {
            const settle = Math.min(remainingSettle, available);
            tx.prepare(`
              UPDATE bill_allocations SET amount_settled_cents = amount_settled_cents + ?
              WHERE id = ? AND operator_id = ?
            `).run(settle, ba.id, operatorId);
            remainingSettle -= settle;
          }
        }
      }

      // 3. Post General Ledger entry:
      // Dr: 2010 Accounts Payable (liability reduction)
      // Cr: input.bank_account_id (cash reduction)
      JournalService.postEntry({
        date_ms: input.check_date,
        memo: `Vendor Check #${checkNumber} to ${payeeName}`,
        source_type: 'vendor_check',
        source_id: checkId,
        lines: [
          {
            account_id: apAccount.id,
            debit_cents: input.amount_cents,
            credit_cents: 0,
            description: `Payment to ${payeeName} - Check #${checkNumber}`
          },
          {
            account_id: input.bank_account_id,
            debit_cents: 0,
            credit_cents: input.amount_cents,
            description: `Disbursement from ${bankAccount.account_name} - Check #${checkNumber}`
          }
        ]
      }, tx);

      return this.getCheckById(checkId)!;
    });
  }

  /**
   * Fetch a vendor check record by ID.
   *
   * @param id - Check identifier.
   * @returns VendorCheckRecord or null.
   */
  public static getCheckById(id: string): VendorCheckRecord | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT vc.*, COALESCE(c.company_name, c.first_name || ' ' || last_name) as vendor_name, c.company_name as vendor_company,
             coa.account_name as bank_account_name, coa.account_number as bank_account_number
      FROM vendor_checks vc
      LEFT JOIN contacts c ON vc.vendor_id = c.id AND c.operator_id = vc.operator_id AND c.deleted_at IS NULL
      LEFT JOIN chart_of_accounts coa ON vc.bank_account_id = coa.id
      WHERE vc.id = ? AND vc.operator_id = ? AND vc.deleted_at IS NULL
    `).get(id, operatorId) as unknown as (VendorCheckRecord & {
      vendor_name?: string;
      vendor_company?: string;
      bank_account_name?: string;
      bank_account_number?: string;
    }) | undefined;

    if (!row) {
      return null;
    }

    const allocRows = db.prepare(`
      SELECT vca.*, b.invoice_number, b.invoice_date, b.total_amount_cents
      FROM vendor_check_allocations vca
      JOIN bills b ON vca.bill_id = b.id
      WHERE vca.check_id = ? AND vca.operator_id = ?
      ORDER BY vca.created_at ASC
    `).all(id, operatorId) as unknown as VendorCheckAllocationRecord[];

    return {
      ...row,
      allocations: allocRows
    };
  }

  /**
   * List vendor checks filtered by bank account, vendor, status, or date range.
   *
   * @param filters - Query filters.
   * @returns Array of VendorCheckRecord items.
   */
  public static listChecks(filters: {
    bank_account_id?: string;
    vendor_id?: string;
    status?: VendorCheckStatus;
    check_date_start?: number;
    check_date_end?: number;
    limit?: number;
    offset?: number;
  } = {}): { checks: VendorCheckRecord[]; total: number } {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const whereClauses: string[] = ['vc.operator_id = ?', 'vc.deleted_at IS NULL'];
    const params: (string | number)[] = [operatorId];

    if (filters.bank_account_id) {
      whereClauses.push('vc.bank_account_id = ?');
      params.push(filters.bank_account_id);
    }
    if (filters.vendor_id) {
      whereClauses.push('vc.vendor_id = ?');
      params.push(filters.vendor_id);
    }
    if (filters.status) {
      whereClauses.push('vc.status = ?');
      params.push(filters.status);
    }
    if (filters.check_date_start !== undefined) {
      whereClauses.push('vc.check_date >= ?');
      params.push(filters.check_date_start);
    }
    if (filters.check_date_end !== undefined) {
      whereClauses.push('vc.check_date <= ?');
      params.push(filters.check_date_end);
    }

    const whereSql = whereClauses.join(' AND ');

    const countRow = db.prepare(`
      SELECT COUNT(*) as total FROM vendor_checks vc WHERE ${whereSql}
    `).get(...params) as { total: number };

    const limit = Math.min(Math.max(filters.limit || 50, 1), 200);
    const offset = Math.max(filters.offset || 0, 0);

    const rows = db.prepare(`
      SELECT vc.*, COALESCE(c.company_name, c.first_name || ' ' || last_name) as vendor_name, c.company_name as vendor_company,
             coa.account_name as bank_account_name, coa.account_number as bank_account_number
      FROM vendor_checks vc
      LEFT JOIN contacts c ON vc.vendor_id = c.id AND c.operator_id = vc.operator_id AND c.deleted_at IS NULL
      LEFT JOIN chart_of_accounts coa ON vc.bank_account_id = coa.id
      WHERE ${whereSql}
      ORDER BY vc.check_date DESC, vc.check_number DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as unknown as VendorCheckRecord[];

    return {
      checks: rows,
      total: countRow?.total || 0
    };
  }

  /**
   * Void an issued vendor check, reversing General Ledger entries and reopening paid bills.
   *
   * @param id - Check identifier.
   * @param reason - Reason for voiding.
   * @returns Voided VendorCheckRecord.
   */
  public static voidCheck(id: string, reason?: string): VendorCheckRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const check = this.getCheckById(id);
    if (!check) {
      throw new Error(`Vendor check "${id}" not found.`);
    }

    if (check.status === 'voided') {
      return check;
    }

    const now = Date.now();

    return withTransaction((tx) => {
      // 1. Reverse General Ledger entry
      const entryRow = tx.prepare(`
        SELECT id FROM journal_entries
        WHERE operator_id = ? AND source_type = 'vendor_check' AND source_id = ? AND reversed_by_entry_id IS NULL
      `).get(operatorId, id) as { id: string } | undefined;

      if (entryRow) {
        JournalService.reverseEntry(entryRow.id, reason || `Voided Check #${check.check_number}`, tx);
      }

      // 2. Re-open paid bills and reverse settled allocations
      const allocations = check.allocations || [];
      for (const alloc of allocations) {
        const bill = AccountsPayableRepository.getBillById(alloc.bill_id);
        if (bill) {
          const newPaid = Math.max(0, bill.amount_paid_cents - alloc.allocated_amount_cents);
          const newStatus = newPaid === 0 ? 'approved' : 'partially_paid';

          tx.prepare(`
            UPDATE bills SET amount_paid_cents = ?, status = ?, updated_at = ?
            WHERE id = ? AND operator_id = ?
          `).run(newPaid, newStatus, now, alloc.bill_id, operatorId);

          // Reverse settled amount on bill allocation lines
          let toUnsettle = alloc.allocated_amount_cents;
          for (const ba of bill.allocations || []) {
            if (toUnsettle <= 0) break;
            if (ba.amount_settled_cents > 0) {
              const reduce = Math.min(toUnsettle, ba.amount_settled_cents);
              tx.prepare(`
                UPDATE bill_allocations SET amount_settled_cents = amount_settled_cents - ?
                WHERE id = ? AND operator_id = ?
              `).run(reduce, ba.id, operatorId);
              toUnsettle -= reduce;
            }
          }
        }
      }

      // 3. Mark check voided
      tx.prepare(`
        UPDATE vendor_checks SET
          status = 'voided', voided_at = ?, void_reason = ?, updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(now, reason || 'Voided by user', now, id, operatorId);

      return this.getCheckById(id)!;
    });
  }
}
