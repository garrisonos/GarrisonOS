import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/client.js';
import { RequestContext } from '../core/context.js';
import { canAccessModule, hasPermission, loadOperatorRoleOverrides } from '../core/rbac.js';
import type { PermissionString } from '../core/rbac.js';

/**
 * Key-value summary field displayed within an entity preview modal.
 */
export interface EntitySummaryField {
  /** Field label displayed on the summary card. */
  label: string;
  /** Field value string. */
  value: string;
}

/**
 * Standardized preview payload returned by EntityPreviewService.
 */
export interface EntityPreviewResult {
  /** Canonical domain entity type. */
  entityType: string;
  /** Unique entity primary key identifier. */
  id: string;
  /** Primary entity title or headline. */
  title: string;
  /** Status badge text. */
  badge: string;
  /** CSS class applied to status badge. */
  badgeClass: string;
  /** Deep link navigation URL to the entity full view. */
  fullUrl: string;
  /** Key-value summary fields. */
  summary: EntitySummaryField[];
}

/**
 * Format timestamp into readable UTC date string.
 *
 * @param epochMs UTC epoch timestamp in milliseconds.
 * @returns Human-readable formatted date.
 */
function formatDate(epochMs: number | null | undefined): string {
  if (!epochMs || !Number.isFinite(epochMs)) return '—';
  try {
    const d = new Date(epochMs);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch {
    return '—';
  }
}

/**
 * Format integer cents into USD currency string.
 *
 * @param cents Amount in integer cents.
 * @returns Formatted currency string.
 */
function formatCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '$0.00';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Service to resolve any system entity UUID into a standardized modal preview summary.
 */
export class EntityPreviewService {
  /**
   * Resolve an entity by ID and optional type hint within active operator scope.
   *
   * @param id Entity UUIDv7 string.
   * @param typeHint Optional hint (property, unit, lease, contact, work_order, bill, check, deposit).
   * @returns Entity preview payload or null if not found.
   */
  public static getPreview(id: string, typeHint?: string): EntityPreviewResult | null {
    if (!id || typeof id !== 'string') return null;
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const normalizedType = (typeHint || '').toLowerCase().trim();
    const userId = RequestContext.tryGet()?.userId;
    const user = userId && userId !== 'system'
      ? db.prepare('SELECT role FROM users WHERE id = ? AND operator_id = ? AND deleted_at IS NULL')
        .get(userId, operatorId) as { role: string } | undefined
      : undefined;
    const overrides = loadOperatorRoleOverrides(operatorId, db);
    const canView = (permission: PermissionString): boolean => {
      if (userId === 'system') return true;
      const moduleName = permission.split(':')[0] ?? '';
      if (user && userId) {
        return !!user.role
          && hasPermission(user.role, permission, overrides)
          && canAccessModule(userId, moduleName, operatorId, db);
      }
      const contextRole = (RequestContext.tryGet() as any)?.role;
      if (contextRole) {
        return hasPermission(contextRole, permission, overrides);
      }
      if (process.env['NODE_ENV'] !== 'production') {
        return true;
      }
      return false;
    };

    // 1. Property
    if (canView('properties:view') && (!normalizedType || normalizedType === 'property' || normalizedType === 'properties')) {
      const prop = db.prepare(`
        SELECT id, name, property_type, address_line1, city, state, postal_code, year_built
        FROM properties
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).get(id, operatorId) as any;

      if (prop) {
        const unitsCount = (db.prepare(`
          SELECT COUNT(*) as count FROM units WHERE property_id = ? AND operator_id = ? AND deleted_at IS NULL
        `).get(id, operatorId) as any)?.count || 0;

        return {
          entityType: 'property',
          id: prop.id,
          title: prop.name,
          badge: (prop.property_type || '').replace(/_/g, ' ').toUpperCase(),
          badgeClass: 'badge-primary',
          fullUrl: `/properties/show?id=${encodeURIComponent(prop.id)}`,
          summary: [
            { label: 'Address', value: `${prop.address_line1}, ${prop.city}, ${prop.state} ${prop.postal_code}` },
            { label: 'Total Units', value: `${unitsCount} unit${unitsCount === 1 ? '' : 's'}` },
            { label: 'Year Built', value: prop.year_built ? String(prop.year_built) : '—' }
          ]
        };
      }
    }

    // 2. Unit
    if (canView('properties:view') && (!normalizedType || normalizedType === 'unit' || normalizedType === 'units')) {
      const unit = db.prepare(`
        SELECT u.*, p.name as property_name
        FROM units u
        JOIN properties p ON u.property_id = p.id AND p.deleted_at IS NULL
        WHERE u.id = ? AND u.operator_id = ? AND u.deleted_at IS NULL
      `).get(id, operatorId) as any;

      if (unit) {
        return {
          entityType: 'unit',
          id: unit.id,
          title: `Unit ${unit.unit_number} • ${unit.property_name}`,
          badge: (unit.status || 'unknown').toUpperCase(),
          badgeClass: unit.status === 'occupied' ? 'badge-success' : 'badge-warning',
          fullUrl: `/properties/show?id=${encodeURIComponent(unit.property_id)}`,
          summary: [
            { label: 'Property', value: unit.property_name },
            { label: 'Unit Number', value: unit.unit_number },
            { label: 'Market Rent', value: `${formatCurrency(unit.market_rent_cents)} / mo` },
            { label: 'Layout', value: `${unit.bedrooms ?? 0} Bed / ${unit.bathrooms ?? 1} Bath` },
            { label: 'Size', value: unit.square_feet ? `${unit.square_feet} sq ft` : '—' }
          ]
        };
      }
    }

    // 3. Lease
    if (canView('leases:view') && (!normalizedType || normalizedType === 'lease' || normalizedType === 'leases')) {
      const lease = db.prepare(`
        SELECT l.*, p.name as property_name, u.unit_number, c.first_name || ' ' || c.last_name as tenant_name
        FROM leases l
        JOIN units u ON l.unit_id = u.id AND u.deleted_at IS NULL
        JOIN properties p ON u.property_id = p.id AND p.deleted_at IS NULL
        LEFT JOIN lease_contacts lc ON l.id = lc.lease_id AND lc.role = 'primary_tenant' AND lc.deleted_at IS NULL
        LEFT JOIN contacts c ON lc.contact_id = c.id AND c.deleted_at IS NULL
        WHERE l.id = ? AND l.operator_id = ? AND l.deleted_at IS NULL
      `).get(id, operatorId) as any;

      if (lease) {
        return {
          entityType: 'lease',
          id: lease.id,
          title: `Lease: ${lease.property_name} (Unit ${lease.unit_number || '—'})`,
          badge: (lease.status || '').toUpperCase(),
          badgeClass: lease.status === 'active' ? 'badge-success' : 'badge-warning',
          fullUrl: `/leases/show?id=${encodeURIComponent(lease.id)}`,
          summary: [
            { label: 'Tenant', value: lease.tenant_name || 'No Primary Tenant' },
            { label: 'Property', value: lease.property_name },
            { label: 'Monthly Rent', value: formatCurrency(lease.rent_amount_cents) },
            { label: 'Deposit Held', value: formatCurrency(lease.deposit_held_cents) },
            { label: 'Term Dates', value: `${formatDate(lease.start_date)} to ${formatDate(lease.end_date)}` }
          ]
        };
      }
    }

    // 4. Contact
    if (canView('contacts:view') && (!normalizedType || normalizedType === 'contact' || normalizedType === 'contacts')) {
      const contact = db.prepare(`
        SELECT * FROM contacts
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).get(id, operatorId) as any;

      if (contact) {
        const contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
        return {
          entityType: 'contact',
          id: contact.id,
          title: contactName + (contact.company_name ? ` (${contact.company_name})` : ''),
          badge: (contact.contact_type || '').toUpperCase(),
          badgeClass: 'badge-info',
          fullUrl: `/contacts/show?id=${encodeURIComponent(contact.id)}`,
          summary: [
            { label: 'Contact Type', value: (contact.contact_type || '').toUpperCase() },
            { label: 'Email', value: contact.email || '—' },
            { label: 'Phone', value: contact.phone || '—' },
            { label: 'Company', value: contact.company_name || '—' },
            { label: 'Specialty', value: contact.vendor_specialty || '—' }
          ]
        };
      }
    }

    // 5. Work Order (Maintenance)
    if (canView('maintenance:view') && (!normalizedType || normalizedType === 'work_order' || normalizedType === 'maintenance')) {
      const wo = db.prepare(`
        SELECT w.*, p.name as property_name, u.unit_number, v.first_name || ' ' || v.last_name as vendor_name
        FROM work_orders w
        JOIN properties p ON w.property_id = p.id AND p.deleted_at IS NULL
        LEFT JOIN units u ON w.unit_id = u.id AND u.deleted_at IS NULL
        LEFT JOIN contacts v ON w.vendor_contact_id = v.id AND v.deleted_at IS NULL
        WHERE w.id = ? AND w.operator_id = ? AND w.deleted_at IS NULL
      `).get(id, operatorId) as any;

      if (wo) {
        return {
          entityType: 'work_order',
          id: wo.id,
          title: `${wo.title} (WO-${wo.id.slice(-6).toUpperCase()})`,
          badge: `${(wo.status || '').toUpperCase()} • ${(wo.priority || '').toUpperCase()}`,
          badgeClass: wo.priority === 'emergency' ? 'badge-danger' : wo.status === 'completed' ? 'badge-success' : 'badge-warning',
          fullUrl: `/maintenance/show?id=${encodeURIComponent(wo.id)}`,
          summary: [
            { label: 'Ticket ID', value: `WO-${wo.id.slice(-6).toUpperCase()}` },
            { label: 'Property', value: wo.property_name + (wo.unit_number ? ` (Unit ${wo.unit_number})` : '') },
            { label: 'Category', value: (wo.category || '').toUpperCase() },
            { label: 'Assigned Vendor', value: wo.vendor_name || 'Unassigned' },
            { label: 'Est. Cost', value: formatCurrency(wo.estimated_cost_cents) },
            { label: 'Scheduled', value: formatDate(wo.scheduled_date) }
          ]
        };
      }
    }

    // 6. AP Bill
    if (canView('accounting:view') && (!normalizedType || normalizedType === 'bill' || normalizedType === 'bills')) {
      const bill = db.prepare(`
        SELECT b.*, v.first_name || ' ' || v.last_name as vendor_name, v.company_name
        FROM bills b
        LEFT JOIN contacts v ON b.vendor_id = v.id AND v.deleted_at IS NULL
        WHERE b.id = ? AND b.operator_id = ? AND b.deleted_at IS NULL
      `).get(id, operatorId) as any;

      if (bill) {
        return {
          entityType: 'bill',
          id: bill.id,
          title: `Bill #${bill.invoice_number || bill.id.slice(-6).toUpperCase()}`,
          badge: (bill.status || '').toUpperCase(),
          badgeClass: bill.status === 'paid' ? 'badge-success' : bill.status === 'approved' ? 'badge-info' : 'badge-warning',
          fullUrl: `/accounting/bills`,
          summary: [
            { label: 'Vendor', value: bill.company_name || bill.vendor_name || 'Unknown Vendor' },
            { label: 'Amount', value: formatCurrency(bill.total_amount_cents) },
            { label: 'Due Date', value: formatDate(bill.due_date) },
            { label: 'Status', value: (bill.status || '').toUpperCase() },
            { label: 'Notes', value: bill.notes || '—' }
          ]
        };
      }
    }

    // 7. Check
    if (canView('accounting:view') && (!normalizedType || normalizedType === 'check' || normalizedType === 'checks')) {
      const check = db.prepare(`
        SELECT * FROM vendor_checks
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).get(id, operatorId) as any;

      if (check) {
        return {
          entityType: 'check',
          id: check.id,
          title: `Check #${check.check_number}`,
          badge: (check.status || '').toUpperCase(),
          badgeClass: check.status === 'cleared' ? 'badge-success' : 'badge-info',
          fullUrl: `/accounting/checks`,
          summary: [
            { label: 'Payee', value: check.payee_name },
            { label: 'Amount', value: formatCurrency(check.amount_cents) },
            { label: 'Issue Date', value: formatDate(check.check_date) },
            { label: 'Status', value: (check.status || '').toUpperCase() },
            { label: 'Memo', value: check.memo || '—' }
          ]
        };
      }
    }

    // 8. Bank Deposit
    if (canView('accounting:view') && (!normalizedType || normalizedType === 'deposit' || normalizedType === 'deposits')) {
      const deposit = db.prepare(`
        SELECT * FROM bank_deposits
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).get(id, operatorId) as any;

      if (deposit) {
        return {
          entityType: 'deposit',
          id: deposit.id,
          title: `Deposit ${deposit.deposit_reference || deposit.id.slice(-6).toUpperCase()}`,
          badge: (deposit.status || '').toUpperCase(),
          badgeClass: deposit.status === 'cleared' ? 'badge-success' : 'badge-info',
          fullUrl: `/accounting/deposits`,
          summary: [
            { label: 'Deposit Date', value: formatDate(deposit.deposit_date) },
            { label: 'Total Amount', value: formatCurrency(deposit.total_amount_cents) },
            { label: 'Items Batched', value: String(deposit.item_count || 1) },
            { label: 'Status', value: (deposit.status || '').toUpperCase() }
          ]
        };
      }
    }

    return null;
  }
}
