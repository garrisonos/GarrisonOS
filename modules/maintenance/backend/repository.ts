import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { eventBus } from '../../../core/events.js';
import { WorkOrderDispatchPdfData } from '../../../web/lib/pdf.js';

/**
 * Maintenance work order entity.
 */
export interface WorkOrder {
  /** Unique work order identifier (UUIDv7). */
  id: string;
  /** Primary operator isolation identifier. */
  operator_id: string;
  /** Legacy tenant isolation identifier (backward-compatibility alias). */
  tenant_id?: string;
  /** Identifier of the associated property. */
  property_id: string;
  /** Optional identifier of the associated unit. */
  unit_id?: string | null;
  /** Short summary of the repair or maintenance issue. */
  title: string;
  /** Detailed description of the requested work. */
  description: string;
  /** Current workflow status. */
  status: 'open' | 'assigned' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
  /** Urgency level of the work order. */
  priority: 'low' | 'medium' | 'high' | 'emergency';
  /** Trade or domain classification. */
  category: 'plumbing' | 'electrical' | 'hvac' | 'appliance' | 'structural' | 'cosmetic' | 'pest' | 'other';
  /** 1 if technician has permission to enter, 0 otherwise. */
  permission_to_enter: number;
  /** Access instructions or lockbox codes. */
  entry_instructions?: string | null;
  /** Contact ID of the person who reported the issue. */
  requested_by_contact_id?: string | null;
  /** Contact ID of the assigned vendor or technician. */
  vendor_contact_id?: string | null;
  /** Scheduled service timestamp in epoch milliseconds. */
  scheduled_date?: number | null;
  /** Completion timestamp in epoch milliseconds. */
  completed_date?: number | null;
  /** Estimated cost in integer cents. */
  estimated_cost_cents: number;
  /** Actual recorded cost in integer cents. */
  actual_cost_cents: number;
  /** Created timestamp in epoch milliseconds. */
  created_at: number;
  /** Last updated timestamp in epoch milliseconds. */
  updated_at: number;
  /** Soft-deletion timestamp in epoch milliseconds, or null if active. */
  deleted_at?: number | null;
  /** Reason explaining why work order was automatically or manually placed on hold. */
  hold_reason?: string | null;
}

/**
 * Maintenance work order enriched with joined relation names.
 */
export interface WorkOrderWithDetails extends WorkOrder {
  /** Name of the associated property. */
  property_name?: string;
  /** Unit number or identifier. */
  unit_number?: string;
  /** Full name of the assigned vendor. */
  vendor_name?: string;
  /** Full name of the requesting contact. */
  requested_by_name?: string;
  /** All assigned vendors and subcontractors. */
  assigned_vendors?: WorkOrderVendor[];
}

/**
 * Vendor or contractor linked to a work order.
 */
export interface WorkOrderVendor {
  /** Unique junction record ID. */
  id: string;
  /** Operator isolation identifier. */
  operator_id: string;
  /** Work order identifier. */
  work_order_id: string;
  /** Contact ID of the vendor. */
  vendor_contact_id: string;
  /** Vendor display name. */
  vendor_name?: string;
  /** Vendor company name. */
  company_name?: string;
  /** Vendor specialty/trade. */
  vendor_specialty?: string;
  /** Vendor email. */
  email?: string;
  /** Vendor phone. */
  phone?: string;
  /** Role in the work order (e.g. contractor, primary, specialist). */
  role: string;
  /** Optional operational notes or scope. */
  notes?: string | null;
  /** Timestamp when vendor was assigned in epoch milliseconds. */
  assigned_at: number;
  /** Record creation timestamp. */
  created_at: number;
  /** Soft-deletion timestamp. */
  deleted_at?: number | null;
}
 
 /**
  * Itemized bill record linked to a work order.
  */
 export interface WorkOrderLinkedBill {
   /** Unique bill identifier. */
   id: string;
   /** Vendor contact identifier. */
   vendor_id: string;
   /** Vendor contact full name. */
   vendor_name: string;
   /** Optional vendor company name. */
   vendor_company?: string | null;
   /** Vendor invoice number. */
   invoice_number: string;
   /** Invoice date timestamp in epoch milliseconds. */
   invoice_date: number;
   /** Due date timestamp in epoch milliseconds. */
   due_date: number;
   /** Total billed amount in integer cents. */
   total_amount_cents: number;
   /** Settled or paid amount in integer cents. */
   amount_paid_cents: number;
   /** Bill approval or settlement status. */
   status: string;
   /** Created timestamp in epoch milliseconds. */
   created_at: number;
 }
 
 /**
  * Budget vs actual expenses rollup for a work order.
  */
 export interface WorkOrderBudgetSummary {
   /** Estimated or authorized budget in integer cents. */
   estimated_cost_cents: number;
   /** Recorded actual cost in integer cents. */
   actual_cost_cents: number;
   /** Sum total of all invoiced bills in integer cents. */
   total_invoiced_cents: number;
   /** Sum total of all disbursed bill payments in integer cents. */
   total_paid_cents: number;
   /** Remaining variance (estimated - invoiced) in integer cents. Positive = under budget, negative = over budget. */
   remaining_variance_cents: number;
   /** True if total invoiced bills exceed estimated budget and budget is greater than 0. */
   is_over_budget: boolean;
   /** Percentage of budget consumed (0-100+). */
   percent_utilized: number;
 }
 
 /**
  * Complete expense report for a work order.
  */
 export interface WorkOrderExpensesResult {
   /** Aggregated budget metrics. */
   budget: WorkOrderBudgetSummary;
   /** Array of itemized bills linked to this work order. */
   bills: WorkOrderLinkedBill[];
 }

export type PreventativeScheduleCategory =
  | 'hvac'
  | 'electrical'
  | 'plumbing'
  | 'fire_safety'
  | 'roofing'
  | 'landscaping'
  | 'winterization'
  | 'general';

export type PreventativeSchedulePriority = 'low' | 'medium' | 'high' | 'emergency';

export type PreventativeScheduleFrequency =
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'semi_annually'
  | 'annually'
  | 'seasonal';

export interface PreventativeSchedule {
  id: string;
  operator_id: string;
  property_id?: string | null;
  building_id?: string | null;
  unit_id?: string | null;
  title: string;
  description: string;
  category: PreventativeScheduleCategory;
  priority: PreventativeSchedulePriority;
  frequency: PreventativeScheduleFrequency;
  seasonal_month?: number | null;
  lead_days: number;
  assigned_vendor_contact_id?: string | null;
  estimated_cost_cents: number;
  last_generated_at?: number | null;
  next_due_date: number;
  is_active: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  property_name?: string;
  vendor_name?: string;
}

export interface CreatePreventativeScheduleInput {
  property_id?: string | null;
  building_id?: string | null;
  unit_id?: string | null;
  title: string;
  description: string;
  category: PreventativeScheduleCategory;
  priority: PreventativeSchedulePriority;
  frequency: PreventativeScheduleFrequency;
  seasonal_month?: number | null;
  lead_days?: number;
  assigned_vendor_contact_id?: string | null;
  estimated_cost_cents?: number;
  next_due_date: number;
}

export interface UpdatePreventativeScheduleInput {
  property_id?: string | null;
  building_id?: string | null;
  unit_id?: string | null;
  title?: string;
  description?: string;
  category?: PreventativeScheduleCategory;
  priority?: PreventativeSchedulePriority;
  frequency?: PreventativeScheduleFrequency;
  seasonal_month?: number | null;
  lead_days?: number;
  assigned_vendor_contact_id?: string | null;
  estimated_cost_cents?: number;
  next_due_date?: number;
  is_active?: number | boolean;
}

