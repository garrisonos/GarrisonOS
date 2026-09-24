import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { eventBus } from '../../../core/events.js';

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
    unit_id?: string;
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

    if (filter?.status) {
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
    if (filter?.unit_id) {
      sql += ' AND w.unit_id = ?';
      params.push(filter.unit_id);
    }

    sql += " ORDER BY CASE w.priority WHEN 'emergency' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, w.created_at DESC";

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
    return {
      ...row,
      tenant_id: row.operator_id
    };
  }

  /**
   * Create a new maintenance work order.
   * Validates that property, unit, and contact references belong to the active operator.
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
      data.status || 'open',
      data.priority || 'medium',
      data.category || 'other',
      data.permission_to_enter === false ? 0 : 1,
      data.entry_instructions || null,
      data.requested_by_contact_id || null,
      data.vendor_contact_id || null,
      data.scheduled_date || null,
      data.estimated_cost_cents || 0,
      data.actual_cost_cents || 0,
      now,
      now
    );

    return MaintenanceRepository.getWorkOrderById(id)!;
  }

  /**
   * Update an existing work order.
   * Validates ownership of updated property, unit, or contact references.
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

    return MaintenanceRepository.getWorkOrderById(id);
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
   * Compute aggregated metrics for dashboard presentation.
   *
   * @returns Counts of open, emergency, in-progress, and recently completed work orders.
   */
  public static getMaintenanceMetrics(): {
    openWorkOrders: number;
    emergencyWorkOrders: number;
    inProgressWorkOrders: number;
    completedLast30Days: number;
  } {
    const orders = MaintenanceRepository.listWorkOrders();
    const openOrders = orders.filter((o) => ['open', 'assigned', 'in_progress', 'on_hold'].includes(o.status));
    const emergencyOrders = openOrders.filter((o) => o.priority === 'emergency');
    const inProgressOrders = openOrders.filter((o) => o.status === 'in_progress');

    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const completedLast30Days = orders.filter((o) => o.status === 'completed' && (o.completed_date || 0) >= thirtyDaysAgo);

    return {
      openWorkOrders: openOrders.length,
      emergencyWorkOrders: emergencyOrders.length,
      inProgressWorkOrders: inProgressOrders.length,
      completedLast30Days: completedLast30Days.length
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


