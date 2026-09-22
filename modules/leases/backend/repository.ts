import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { eventBus } from '../../../core/events.js';

/**
 * Itemized recurring charge attached to a lease contract.
 */
export interface RecurringLeaseCharge {
  /** Unique recurring charge identifier (UUIDv7). */
  id: string;
  /** Primary operator isolation identifier. */
  operator_id: string;
  /** Identifier of the parent lease. */
  lease_id: string;
  /** Functional category of recurring charge. */
  charge_category: 'base_rent' | 'pet_rent' | 'parking_fee' | 'storage_fee' | 'utility_surcharge' | 'amenity_fee';
  /** Periodic charge amount in integer cents. */
  amount_cents: number;
  /** General ledger chart of accounts identifier. */
  gl_account_id: string;
  /** Frequency of charge generation. */
  billing_frequency: 'monthly' | 'quarterly' | 'annually' | 'one_time';
  /** Calendar day of month for billing (1-31). */
  billing_day: number;
  /** Human-readable charge line description. */
  description: string;
  /** Creation timestamp in epoch milliseconds. */
  created_at: number;
  /** Soft-deletion timestamp in epoch milliseconds. */
  deleted_at?: number | null;
}

/**
 * Configurable late fee policy rule.
 */
export interface LateFeePolicy {
  /** Unique policy identifier (UUIDv7). */
  id: string;
  /** Primary operator isolation identifier. */
  operator_id: string;
  /** Optional portfolio scoping identifier. */
  portfolio_id?: string | null;
  /** Optional property scoping identifier. */
  property_id?: string | null;
  /** Grace period in days before fee accrues. */
  grace_period_days: number;
  /** Calendar due day of month. */
  due_day: number;
  /** Mathematical fee calculation formula. */
  calculation_type: 'flat_fee' | 'percentage_of_delinquency' | 'daily_accrual';
  /** Fixed fee amount in integer cents. */
  flat_fee_cents?: number | null;
  /** Percentage of outstanding balance in basis points (100 bps = 1%). */
  percentage_bps?: number | null;
  /** Minimum delinquent balance threshold in cents to trigger policy. */
  delinquency_threshold_cents: number;
  /** Maximum allowable late fee in integer cents. */
  statutory_cap_cents?: number | null;
  /** Creation timestamp in epoch milliseconds. */
  created_at: number;
  /** Soft-deletion timestamp in epoch milliseconds. */
  deleted_at?: number | null;
}

/**
 * Concession or credit applied against a lease balance.
 */
export interface LeaseCreditConcession {
  /** Unique credit record identifier (UUIDv7). */
  id: string;
  /** Primary operator isolation identifier. */
  operator_id: string;
  /** Identifier of the recipient lease. */
  lease_id: string;
  /** Functional category of credit. */
  credit_type: 'promotional_concession' | 'maintenance_inconvenience' | 'discretionary_credit' | 'bad_debt_writeoff';
  /** Credit amount in integer cents. */
  amount_cents: number;
  /** General ledger offset account identifier. */
  gl_account_id: string;
  /** Business rationale for the credit. */
  reason: string;
  /** Effective date timestamp in epoch milliseconds. */
  effective_date: number;
  /** Creation timestamp in epoch milliseconds. */
  created_at: number;
  /** Soft-deletion timestamp in epoch milliseconds. */
  deleted_at?: number | null;
}

/**
 * Security deposit disposition or overpayment return record.
 */
export interface SecurityDepositRefund {
  /** Unique refund record identifier (UUIDv7). */
  id: string;
  /** Primary operator isolation identifier. */
  operator_id: string;
  /** Associated lease agreement identifier. */
  lease_id: string;
  /** Recipient contact identifier. */
  recipient_contact_id: string;
  /** Type of refund disbursement. */
  refund_type: 'deposit_disposition' | 'overpayment_return';
  /** Refund disbursement amount in integer cents. */
  refund_amount_cents: number;
  /** General ledger funding account identifier (typically 1020 Trust Bank). */
  funding_account_id: string;
  /** Method of disbursement. */
  disbursement_method: 'check' | 'ach';
  /** Optional check number or payment reference. */
  check_number?: string | null;
  /** Date of disbursement in epoch milliseconds. */
  disbursement_date: number;
  /** Creation timestamp in epoch milliseconds. */
  created_at: number;
  /** Soft-deletion timestamp in epoch milliseconds. */
  deleted_at?: number | null;
}

/**
 * Contractual lease agreement entity.
 */
export interface Lease {
  /** Unique lease identifier (UUIDv7). */
  id: string;
  /** Primary operator isolation identifier. */
  operator_id: string;
  /** Legacy tenant isolation identifier (backward-compatibility alias). */
  tenant_id?: string;
  /** Identifier of the leased unit. */
  unit_id: string;
  /** Current state of the lease contract lifecycle. */
  status: 'draft' | 'active' | 'expiring' | 'renewed' | 'terminated' | 'month_to_month';
  /** Lease commencement timestamp in epoch milliseconds. */
  start_date: number;
  /** Lease termination timestamp in epoch milliseconds. */
  end_date: number;
  /** Monthly recurring rent amount in integer cents. */
  rent_amount_cents: number;
  /** Required security deposit in integer cents. */
  security_deposit_cents: number;
  /** Security deposit amount currently held in escrow. */
  deposit_held_cents: number;
  /** Day of the month rent is due (1-28). */
  rent_due_day: number;
  /** Grace period in days before late fee accrues. */
  late_fee_grace_days: number;
  /** Fixed late fee amount in integer cents. */
  late_fee_amount_cents: number;
  /** Formal notice date of move-out/termination in epoch milliseconds. */
  notice_date?: number | null;
  /** Scheduled or actual move-out date in epoch milliseconds. */
  move_out_date?: number | null;
  /** Created timestamp in epoch milliseconds. */
  created_at: number;
  /** Updated timestamp in epoch milliseconds. */
  updated_at: number;
  /** Soft-deletion timestamp in epoch milliseconds, or null if active. */
  deleted_at?: number | null;
}