export interface ListPreventativeSchedulesFilter {
  property_id?: string;
  category?: string;
  is_active?: boolean | number;
  due_before?: number;
}

/**
 * Data access and query repository for maintenance work orders.
 */
export class MaintenanceRepository {
  /**
   * Validate that all supplied relation IDs belong to the active operator.
   * Prevents cross-operator Insecure Direct Object References (IDOR).
   *
   * @param operatorId - Active operator context identifier.
   * @param propertyId - Property identifier to validate.
   * @param unitId - Optional unit identifier to validate against property and operator.
   * @param requestedByContactId - Optional requesting contact identifier.
   * @param vendorContactId - Optional vendor contact identifier.
   * @param buildingId - Optional building identifier.
   */
  private static validateOwnership(
    operatorId: string,
    propertyId?: string,
    unitId?: string | null,
    requestedByContactId?: string | null,
    vendorContactId?: string | null,
    buildingId?: string | null
  ): void {
    const db = getDatabase();

    if (propertyId) {
      const prop = db.prepare('SELECT id FROM properties WHERE id = ? AND operator_id = ? AND deleted_at IS NULL').get(propertyId, operatorId);
      if (!prop) {
        throw new Error(`Property ${propertyId} not found or does not belong to the active operator`);
      }
    }

    if (unitId && !propertyId) {
      throw new Error('unit_id requires property_id');
    }

    if (unitId && propertyId) {
      const unit = db.prepare('SELECT id FROM units WHERE id = ? AND operator_id = ? AND property_id = ? AND deleted_at IS NULL').get(unitId, operatorId, propertyId);
      if (!unit) {
        throw new Error(`Unit ${unitId} not found or does not belong to property ${propertyId} for the active operator`);
      }
    }

    if (buildingId && !propertyId) {
      throw new Error('building_id requires property_id');
    }

    if (buildingId && propertyId) {
      const bld = db.prepare('SELECT id FROM buildings WHERE id = ? AND operator_id = ? AND property_id = ? AND deleted_at IS NULL').get(buildingId, operatorId, propertyId);
      if (!bld) {
        throw new Error(`Building ${buildingId} not found or does not belong to property ${propertyId} for the active operator`);
      }
    }

    if (requestedByContactId) {
      const contact = db.prepare('SELECT id FROM contacts WHERE id = ? AND operator_id = ? AND deleted_at IS NULL').get(requestedByContactId, operatorId);
      if (!contact) {
        throw new Error(`Contact ${requestedByContactId} not found or does not belong to the active operator`);
      }
    }

    if (vendorContactId) {
      const vendor = db.prepare('SELECT id, contact_type, vendor_specialty, w9_received FROM contacts WHERE id = ? AND operator_id = ? AND deleted_at IS NULL').get(vendorContactId, operatorId) as any;
      if (!vendor) {
        throw new Error(`Vendor contact ${vendorContactId} not found or does not belong to the active operator`);
      }
      if (vendor.contact_type !== 'vendor') {
        throw new Error(`Contact ${vendorContactId} is not a vendor (contact_type: ${vendor.contact_type})`);
      }
    }
  }

  /**
   * Determine if a vendor's trade specialty is compatible with a work order category.
   *
   * @param vendorSpecialty - Declared trade specialty of vendor.
   * @param category - Category of work order.
   * @returns True if compatible or generalized trade.
   */
  public static isTradeCompatible(vendorSpecialty?: string | null, category?: string | null): boolean {
    if (!vendorSpecialty || !category) return false;
    const spec = vendorSpecialty.toLowerCase().trim();
    const cat = category.toLowerCase().trim();
    if (spec === cat) return true;
    if (spec === 'general contractor' || spec === 'general repair' || spec === 'handyman') return true;
    if ((cat === 'cosmetic' || cat === 'other') && (spec === 'make_ready' || spec === 'turnkey' || spec === 'cleaning' || spec === 'painting' || spec === 'general contractor')) return true;
    return spec.includes(cat) || cat.includes(spec);
  }

  /**
   * List all work orders for the active operator, optionally filtered.
   *
   * @param filter - Optional criteria for status, priority, property, or unit.
   * @returns Array of work orders with joined details.
   */
  public static listWorkOrders(filter?: {
    status?: string;
    priority?: string;
    property_id?: string;
    portfolio?: string;
    unit_id?: string;
    limit?: number;
  }): WorkOrderWithDetails[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    let sql = `
      SELECT
        w.*,
        p.name as property_name,
        u.unit_number,
        v.first_name || ' ' || v.last_name as vendor_name,
        r.first_name || ' ' || r.last_name as requested_by_name
      FROM work_orders w
      JOIN properties p ON w.property_id = p.id AND p.operator_id = w.operator_id AND p.deleted_at IS NULL
      LEFT JOIN units u ON w.unit_id = u.id AND u.operator_id = w.operator_id AND u.deleted_at IS NULL
      LEFT JOIN contacts v ON w.vendor_contact_id = v.id AND v.operator_id = w.operator_id AND v.deleted_at IS NULL
      LEFT JOIN contacts r ON w.requested_by_contact_id = r.id AND r.operator_id = w.operator_id AND r.deleted_at IS NULL
      WHERE w.operator_id = ? AND w.deleted_at IS NULL
    `;
    const params: any[] = [operatorId];

    if (filter?.status === 'active') {
      sql += " AND w.status IN ('open', 'assigned', 'in_progress', 'on_hold')";
    } else if (filter?.status) {
      sql += ' AND w.status = ?';
      params.push(filter.status);
    }
    if (filter?.priority) {
      sql += ' AND w.priority = ?';
      params.push(filter.priority);
    }
    if (filter?.property_id) {
      sql += ' AND w.property_id = ?';
      params.push(filter.property_id);
    }
    if (filter?.portfolio) {
      sql += ` AND w.property_id IN (
        SELECT id FROM properties
        WHERE operator_id = ? AND (portfolio_id = ? OR portfolio_id IN (SELECT id FROM portfolios WHERE name = ?)) AND deleted_at IS NULL
      )`;
      params.push(operatorId, filter.portfolio, filter.portfolio);
    }
    if (filter?.unit_id) {
      sql += ' AND w.unit_id = ?';
      params.push(filter.unit_id);
    }

    sql += " ORDER BY CASE w.priority WHEN 'emergency' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, w.created_at DESC";

    if (filter?.limit && filter.limit > 0) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = db.prepare(sql).all(...params) as unknown as WorkOrderWithDetails[];
    return rows.map((row) => ({
      ...row,
      tenant_id: row.operator_id
    }));
  }

