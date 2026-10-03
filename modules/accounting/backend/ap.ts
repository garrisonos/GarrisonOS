import type { DatabaseSync } from 'node:sqlite';
import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { ChartOfAccountsRepository } from './chart_of_accounts.js';
import { JournalService } from './journal.js';

/**
 * Valid bill status states.
 */
export type BillStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'partially_paid'
  | 'paid'
  | 'voided';

/**
 * Valid standard payment terms.
 */
export type PaymentTerms = 'due_on_receipt' | 'net_15' | 'net_30' | 'net_60';

/**
 * Interface representing a vendor bill record.
 */
export interface BillRecord {
  id: string;
  operator_id: string;
  vendor_id: string;
  invoice_number: string;
  invoice_date: number;
  due_date: number;
  payment_terms: PaymentTerms;
  reference_number: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_amount_cents: number;
  amount_paid_cents: number;
  status: BillStatus;
  approved_by: string | null;
  approved_at: number | null;
  work_order_id: string | null;
  cost_plus_markup_bps: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  allocations?: BillAllocationRecord[];
  vendor_name?: string;
  vendor_company?: string;
}

/**
 * Interface representing an itemized bill expense allocation line.
 */
export interface BillAllocationRecord {
  id: string;
  operator_id: string;
  bill_id: string;
  portfolio_id: string | null;
  property_id: string | null;
  unit_id: string | null;
  gl_account_id: string;
  amount_cents: number;
  amount_settled_cents: number;
  description: string | null;
  created_at: number;
  deleted_at: number | null;
  account_number?: string | null;
  account_name?: string | null;
  property_name?: string | null;
}

/**
 * Input for creating an itemized bill allocation line.
 */
export interface CreateBillAllocationInput {
  portfolio_id?: string | null;
  property_id?: string | null;
  unit_id?: string | null;
  gl_account_id: string;
  amount_cents: number;
  description?: string | null;
}

/**
 * Input payload for creating a vendor bill.
 */
export interface CreateBillInput {
  vendor_id: string;
  invoice_number: string;
  invoice_date: number;
  due_date?: number;
  payment_terms?: PaymentTerms;
  reference_number?: string | null;
  subtotal_cents?: number;
  tax_cents?: number;
  total_amount_cents: number;
  work_order_id?: string | null;
  cost_plus_markup_bps?: number;
  notes?: string | null;
  status?: 'draft' | 'pending_approval';
  allocations: CreateBillAllocationInput[];
}

/**
 * Interface representing a recurring bill schedule record.
 */
export interface RecurringBillRecord {
  id: string;
  operator_id: string;
  vendor_id: string;
  template_reference: string | null;
  start_date: number;
  end_date: number | null;
  interval_count: number;
  interval_unit: 'week' | 'month' | 'quarter' | 'year';
  total_occurrences: number | null;
  remaining_occurrences: number | null;
  next_run_date: number;
  default_disbursement_account_id: string | null;
  auto_disburse: number;
  allocations_template_json: string;
  created_at: number;
  deleted_at: number | null;
  vendor_name?: string;
}

/**
 * Input payload for registering a recurring scheduled bill.
 */
export interface CreateRecurringBillInput {
  vendor_id: string;
  template_reference?: string | null;
  start_date: number;
  end_date?: number | null;
  interval_count?: number;
  interval_unit: 'week' | 'month' | 'quarter' | 'year';
  total_occurrences?: number | null;
  default_disbursement_account_id?: string | null;
  auto_disburse?: boolean;
  allocations: CreateBillAllocationInput[];
  invoice_amount_cents: number;
}

/**
 * Result returned by generateDueRecurringBills, extending array of BillRecord with failure tracking.
 */
export interface GenerateRecurringBillsResult extends Array<BillRecord> {
  failures?: Array<{ recurring_id: string; error: string }>;
}

/**
 * Accounts Payable Repository managing vendor bills, allocations, and recurring bills.
 */
export class AccountsPayableRepository {
  /**
   * Helper to compute due date based on payment terms if not provided.
   *
   * @param invoiceDate - Invoice millisecond timestamp.
   * @param terms - Payment terms enum.
   * @returns Due date millisecond timestamp.
   */
  public static calculateDueDate(invoiceDate: number, terms: PaymentTerms): number {
    switch (terms) {
      case 'due_on_receipt':
        return invoiceDate;
      case 'net_15':
        return invoiceDate + 15 * 86400000;
      case 'net_30':
        return invoiceDate + 30 * 86400000;
      case 'net_60':
        return invoiceDate + 60 * 86400000;
      default:
        return invoiceDate + 30 * 86400000;
    }
  }