/**
 * Junction entity associating contacts with leases as signatories or occupants.
 */
export interface LeaseContact {
  /** Unique junction record identifier (UUIDv7). */
  id: string;
  /** Primary operator isolation identifier. */
  operator_id: string;
  /** Legacy tenant isolation identifier (backward-compatibility alias). */
  tenant_id?: string;
  /** Identifier of the associated lease contract. */
  lease_id: string;
  /** Identifier of the associated contact. */
  contact_id: string;
  /** Role of the contact on the lease. */
  role: 'primary_tenant' | 'co_tenant' | 'guarantor' | 'occupant';
  /** 1 if financially responsible for lease obligations, 0 otherwise. */
  is_financially_responsible: number;
  /** Creation timestamp in epoch milliseconds. */
  created_at: number;
  /** Soft-deletion timestamp in epoch milliseconds, or null if active. */
  deleted_at?: number | null;
  /** Contact first name from joined contact record. */
  first_name?: string;
  /** Contact last name from joined contact record. */
  last_name?: string;
  /** Contact email from joined contact record. */
  email?: string;
  /** Contact phone from joined contact record. */
  phone?: string;
}

/**
 * Lease entity enriched with joined unit, property, and signatory contact details.
 */
export interface LeaseWithDetails extends Lease {
  /** Assigned unit number. */
  unit_number?: string;
  /** Name of the property containing the unit. */
  property_name?: string;
  /** Identifier of the containing property. */
  property_id?: string;
  /** Array of associated signatories and occupants. */
  contacts?: LeaseContact[];
}

/**
 * Data access and query repository for lease contracts and signatories.
 */
export class LeasesRepository {
  /**
   * List all leases for the active operator, optionally filtered by status or unit.
   *
   * @param filter - Optional criteria for lease status or unit ID.
   * @returns Array of leases with joined property/unit details.
   */
  public static listLeases(filter?: { status?: string; unit_id?: string }): LeaseWithDetails[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    let sql = `
      SELECT
        l.*,
        u.unit_number,
        p.name as property_name,
        p.id as property_id
      FROM leases l
      LEFT JOIN units u ON l.unit_id = u.id AND u.deleted_at IS NULL
      LEFT JOIN properties p ON u.property_id = p.id AND p.deleted_at IS NULL
      WHERE l.operator_id = ? AND l.deleted_at IS NULL
    `;
    const params: any[] = [operatorId];

    if (filter?.status) {
      sql += ' AND l.status = ?';
      params.push(filter.status);
    }
    if (filter?.unit_id) {
      sql += ' AND l.unit_id = ?';
      params.push(filter.unit_id);
    }

    sql += ' ORDER BY l.start_date DESC';
    const rows = db.prepare(sql).all(...params) as unknown as LeaseWithDetails[];
    return rows.map((row) => ({
      ...row,
      tenant_id: row.operator_id
    }));
  }

  /**
   * Retrieve a lease by identifier along with its associated contacts.
   *
   * @param id - Lease identifier.
   * @returns Detailed lease record or null if not found.
   */
  public static getLeaseById(id: string): LeaseWithDetails | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const lease = db.prepare(`
      SELECT
        l.*,
        u.unit_number,
        p.name as property_name,
        p.id as property_id
      FROM leases l
      LEFT JOIN units u ON l.unit_id = u.id AND u.deleted_at IS NULL
      LEFT JOIN properties p ON u.property_id = p.id AND p.deleted_at IS NULL
      WHERE l.id = ? AND l.operator_id = ? AND l.deleted_at IS NULL
    `).get(id, operatorId) as LeaseWithDetails | undefined;

    if (!lease) return null;

    lease.tenant_id = lease.operator_id;

    const contacts = db.prepare(`
      SELECT
        lc.*,
        c.first_name,
        c.last_name,
        c.email,
        c.phone
      FROM lease_contacts lc
      JOIN contacts c ON lc.contact_id = c.id AND c.deleted_at IS NULL
      WHERE lc.lease_id = ? AND lc.operator_id = ? AND lc.deleted_at IS NULL
      ORDER BY lc.role ASC
    `).all(id, operatorId) as unknown as LeaseContact[];

