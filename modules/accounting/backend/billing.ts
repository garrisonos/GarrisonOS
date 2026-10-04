import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { AccountingRepository } from './repository.js';

export interface RecurringRentGenerationResult {
  month: string;
  leasesProcessed: number;
  chargesCreated: number;
  skippedExisting: number;
  totalChargesCents: number;
  createdTransactionIds: string[];
}

/**
 * Calculate mid-month prorated rent in integer cents.
 * Formula: floor( (monthlyRentCents / daysInMonth) * daysRemainingInclusive )
 */
export function calculateProratedRent(
  monthlyRentCents: number,
  year: number,
  monthIndex: number, // 0-based month (0 = Jan, 11 = Dec)
  startDay: number
): number {
  // Number of days in the specific month
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const daysRemaining = Math.max(1, daysInMonth - startDay + 1);
  return Math.floor((monthlyRentCents / daysInMonth) * daysRemaining);
}

/**
 * Automatically generate monthly recurring rent charges for active leases.
 * Idempotent execution using reference key pattern: rent_charge:{lease_id}:{YYYY_MM}
 * Automatically posts balanced double-entry journal entries via AccountingRepository.createTransaction.
 */
export function generateMonthlyRentCharges(targetYearMonth?: string): RecurringRentGenerationResult {
  const operatorId = RequestContext.getOperatorId();
  const db = getDatabase();

  let year: number;
  let monthIndex: number;

  if (targetYearMonth) {
    const [yStr, mStr] = targetYearMonth.split('-');
    year = parseInt(yStr || '', 10);
    monthIndex = parseInt(mStr || '', 10) - 1;
  } else {
    const now = new Date();
    year = now.getUTCFullYear();
    monthIndex = now.getUTCMonth();
  }

  const monthStr = (monthIndex + 1).toString().padStart(2, '0');
  const yyyyMm = `${year}-${monthStr}`;

  // Start and end timestamp of target month
  const monthStartMs = Date.UTC(year, monthIndex, 1, 0, 0, 0, 0);
  const monthEndMs = Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999);

  // Find all leases that are active during this target month
  const activeLeases = db.prepare(`
    SELECT
      l.id,
      l.unit_id,
      l.rent_amount_cents,
      l.start_date,
      l.end_date,
      l.rent_due_day,
      u.property_id,
      (SELECT lc.contact_id FROM lease_contacts lc WHERE lc.lease_id = l.id AND lc.role = 'primary_tenant' AND lc.deleted_at IS NULL LIMIT 1) as contact_id
    FROM leases l
    JOIN units u ON l.unit_id = u.id AND u.deleted_at IS NULL
    WHERE l.operator_id = ?
      AND l.status IN ('active', 'renewed', 'month_to_month', 'expiring')
      AND l.start_date <= ?
      AND l.end_date >= ?
      AND l.deleted_at IS NULL
  `).all(operatorId, monthEndMs, monthStartMs) as unknown as Array<{
    id: string;
    unit_id: string;
    property_id: string;
    rent_amount_cents: number;
    start_date: number;
    end_date: number;
    rent_due_day: number;
    contact_id: string | null;
  }>;

  const result: RecurringRentGenerationResult = {
    month: yyyyMm,
    leasesProcessed: activeLeases.length,
    chargesCreated: 0,
    skippedExisting: 0,
    totalChargesCents: 0,
    createdTransactionIds: []
  };

  const hasRecurringChargesTable = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recurring_lease_charges'
  `).get();

  for (const lease of activeLeases) {
    const idempotencyRef = `rent_charge:${lease.id}:${yyyyMm}`;

    // Check if charge already exists
    const existing = db.prepare(`
      SELECT id FROM transactions
      WHERE operator_id = ? AND lease_id = ? AND reference_number = ? AND deleted_at IS NULL
    `).get(operatorId, lease.id, idempotencyRef);

    if (existing) {
      result.skippedExisting += 1;
    } else {
      // Check if lease starts mid-month during this target month
      const leaseStartDate = new Date(lease.start_date);
      const isStartMonth = leaseStartDate.getUTCFullYear() === year && leaseStartDate.getUTCMonth() === monthIndex;
      let chargeAmountCents = lease.rent_amount_cents;

      if (isStartMonth && leaseStartDate.getUTCDate() > 1) {
        chargeAmountCents = calculateProratedRent(
          lease.rent_amount_cents,
          year,
          monthIndex,
          leaseStartDate.getUTCDate()
        );
      }

      const dueDay = Math.min(lease.rent_due_day || 1, 28);
      const chargeDateMs = Date.UTC(year, monthIndex, dueDay);

      const tx = AccountingRepository.createTransaction({
        transaction_type: 'charge',
        category: 'rent',
        amount_cents: chargeAmountCents,
        transaction_date: chargeDateMs,
        description: `Monthly Rent – ${yyyyMm}${isStartMonth && leaseStartDate.getUTCDate() > 1 ? ' (Prorated)' : ''}`,
        reference_number: idempotencyRef,
        property_id: lease.property_id,
        unit_id: lease.unit_id,
        lease_id: lease.id,
        payer_contact_id: lease.contact_id
      });

      result.chargesCreated += 1;
      result.totalChargesCents += chargeAmountCents;
      result.createdTransactionIds.push(tx.id);
    }

    // Process attached itemized recurring lease charges (pet rent, parking, storage, utilities)
    if (hasRecurringChargesTable) {
      const recurringCharges = db.prepare(`
        SELECT id, charge_category, amount_cents, billing_day, description, gl_account_id
        FROM recurring_lease_charges
        WHERE operator_id = ? AND lease_id = ? AND billing_frequency = 'monthly' AND deleted_at IS NULL
      `).all(operatorId, lease.id) as Array<{
        id: string;
        charge_category: string;
        amount_cents: number;
        billing_day: number;
        description: string;
        gl_account_id?: string | null;
      }>;

      for (const rc of recurringCharges) {
        const rcIdempotencyRef = `recurring_charge:${rc.id}:${yyyyMm}`;
        const rcExisting = db.prepare(`
          SELECT id FROM transactions
          WHERE operator_id = ? AND lease_id = ? AND reference_number = ? AND deleted_at IS NULL
        `).get(operatorId, lease.id, rcIdempotencyRef);

        if (rcExisting) {
          result.skippedExisting += 1;
          continue;
        }

        const rcCategory =
          rc.charge_category === 'pet_rent' ? 'pet_fee' :
          rc.charge_category === 'utility_surcharge' ? 'utility_rebill' :
          rc.charge_category === 'base_rent' ? 'rent' : 'other_income';

        const rcDueDay = Math.min(rc.billing_day || lease.rent_due_day || 1, 28);
        const rcChargeDateMs = Date.UTC(year, monthIndex, rcDueDay);

        const rcTx = AccountingRepository.createTransaction({
          transaction_type: 'charge',
          category: rcCategory,
          amount_cents: rc.amount_cents,
          transaction_date: rcChargeDateMs,
          description: `${rc.description} – ${yyyyMm}`,
          reference_number: rcIdempotencyRef,
          property_id: lease.property_id,
          unit_id: lease.unit_id,
          lease_id: lease.id,
          payer_contact_id: lease.contact_id,
          gl_account_id: rc.gl_account_id || null
        });

        result.chargesCreated += 1;
        result.totalChargesCents += rc.amount_cents;
        result.createdTransactionIds.push(rcTx.id);
      }
    }
  }

  return result;
}