  /**
   * Create a new vendor bill with atomic expense allocations.
   *
   * @param input - Creation payload.
   * @param existingTx - Optional shared transaction instance.
   * @returns Newly created BillRecord with allocations.
   */
  public static createBill(input: CreateBillInput, existingTx?: DatabaseSync): BillRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = existingTx || getDatabase();

    if (!input.vendor_id) {
      throw new Error('vendor_id is required.');
    }
    if (!input.invoice_number || input.invoice_number.trim() === '') {
      throw new Error('invoice_number is required.');
    }
    if (!Number.isSafeInteger(input.invoice_date) || input.invoice_date <= 0) {
      throw new Error('invoice_date must be a positive integer millisecond timestamp.');
    }
    if (!Number.isSafeInteger(input.total_amount_cents) || input.total_amount_cents <= 0) {
      throw new Error('total_amount_cents must be a positive integer in cents.');
    }

    const paymentTerms = input.payment_terms || 'net_30';
    const dueDate = input.due_date && Number.isSafeInteger(input.due_date) && input.due_date > 0
      ? input.due_date
      : this.calculateDueDate(input.invoice_date, paymentTerms);

    const taxCents = Number.isSafeInteger(input.tax_cents) && (input.tax_cents || 0) >= 0
      ? (input.tax_cents || 0)
      : 0;

    const subtotalCents = input.subtotal_cents !== undefined && Number.isSafeInteger(input.subtotal_cents)
      ? input.subtotal_cents
      : input.total_amount_cents - taxCents;

    if (subtotalCents <= 0) {
      throw new Error('subtotal_cents must be a positive integer in cents.');
    }

    if (subtotalCents + taxCents !== input.total_amount_cents) {
      throw new Error('subtotal_cents + tax_cents must equal total_amount_cents.');
    }

    if (!input.allocations || !Array.isArray(input.allocations) || input.allocations.length === 0) {
      throw new Error('A bill must include at least one allocation line.');
    }

    let allocationSum = 0;
    for (const alloc of input.allocations) {
      if (!Number.isSafeInteger(alloc.amount_cents) || alloc.amount_cents <= 0) {
        throw new Error('Allocation amount_cents must be a positive integer in cents.');
      }
      allocationSum += alloc.amount_cents;
    }

    if (allocationSum !== input.total_amount_cents) {
      throw new Error(
        `Total of allocation lines ($${(allocationSum / 100).toFixed(2)}) must equal total_amount_cents ($${(input.total_amount_cents / 100).toFixed(2)}).`
      );
    }