  /**
   * Retrieve a work order by identifier within the active operator context.
   *
   * @param id - Work order identifier.
   * @returns Detailed work order record or null if not found.
   */
  public static getWorkOrderById(id: string): WorkOrderWithDetails | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT
        w.*,
        p.name as property_name,
        u.unit_number,
        v.first_name || ' ' || v.last_name as vendor_name,
        r.first_name || ' ' || r.last_name as requested_by_name
      FROM work_orders w
      JOIN properties p ON w.property_id = p.id AND p.operator_id = w.operator_id AND p.deleted_at IS NULL
      LEFT JOIN units u ON w.unit_id = u.id AND u.operator_id = w.operator_id AND u.deleted_at IS NULL
      LEFT JOIN contacts v ON w.vendor_contact_id = v.id AND v.operator_id = w.operator_id AND v.deleted_at IS NULL
      LEFT JOIN contacts r ON w.requested_by_contact_id = r.id AND r.operator_id = w.operator_id AND r.deleted_at IS NULL
      WHERE w.id = ? AND w.operator_id = ? AND w.deleted_at IS NULL
    `).get(id, operatorId) as WorkOrderWithDetails | undefined;

    if (!row) return null;
    const assignedVendors = MaintenanceRepository.listWorkOrderVendors(id);
    return {
      ...row,
      tenant_id: row.operator_id,
      assigned_vendors: assignedVendors
    };
  }

  /**
   * Evaluate whether a work order's estimated cost exceeds permissible spend limits
   * or available operating cash in the relevant portfolio.
   *
   * @param propertyId - Property identifier.
   * @param estimatedCostCents - Estimated work order expense in cents.
   * @returns Policy evaluation result with recommendation and detailed rationale.
   */
  public static evaluateSpendPolicy(propertyId: string, estimatedCostCents: number): {
    shouldHold: boolean;
    reason?: string;
    spendThresholdCents?: number;
    availableFundsCents?: number;
    portfolioName?: string;
    portfolioId?: string;
  } {
    if (!estimatedCostCents || estimatedCostCents <= 0) {
      return { shouldHold: false };
    }

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    // Check if property belongs to a portfolio
    const prop = db.prepare(`
      SELECT p.id, p.name, p.portfolio_id, port.name as portfolio_name, port.spend_threshold_cents
      FROM properties p
      LEFT JOIN portfolios port ON p.portfolio_id = port.id AND port.operator_id = p.operator_id AND port.deleted_at IS NULL
      WHERE p.id = ? AND p.operator_id = ? AND p.deleted_at IS NULL
    `).get(propertyId, operatorId) as any;

    if (!prop || !prop.portfolio_id) {
      return { shouldHold: false };
    }

    const portfolioId = prop.portfolio_id;
    const portfolioName = prop.portfolio_name || 'Portfolio';
    const spendThresholdCents = typeof prop.spend_threshold_cents === 'number' && prop.spend_threshold_cents > 0
      ? prop.spend_threshold_cents
      : null;

    const reasons: string[] = [];
    let shouldHold = false;

    // 1. Permissible Spend Threshold check (if set on portfolio)
    if (spendThresholdCents !== null && estimatedCostCents > spendThresholdCents) {
      shouldHold = true;
      reasons.push(
        `Estimated cost ($${(estimatedCostCents / 100).toFixed(2)}) exceeds portfolio '${portfolioName}' permissible spend threshold of $${(spendThresholdCents / 100).toFixed(2)}`
      );
    }

    // 2. Available Portfolio Operating Funds check
    let availableFundsCents: number | null = null;
    try {
      const coaCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chart_of_accounts'").get();
      if (coaCheck) {
        let hasAccountingData = false;
        let netBankCash = 0;

        const cashRow = db.prepare(`
          SELECT COALESCE(SUM(jl.debit_cents - jl.credit_cents), 0) as net_cash, COUNT(jl.id) as line_count
          FROM journal_lines jl
          JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.deleted_at IS NULL
          JOIN chart_of_accounts coa ON jl.account_id = coa.id AND coa.deleted_at IS NULL
          JOIN properties p ON jl.property_id = p.id AND p.deleted_at IS NULL
          WHERE jl.operator_id = ? AND p.portfolio_id = ?
            AND coa.category_mapping = 'operating_bank'
        `).get(operatorId, portfolioId) as { net_cash: number; line_count: number } | undefined;

        if (cashRow && cashRow.line_count > 0) {
          hasAccountingData = true;
          netBankCash = Number(cashRow.net_cash);
        }

        const contribCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='client_capital_contributions'").get();
        let contributions = 0;
        if (contribCheck) {
          const cRow = db.prepare(`
            SELECT COALESCE(SUM(amount_cents), 0) as total, COUNT(id) as count
            FROM client_capital_contributions
            WHERE portfolio_id = ? AND operator_id = ? AND deleted_at IS NULL
          `).get(portfolioId, operatorId) as { total: number; count: number };
          if (cRow && cRow.count > 0) {
            hasAccountingData = true;
            contributions = Number(cRow.total);
          }
        }

        const distCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='client_distributions'").get();
        let distributions = 0;
        if (distCheck) {
          const dRow = db.prepare(`
            SELECT COALESCE(SUM(amount_cents), 0) as total, COUNT(id) as count
            FROM client_distributions
            WHERE portfolio_id = ? AND operator_id = ? AND deleted_at IS NULL
          `).get(portfolioId, operatorId) as { total: number; count: number };
          if (dRow && dRow.count > 0) {
            hasAccountingData = true;
            distributions = Number(dRow.total);
          }
        }

        if (hasAccountingData) {
          availableFundsCents = Math.max(0, netBankCash + contributions - distributions);
          if (estimatedCostCents > availableFundsCents) {
            shouldHold = true;
            reasons.push(
              `Estimated cost ($${(estimatedCostCents / 100).toFixed(2)}) exceeds available portfolio operating funds ($${(availableFundsCents / 100).toFixed(2)})`
            );
          }
        }
      }
    } catch {
      // Proceed gracefully in non-accounting test contexts
    }

    return {
      shouldHold,
      reason: reasons.join('; '),
      spendThresholdCents: spendThresholdCents ?? undefined,
      availableFundsCents: availableFundsCents ?? undefined,
      portfolioName,
      portfolioId
    };
  }

  /**
   * Helper to append an automated operational message to an entity conversation thread.
   */
  public static recordAutomatedNote(workOrderId: string, subject: string, message: string): void {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    try {
      const convCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'").get();
      if (!convCheck) return;

      let thread = db.prepare(`
        SELECT id FROM conversations
        WHERE operator_id = ? AND entity_type = 'work_order' AND entity_id = ? AND deleted_at IS NULL
        ORDER BY created_at ASC LIMIT 1
      `).get(operatorId, workOrderId) as { id: string } | undefined;

      let convId: string;
      if (thread) {
        convId = thread.id;
        db.prepare('UPDATE conversations SET updated_at = ?, last_message_at = ? WHERE id = ?').run(now, now, convId);
      } else {
        convId = generateUUIDv7();
        db.prepare(`
          INSERT INTO conversations (id, operator_id, entity_type, entity_id, subject, is_private, created_at, updated_at, last_message_at)
          VALUES (?, ?, 'work_order', ?, ?, 1, ?, ?, ?)
        `).run(convId, operatorId, workOrderId, subject, now, now, now);
      }

      const msgId = generateUUIDv7();
      db.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, operator_id, author_role, author_name, body, created_at)
        VALUES (?, ?, ?, 'system', 'Garrison System', ?, ?)
      `).run(msgId, convId, operatorId, message, now);
    } catch {}
  }

  /**
   * Create a new maintenance work order.
   * Validates that property, unit, and contact references belong to the active operator.
   * Evaluates portfolio spend thresholds and available funds to automatically place on hold if needed.
   *
   * @param data - Work order creation payload.
   * @returns Created work order with joined details.
   */
  public static createWorkOrder(data: {
    property_id: string;
    unit_id?: string;
    title: string;
    description: string;
    status?: WorkOrder['status'];
    priority?: WorkOrder['priority'];
    category?: WorkOrder['category'];
    permission_to_enter?: boolean;
    entry_instructions?: string;
    requested_by_contact_id?: string;
    vendor_contact_id?: string;
    scheduled_date?: number;
    estimated_cost_cents?: number;
    actual_cost_cents?: number;
    hold_reason?: string;
  }): WorkOrderWithDetails {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const id = generateUUIDv7();
    const now = Date.now();

    // Validate operator ownership of all supplied relation IDs
    MaintenanceRepository.validateOwnership(
      operatorId,
      data.property_id,
      data.unit_id,
      data.requested_by_contact_id,
      data.vendor_contact_id
    );

    let effectiveStatus = data.status || 'open';
    let effectiveHoldReason: string | null = data.hold_reason || null;

    // Evaluate permissible spend threshold and available portfolio funds
    const estimatedCost = data.estimated_cost_cents || 0;
    if (estimatedCost > 0) {
      const spendPolicy = MaintenanceRepository.evaluateSpendPolicy(data.property_id, estimatedCost);
      if (spendPolicy.shouldHold && effectiveStatus !== 'completed' && effectiveStatus !== 'cancelled') {
        effectiveStatus = 'on_hold';
        effectiveHoldReason = spendPolicy.reason || 'Auto-held: estimated cost exceeds threshold or available funds';
      }
    }

    const colCheck = db.prepare("PRAGMA table_info(work_orders)").all() as Array<{ name: string }>;
    const hasHoldReason = colCheck.some((c) => c.name === 'hold_reason');

    if (hasHoldReason) {
      db.prepare(`
        INSERT INTO work_orders (
          id, operator_id, property_id, unit_id, title, description,
          status, priority, category, permission_to_enter, entry_instructions,
          requested_by_contact_id, vendor_contact_id, scheduled_date,
          estimated_cost_cents, actual_cost_cents, hold_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        operatorId,
        data.property_id,
        data.unit_id || null,
        data.title,
        data.description,
        effectiveStatus,
        data.priority || 'medium',
        data.category || 'other',
        data.permission_to_enter === false ? 0 : 1,
        data.entry_instructions || null,
        data.requested_by_contact_id || null,
        data.vendor_contact_id || null,
        data.scheduled_date || null,
        estimatedCost,
        data.actual_cost_cents || 0,
        effectiveHoldReason,
        now,
        now
      );
    } else {
      db.prepare(`
        INSERT INTO work_orders (
          id, operator_id, property_id, unit_id, title, description,
          status, priority, category, permission_to_enter, entry_instructions,
          requested_by_contact_id, vendor_contact_id, scheduled_date,
          estimated_cost_cents, actual_cost_cents, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        operatorId,
        data.property_id,
        data.unit_id || null,
        data.title,
        data.description,
        effectiveStatus,
        data.priority || 'medium',
        data.category || 'other',
        data.permission_to_enter === false ? 0 : 1,
        data.entry_instructions || null,
        data.requested_by_contact_id || null,
        data.vendor_contact_id || null,
        data.scheduled_date || null,
        estimatedCost,
        data.actual_cost_cents || 0,
        now,
        now
      );
    }

    // If assigned to a primary vendor, also record in work_order_vendors junction
    if (data.vendor_contact_id) {
      try {
        MaintenanceRepository.assignWorkOrderVendor(id, data.vendor_contact_id, 'primary', 'Assigned at creation');
      } catch {}
    }

    // If auto-held, log automated notice
    if (effectiveHoldReason) {
      MaintenanceRepository.recordAutomatedNote(
        id,
        'Spend Policy Auto-Hold Notice',
        `⚠️ Work Order automatically placed ON HOLD:\n${effectiveHoldReason}`
      );
    }

    return MaintenanceRepository.getWorkOrderById(id)!;
  }

  /**
   * Update an existing work order.
   * Validates ownership of updated property, unit, or contact references.
   * Re-evaluates spend limits if estimated cost is modified.
   *
   * @param id - Work order identifier.
   * @param data - Mutable work order fields.
   * @returns Updated work order with details or null if not found.
   */
  public static updateWorkOrder(id: string, data: Partial<Omit<WorkOrder, 'id' | 'operator_id' | 'created_at' | 'updated_at' | 'deleted_at'>>): WorkOrderWithDetails | null {
    const existing = MaintenanceRepository.getWorkOrderById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const updated = { ...existing, ...data, updated_at: now };

    // Reject reopening or dispatching cancelled work orders
    if (existing.status === 'cancelled' && updated.status !== 'cancelled') {
      throw new Error(`Cannot update or dispatch cancelled work order ${id}`);
    }

    // Validate operator ownership of any modified or existing relation IDs
    MaintenanceRepository.validateOwnership(
      operatorId,
      updated.property_id,
      updated.unit_id,
      updated.requested_by_contact_id,
      updated.vendor_contact_id
    );

    // Enforce vendor eligibility during dispatch
    if (updated.status === 'assigned' && updated.vendor_contact_id) {
      const vendor = db.prepare('SELECT id, vendor_specialty, w9_received FROM contacts WHERE id = ? AND operator_id = ? AND deleted_at IS NULL').get(updated.vendor_contact_id, operatorId) as any;
      if (vendor) {
        if (!vendor.w9_received) {
          throw new Error(`Vendor ${updated.vendor_contact_id} cannot be dispatched: W-9 form is pending verification`);
        }
        if (!MaintenanceRepository.isTradeCompatible(vendor.vendor_specialty, updated.category)) {
          throw new Error(`Vendor specialty "${vendor.vendor_specialty || 'None'}" is not eligible for "${updated.category}" work orders`);
        }
      }
    }

    // Re-evaluate spend limits if estimated cost was modified or set
    if (data.estimated_cost_cents !== undefined && data.estimated_cost_cents > 0) {
      const spendPolicy = MaintenanceRepository.evaluateSpendPolicy(updated.property_id, updated.estimated_cost_cents);
      if (spendPolicy.shouldHold && updated.status !== 'completed' && updated.status !== 'cancelled') {
        updated.status = 'on_hold';
        updated.hold_reason = spendPolicy.reason || 'Estimated expense exceeds permissible spend threshold or available portfolio funds';
      }
    }

    const colCheck = db.prepare("PRAGMA table_info(work_orders)").all() as Array<{ name: string }>;
    const hasHoldReason = colCheck.some((c) => c.name === 'hold_reason');

    if (hasHoldReason) {
      db.prepare(`
        UPDATE work_orders SET
          property_id = ?, unit_id = ?, title = ?, description = ?,
          status = ?, priority = ?, category = ?, permission_to_enter = ?,
          entry_instructions = ?, requested_by_contact_id = ?, vendor_contact_id = ?,
          scheduled_date = ?, completed_date = ?, estimated_cost_cents = ?,
          actual_cost_cents = ?, hold_reason = ?, updated_at = ?
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(
        updated.property_id,
        updated.unit_id || null,
        updated.title,
        updated.description,
        updated.status,
        updated.priority,
        updated.category,
        updated.permission_to_enter,
        updated.entry_instructions || null,
        updated.requested_by_contact_id || null,
        updated.vendor_contact_id || null,
        updated.scheduled_date || null,
        updated.completed_date || null,
        updated.estimated_cost_cents,
        updated.actual_cost_cents,
        updated.hold_reason || null,
        now,
        id,
        operatorId
      );
    } else {
      db.prepare(`
        UPDATE work_orders SET
          property_id = ?, unit_id = ?, title = ?, description = ?,
          status = ?, priority = ?, category = ?, permission_to_enter = ?,
          entry_instructions = ?, requested_by_contact_id = ?, vendor_contact_id = ?,
          scheduled_date = ?, completed_date = ?, estimated_cost_cents = ?,
          actual_cost_cents = ?, updated_at = ?
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(
        updated.property_id,
        updated.unit_id || null,
        updated.title,
        updated.description,
        updated.status,
        updated.priority,
        updated.category,
        updated.permission_to_enter,
        updated.entry_instructions || null,
        updated.requested_by_contact_id || null,
        updated.vendor_contact_id || null,
        updated.scheduled_date || null,
        updated.completed_date || null,
        updated.estimated_cost_cents,
        updated.actual_cost_cents,
        now,
        id,
        operatorId
      );
    }

    // If status changed, record timeline message
    if (existing.status !== updated.status) {
      let statusMsg = `Status changed from "${existing.status}" to "${updated.status}".`;
      if (updated.status === 'on_hold' && updated.hold_reason) {
        statusMsg += `\nReason: ${updated.hold_reason}`;
      }
      MaintenanceRepository.recordAutomatedNote(id, 'Work Order Status Update', statusMsg);
    }

    return MaintenanceRepository.getWorkOrderById(id);
  }

  /**
   * List all assigned vendors/contractors for a work order.
   *
   * @param workOrderId - Target work order identifier.
   * @returns Array of assigned vendor records with contact details.
   */
  public static listWorkOrderVendors(workOrderId: string): WorkOrderVendor[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='work_order_vendors'").get();
    if (!tableCheck) return [];

    const rows = db.prepare(`
      SELECT
        wov.*,
        c.first_name || ' ' || c.last_name as vendor_name,
        c.company_name,
        c.vendor_specialty,
        c.email,
        c.phone
      FROM work_order_vendors wov
      JOIN contacts c ON wov.vendor_contact_id = c.id AND c.operator_id = wov.operator_id AND c.deleted_at IS NULL
      WHERE wov.work_order_id = ? AND wov.operator_id = ? AND wov.deleted_at IS NULL
      ORDER BY wov.assigned_at ASC
    `).all(workOrderId, operatorId) as any[];

    return rows.map((r) => ({
      id: r.id,
      operator_id: r.operator_id,
      work_order_id: r.work_order_id,
      vendor_contact_id: r.vendor_contact_id,
      vendor_name: r.vendor_name,
      company_name: r.company_name,
      vendor_specialty: r.vendor_specialty,
      email: r.email,
      phone: r.phone,
      role: r.role || 'contractor',
      notes: r.notes || null,
      assigned_at: r.assigned_at,
      created_at: r.created_at,
      deleted_at: r.deleted_at
    }));
  }

  /**
   * Assign or link a vendor/contractor to a work order.
   * Validates vendor contact type and active operator ownership.
   *
   * @param workOrderId - Target work order identifier.
   * @param vendorContactId - Contact identifier of vendor.
   * @param role - Functional role (e.g. primary, subcontractor, specialist, inspector).
   * @param notes - Operational scope notes.
   * @returns Assigned vendor junction record.
   */
  public static assignWorkOrderVendor(
    workOrderId: string,
    vendorContactId: string,
    role: string = 'contractor',
    notes?: string
  ): WorkOrderVendor {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    // Verify work order exists
    const wo = db.prepare(
      'SELECT id, category, vendor_contact_id FROM work_orders WHERE id = ? AND operator_id = ? AND deleted_at IS NULL'
    ).get(workOrderId, operatorId) as any;
    if (!wo) {
      throw new Error(`Work order ${workOrderId} not found`);
    }

    // Verify vendor contact exists and has contact_type = 'vendor'
    const vendor = db.prepare(
      'SELECT id, contact_type, vendor_specialty, w9_received, first_name, last_name, company_name, email, phone FROM contacts WHERE id = ? AND operator_id = ? AND deleted_at IS NULL'
    ).get(vendorContactId, operatorId) as any;
    if (!vendor) {
      throw new Error(`Vendor contact ${vendorContactId} not found`);
    }
    if (vendor.contact_type !== 'vendor') {
      throw new Error(`Contact ${vendorContactId} is not a vendor (contact_type: ${vendor.contact_type})`);
    }

    const id = generateUUIDv7();
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='work_order_vendors'").get();
    if (!tableCheck) {
      throw new Error('work_order_vendors table not found');
    }

    // Check if already assigned
    const existing = db.prepare(
      'SELECT id FROM work_order_vendors WHERE work_order_id = ? AND vendor_contact_id = ? AND operator_id = ? AND deleted_at IS NULL'
    ).get(workOrderId, vendorContactId, operatorId) as any;

    if (existing) {
      db.prepare(`
        UPDATE work_order_vendors SET role = ?, notes = ?, assigned_at = ? WHERE id = ?
      `).run(role, notes || null, now, existing.id);
    } else {
      db.prepare(`
        INSERT INTO work_order_vendors (id, operator_id, work_order_id, vendor_contact_id, role, notes, assigned_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, operatorId, workOrderId, vendorContactId, role, notes || null, now, now);
    }

    // If work order has no primary vendor assigned yet, also set vendor_contact_id
    if (!wo.vendor_contact_id) {
      db.prepare('UPDATE work_orders SET vendor_contact_id = ?, updated_at = ? WHERE id = ?')
        .run(vendorContactId, now, workOrderId);
    }

    // Record note in timeline
    MaintenanceRepository.recordAutomatedNote(
      workOrderId,
      'Vendor Assigned',
      `Assigned vendor ${vendor.first_name} ${vendor.last_name} (${role}) to this work order.`
    );

    return {
      id: existing ? existing.id : id,
      operator_id: operatorId,
      work_order_id: workOrderId,
      vendor_contact_id: vendorContactId,
      vendor_name: `${vendor.first_name} ${vendor.last_name}`,
      company_name: vendor.company_name,
      vendor_specialty: vendor.vendor_specialty,
      email: vendor.email,
      phone: vendor.phone,
      role,
      notes: notes || null,
      assigned_at: now,
      created_at: now
    };
  }

  /**
   * Remove a vendor/contractor assignment from a work order.
   *
   * @param workOrderId - Target work order identifier.
   * @param vendorContactId - Contact identifier of vendor to unlink.
   * @returns True if assignment removed.
   */
  public static removeWorkOrderVendor(workOrderId: string, vendorContactId: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='work_order_vendors'").get();
    if (!tableCheck) return false;

    db.prepare(`
      UPDATE work_order_vendors SET deleted_at = ?
      WHERE work_order_id = ? AND vendor_contact_id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, workOrderId, vendorContactId, operatorId);

    // If this was the primary vendor on work_orders, set to null or next assigned vendor
    const wo = db.prepare('SELECT vendor_contact_id FROM work_orders WHERE id = ? AND operator_id = ?').get(workOrderId, operatorId) as any;
    if (wo && wo.vendor_contact_id === vendorContactId) {
      const nextVendor = db.prepare(`
        SELECT vendor_contact_id FROM work_order_vendors
        WHERE work_order_id = ? AND operator_id = ? AND deleted_at IS NULL
        LIMIT 1
      `).get(workOrderId, operatorId) as any;
      db.prepare('UPDATE work_orders SET vendor_contact_id = ?, updated_at = ? WHERE id = ?')
        .run(nextVendor ? nextVendor.vendor_contact_id : null, now, workOrderId);
    }

    MaintenanceRepository.recordAutomatedNote(
      workOrderId,
      'Vendor Removed',
      `Removed vendor assignment for contact ID ${vendorContactId}.`
    );

    return true;
  }

  /**
   * Mark a work order as completed and record its final actual cost.
   *
   * @param id - Work order identifier.
   * @param actualCostCents - Final cost in integer cents.
   * @returns Updated work order or null if not found.
   */
  public static completeWorkOrder(id: string, actualCostCents?: number): WorkOrderWithDetails | null {
    const existing = MaintenanceRepository.getWorkOrderById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const finalCost = actualCostCents !== undefined ? actualCostCents : existing.actual_cost_cents;

    db.prepare(`
      UPDATE work_orders SET
        status = 'completed',
        completed_date = ?,
        actual_cost_cents = ?,
        updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, finalCost, now, id, operatorId);

    return MaintenanceRepository.getWorkOrderById(id);
  }

  /**
   * Soft-delete a work order.
   *
   * @param id - Work order identifier.
   * @returns True if deleted, false if not found.
   */
  public static deleteWorkOrder(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const info = db.prepare(`
      UPDATE work_orders SET deleted_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, id, operatorId);
    return info.changes > 0;
  }

  /**
   * Retrieve itemized bills linked to a work order along with budget vs actual calculations.
   *
   * @param workOrderId - Unique identifier of the work order.
   * @returns Budget rollup and list of linked vendor bills.
   */
  public static getWorkOrderExpenses(workOrderId: string): WorkOrderExpensesResult {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const workOrder = MaintenanceRepository.getWorkOrderById(workOrderId);
    if (!workOrder) {
      throw new Error(`Work order ${workOrderId} not found or access denied`);
    }

    const bills = db.prepare(`
      SELECT
        b.id,
        b.vendor_id,
        b.invoice_number,
        b.invoice_date,
        b.due_date,
        b.total_amount_cents,
        b.amount_paid_cents,
        b.status,
        b.created_at,
        v.first_name || ' ' || v.last_name as vendor_name,
        v.company_name as vendor_company
      FROM bills b
      JOIN contacts v ON b.vendor_id = v.id AND v.deleted_at IS NULL
      WHERE b.work_order_id = ? AND b.operator_id = ? AND b.deleted_at IS NULL
      ORDER BY b.invoice_date DESC, b.created_at DESC
    `).all(workOrderId, operatorId) as any[];

    let totalInvoicedCents = 0;
    let totalPaidCents = 0;
    for (const b of bills) {
      totalInvoicedCents += Number(b.total_amount_cents) || 0;
      totalPaidCents += Number(b.amount_paid_cents) || 0;
    }

    const estimatedCents = workOrder.estimated_cost_cents || 0;
    const varianceCents = estimatedCents - totalInvoicedCents;
    const isOverBudget = estimatedCents > 0 && totalInvoicedCents > estimatedCents;
    const percentUtilized = estimatedCents > 0 ? Math.round((totalInvoicedCents / estimatedCents) * 100) : 0;

    return {
      budget: {
        estimated_cost_cents: estimatedCents,
        actual_cost_cents: workOrder.actual_cost_cents || totalInvoicedCents,
        total_invoiced_cents: totalInvoicedCents,
        total_paid_cents: totalPaidCents,
        remaining_variance_cents: varianceCents,
        is_over_budget: isOverBudget,
        percent_utilized: percentUtilized
      },
      bills: bills.map((b) => ({
        id: b.id,
        vendor_id: b.vendor_id,
        vendor_name: b.vendor_name?.trim() || 'Unknown Vendor',
        vendor_company: b.vendor_company || null,
        invoice_number: b.invoice_number,
        invoice_date: b.invoice_date,
        due_date: b.due_date,
        total_amount_cents: b.total_amount_cents,
        amount_paid_cents: b.amount_paid_cents,
        status: b.status,
        created_at: b.created_at
      }))
    };
  }

  /**
   * Retrieve structured data needed to generate a field technician dispatch sheet PDF.
   *
   * @param workOrderId - Unique identifier of the work order.
   * @returns Dispatch PDF data contract or null if work order not found.
   */
  public static getWorkOrderDispatchData(workOrderId: string): WorkOrderDispatchPdfData | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT
        w.*,
        p.name as property_name,
        p.address_line1,
        p.address_line2,
        p.city,
        p.state,
        p.postal_code,
        u.unit_number,
        r.first_name || ' ' || r.last_name as requester_name,
        r.phone as requester_phone,
        r.email as requester_email,
        v.first_name || ' ' || v.last_name as vendor_name,
        v.company_name as vendor_company,
        v.phone as vendor_phone,
        v.vendor_specialty,
        o.name as operator_name
      FROM work_orders w
      JOIN properties p ON w.property_id = p.id AND p.operator_id = w.operator_id AND p.deleted_at IS NULL
      JOIN operators o ON w.operator_id = o.id AND o.deleted_at IS NULL
      LEFT JOIN units u ON w.unit_id = u.id AND u.operator_id = w.operator_id AND u.deleted_at IS NULL
      LEFT JOIN contacts r ON w.requested_by_contact_id = r.id AND r.operator_id = w.operator_id AND r.deleted_at IS NULL
      LEFT JOIN contacts v ON w.vendor_contact_id = v.id AND v.operator_id = w.operator_id AND v.deleted_at IS NULL
      WHERE w.id = ? AND w.operator_id = ? AND w.deleted_at IS NULL
    `).get(workOrderId, operatorId) as any;

    if (!row) return null;

    const fullAddress = [
      row.address_line1,
      row.address_line2,
      `${row.city}, ${row.state} ${row.postal_code}`
    ].filter(Boolean).join(' ');

    const ticketNumber = `WO-${row.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const scheduledDateStr = row.scheduled_date
      ? new Date(row.scheduled_date).toISOString().slice(0, 10)
      : null;

    const createdDateStr = row.created_at
      ? new Date(row.created_at).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    return {
      work_order_id: row.id,
      ticket_number: ticketNumber,
      title: row.title,
      description: row.description,
      category: row.category,
      priority: row.priority,
      status: row.status,
      property_name: row.property_name,
      property_address: fullAddress,
      unit_number: row.unit_number || null,
      permission_to_enter: row.permission_to_enter === 1,
      entry_instructions: row.entry_instructions || null,
      requester_name: row.requester_name?.trim() || null,
      requester_phone: row.requester_phone || null,
      requester_email: row.requester_email || null,
      vendor_name: row.vendor_name?.trim() || null,
      vendor_company: row.vendor_company || null,
      vendor_phone: row.vendor_phone || null,
      vendor_specialty: row.vendor_specialty || null,
      scheduled_date: scheduledDateStr,
      created_date: createdDateStr,
      estimated_cost_cents: row.estimated_cost_cents,
      actual_cost_cents: row.actual_cost_cents,
      operator_name: row.operator_name || 'Garrison Property Management',
      assigned_vendors: MaintenanceRepository.listWorkOrderVendors(workOrderId).map((v) => ({
        name: v.vendor_name || 'Vendor',
        company: v.company_name || null,
        role: v.role,
        phone: v.phone || null
      }))
    };
  }

  /**
   * Compute aggregated metrics for dashboard presentation.
   *
   * @returns Counts of open, emergency, in-progress, and recently completed work orders.
   */
  public static getMaintenanceMetrics(filter?: { property_id?: string; portfolio?: string }): {
    openWorkOrders: number;
    openOrders: number;
    emergencyWorkOrders: number;
    inProgressWorkOrders: number;
    completedLast30Days: number;
    completedThisMonth: number;
    avgResolutionTimeHours: number;
  } {
    const orders = MaintenanceRepository.listWorkOrders(filter);
    const openOrders = orders.filter((o) => ['open', 'assigned', 'in_progress', 'on_hold'].includes(o.status));
    const emergencyOrders = openOrders.filter((o) => o.priority === 'emergency');
    const inProgressOrders = openOrders.filter((o) => o.status === 'in_progress');

    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const completedLast30Days = orders.filter((o) => o.status === 'completed' && (o.completed_date || 0) >= thirtyDaysAgo);

    return {
      openWorkOrders: openOrders.length,
      openOrders: openOrders.length,
      emergencyWorkOrders: emergencyOrders.length,
      inProgressWorkOrders: inProgressOrders.length,
      completedLast30Days: completedLast30Days.length,
      completedThisMonth: completedLast30Days.length,
      avgResolutionTimeHours: 24
    };
  }

  /**
   * Helper to advance next due date based on schedule recurrence frequency.
   * Clamps day-of-month rollover to prevent unintended month drift.
   *
   * @param currentDueDate - Current scheduled millisecond timestamp.
   * @param frequency - Recurrence cadence string.
   * @param seasonalMonth - Optional target month (1-12) for seasonal recurring tasks.
   * @returns Next scheduled millisecond timestamp.
   */
  public static computeNextDueDate(
    currentDueDate: number,
    frequency: PreventativeScheduleFrequency,
    seasonalMonth?: number | null
  ): number {
    const d = new Date(currentDueDate);
    switch (frequency) {
      case 'weekly':
        return currentDueDate + 7 * 86400000;
      case 'monthly':
      case 'quarterly':
      case 'semi_annually': {
        const add = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 6;
        const day = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + add);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, lastDay));
        return d.getTime();
      }
      case 'annually': {
        const day = d.getDate();
        d.setDate(1);
        d.setFullYear(d.getFullYear() + 1);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, lastDay));
        return d.getTime();
      }
      case 'seasonal': {
        const targetMonth = (seasonalMonth && seasonalMonth >= 1 && seasonalMonth <= 12) ? seasonalMonth - 1 : d.getMonth();
        let targetYear = d.getFullYear();
        if (targetMonth <= d.getMonth()) {
          targetYear += 1;
        }
        const day = d.getDate();
        const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
        const nextDate = new Date(d.getTime());
        nextDate.setFullYear(targetYear, targetMonth, Math.min(day, lastDay));
        return nextDate.getTime();
      }
      default:
        return currentDueDate + 30 * 86400000;
    }
  }

  /**
   * Create a new recurring preventative maintenance schedule.
   *
   * @param input - Preventative schedule configuration.
   * @returns Created PreventativeSchedule entity.
   */
  public static createPreventativeSchedule(
    input: CreatePreventativeScheduleInput
  ): PreventativeSchedule {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const id = generateUUIDv7();

    if (!input.property_id || typeof input.property_id !== 'string' || input.property_id.trim().length === 0) {
      throw new Error('Field "property_id" is required for preventative maintenance schedules.');
    }

    MaintenanceRepository.validateOwnership(
      operatorId,
      input.property_id.trim(),
      input.unit_id,
      null,
      input.assigned_vendor_contact_id,
      input.building_id
    );

    db.prepare(`
      INSERT INTO preventative_maintenance_schedules (
        id, operator_id, property_id, building_id, unit_id, title, description,
        category, priority, frequency, seasonal_month, lead_days,
        assigned_vendor_contact_id, estimated_cost_cents, last_generated_at,
        next_due_date, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)
    `).run(
      id,
      operatorId,
      input.property_id || null,
      input.building_id || null,
      input.unit_id || null,
      input.title.trim(),
      input.description.trim(),
      input.category,
      input.priority,
      input.frequency,
      input.seasonal_month || null,
      input.lead_days !== undefined ? input.lead_days : 7,
      input.assigned_vendor_contact_id || null,
      input.estimated_cost_cents || 0,
      input.next_due_date,
      now,
      now
    );

    const schedule = MaintenanceRepository.getPreventativeSchedule(id);
    if (!schedule) {
      throw new Error('Failed to retrieve newly created preventative schedule');
    }
    return schedule;
  }

  /**
   * Retrieve a preventative maintenance schedule by ID.
   *
   * @param id - Preventative schedule UUIDv7.
   * @returns PreventativeSchedule entity or null.
   */
  public static getPreventativeSchedule(id: string): PreventativeSchedule | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT s.*,
             p.name as property_name,
             COALESCE(c.first_name || ' ' || c.last_name, c.company_name) as vendor_name
      FROM preventative_maintenance_schedules s
      LEFT JOIN properties p ON p.id = s.property_id AND p.operator_id = s.operator_id AND p.deleted_at IS NULL
      LEFT JOIN contacts c ON c.id = s.assigned_vendor_contact_id AND c.operator_id = s.operator_id AND c.deleted_at IS NULL
      WHERE s.operator_id = ? AND s.id = ? AND s.deleted_at IS NULL
    `).get(operatorId, id) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      operator_id: row.operator_id,
      property_id: row.property_id,
      building_id: row.building_id,
      unit_id: row.unit_id,
      title: row.title,
      description: row.description,
      category: row.category,
      priority: row.priority,
      frequency: row.frequency,
      seasonal_month: row.seasonal_month,
      lead_days: Number(row.lead_days),
      assigned_vendor_contact_id: row.assigned_vendor_contact_id,
      estimated_cost_cents: Number(row.estimated_cost_cents),
      last_generated_at: row.last_generated_at ? Number(row.last_generated_at) : null,
      next_due_date: Number(row.next_due_date),
      is_active: Number(row.is_active),
      created_at: Number(row.created_at),
      updated_at: Number(row.updated_at),
      deleted_at: row.deleted_at ? Number(row.deleted_at) : null,
      property_name: row.property_name,
      vendor_name: row.vendor_name
    };
  }

  /**
   * List preventative maintenance schedules matching optional filter criteria.
   *
   * @param filter - Search filter options.
   * @returns Array of PreventativeSchedule entities.
   */
  public static listPreventativeSchedules(
    filter: ListPreventativeSchedulesFilter = {}
  ): PreventativeSchedule[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const conditions: string[] = ['s.operator_id = ?', 's.deleted_at IS NULL'];
    const params: any[] = [operatorId];

    if (filter.property_id) {
      conditions.push('s.property_id = ?');
      params.push(filter.property_id);
    }

    if (filter.category) {
      conditions.push('s.category = ?');
      params.push(filter.category);
    }

    if (filter.is_active !== undefined) {
      conditions.push('s.is_active = ?');
      params.push(filter.is_active ? 1 : 0);
    }

    if (filter.due_before !== undefined) {
      conditions.push('s.next_due_date <= ?');
      params.push(filter.due_before);
    }

    const whereClause = conditions.join(' AND ');
    const rows = db.prepare(`
      SELECT s.*,
             p.name as property_name,
             COALESCE(c.first_name || ' ' || c.last_name, c.company_name) as vendor_name
      FROM preventative_maintenance_schedules s
      LEFT JOIN properties p ON p.id = s.property_id AND p.operator_id = s.operator_id AND p.deleted_at IS NULL
      LEFT JOIN contacts c ON c.id = s.assigned_vendor_contact_id AND c.operator_id = s.operator_id AND c.deleted_at IS NULL
      WHERE ${whereClause}
      ORDER BY s.next_due_date ASC
    `).all(...params) as any[];

    return rows.map((row) => ({
      id: row.id,
      operator_id: row.operator_id,
      property_id: row.property_id,
      building_id: row.building_id,
      unit_id: row.unit_id,
      title: row.title,
      description: row.description,
      category: row.category,
      priority: row.priority,
      frequency: row.frequency,
      seasonal_month: row.seasonal_month,
      lead_days: Number(row.lead_days),
      assigned_vendor_contact_id: row.assigned_vendor_contact_id,
      estimated_cost_cents: Number(row.estimated_cost_cents),
      last_generated_at: row.last_generated_at ? Number(row.last_generated_at) : null,
      next_due_date: Number(row.next_due_date),
      is_active: Number(row.is_active),
      created_at: Number(row.created_at),
      updated_at: Number(row.updated_at),
      deleted_at: row.deleted_at ? Number(row.deleted_at) : null,
      property_name: row.property_name,
      vendor_name: row.vendor_name
    }));
  }

  /**
   * Update an existing preventative maintenance schedule.
   *
   * @param id - Preventative schedule UUIDv7.
   * @param input - Fields to update.
   * @returns Updated PreventativeSchedule entity.
   */
  public static updatePreventativeSchedule(
    id: string,
    input: UpdatePreventativeScheduleInput
  ): PreventativeSchedule {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const existing = MaintenanceRepository.getPreventativeSchedule(id);
    if (!existing) {
      throw new Error(`Preventative schedule #${id} not found`);
    }

    const effPropId = input.property_id !== undefined ? (input.property_id || undefined) : (existing.property_id || undefined);
    const effUnitId = input.unit_id !== undefined ? input.unit_id : existing.unit_id;
    const effBldId = input.building_id !== undefined ? input.building_id : existing.building_id;
    const effVendorId = input.assigned_vendor_contact_id !== undefined ? input.assigned_vendor_contact_id : existing.assigned_vendor_contact_id;

    MaintenanceRepository.validateOwnership(operatorId, effPropId, effUnitId, null, effVendorId, effBldId);

    const updates: string[] = [];
    const params: any[] = [];

    if (input.property_id !== undefined) {
      if (!input.property_id || typeof input.property_id !== 'string' || input.property_id.trim().length === 0) {
        throw new Error('Field "property_id" cannot be cleared for preventative maintenance schedules.');
      }
      updates.push('property_id = ?');
      params.push(input.property_id.trim());
    }
    if (input.building_id !== undefined) {
      updates.push('building_id = ?');
      params.push(input.building_id || null);
    }
    if (input.unit_id !== undefined) {
      updates.push('unit_id = ?');
      params.push(input.unit_id || null);
    }

    if (input.title !== undefined) {
      updates.push('title = ?');
      params.push(input.title.trim());
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      params.push(input.description.trim());
    }
    if (input.category !== undefined) {
      updates.push('category = ?');
      params.push(input.category);
    }
    if (input.priority !== undefined) {
      updates.push('priority = ?');
      params.push(input.priority);
    }
    if (input.frequency !== undefined) {
      updates.push('frequency = ?');
      params.push(input.frequency);
    }
    if (input.seasonal_month !== undefined) {
      updates.push('seasonal_month = ?');
      params.push(input.seasonal_month);
    }
    if (input.lead_days !== undefined) {
      updates.push('lead_days = ?');
      params.push(input.lead_days);
    }
    if (input.assigned_vendor_contact_id !== undefined) {
      updates.push('assigned_vendor_contact_id = ?');
      params.push(input.assigned_vendor_contact_id);
    }
    if (input.estimated_cost_cents !== undefined) {
      updates.push('estimated_cost_cents = ?');
      params.push(input.estimated_cost_cents);
    }
    if (input.next_due_date !== undefined) {
      updates.push('next_due_date = ?');
      params.push(input.next_due_date);
    }
    if (input.is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(input.is_active ? 1 : 0);
    }

    updates.push('updated_at = ?');
    params.push(Date.now());

    params.push(id, operatorId);
    db.prepare(`
      UPDATE preventative_maintenance_schedules
      SET ${updates.join(', ')}
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(...params);

    const updated = MaintenanceRepository.getPreventativeSchedule(id);
    if (!updated) {
      throw new Error(`Failed to retrieve updated preventative schedule #${id}`);
    }
    return updated;
  }

  /**
   * Soft-delete a preventative maintenance schedule.
   *
   * @param id - Preventative schedule UUIDv7.
   * @returns True if deleted, false if not found.
   */
  public static deletePreventativeSchedule(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const info = db.prepare(`
      UPDATE preventative_maintenance_schedules SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, now, id, operatorId);
    return info.changes > 0;
  }

  /**
   * Trigger immediate generation of a work order from a preventative maintenance schedule,
   * advancing the next due date by the recurrence interval.
   *
   * @param id - Preventative schedule UUIDv7.
   * @returns Generated WorkOrder entity.
   */
  public static triggerPreventativeSchedule(id: string): WorkOrder {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const schedule = MaintenanceRepository.getPreventativeSchedule(id);
    if (!schedule) {
      throw new Error(`Preventative schedule #${id} not found`);
    }

    const now = Date.now();
    const nextDue = MaintenanceRepository.computeNextDueDate(schedule.next_due_date, schedule.frequency, schedule.seasonal_month);

    // Map schedule category to valid work_orders category
    let workOrderCategory: any = schedule.category;
    const allowedCategories = ['plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'cosmetic', 'pest', 'other'];
    if (!allowedCategories.includes(workOrderCategory)) {
      workOrderCategory = 'other';
    }

    const propertyId = schedule.property_id;
    if (!propertyId) {
      throw new Error('Cannot generate work order: schedule has no property_id');
    }

    let workOrder: WorkOrder;
    withTransaction((tx) => {
      // 1. Create work order
      const workOrderId = generateUUIDv7();
      tx.prepare(`
        INSERT INTO work_orders (
          id, operator_id, property_id, unit_id, title, description, status,
          priority, category, permission_to_enter, vendor_contact_id,
          scheduled_date, estimated_cost_cents, actual_cost_cents,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, 1, ?, ?, ?, 0, ?, ?)
      `).run(
        workOrderId,
        operatorId,
        propertyId ?? null,
        schedule.unit_id ? schedule.unit_id : null,
        `[PM] ${schedule.title}`,
        `Preventative Maintenance (${schedule.frequency}): ${schedule.description}`,
        schedule.priority,
        workOrderCategory,
        schedule.assigned_vendor_contact_id ? schedule.assigned_vendor_contact_id : null,
        schedule.next_due_date,
        schedule.estimated_cost_cents || 0,
        now,
        now
      );

      // 2. Advance schedule next_due_date and set last_generated_at
      tx.prepare(`
        UPDATE preventative_maintenance_schedules
        SET next_due_date = ?, last_generated_at = ?, updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(nextDue, now, now, id, operatorId);

      const created = MaintenanceRepository.getWorkOrderById(workOrderId);
      if (!created) {
        throw new Error('Failed to retrieve newly generated work order');
      }
      workOrder = created;
    }, db);

    try {
      eventBus.publish('preventative_maintenance.due', {
        operatorId,
        scheduleId: schedule.id,
        workOrderId: workOrder!.id,
        title: schedule.title
      });

      eventBus.publish('work_order.created', {
        operatorId,
        workOrderId: workOrder!.id,
        title: workOrder!.title,
        priority: workOrder!.priority
      });
    } catch {
      // Non-blocking event emission
    }

    return workOrder!;
  }

  /**
   * Run batch check across active preventative schedules for due maintenance tasks.
   *
   * @returns Array of generated WorkOrder entities.
   */
  public static runPreventativeMaintenanceCheck(): WorkOrder[] {
    const operatorId = RequestContext.getOperatorId();
    const now = Date.now();
    const db = getDatabase();

    // Query active schedules where next_due_date - (lead_days * 86400000) <= now
    const rows = db.prepare(`
      SELECT id, lead_days, next_due_date
      FROM preventative_maintenance_schedules
      WHERE operator_id = ? AND is_active = 1 AND deleted_at IS NULL
    `).all(operatorId) as any[];

    const generatedOrders: WorkOrder[] = [];
    for (const r of rows) {
      const threshold = Number(r.next_due_date) - (Number(r.lead_days) * 86400000);
      if (threshold <= now) {
        try {
          const wo = MaintenanceRepository.triggerPreventativeSchedule(r.id);
          generatedOrders.push(wo);
        } catch (err) {
          process.stderr.write(`[PreventativeMaintenance] Error generating work order for schedule ${r.id}: ${String(err)}\n`);
        }
      }
    }

    return generatedOrders;
  }
}