    lease.contacts = contacts.map((c) => ({
      ...c,
      tenant_id: c.operator_id
    }));
    return lease;
  }

  /**
   * Create a new lease agreement and optionally register signatories.
   *
   * @param data - Lease terms and optional signatory contacts.
   * @returns Newly created lease with joined details.
   */
  public static createLease(data: {
    unit_id: string;
    status?: Lease['status'];
    start_date: number;
    end_date: number;
    rent_amount_cents: number;
    security_deposit_cents?: number;
    deposit_held_cents?: number;
    rent_due_day?: number;
    late_fee_grace_days?: number;
    late_fee_amount_cents?: number;
    contacts?: Array<{ contact_id: string; role: LeaseContact['role']; is_financially_responsible?: boolean }>;
  }): LeaseWithDetails {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const leaseId = generateUUIDv7();
    const now = Date.now();

    return withTransaction((tx) => {
      tx.prepare(`
        INSERT INTO leases (
          id, operator_id, unit_id, status, start_date, end_date,
          rent_amount_cents, security_deposit_cents, deposit_held_cents,
          rent_due_day, late_fee_grace_days, late_fee_amount_cents,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        leaseId,
        operatorId,
        data.unit_id,
        data.status || 'draft',
        data.start_date,
        data.end_date,
        data.rent_amount_cents,
        data.security_deposit_cents || 0,
        data.deposit_held_cents || 0,
        data.rent_due_day ?? 1,
        data.late_fee_grace_days ?? 5,
        data.late_fee_amount_cents ?? 0,
        now,
        now
      );

      if (data.contacts && Array.isArray(data.contacts)) {
        for (const c of data.contacts) {
          tx.prepare(`
            INSERT INTO lease_contacts (
              id, operator_id, lease_id, contact_id, role,
              is_financially_responsible, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            generateUUIDv7(),
            operatorId,
            leaseId,
            c.contact_id,
            c.role,
            c.is_financially_responsible === false ? 0 : 1,
            now
          );
        }
      }

      return LeasesRepository.getLeaseById(leaseId)!;
    }, db);
  }

  /**
   * Update terms or dates of an existing lease.
   *
   * @param id - Lease identifier.
   * @param data - Mutable lease fields.
   * @returns Updated lease with details or null if not found.
   */
  public static updateLease(id: string, data: Partial<Omit<Lease, 'id' | 'operator_id' | 'created_at' | 'updated_at' | 'deleted_at'>>): LeaseWithDetails | null {
    const existing = LeasesRepository.getLeaseById(id);
    if (!existing) return null;

    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const updated = { ...existing, ...data, updated_at: now };

    db.prepare(`
      UPDATE leases SET
        unit_id = ?, status = ?, start_date = ?, end_date = ?,
        rent_amount_cents = ?, security_deposit_cents = ?, deposit_held_cents = ?,
        rent_due_day = ?, late_fee_grace_days = ?, late_fee_amount_cents = ?,
        notice_date = ?, move_out_date = ?,
        updated_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(
      updated.unit_id,
      updated.status,
      updated.start_date,
      updated.end_date,
      updated.rent_amount_cents,
      updated.security_deposit_cents,
      updated.deposit_held_cents,
      updated.rent_due_day,
      updated.late_fee_grace_days,
      updated.late_fee_amount_cents,
      updated.notice_date || null,
      updated.move_out_date || null,
      now,
      id,
      operatorId
    );

    return LeasesRepository.getLeaseById(id);
  }

  /**
   * Transition the status of a lease contract with optional termination dates.
   *
   * @param id - Lease identifier.
   * @param status - Target status enum.
   * @param noticeDate - Optional formal notice date in epoch milliseconds.
   * @param moveOutDate - Optional scheduled or actual move-out date in epoch milliseconds.
   * @returns Updated lease or null if not found.
   */
  public static updateLeaseStatus(
    id: string,
    status: Lease['status'],
    noticeDate?: number | null,
    moveOutDate?: number | null
  ): LeaseWithDetails | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    if (status === 'terminated' && (noticeDate !== undefined || moveOutDate !== undefined)) {
      db.prepare(`
        UPDATE leases SET
          status = ?,
          notice_date = COALESCE(?, notice_date),
          move_out_date = COALESCE(?, move_out_date),
          updated_at = ?
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(status, noticeDate ?? null, moveOutDate ?? null, now, id, operatorId);
    } else {
      db.prepare(`
        UPDATE leases SET status = ?, updated_at = ?
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).run(status, now, id, operatorId);
    }

    return LeasesRepository.getLeaseById(id);
  }

  /**
   * Link a contact as a signatory or occupant to a lease.
   *
   * @param leaseId - Lease identifier.
   * @param contactId - Contact identifier.
   * @param role - Role of contact on lease.
   * @param isFinanciallyResponsible - True if financially responsible.
   * @returns True if linked or updated.
   */
  public static addLeaseContact(
    leaseId: string,
    contactId: string,
    role: LeaseContact['role'],
    isFinanciallyResponsible: boolean = true
  ): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const info = db.prepare(`
      INSERT INTO lease_contacts (
        id, operator_id, lease_id, contact_id, role,
        is_financially_responsible, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(operator_id, lease_id, contact_id) WHERE deleted_at IS NULL DO UPDATE SET
        role = excluded.role,
        is_financially_responsible = excluded.is_financially_responsible,
        deleted_at = NULL
    `).run(
      generateUUIDv7(),
      operatorId,
      leaseId,
      contactId,
      role,
      isFinanciallyResponsible ? 1 : 0,
      now
    );

    return info.changes > 0;
  }

  /**
   * Detach a contact from a lease.
   *
   * @param leaseId - Lease identifier.
   * @param contactId - Contact identifier.
   * @returns True if detached.
   */
  public static removeLeaseContact(leaseId: string, contactId: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const info = db.prepare(`
      UPDATE lease_contacts SET deleted_at = ?
      WHERE lease_id = ? AND contact_id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, leaseId, contactId, operatorId);

    return info.changes > 0;
  }

  /**
   * Soft-delete a lease agreement.
   *
   * @param id - Lease identifier.
   * @returns True if deleted, false if not found.
   */
  public static deleteLease(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const info = db.prepare(`
      UPDATE leases SET deleted_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, id, operatorId);

    return info.changes > 0;
  }

  // =========================================================================
  // RECURRING LEASE CHARGES
  // =========================================================================

  /**
   * Attach an itemized recurring charge to a lease.
   *
   * @param input - Charge configuration parameters.
   * @returns Newly created recurring charge entity.
   */
  public static addRecurringCharge(input: {
    lease_id: string;
    charge_category: RecurringLeaseCharge['charge_category'];
    amount_cents: number;
    gl_account_id?: string;
    billing_frequency?: RecurringLeaseCharge['billing_frequency'];
    billing_day?: number;
    description: string;
  }): RecurringLeaseCharge {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const lease = this.getLeaseById(input.lease_id);
    if (!lease) {
      throw new Error(`Lease '${input.lease_id}' not found.`);
    }

    if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
      throw new Error('Charge amount_cents must be a positive integer in cents.');
    }

    let glAccountId = input.gl_account_id;
    if (!glAccountId) {
      // Map category to standard chart of accounts
      const mappingKey =
        input.charge_category === 'base_rent' ? 'rent' :
        input.charge_category === 'pet_rent' ? 'pet_fee' :
        input.charge_category === 'utility_surcharge' ? 'utility_rebill' :
        input.charge_category === 'parking_fee' ? 'parking_fee' :
        input.charge_category === 'storage_fee' ? 'parking_fee' : 'other_income';

      const accRow = db.prepare(`
        SELECT id FROM chart_of_accounts
        WHERE operator_id = ? AND category_mapping = ? AND deleted_at IS NULL
        LIMIT 1
      `).get(operatorId, mappingKey) as { id: string } | undefined;

      if (accRow) {
        glAccountId = accRow.id;
      } else {
        // Fallback to any active income account
        const fallback = db.prepare(`
          SELECT id FROM chart_of_accounts
          WHERE operator_id = ? AND account_type = 'Income' AND deleted_at IS NULL
          LIMIT 1
        `).get(operatorId) as { id: string } | undefined;
        if (!fallback) {
          throw new Error('No valid GL account found for recurring charge.');
        }
        glAccountId = fallback.id;
      }
    }

    const id = generateUUIDv7();
    const frequency = input.billing_frequency || 'monthly';
    const billingDay = input.billing_day || 1;

    db.prepare(`
      INSERT INTO recurring_lease_charges (
        id, operator_id, lease_id, charge_category, amount_cents,
        gl_account_id, billing_frequency, billing_day, description,
        created_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id,
      operatorId,
      input.lease_id,
      input.charge_category,
      input.amount_cents,
      glAccountId,
      frequency,
      billingDay,
      input.description,
      now
    );

    return {
      id,
      operator_id: operatorId,
      lease_id: input.lease_id,
      charge_category: input.charge_category,
      amount_cents: input.amount_cents,
      gl_account_id: glAccountId,
      billing_frequency: frequency,
      billing_day: billingDay,
      description: input.description,
      created_at: now
    };
  }

  /**
   * List active recurring charges for a lease agreement.
   *
   * @param leaseId - Lease identifier.
   * @returns Array of active recurring charges.
   */
  public static listRecurringCharges(leaseId: string): RecurringLeaseCharge[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    return db.prepare(`
      SELECT * FROM recurring_lease_charges
      WHERE operator_id = ? AND lease_id = ? AND deleted_at IS NULL
      ORDER BY billing_day ASC, created_at ASC
    `).all(operatorId, leaseId) as unknown as RecurringLeaseCharge[];
  }

  /**
   * Remove an itemized recurring charge.
   *
   * @param id - Recurring charge identifier.
   * @returns True if soft-deleted.
   */
  public static deleteRecurringCharge(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const info = db.prepare(`
      UPDATE recurring_lease_charges SET deleted_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, id, operatorId);

    return info.changes > 0;
  }

  // =========================================================================
  // LATE FEE POLICIES & DELINQUENCY ENGINE
  // =========================================================================

  /**
   * Create a configurable late fee policy.
   *
   * @param input - Policy parameters.
   * @returns Created policy record.
   */
  public static createLateFeePolicy(input: {
    portfolio_id?: string | null;
    property_id?: string | null;
    grace_period_days?: number;
    due_day?: number;
    calculation_type: LateFeePolicy['calculation_type'];
    flat_fee_cents?: number | null;
    percentage_bps?: number | null;
    delinquency_threshold_cents?: number;
    statutory_cap_cents?: number | null;
  }): LateFeePolicy {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const id = generateUUIDv7();
    const graceDays = input.grace_period_days ?? 5;
    const dueDay = input.due_day ?? 1;
    const threshold = input.delinquency_threshold_cents ?? 5000;

    db.prepare(`
      INSERT INTO late_fee_policies (
        id, operator_id, portfolio_id, property_id, grace_period_days,
        due_day, calculation_type, flat_fee_cents, percentage_bps,
        delinquency_threshold_cents, statutory_cap_cents, created_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id,
      operatorId,
      input.portfolio_id || null,
      input.property_id || null,
      graceDays,
      dueDay,
      input.calculation_type,
      input.flat_fee_cents ?? 0,
      input.percentage_bps ?? 0,
      threshold,
      input.statutory_cap_cents || null,
      now
    );

    return {
      id,
      operator_id: operatorId,
      portfolio_id: input.portfolio_id || null,
      property_id: input.property_id || null,
      grace_period_days: graceDays,
      due_day: dueDay,
      calculation_type: input.calculation_type,
      flat_fee_cents: input.flat_fee_cents ?? 0,
      percentage_bps: input.percentage_bps ?? 0,
      delinquency_threshold_cents: threshold,
      statutory_cap_cents: input.statutory_cap_cents || null,
      created_at: now
    };
  }

  /**
   * List all configured late fee policies.
   *
   * @returns Array of active policies.
   */
  public static listLateFeePolicies(): LateFeePolicy[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    return db.prepare(`
      SELECT * FROM late_fee_policies
      WHERE operator_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
    `).all(operatorId) as unknown as LateFeePolicy[];
  }

  /**
   * Retrieve a late fee policy by identifier.
   *
   * @param id - Policy identifier.
   * @returns Policy or null.
   */
  public static getLateFeePolicyById(id: string): LateFeePolicy | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT * FROM late_fee_policies
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(id, operatorId);

    return (row as unknown as LateFeePolicy) || null;
  }

  /**
   * Soft-delete a late fee policy.
   *
   * @param id - Policy identifier.
   * @returns True if deleted.
   */
  public static deleteLateFeePolicy(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const info = db.prepare(`
      UPDATE late_fee_policies SET deleted_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, id, operatorId);

    return info.changes > 0;
  }

  /**
   * Resolve the active late fee policy for a lease via hierarchy:
   * 1. Property-level override
   * 2. Portfolio-level policy
   * 3. Operator-wide default policy
   *
   * @param leaseId - Lease identifier.
   * @returns Resolved policy or null.
   */
  public static getActiveLateFeePolicyForLease(leaseId: string): LateFeePolicy | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    // Find unit and property scoping
    const leaseScope = db.prepare(`
      SELECT u.property_id, p.portfolio_id
      FROM leases l
      JOIN units u ON l.unit_id = u.id
      JOIN properties p ON u.property_id = p.id
      WHERE l.id = ? AND l.operator_id = ? AND l.deleted_at IS NULL
    `).get(leaseId, operatorId) as { property_id: string; portfolio_id?: string | null } | undefined;

    if (!leaseScope) {
      return null;
    }

    // 1. Property policy
    const propPolicy = db.prepare(`
      SELECT * FROM late_fee_policies
      WHERE operator_id = ? AND property_id = ? AND deleted_at IS NULL
      LIMIT 1
    `).get(operatorId, leaseScope.property_id) as LateFeePolicy | undefined;

    if (propPolicy) return propPolicy;

    // 2. Portfolio policy
    if (leaseScope.portfolio_id) {
      const portPolicy = db.prepare(`
        SELECT * FROM late_fee_policies
        WHERE operator_id = ? AND portfolio_id = ? AND deleted_at IS NULL
        LIMIT 1
      `).get(operatorId, leaseScope.portfolio_id) as LateFeePolicy | undefined;

      if (portPolicy) return portPolicy;
    }

    // 3. Operator default (property_id IS NULL AND portfolio_id IS NULL)
    const defaultPolicy = db.prepare(`
      SELECT * FROM late_fee_policies
      WHERE operator_id = ? AND property_id IS NULL AND portfolio_id IS NULL AND deleted_at IS NULL
      LIMIT 1
    `).get(operatorId) as LateFeePolicy | undefined;

    return defaultPolicy || null;
  }

  /**
   * Calculate late fee delinquency for a lease contract.
   *
   * @param leaseId - Lease identifier.
   * @param asOfDateMs - Cutoff timestamp (defaults to current time).
   * @returns Delinquency calculation assessment.
   */
  public static calculateLateFee(
    leaseId: string,
    asOfDateMs: number = Date.now()
  ): {
    lease_id: string;
    balance_cents: number;
    days_past_due: number;
    fee_cents: number;
    is_delinquent: boolean;
    policy: any;
  } {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const lease = this.getLeaseById(leaseId);
    if (!lease) {
      throw new Error(`Lease '${leaseId}' not found.`);
    }

    const policy = this.getActiveLateFeePolicyForLease(leaseId);
    const graceDays = policy ? policy.grace_period_days : (lease.late_fee_grace_days || 5);
    const dueDay = policy ? policy.due_day : (lease.rent_due_day || 1);
    const calcType = policy ? policy.calculation_type : 'flat_fee';
    const flatFee = policy ? (policy.flat_fee_cents || 0) : (lease.late_fee_amount_cents || 0);
    const percentageBps = policy ? (policy.percentage_bps || 0) : 0;
    const threshold = policy ? policy.delinquency_threshold_cents : 5000;
    const statutoryCap = policy?.statutory_cap_cents;

    // Temporal day calculation
    const d = new Date(asOfDateMs);
    const currentDay = d.getUTCDate();
    const lateThresholdDay = dueDay + graceDays;
    const isPastGracePeriod = currentDay > lateThresholdDay;
    const daysPastDue = isPastGracePeriod ? (currentDay - lateThresholdDay) : 0;

    // Query outstanding AR balance for this lease
    const arRow = db.prepare(`
      SELECT COALESCE(SUM(jl.debit_cents - jl.credit_cents), 0) AS balance_cents
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.deleted_at IS NULL
      JOIN chart_of_accounts coa ON jl.account_id = coa.id
      WHERE jl.operator_id = ?
        AND jl.lease_id = ?
        AND coa.category_mapping = 'accounts_receivable'
        AND je.date_ms <= ?
        AND je.reversed_by_entry_id IS NULL
    `).get(operatorId, leaseId, asOfDateMs) as { balance_cents: number };

    let balanceCents = arRow?.balance_cents || 0;

    // Fallback to legacy single-entry transactions if no journal lines exist
    if (balanceCents === 0) {
      const legacyRow = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type = 'charge' THEN amount_cents ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN transaction_type IN ('payment', 'refund') THEN amount_cents ELSE 0 END), 0) AS legacy_balance
        FROM transactions
        WHERE operator_id = ? AND lease_id = ? AND transaction_date <= ? AND deleted_at IS NULL
      `).get(operatorId, leaseId, asOfDateMs) as { legacy_balance: number };
      balanceCents = legacyRow?.legacy_balance || 0;
    }

    let feeCents = 0;
    if (isPastGracePeriod && balanceCents >= threshold) {
      if (calcType === 'flat_fee') {
        feeCents = flatFee;
      } else if (calcType === 'percentage_of_delinquency') {
        feeCents = Math.round((balanceCents * percentageBps) / 10000);
      } else if (calcType === 'daily_accrual') {
        feeCents = flatFee + (Math.round((balanceCents * percentageBps) / 10000) * daysPastDue);
      }

      if (statutoryCap !== undefined && statutoryCap !== null && statutoryCap > 0) {
        feeCents = Math.min(feeCents, statutoryCap);
      }
    }

    return {
      lease_id: leaseId,
      balance_cents: balanceCents,
      days_past_due: daysPastDue,
      fee_cents: feeCents,
      is_delinquent: feeCents > 0,
      policy: policy || {
        grace_period_days: graceDays,
        due_day: dueDay,
        calculation_type: calcType,
        flat_fee_cents: flatFee,
        delinquency_threshold_cents: threshold
      }
    };
  }

  /**
   * Apply an assessed late fee to a delinquent lease, recording a double-entry journal charge.
   *
   * @param leaseId - Lease identifier.
   * @param asOfDateMs - Timestamp of assessment.
   * @returns Assessment outcome.
   */
  public static applyLateFee(
    leaseId: string,
    asOfDateMs: number = Date.now()
  ): {
    applied: boolean;
    reason?: string;
    fee_cents: number;
    journal_entry_id?: string;
  } {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const calc = this.calculateLateFee(leaseId, asOfDateMs);
    if (calc.fee_cents <= 0) {
      return {
        applied: false,
        reason: 'No late fee accrued or balance is below delinquency threshold.',
        fee_cents: 0
      };
    }

    const d = new Date(asOfDateMs);
    const yyyyMm = `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}`;
    const idempotencyRef = `late_fee:${leaseId}:${yyyyMm}`;

    // Check idempotency in journal entries
    const existing = db.prepare(`
      SELECT id FROM journal_entries
      WHERE operator_id = ? AND source_type = 'late_fee' AND source_id = ? AND deleted_at IS NULL
    `).get(operatorId, idempotencyRef) as { id: string } | undefined;

    if (existing) {
      return {
        applied: false,
        reason: `Late fee already assessed for period ${yyyyMm}.`,
        fee_cents: 0
      };
    }

    // Fetch lease details for metadata
    const meta = db.prepare(`
      SELECT l.unit_id, u.property_id,
        (SELECT lc.contact_id FROM lease_contacts lc WHERE lc.lease_id = l.id AND lc.role = 'primary_tenant' AND lc.deleted_at IS NULL LIMIT 1) as contact_id
      FROM leases l
      JOIN units u ON l.unit_id = u.id
      WHERE l.id = ? AND l.operator_id = ?
    `).get(leaseId, operatorId) as { unit_id: string; property_id: string; contact_id?: string | null };

    return withTransaction((conn) => {
      // Find accounts: AR (1100) and Late Fee Income (4020)
      const arAcc = conn.prepare(`
        SELECT id FROM chart_of_accounts
        WHERE operator_id = ? AND category_mapping = 'accounts_receivable' AND deleted_at IS NULL
        LIMIT 1
      `).get(operatorId) as { id: string } | undefined;

      const lateFeeAcc = conn.prepare(`
        SELECT id FROM chart_of_accounts
        WHERE operator_id = ? AND category_mapping = 'late_fee' AND deleted_at IS NULL
        LIMIT 1
      `).get(operatorId) as { id: string } | undefined;

      if (!arAcc || !lateFeeAcc) {
        throw new Error('Chart of accounts missing required Accounts Receivable (1100) or Late Fee Income (4020) account.');
      }

      const entryId = generateUUIDv7();
      const now = Date.now();
      const maxRow = conn.prepare(`
        SELECT COALESCE(MAX(entry_number), 0) AS max_num
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
        asOfDateMs,
        `Late Fee Assessment - ${yyyyMm}`,
        'late_fee',
        idempotencyRef,
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

      // Debit AR (increases amount tenant owes)
      lineStmt.run(
        generateUUIDv7(),
        operatorId,
        entryId,
        arAcc.id,
        calc.fee_cents,
        0,
        meta.property_id,
        meta.unit_id,
        meta.contact_id || null,
        leaseId,
        `Late Fee Assessment - ${yyyyMm}`,
        now
      );

      // Credit Late Fee Income (increases income)
      lineStmt.run(
        generateUUIDv7(),
        operatorId,
        entryId,
        lateFeeAcc.id,
        0,
        calc.fee_cents,
        meta.property_id,
        meta.unit_id,
        meta.contact_id || null,
        leaseId,
        `Late Fee Assessment - ${yyyyMm}`,
        now
      );

      // Legacy transactions table entry for backward compatibility
      conn.prepare(`
        INSERT INTO transactions (
          id, operator_id, transaction_type, category, amount_cents,
          transaction_date, description, reference_number,
          property_id, unit_id, lease_id, payer_contact_id, payee_contact_id,
          journal_entry_id, created_at, updated_at
        ) VALUES (?, ?, 'charge', 'late_fee', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `).run(
        generateUUIDv7(),
        operatorId,
        calc.fee_cents,
        asOfDateMs,
        `Late Fee Assessment - ${yyyyMm}`,
        idempotencyRef,
        meta.property_id,
        meta.unit_id,
        leaseId,
        meta.contact_id || null,
        entryId,
        now,
        now
      );

      eventBus.publish('lease.late_fee_applied', {
        operatorId,
        leaseId,
        amountCents: calc.fee_cents,
        asOfDateMs
      });

      return {
        applied: true,
        fee_cents: calc.fee_cents,
        journal_entry_id: entryId
      };
    });
  }

  // =========================================================================
  // LEASE CREDITS & CONCESSIONS
  // =========================================================================

  /**
   * Issue a promotional concession or discretionary credit against a lease.
   *
   * @param input - Concession details.
   * @returns Created concession entity.
   */
  public static addCreditConcession(input: {
    lease_id: string;
    credit_type: LeaseCreditConcession['credit_type'];
    amount_cents: number;
    gl_account_id?: string;
    reason: string;
    effective_date?: number;
  }): LeaseCreditConcession {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const lease = this.getLeaseById(input.lease_id);
    if (!lease) {
      throw new Error(`Lease '${input.lease_id}' not found.`);
    }

    if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
      throw new Error('Credit amount_cents must be a positive integer in cents.');
    }

    const effectiveDate = input.effective_date || now;

    // Fetch lease details for scoping
    const meta = db.prepare(`
      SELECT l.unit_id, u.property_id,
        (SELECT lc.contact_id FROM lease_contacts lc WHERE lc.lease_id = l.id AND lc.role = 'primary_tenant' AND lc.deleted_at IS NULL LIMIT 1) as contact_id
      FROM leases l
      JOIN units u ON l.unit_id = u.id
      WHERE l.id = ? AND l.operator_id = ?
    `).get(input.lease_id, operatorId) as { unit_id: string; property_id: string; contact_id?: string | null };

    return withTransaction((conn) => {
      let glAccountId = input.gl_account_id;
      if (!glAccountId) {
        const concessionAcc = conn.prepare(`
          SELECT id FROM chart_of_accounts
          WHERE operator_id = ? AND category_mapping = 'lease_concession' AND deleted_at IS NULL
          LIMIT 1
        `).get(operatorId) as { id: string } | undefined;

        if (concessionAcc) {
          glAccountId = concessionAcc.id;
        } else {
          // Fallback to rent revenue offset
          const rentAcc = conn.prepare(`
            SELECT id FROM chart_of_accounts
            WHERE operator_id = ? AND category_mapping = 'rent' AND deleted_at IS NULL
            LIMIT 1
          `).get(operatorId) as { id: string } | undefined;
          if (!rentAcc) {
            throw new Error('No chart of accounts mapping found for concession.');
          }
          glAccountId = rentAcc.id;
        }
      }

      const arAcc = conn.prepare(`
        SELECT id FROM chart_of_accounts
        WHERE operator_id = ? AND category_mapping = 'accounts_receivable' AND deleted_at IS NULL
        LIMIT 1
      `).get(operatorId) as { id: string } | undefined;

      if (!arAcc) {
        throw new Error('Accounts Receivable account (1100) not found in chart of accounts.');
      }

      const id = generateUUIDv7();
      conn.prepare(`
        INSERT INTO lease_credits_and_concessions (
          id, operator_id, lease_id, credit_type, amount_cents,
          gl_account_id, reason, effective_date, created_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        id,
        operatorId,
        input.lease_id,
        input.credit_type,
        input.amount_cents,
        glAccountId,
        input.reason,
        effectiveDate,
        now
      );

      // Post double-entry: Debit Concessions (4050), Credit AR (1100 - reduces tenant balance)
      const entryId = generateUUIDv7();
      const maxRow = conn.prepare(`
        SELECT COALESCE(MAX(entry_number), 0) AS max_num
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
        effectiveDate,
        `Lease Credit: ${input.reason}`,
        'credit_concession',
        id,
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

      // Debit Concessions / Discount Account
      lineStmt.run(
        generateUUIDv7(),
        operatorId,
        entryId,
        glAccountId,
        input.amount_cents,
        0,
        meta.property_id,
        meta.unit_id,
        meta.contact_id || null,
        input.lease_id,
        input.reason,
        now
      );

      // Credit AR (reducing tenant debt)
      lineStmt.run(
        generateUUIDv7(),
        operatorId,
        entryId,
        arAcc.id,
        0,
        input.amount_cents,
        meta.property_id,
        meta.unit_id,
        meta.contact_id || null,
        input.lease_id,
        input.reason,
        now
      );

      // Insert legacy single-entry record for backward compatibility
      conn.prepare(`
        INSERT INTO transactions (
          id, operator_id, transaction_type, category, amount_cents,
          transaction_date, description, reference_number,
          property_id, unit_id, lease_id, payer_contact_id, payee_contact_id,
          journal_entry_id, created_at, updated_at
        ) VALUES (?, ?, 'refund', 'rent', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `).run(
        generateUUIDv7(),
        operatorId,
        input.amount_cents,
        effectiveDate,
        `Credit Concession: ${input.reason}`,
        id,
        meta.property_id,
        meta.unit_id,
        input.lease_id,
        meta.contact_id || null,
        entryId,
        now,
        now
      );

      eventBus.publish('lease.credit_applied', {
        operatorId,
        leaseId: input.lease_id,
        amountCents: input.amount_cents,
        creditType: input.credit_type
      });

      return {
        id,
        operator_id: operatorId,
        lease_id: input.lease_id,
        credit_type: input.credit_type,
        amount_cents: input.amount_cents,
        gl_account_id: glAccountId,
        reason: input.reason,
        effective_date: effectiveDate,
        created_at: now
      };
    });
  }

  /**
   * List concessions and credits applied to a lease.
   *
   * @param leaseId - Lease identifier.
   * @returns Array of credits/concessions.
   */
  public static listCreditConcessions(leaseId: string): LeaseCreditConcession[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    return db.prepare(`
      SELECT * FROM lease_credits_and_concessions
      WHERE operator_id = ? AND lease_id = ? AND deleted_at IS NULL
      ORDER BY effective_date DESC, created_at DESC
    `).all(operatorId, leaseId) as unknown as LeaseCreditConcession[];
  }

  // =========================================================================
  // SECURITY DEPOSIT REFUNDS
  // =========================================================================

  /**
   * Issue a security deposit refund or overpayment return.
   * Decrements lease deposit_held_cents and posts balanced trust double-entry:
   * Debit: 2100 Tenant Security Deposits Held
   * Credit: 1020 Security Deposit Trust Checking
   *
   * @param input - Refund issuance parameters.
   * @returns Created refund record.
   */
  public static issueDepositRefund(input: {
    lease_id: string;
    recipient_contact_id: string;
    refund_type: SecurityDepositRefund['refund_type'];
    refund_amount_cents: number;
    funding_account_id?: string;
    disbursement_method: SecurityDepositRefund['disbursement_method'];
    check_number?: string | null;
    disbursement_date?: number;
  }): SecurityDepositRefund {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const lease = this.getLeaseById(input.lease_id);
    if (!lease) {
      throw new Error(`Lease '${input.lease_id}' not found.`);
    }

    if (!Number.isInteger(input.refund_amount_cents) || input.refund_amount_cents <= 0) {
      throw new Error('Refund amount_cents must be a positive integer in cents.');
    }

    if (lease.deposit_held_cents < input.refund_amount_cents) {
      throw new Error(
        `Refund amount (${input.refund_amount_cents} cents) exceeds currently held deposit balance (${lease.deposit_held_cents} cents).`
      );
    }

    const disbursementDate = input.disbursement_date || now;

    // Fetch lease details for scoping
    const meta = db.prepare(`
      SELECT l.unit_id, u.property_id
      FROM leases l
      JOIN units u ON l.unit_id = u.id
      WHERE l.id = ? AND l.operator_id = ?
    `).get(input.lease_id, operatorId) as { unit_id: string; property_id: string };

    return withTransaction((conn) => {
      let fundingAccountId = input.funding_account_id;
      if (!fundingAccountId) {
        const trustBank = conn.prepare(`
          SELECT id FROM chart_of_accounts
          WHERE operator_id = ? AND category_mapping = 'trust_bank' AND deleted_at IS NULL
          LIMIT 1
        `).get(operatorId) as { id: string } | undefined;

        if (!trustBank) {
          throw new Error('Security Deposit Trust Checking account (1020) not found in chart of accounts.');
        }
        fundingAccountId = trustBank.id;
      }

      const depositLiability = conn.prepare(`
        SELECT id FROM chart_of_accounts
        WHERE operator_id = ? AND category_mapping = 'security_deposit' AND deleted_at IS NULL
        LIMIT 1
      `).get(operatorId) as { id: string } | undefined;

      if (!depositLiability) {
        throw new Error('Tenant Security Deposits Held liability account (2100) not found in chart of accounts.');
      }

      const id = generateUUIDv7();

      // Decrement held deposit on the lease
      conn.prepare(`
        UPDATE leases
        SET deposit_held_cents = deposit_held_cents - ?, updated_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(input.refund_amount_cents, now, input.lease_id, operatorId);

      // Insert refund record
      conn.prepare(`
        INSERT INTO security_deposit_refunds (
          id, operator_id, lease_id, recipient_contact_id, refund_type,
          refund_amount_cents, funding_account_id, disbursement_method,
          check_number, disbursement_date, created_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        id,
        operatorId,
        input.lease_id,
        input.recipient_contact_id,
        input.refund_type,
        input.refund_amount_cents,
        fundingAccountId,
        input.disbursement_method,
        input.check_number || null,
        disbursementDate,
        now
      );

      // Post double-entry: Debit 2100 (Liability), Credit 1020 (Trust Bank Asset)
      const entryId = generateUUIDv7();
      const maxRow = conn.prepare(`
        SELECT COALESCE(MAX(entry_number), 0) AS max_num
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
        disbursementDate,
        `Security Deposit Refund - ${input.refund_type}`,
        'deposit_refund',
        id,
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

      // Debit Liability (reduces what operator owes to tenant)
      lineStmt.run(
        generateUUIDv7(),
        operatorId,
        entryId,
        depositLiability.id,
        input.refund_amount_cents,
        0,
        meta.property_id,
        meta.unit_id,
        input.recipient_contact_id,
        input.lease_id,
        `Security Deposit Disposition: ${input.refund_type}`,
        now
      );

      // Credit Trust Bank (reduces cash held in trust checking)
      lineStmt.run(
        generateUUIDv7(),
        operatorId,
        entryId,
        fundingAccountId,
        0,
        input.refund_amount_cents,
        meta.property_id,
        meta.unit_id,
        input.recipient_contact_id,
        input.lease_id,
        `Security Deposit Disposition: ${input.refund_type}`,
        now
      );

      // Insert legacy single-entry record
      conn.prepare(`
        INSERT INTO transactions (
          id, operator_id, transaction_type, category, amount_cents,
          transaction_date, description, reference_number,
          property_id, unit_id, lease_id, payer_contact_id, payee_contact_id,
          journal_entry_id, created_at, updated_at
        ) VALUES (?, ?, 'deposit_return', 'security_deposit', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
      `).run(
        generateUUIDv7(),
        operatorId,
        input.refund_amount_cents,
        disbursementDate,
        `Deposit Refund: ${input.refund_type}`,
        input.check_number || id,
        meta.property_id,
        meta.unit_id,
        input.lease_id,
        input.recipient_contact_id,
        entryId,
        now,
        now
      );

      eventBus.publish('lease.deposit_refunded', {
        operatorId,
        leaseId: input.lease_id,
        amountCents: input.refund_amount_cents,
        recipientContactId: input.recipient_contact_id
      });

      return {
        id,
        operator_id: operatorId,
        lease_id: input.lease_id,
        recipient_contact_id: input.recipient_contact_id,
        refund_type: input.refund_type,
        refund_amount_cents: input.refund_amount_cents,
        funding_account_id: fundingAccountId,
        disbursement_method: input.disbursement_method,
        check_number: input.check_number || null,
        disbursement_date: disbursementDate,
        created_at: now
      };
    });
  }

  /**
   * List security deposit refunds and overpayment returns for a lease.
   *
   * @param leaseId - Lease identifier.
   * @returns Array of refund records.
   */
  public static listDepositRefunds(leaseId: string): SecurityDepositRefund[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    return db.prepare(`
      SELECT * FROM security_deposit_refunds
      WHERE operator_id = ? AND lease_id = ? AND deleted_at IS NULL
      ORDER BY disbursement_date DESC, created_at DESC
    `).all(operatorId, leaseId) as unknown as SecurityDepositRefund[];
  }
}