    // Verify vendor belongs to operator and has contact_type = 'vendor'
    const vendorRow = db.prepare(`
      SELECT id, contact_type, COALESCE(company_name, first_name || ' ' || last_name) AS name FROM contacts
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(input.vendor_id, operatorId) as any;

    if (!vendorRow) {
      throw new Error(`Vendor contact "${input.vendor_id}" not found or unauthorized.`);
    }

    if (vendorRow.contact_type !== 'vendor') {
      throw new Error(`Contact "${input.vendor_id}" is not a vendor (contact_type is "${vendorRow.contact_type}"). Expenses must be associated with an existing vendor contact.`);
    }

    if (input.work_order_id) {
      const woRow = db.prepare(`
        SELECT id FROM work_orders
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).get(input.work_order_id, operatorId);
      if (!woRow) {
        throw new Error(`Work order "${input.work_order_id}" not found or unauthorized.`);
      }
    }

    // Verify GL accounts exist and belong to operator
    for (const alloc of input.allocations) {
      const glAccount = ChartOfAccountsRepository.getAccountById(alloc.gl_account_id);
      if (!glAccount || glAccount.is_active === 0) {
        throw new Error(`GL Account "${alloc.gl_account_id}" not found or inactive.`);
      }

      if (alloc.property_id) {
        const propRow = db.prepare(`
          SELECT id FROM properties
          WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
        `).get(alloc.property_id, operatorId);
        if (!propRow) {
          throw new Error(`Property "${alloc.property_id}" not found or unauthorized.`);
        }
      }

      if (alloc.portfolio_id) {
        const portRow = db.prepare(`
          SELECT id FROM portfolios
          WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
        `).get(alloc.portfolio_id, operatorId);
        if (!portRow) {
          throw new Error(`Portfolio "${alloc.portfolio_id}" not found or unauthorized.`);
        }
      }

      if (alloc.unit_id) {
        const unitRow = db.prepare(`
          SELECT id FROM units
          WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
        `).get(alloc.unit_id, operatorId);
        if (!unitRow) {
          throw new Error(`Unit "${alloc.unit_id}" not found or unauthorized.`);
        }
      }
    }

    const billId = generateUUIDv7();
    const now = Date.now();
    const status: BillStatus = input.status === 'pending_approval' ? 'pending_approval' : 'draft';

    const runInserts = (tx: DatabaseSync) => {
      tx.prepare(`
        INSERT INTO bills (
          id, operator_id, vendor_id, invoice_number, invoice_date, due_date,
          payment_terms, reference_number, subtotal_cents, tax_cents,
          total_amount_cents, amount_paid_cents, status, approved_by, approved_at,
          work_order_id, cost_plus_markup_bps, notes, created_at, updated_at, deleted_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, 0, ?, NULL, NULL,
          ?, ?, ?, ?, ?, NULL
        )
      `).run(
        billId,
        operatorId,
        input.vendor_id,
        input.invoice_number.trim(),
        input.invoice_date,
        dueDate,
        paymentTerms,
        input.reference_number || null,
        subtotalCents,
        taxCents,
        input.total_amount_cents,
        status,
        input.work_order_id || null,
        input.cost_plus_markup_bps || 0,
        input.notes || null,
        now,
        now
      );

      for (const alloc of input.allocations) {
        const allocId = generateUUIDv7();
        tx.prepare(`
          INSERT INTO bill_allocations (
            id, operator_id, bill_id, portfolio_id, property_id, unit_id,
            gl_account_id, amount_cents, amount_settled_cents, description,
            created_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
        `).run(
          allocId,
          operatorId,
          billId,
          alloc.portfolio_id || null,
          alloc.property_id || null,
          alloc.unit_id || null,
          alloc.gl_account_id,
          alloc.amount_cents,
          alloc.description || null,
          now
        );
      }

      if (input.work_order_id) {
        const totalExpensesRow = tx.prepare(`
          SELECT COALESCE(SUM(total_amount_cents), 0) AS total
          FROM bills
          WHERE work_order_id = ? AND operator_id = ? AND deleted_at IS NULL AND status <> 'voided'
        `).get(input.work_order_id, operatorId) as any;
        const totalExpenses = (totalExpensesRow?.total || 0);
        tx.prepare(`
          UPDATE work_orders SET actual_cost_cents = ?, updated_at = ?
          WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
        `).run(totalExpenses, now, input.work_order_id, operatorId);
      }

      return this.getBillById(billId)!;
    };

    if (existingTx) {
      return runInserts(existingTx);
    }
    return withTransaction(runInserts);
  }

  /**
   * Fetch a bill record by ID with allocations and vendor information.
   *
   * @param id - Bill identifier.
   * @returns BillRecord or null if not found.
   */
  public static getBillById(id: string): BillRecord | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT b.*, COALESCE(c.company_name, c.first_name || ' ' || c.last_name) as vendor_name, c.company_name as vendor_company
      FROM bills b
      LEFT JOIN contacts c ON b.vendor_id = c.id AND c.operator_id = b.operator_id AND c.deleted_at IS NULL
      WHERE b.id = ? AND b.operator_id = ? AND b.deleted_at IS NULL
    `).get(id, operatorId) as unknown as (BillRecord & { vendor_name?: string; vendor_company?: string }) | undefined;

    if (!row) {
      return null;
    }

    const allocRows = db.prepare(`
      SELECT ba.*, coa.account_number, coa.account_name, p.name as property_name
      FROM bill_allocations ba
      JOIN chart_of_accounts coa ON ba.gl_account_id = coa.id
      LEFT JOIN properties p ON ba.property_id = p.id
      WHERE ba.bill_id = ? AND ba.operator_id = ? AND ba.deleted_at IS NULL
      ORDER BY ba.created_at ASC
    `).all(id, operatorId) as unknown as BillAllocationRecord[];

    return {
      ...row,
      allocations: allocRows
    };
  }

  /**
   * Query bills filtered by status, vendor, property, or date intervals.
   *
   * @param filters - Query filters.
   * @returns Array of BillRecord items.
   */
  public static listBills(filters: {
    status?: BillStatus;
    vendor_id?: string;
    work_order_id?: string;
    property_id?: string;
    portfolio_id?: string;
    due_date_start?: number;
    due_date_end?: number;
    invoice_date_start?: number;
    invoice_date_end?: number;
    limit?: number;
    offset?: number;
  } = {}): { bills: BillRecord[]; total: number } {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const whereClauses: string[] = ['b.operator_id = ?', 'b.deleted_at IS NULL'];
    const params: (string | number)[] = [operatorId];

    if (filters.status) {
      whereClauses.push('b.status = ?');
      params.push(filters.status);
    }
    if (filters.vendor_id) {
      whereClauses.push('b.vendor_id = ?');
      params.push(filters.vendor_id);
    }
    if (filters.work_order_id) {
      whereClauses.push('b.work_order_id = ?');
      params.push(filters.work_order_id);
    }
    if (filters.due_date_start !== undefined) {
      whereClauses.push('b.due_date >= ?');
      params.push(filters.due_date_start);
    }
    if (filters.due_date_end !== undefined) {
      whereClauses.push('b.due_date <= ?');
      params.push(filters.due_date_end);
    }
    if (filters.invoice_date_start !== undefined) {
      whereClauses.push('b.invoice_date >= ?');
      params.push(filters.invoice_date_start);
    }
    if (filters.invoice_date_end !== undefined) {
      whereClauses.push('b.invoice_date <= ?');
      params.push(filters.invoice_date_end);
    }

    if (filters.property_id) {
      whereClauses.push(`
        EXISTS (
          SELECT 1 FROM bill_allocations ba
          WHERE ba.bill_id = b.id AND ba.property_id = ? AND ba.deleted_at IS NULL
        )
      `);
      params.push(filters.property_id);
    }

    if (filters.portfolio_id) {
      whereClauses.push(`
        EXISTS (
          SELECT 1 FROM bill_allocations ba
          WHERE ba.bill_id = b.id AND ba.portfolio_id = ? AND ba.deleted_at IS NULL
        )
      `);
      params.push(filters.portfolio_id);
    }

    const whereSql = whereClauses.join(' AND ');

    const countRow = db.prepare(`
      SELECT COUNT(*) as total FROM bills b WHERE ${whereSql}
    `).get(...params) as { total: number };

    const limit = Math.min(Math.max(filters.limit || 50, 1), 200);
    const offset = Math.max(filters.offset || 0, 0);

    const rows = db.prepare(`
      SELECT b.*, COALESCE(c.company_name, c.first_name || ' ' || c.last_name) as vendor_name, c.company_name as vendor_company
      FROM bills b
      LEFT JOIN contacts c ON b.vendor_id = c.id AND c.operator_id = b.operator_id AND c.deleted_at IS NULL
      WHERE ${whereSql}
      ORDER BY b.due_date ASC, b.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as unknown as BillRecord[];

    const billsWithAllocations = rows.map((b) => {
      const allocRows = db.prepare(`
        SELECT ba.*, coa.account_number, coa.account_name, p.name as property_name
        FROM bill_allocations ba
        JOIN chart_of_accounts coa ON ba.gl_account_id = coa.id
        LEFT JOIN properties p ON ba.property_id = p.id
        WHERE ba.bill_id = ? AND ba.operator_id = ? AND ba.deleted_at IS NULL
        ORDER BY ba.created_at ASC
      `).all(b.id, operatorId) as unknown as BillAllocationRecord[];
      return {
        ...b,
        allocations: allocRows
      };
    });

    return {
      bills: billsWithAllocations,
      total: countRow?.total || 0
    };
  }

  /**
   * List all bills associated with a given work order.
   *
   * @param workOrderId - Target work order identifier.
   * @returns Array of bill records linked to the work order.
   */
  public static listBillsByWorkOrder(workOrderId: string): BillRecord[] {
    return this.listBills({ work_order_id: workOrderId, limit: 100 }).bills;
  }

  /**
   * Update an existing draft or pending bill.
   *
   * @param id - Bill identifier.
   * @param input - Update payload.
   * @returns Updated BillRecord.
   */
  public static updateBill(id: string, input: Partial<CreateBillInput>): BillRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const existing = this.getBillById(id);
    if (!existing) {
      throw new Error(`Bill "${id}" not found.`);
    }

    if (existing.status !== 'draft' && existing.status !== 'pending_approval') {
      throw new Error(`Only draft or pending_approval bills can be edited. Current status is "${existing.status}".`);
    }

    const now = Date.now();
    const vendorId = input.vendor_id || existing.vendor_id;
    if (input.vendor_id && input.vendor_id !== existing.vendor_id) {
      const vendorRow = db.prepare(`
        SELECT id FROM contacts
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).get(input.vendor_id, operatorId);
      if (!vendorRow) {
        throw new Error(`Vendor contact "${input.vendor_id}" not found or unauthorized.`);
      }
    }

    const invoiceNumber = input.invoice_number ? input.invoice_number.trim() : existing.invoice_number;
    const invoiceDate = input.invoice_date || existing.invoice_date;
    const paymentTerms = input.payment_terms || existing.payment_terms;
    const termsOrDateChanged = input.invoice_date !== undefined || input.payment_terms !== undefined;
    const dueDate = input.due_date
      ?? (termsOrDateChanged ? this.calculateDueDate(invoiceDate, paymentTerms) : existing.due_date);

    const totalAmount = input.total_amount_cents !== undefined ? input.total_amount_cents : existing.total_amount_cents;
    const taxCents = input.tax_cents !== undefined ? input.tax_cents : existing.tax_cents;
    const subtotalCents = input.subtotal_cents !== undefined ? input.subtotal_cents : totalAmount - taxCents;

    if (totalAmount <= 0) {
      throw new Error('total_amount_cents must be a positive integer in cents.');
    }
    if (subtotalCents + taxCents !== totalAmount) {
      throw new Error('subtotal_cents + tax_cents must equal total_amount_cents.');
    }

    if (input.allocations) {
      for (const alloc of input.allocations) {
        const glAccount = ChartOfAccountsRepository.getAccountById(alloc.gl_account_id);
        if (!glAccount || glAccount.is_active === 0) {
          throw new Error(`GL Account "${alloc.gl_account_id}" not found or inactive.`);
        }
        if (alloc.property_id) {
          const propRow = db.prepare(`
            SELECT id FROM properties
            WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
          `).get(alloc.property_id, operatorId);
          if (!propRow) {
            throw new Error(`Property "${alloc.property_id}" not found or unauthorized.`);
          }
        }
        if (alloc.portfolio_id) {
          const portRow = db.prepare(`
            SELECT id FROM portfolios
            WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
          `).get(alloc.portfolio_id, operatorId);
          if (!portRow) {
            throw new Error(`Portfolio "${alloc.portfolio_id}" not found or unauthorized.`);
          }
        }
        if (alloc.unit_id) {
          const unitRow = db.prepare(`
            SELECT id FROM units
            WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
          `).get(alloc.unit_id, operatorId);
          if (!unitRow) {
            throw new Error(`Unit "${alloc.unit_id}" not found or unauthorized.`);
          }
        }
      }
    }

    const allocations = input.allocations || existing.allocations?.map((a) => ({
      portfolio_id: a.portfolio_id,
      property_id: a.property_id,
      unit_id: a.unit_id,
      gl_account_id: a.gl_account_id,
      amount_cents: a.amount_cents,
      description: a.description
    })) || [];

    let allocationSum = 0;
    for (const alloc of allocations) {
      if (!Number.isSafeInteger(alloc.amount_cents) || alloc.amount_cents <= 0) {
        throw new Error('Allocation amount_cents must be a positive integer in cents.');
      }
      allocationSum += alloc.amount_cents;
    }

    if (allocationSum !== totalAmount) {
      throw new Error(
        `Total of allocation lines ($${(allocationSum / 100).toFixed(2)}) must equal total_amount_cents ($${(totalAmount / 100).toFixed(2)}).`
      );
    }

    return withTransaction((tx) => {
      tx.prepare(`
        UPDATE bills SET
          vendor_id = ?, invoice_number = ?, invoice_date = ?, due_date = ?,
          payment_terms = ?, reference_number = ?, subtotal_cents = ?, tax_cents = ?,
          total_amount_cents = ?, work_order_id = ?, cost_plus_markup_bps = ?,
          notes = ?, updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(
        vendorId,
        invoiceNumber,
        invoiceDate,
        dueDate,
        paymentTerms,
        input.reference_number !== undefined ? input.reference_number : existing.reference_number,
        subtotalCents,
        taxCents,
        totalAmount,
        input.work_order_id !== undefined ? input.work_order_id : existing.work_order_id,
        input.cost_plus_markup_bps !== undefined ? input.cost_plus_markup_bps : existing.cost_plus_markup_bps,
        input.notes !== undefined ? input.notes : existing.notes,
        now,
        id,
        operatorId
      );

      if (input.allocations) {
        // Soft delete old allocations and replace with new ones
        tx.prepare(`
          UPDATE bill_allocations SET deleted_at = ?
          WHERE bill_id = ? AND operator_id = ? AND deleted_at IS NULL
        `).run(now, id, operatorId);

        for (const alloc of allocations) {
          const allocId = generateUUIDv7();
          tx.prepare(`
            INSERT INTO bill_allocations (
              id, operator_id, bill_id, portfolio_id, property_id, unit_id,
              gl_account_id, amount_cents, amount_settled_cents, description,
              created_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
          `).run(
            allocId,
            operatorId,
            id,
            alloc.portfolio_id || null,
            alloc.property_id || null,
            alloc.unit_id || null,
            alloc.gl_account_id,
            alloc.amount_cents,
            alloc.description || null,
            now
          );
        }
      }

      return this.getBillById(id)!;
    });
  }

  /**
   * Approve a vendor bill, posting double-entry General Ledger accruals.
   * Dr: Expense Accounts (per allocation lines)
   * Cr: 2010 Accounts Payable
   *
   * @param id - Bill identifier.
   * @param approvedByUserId - User ID performing the approval.
   * @returns Updated BillRecord.
   */
  public static approveBill(id: string, approvedByUserId: string): BillRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const bill = this.getBillById(id);
    if (!bill) {
      throw new Error(`Bill "${id}" not found.`);
    }

    if (bill.status === 'approved') {
      return bill;
    }

    if (bill.status !== 'draft' && bill.status !== 'pending_approval') {
      throw new Error(`Cannot approve a bill with status "${bill.status}".`);
    }

    // Resolve 2010 Accounts Payable account
    const apAccount = db.prepare(`
      SELECT id FROM chart_of_accounts
      WHERE operator_id = ? AND (account_number = '2010' OR category_mapping = 'accounts_payable') AND deleted_at IS NULL
    `).get(operatorId) as { id: string } | undefined;

    if (!apAccount) {
      throw new Error('Default Accounts Payable account (2010) not found in Chart of Accounts.');
    }

    const allocations = bill.allocations || [];
    if (allocations.length === 0) {
      throw new Error('Cannot approve bill without allocations.');
    }

    const now = Date.now();

    let approvedUser: string | null = null;
    if (approvedByUserId) {
      const userRow = db.prepare('SELECT 1 FROM users WHERE id = ?').get(approvedByUserId);
      if (userRow) {
        approvedUser = approvedByUserId;
      }
    }

    return withTransaction((tx) => {
      // Build journal lines
      const journalLines = allocations.map((alloc) => ({
        account_id: alloc.gl_account_id,
        debit_cents: alloc.amount_cents,
        credit_cents: 0,
        property_id: alloc.property_id,
        unit_id: alloc.unit_id,
        description: alloc.description || `Bill: ${bill.invoice_number}`
      }));

      // Credit 2010 Accounts Payable per allocation so property-level balances stay balanced
      for (const alloc of allocations) {
        journalLines.push({
          account_id: apAccount.id,
          debit_cents: 0,
          credit_cents: alloc.amount_cents,
          property_id: alloc.property_id || null,
          unit_id: alloc.unit_id || null,
          description: `Bill Accrual: ${bill.vendor_name || 'Vendor'} Inv# ${bill.invoice_number}`
        });
      }

      // Post General Ledger accrual
      JournalService.postEntry({
        date_ms: bill.invoice_date,
        memo: `Bill Accrual: ${bill.vendor_name || 'Vendor'} Inv# ${bill.invoice_number}`,
        source_type: 'bill',
        source_id: bill.id,
        lines: journalLines
      }, tx);

      tx.prepare(`
        UPDATE bills SET
          status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(approvedUser, now, now, id, operatorId);

      return this.getBillById(id)!;
    });
  }

  /**
   * Void a bill and reverse any posted accrual journal entries.
   *
   * @param id - Bill identifier.
   * @param reason - Optional audit memo for voiding.
   * @returns Voided BillRecord.
   */
  public static voidBill(id: string, reason?: string): BillRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const bill = this.getBillById(id);
    if (!bill) {
      throw new Error(`Bill "${id}" not found.`);
    }

    if (bill.status === 'voided') {
      return bill;
    }

    if (bill.amount_paid_cents > 0 || bill.status === 'paid' || bill.status === 'partially_paid') {
      throw new Error(
        `Cannot void bill with payments or credits applied ($${(bill.amount_paid_cents / 100).toFixed(2)} paid). Void disbursements or credits first.`
      );
    }

    const now = Date.now();

    return withTransaction((tx) => {
      if (bill.status === 'approved') {
        // Reverse General Ledger accrual entry if present
        const entryRow = tx.prepare(`
          SELECT id FROM journal_entries
          WHERE operator_id = ? AND source_type = 'bill' AND source_id = ? AND reversed_by_entry_id IS NULL
        `).get(operatorId, bill.id) as { id: string } | undefined;

        if (entryRow) {
          JournalService.reverseEntry(entryRow.id, reason || `Voided Bill #${bill.invoice_number}`, tx);
        }
      }

      tx.prepare(`
        UPDATE bills SET status = 'voided', updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(now, id, operatorId);

      return this.getBillById(id)!;
    });
  }

  /**
   * Register a new recurring scheduled bill template.
   *
   * @param input - Creation payload.
   * @returns Newly created RecurringBillRecord.
   */
  public static createRecurringBill(input: CreateRecurringBillInput): RecurringBillRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    if (!input.vendor_id) {
      throw new Error('vendor_id is required.');
    }
    const vendorRow = db.prepare(`
      SELECT id FROM contacts
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(input.vendor_id, operatorId);
    if (!vendorRow) {
      throw new Error(`Vendor contact "${input.vendor_id}" not found or unauthorized.`);
    }

    if (!Number.isSafeInteger(input.start_date) || input.start_date <= 0) {
      throw new Error('start_date must be a positive integer millisecond timestamp.');
    }
    if (input.end_date !== undefined && input.end_date !== null) {
      if (!Number.isSafeInteger(input.end_date) || input.end_date <= input.start_date) {
        throw new Error('end_date must be a positive integer millisecond timestamp after start_date.');
      }
    }
    if (!input.allocations || !Array.isArray(input.allocations) || input.allocations.length === 0) {
      throw new Error('allocations array is required.');
    }

    const intervalCount = input.interval_count ?? 1;
    if (!Number.isSafeInteger(intervalCount) || intervalCount <= 0) {
      throw new Error('interval_count must be a positive integer.');
    }

    if (input.total_occurrences !== undefined && input.total_occurrences !== null) {
      if (!Number.isSafeInteger(input.total_occurrences) || input.total_occurrences <= 0) {
        throw new Error('total_occurrences must be a positive integer.');
      }
    }

    for (const alloc of input.allocations) {
      if (!Number.isSafeInteger(alloc.amount_cents) || alloc.amount_cents <= 0) {
        throw new Error('Allocation amount_cents must be a positive integer in cents.');
      }
      const glAccount = ChartOfAccountsRepository.getAccountById(alloc.gl_account_id);
      if (!glAccount || glAccount.is_active === 0) {
        throw new Error(`GL Account "${alloc.gl_account_id}" not found or inactive.`);
      }
      if (alloc.property_id) {
        const propRow = db.prepare(`
          SELECT id FROM properties
          WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
        `).get(alloc.property_id, operatorId);
        if (!propRow) {
          throw new Error(`Property "${alloc.property_id}" not found or unauthorized.`);
        }
      }
      if (alloc.portfolio_id) {
        const portRow = db.prepare(`
          SELECT id FROM portfolios
          WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
        `).get(alloc.portfolio_id, operatorId);
        if (!portRow) {
          throw new Error(`Portfolio "${alloc.portfolio_id}" not found or unauthorized.`);
        }
      }
      if (alloc.unit_id) {
        const unitRow = db.prepare(`
          SELECT id FROM units
          WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
        `).get(alloc.unit_id, operatorId);
        if (!unitRow) {
          throw new Error(`Unit "${alloc.unit_id}" not found or unauthorized.`);
        }
      }
    }

    const recurringId = generateUUIDv7();
    const now = Date.now();
    const nextRunDate = input.start_date;
    const occurrences = input.total_occurrences || null;

    db.prepare(`
      INSERT INTO recurring_bills (
        id, operator_id, vendor_id, template_reference, start_date, end_date,
        interval_count, interval_unit, total_occurrences, remaining_occurrences,
        next_run_date, default_disbursement_account_id, auto_disburse,
        allocations_template_json, created_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      recurringId,
      operatorId,
      input.vendor_id,
      input.template_reference || null,
      input.start_date,
      input.end_date || null,
      intervalCount,
      input.interval_unit,
      occurrences,
      occurrences,
      nextRunDate,
      input.default_disbursement_account_id || null,
      input.auto_disburse ? 1 : 0,
      JSON.stringify(input.allocations),
      now
    );

    return db.prepare(`
      SELECT rb.*, COALESCE(c.company_name, c.first_name || ' ' || c.last_name) as vendor_name
      FROM recurring_bills rb
      JOIN contacts c ON rb.vendor_id = c.id AND c.operator_id = rb.operator_id AND c.deleted_at IS NULL
      WHERE rb.id = ? AND rb.operator_id = ?
    `).get(recurringId, operatorId) as unknown as RecurringBillRecord;
  }

  /**
   * List all recurring scheduled bills.
   *
   * @returns Array of RecurringBillRecord items.
   */
  public static listRecurringBills(): RecurringBillRecord[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    return db.prepare(`
      SELECT rb.*, COALESCE(c.company_name, c.first_name || ' ' || c.last_name) as vendor_name
      FROM recurring_bills rb
      JOIN contacts c ON rb.vendor_id = c.id AND c.operator_id = rb.operator_id AND c.deleted_at IS NULL
      WHERE rb.operator_id = ? AND rb.deleted_at IS NULL
      ORDER BY rb.next_run_date ASC
    `).all(operatorId) as unknown as RecurringBillRecord[];
  }

  /**
   * Compute next scheduled run date based on interval unit and count.
   *
   * @param currentDateMs - Current millisecond timestamp.
   * @param unit - Interval unit ('week', 'month', 'quarter', 'year').
   * @param count - Cadence multiplier.
   * @returns Next millisecond timestamp.
   */
  public static computeNextIntervalDate(
    currentDateMs: number,
    unit: 'week' | 'month' | 'quarter' | 'year',
    count: number = 1
  ): number {
    const d = new Date(currentDateMs);
    switch (unit) {
      case 'week':
        return currentDateMs + (count * 7 * 86400000);
      case 'month':
      case 'quarter': {
        const addMonths = unit === 'quarter' ? count * 3 : count;
        const targetDay = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + addMonths);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(targetDay, lastDay));
        return d.getTime();
      }
      case 'year': {
        const targetDay = d.getDate();
        d.setDate(1);
        d.setFullYear(d.getFullYear() + count);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(targetDay, lastDay));
        return d.getTime();
      }
      default:
        return currentDateMs + (30 * 86400000);
    }
  }

  /**
   * Run due recurring bills pass, creating scheduled bills and advancing run dates.
   *
   * @param asOfDateMs - Cutoff timestamp (defaults to current time).
   * @returns Array of newly generated BillRecord items with failure details.
   */
  public static generateDueRecurringBills(asOfDateMs: number = Date.now()): GenerateRecurringBillsResult {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const dueList = db.prepare(`
      SELECT * FROM recurring_bills
      WHERE operator_id = ? AND next_run_date <= ? AND deleted_at IS NULL
        AND (end_date IS NULL OR next_run_date <= end_date)
        AND (remaining_occurrences IS NULL OR remaining_occurrences > 0)
    `).all(operatorId, asOfDateMs) as unknown as RecurringBillRecord[];

    const generatedBills: BillRecord[] = [];
    const failures: Array<{ recurring_id: string; error: string }> = [];

    for (const rec of dueList) {
      try {
        const allocations: CreateBillAllocationInput[] = JSON.parse(rec.allocations_template_json);
        const totalAmount = allocations.reduce((sum, a) => sum + a.amount_cents, 0);

        const d = new Date(rec.next_run_date);
        const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
        const invoiceNum = `REC-${dateStr}-${rec.id}`;

        const nextDate = this.computeNextIntervalDate(rec.next_run_date, rec.interval_unit, rec.interval_count);
        const newRemaining = rec.remaining_occurrences !== null ? rec.remaining_occurrences - 1 : null;

        const newBill = withTransaction((tx) => {
          const bill = this.createBill({
            vendor_id: rec.vendor_id,
            invoice_number: invoiceNum,
            invoice_date: rec.next_run_date,
            total_amount_cents: totalAmount,
            notes: `Automatically generated from recurring bill ${rec.id}`,
            allocations
          }, tx);

          tx.prepare(`
            UPDATE recurring_bills SET
              next_run_date = ?,
              remaining_occurrences = ?
            WHERE id = ? AND operator_id = ?
          `).run(nextDate, newRemaining, rec.id, operatorId);

          return bill;
        });

        generatedBills.push(newBill);
      } catch (err: any) {
        failures.push({ recurring_id: rec.id, error: err.message });
      }
    }

    (generatedBills as any).failures = failures;
    return generatedBills;
  }
}
