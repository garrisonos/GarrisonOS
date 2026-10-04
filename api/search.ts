import { RequestContext } from '../core/context.js';
import { getDatabase } from '../database/client.js';
import { hasPermission } from '../core/rbac.js';

/**
 * Single search result item returned across domain entity categories.
 */
export interface SearchResultItem {
  /** Entity UUIDv7 identifier. */
  id: string;
  /** Broad search category partition. */
  category: 'properties' | 'people' | 'financials' | 'maintenance';
  /** Underlying specific entity type name. */
  entity_type: string;
  /** Primary headline or title text. */
  title: string;
  /** Contextual secondary subtitle text. */
  subtitle: string;
  /** In-app navigation URL for the entity. */
  url: string;
  /** Entity status string if applicable. */
  status?: string;
  /** Status badge label if applicable. */
  badge?: string;
  /** Financial amount in integer cents if applicable. */
  amount_cents?: number;
  /** Computed search relevance score. */
  score: number;
}

/**
 * Structured response payload containing search results grouped by category.
 */
export interface SearchResponseData {
  /** Original search query string. */
  query: string;
  /** Total matching count across all categories. */
  total: number;
  /** Flag indicating whether syntax filters excluded results. */
  has_filtered_results: boolean;
  /** Flat list of top matching search results. */
  results: SearchResultItem[];
  /** Search results partitioned by domain category. */
  categories: {
    properties: SearchResultItem[];
    people: SearchResultItem[];
    financials: SearchResultItem[];
    maintenance: SearchResultItem[];
  };
}

interface ParsedQuery {
  raw: string;
  terms: string[];
  typeFilter?: string;
  statusFilter?: string;
  vendorFilter?: string;
  minAmountCents?: number;
  maxAmountCents?: number;
}

/**
 * Parses user search query extracting keywords and structured syntax tokens like type:, status:, amount:.
 */
function parseSearchQuery(query: string): ParsedQuery {
  const parts = query.trim().split(/\s+/);
  const terms: string[] = [];
  let typeFilter: string | undefined;
  let statusFilter: string | undefined;
  let vendorFilter: string | undefined;
  let minAmountCents: number | undefined;
  let maxAmountCents: number | undefined;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower.startsWith('type:')) {
      typeFilter = lower.slice(5).trim();
    } else if (lower.startsWith('status:')) {
      statusFilter = lower.slice(7).trim();
    } else if (lower.startsWith('vendor:')) {
      vendorFilter = lower.slice(7).trim();
    } else if (lower.startsWith('amount:>')) {
      const dollars = parseFloat(lower.slice(8));
      if (!isNaN(dollars)) minAmountCents = Math.round(dollars * 100);
    } else if (lower.startsWith('amount:<')) {
      const dollars = parseFloat(lower.slice(8));
      if (!isNaN(dollars)) maxAmountCents = Math.round(dollars * 100);
    } else if (part.length > 0) {
      terms.push(part);
    }
  }

  return {
    raw: query,
    terms,
    typeFilter,
    statusFilter,
    vendorFilter,
    minAmountCents,
    maxAmountCents
  };
}

/**
 * Universal Search Service providing scoped cross-entity queries.
 */
export class UniversalSearchService {
  /**
   * Execute universal search across all entities accessible to the user in their active operator context.
   */
  public static search(
    queryStr: string,
    userRole: string = 'manager',
    limitPerCategory: number = 3,
    opId?: string
  ): SearchResponseData {
    const operatorId = opId || RequestContext.getOperatorId();
    const db = getDatabase();

    const parsed = parseSearchQuery(queryStr);
    const searchTerm = parsed.terms.join(' ').trim();
    const isBlank = searchTerm.length === 0 && !parsed.typeFilter && !parsed.statusFilter;

    if (isBlank) {
      return {
        query: queryStr,
        total: 0,
        has_filtered_results: false,
        results: [],
        categories: { properties: [], people: [], financials: [], maintenance: [] }
      };
    }

    const sanitizedSearchTerm = searchTerm.replace(/[\\%_]/g, '\\$&');
    const likeTerm = `%${sanitizedSearchTerm}%`;
    const prefixTerm = `${sanitizedSearchTerm}%`;

    const canProps = hasPermission(userRole, 'properties:view');
    const canContacts = hasPermission(userRole, 'contacts:view');
    const canLeases = hasPermission(userRole, 'leases:view');
    const canAccounting = hasPermission(userRole, 'accounting:view');
    const canMaintenance = hasPermission(userRole, 'maintenance:view');

    let hasFilteredResults = false;
    if (!canProps || !canContacts || !canLeases || !canAccounting || !canMaintenance) {
      hasFilteredResults = true;
    }

    const propertiesResults: SearchResultItem[] = [];
    const peopleResults: SearchResultItem[] = [];
    const financialsResults: SearchResultItem[] = [];
    const maintenanceResults: SearchResultItem[] = [];

    // --- 1. PROPERTIES & UNITS ---
    if (canProps && (!parsed.typeFilter || parsed.typeFilter === 'property' || parsed.typeFilter === 'properties' || parsed.typeFilter === 'unit' || parsed.typeFilter === 'units')) {
      if (!parsed.typeFilter || parsed.typeFilter.startsWith('prop')) {
        const propRows = db.prepare(`
          SELECT id, name, property_type, address_line1, city, state, postal_code
          FROM properties
          WHERE operator_id = ? AND deleted_at IS NULL AND (
            name LIKE ? ESCAPE '\\' OR address_line1 LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\'
          )
          LIMIT ?
        `).all(operatorId, likeTerm, likeTerm, likeTerm, prefixTerm, limitPerCategory * 2) as any[];

        for (const p of propRows) {
          const isPrefix = p.name.toLowerCase().startsWith(searchTerm.toLowerCase()) || p.id.toLowerCase().startsWith(searchTerm.toLowerCase());
          propertiesResults.push({
            id: p.id,
            category: 'properties',
            entity_type: 'property',
            title: p.name,
            subtitle: `${p.address_line1}, ${p.city}, ${p.state} ${p.postal_code}`,
            url: `/properties/show?id=${encodeURIComponent(p.id)}`,
            badge: p.property_type.replace(/_/g, ' '),
            score: isPrefix ? 10 : 5
          });
        }
      }

      if (!parsed.typeFilter || parsed.typeFilter.startsWith('unit')) {
        const unitRows = db.prepare(`
          SELECT u.id, u.unit_number, u.status, u.market_rent_cents, p.name as property_name, p.id as property_id
          FROM units u
          JOIN properties p ON u.property_id = p.id
          WHERE u.operator_id = ? AND u.deleted_at IS NULL AND (
            u.unit_number LIKE ? ESCAPE '\\' OR u.id LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\'
          )
          ${parsed.statusFilter ? 'AND u.status = ?' : ''}
          LIMIT ?
        `).all(
          ...(parsed.statusFilter
            ? [operatorId, likeTerm, prefixTerm, likeTerm, parsed.statusFilter, limitPerCategory * 2]
            : [operatorId, likeTerm, prefixTerm, likeTerm, limitPerCategory * 2])
        ) as any[];

        for (const u of unitRows) {
          const isPrefix = u.unit_number.toLowerCase().startsWith(searchTerm.toLowerCase()) || u.id.toLowerCase().startsWith(searchTerm.toLowerCase());
          propertiesResults.push({
            id: u.id,
            category: 'properties',
            entity_type: 'unit',
            title: `Unit ${u.unit_number} – ${u.property_name}`,
            subtitle: `Status: ${u.status.replace(/_/g, ' ')} | Rent: $${(u.market_rent_cents / 100).toFixed(2)}/mo`,
            url: `/properties/show?id=${encodeURIComponent(u.property_id)}#unit-${encodeURIComponent(u.id)}`,
            status: u.status,
            badge: 'Unit',
            score: isPrefix ? 9 : 4
          });
        }
      }
    }

    // --- 2. PEOPLE & LEASES ---
    if (canContacts && (!parsed.typeFilter || parsed.typeFilter === 'contact' || parsed.typeFilter === 'tenant' || parsed.typeFilter === 'vendor' || parsed.typeFilter === 'owner')) {
      const contactRows = db.prepare(`
        SELECT id, first_name, last_name, company_name, email, phone, contact_type
        FROM contacts
        WHERE operator_id = ? AND deleted_at IS NULL AND (
          first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\' OR company_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\'
        )
        ${parsed.typeFilter && ['tenant', 'vendor', 'owner'].includes(parsed.typeFilter) ? 'AND contact_type = ?' : ''}
        LIMIT ?
      `).all(
        ...(parsed.typeFilter && ['tenant', 'vendor', 'owner'].includes(parsed.typeFilter)
          ? [operatorId, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, prefixTerm, parsed.typeFilter, limitPerCategory * 2]
          : [operatorId, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, prefixTerm, limitPerCategory * 2])
      ) as any[];

      for (const c of contactRows) {
        const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company_name || 'Contact';
        const isPrefix = fullName.toLowerCase().startsWith(searchTerm.toLowerCase()) || c.id.toLowerCase().startsWith(searchTerm.toLowerCase());
        peopleResults.push({
          id: c.id,
          category: 'people',
          entity_type: 'contact',
          title: fullName,
          subtitle: `${c.contact_type.toUpperCase()} | ${c.email || c.phone || 'No direct contact'}`,
          url: `/contacts/show?id=${encodeURIComponent(c.id)}`,
          badge: c.contact_type,
          score: isPrefix ? 10 : 5
        });
      }
    }

    if (canLeases && (!parsed.typeFilter || parsed.typeFilter === 'lease' || parsed.typeFilter === 'leases')) {
      const leaseRows = db.prepare(`
        SELECT l.id, l.status, l.rent_amount_cents, p.name as property_name, u.unit_number
        FROM leases l
        JOIN units u ON l.unit_id = u.id
        JOIN properties p ON u.property_id = p.id
        WHERE l.operator_id = ? AND l.deleted_at IS NULL AND (
          l.id LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR u.unit_number LIKE ? ESCAPE '\\'
        )
        ${parsed.statusFilter ? 'AND l.status = ?' : ''}
        LIMIT ?
      `).all(
        ...(parsed.statusFilter
          ? [operatorId, prefixTerm, likeTerm, likeTerm, parsed.statusFilter, limitPerCategory * 2]
          : [operatorId, prefixTerm, likeTerm, likeTerm, limitPerCategory * 2])
      ) as any[];

      for (const l of leaseRows) {
        peopleResults.push({
          id: l.id,
          category: 'people',
          entity_type: 'lease',
          title: `Lease: ${l.property_name} ${l.unit_number ? '- Unit ' + l.unit_number : ''}`,
          subtitle: `Status: ${l.status} | Rent: $${(l.rent_amount_cents / 100).toFixed(2)}`,
          url: `/leases/show?id=${encodeURIComponent(l.id)}`,
          status: l.status,
          badge: 'Lease',
          score: l.id.toLowerCase().startsWith(searchTerm.toLowerCase()) ? 10 : 4
        });
      }
    }

    // --- 3. FINANCIALS (BILLS, CHECKS, DEPOSITS, ACCOUNTS) ---
    if (canAccounting && (!parsed.typeFilter || ['bill', 'bills', 'check', 'checks', 'deposit', 'deposits', 'account'].includes(parsed.typeFilter))) {
      // Bills
      if (!parsed.typeFilter || parsed.typeFilter.startsWith('bill')) {
        const billRows = db.prepare(`
          SELECT b.id, b.invoice_number, b.total_amount_cents, b.status, b.due_date, c.first_name, c.last_name, c.company_name
          FROM bills b
          LEFT JOIN contacts c ON b.vendor_id = c.id
          WHERE b.operator_id = ? AND b.deleted_at IS NULL AND (
            b.invoice_number LIKE ? ESCAPE '\\' OR b.id LIKE ? ESCAPE '\\' OR c.company_name LIKE ? ESCAPE '\\' OR c.first_name LIKE ? ESCAPE '\\'
          )
          ${parsed.statusFilter ? 'AND b.status = ?' : ''}
          ${parsed.vendorFilter ? "AND (c.company_name LIKE ? ESCAPE '\\' OR c.first_name LIKE ? ESCAPE '\\')" : ''}
          ${parsed.minAmountCents !== undefined ? 'AND b.total_amount_cents >= ?' : ''}
          ${parsed.maxAmountCents !== undefined ? 'AND b.total_amount_cents <= ?' : ''}
          LIMIT ?
        `).all(
          operatorId,
          likeTerm,
          prefixTerm,
          likeTerm,
          likeTerm,
          ...(parsed.statusFilter ? [parsed.statusFilter] : []),
          ...(parsed.vendorFilter ? [`%${parsed.vendorFilter}%`, `%${parsed.vendorFilter}%`] : []),
          ...(parsed.minAmountCents !== undefined ? [parsed.minAmountCents] : []),
          ...(parsed.maxAmountCents !== undefined ? [parsed.maxAmountCents] : []),
          limitPerCategory * 2
        ) as any[];

        for (const b of billRows) {
          const vendorName = b.company_name || `${b.first_name || ''} ${b.last_name || ''}`.trim() || 'Vendor';
          const isPrefix = b.invoice_number.toLowerCase().startsWith(searchTerm.toLowerCase()) || b.id.toLowerCase().startsWith(searchTerm.toLowerCase());
          financialsResults.push({
            id: b.id,
            category: 'financials',
            entity_type: 'bill',
            title: `Bill #${b.invoice_number} – ${vendorName}`,
            subtitle: `Amount: $${(b.total_amount_cents / 100).toFixed(2)} | Status: ${b.status} | Due: ${new Date(b.due_date).toISOString().slice(0, 10)}`,
            url: `/accounting/bills#bill-${encodeURIComponent(b.id)}`,
            status: b.status,
            badge: 'AP Bill',
            amount_cents: b.total_amount_cents,
            score: isPrefix ? 10 : 5
          });
        }
      }

      // Checks
      if (!parsed.typeFilter || parsed.typeFilter.startsWith('check')) {
        const checkRows = db.prepare(`
          SELECT id, check_number, payee_name, amount_cents, status, check_date
          FROM vendor_checks
          WHERE operator_id = ? AND deleted_at IS NULL AND (
            check_number LIKE ? ESCAPE '\\' OR payee_name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\'
          )
          ${parsed.statusFilter ? 'AND status = ?' : ''}
          ${parsed.minAmountCents !== undefined ? 'AND amount_cents >= ?' : ''}
          ${parsed.maxAmountCents !== undefined ? 'AND amount_cents <= ?' : ''}
          LIMIT ?
        `).all(
          operatorId,
          likeTerm,
          likeTerm,
          prefixTerm,
          ...(parsed.statusFilter ? [parsed.statusFilter] : []),
          ...(parsed.minAmountCents !== undefined ? [parsed.minAmountCents] : []),
          ...(parsed.maxAmountCents !== undefined ? [parsed.maxAmountCents] : []),
          limitPerCategory * 2
        ) as any[];

        for (const chk of checkRows) {
          const isPrefix = chk.check_number.toLowerCase().startsWith(searchTerm.toLowerCase()) || chk.id.toLowerCase().startsWith(searchTerm.toLowerCase());
          financialsResults.push({
            id: chk.id,
            category: 'financials',
            entity_type: 'check',
            title: `Check #${chk.check_number} – ${chk.payee_name}`,
            subtitle: `Amount: $${(chk.amount_cents / 100).toFixed(2)} | Status: ${chk.status}`,
            url: `/accounting/checks#check-${encodeURIComponent(chk.id)}`,
            status: chk.status,
            badge: 'Check',
            amount_cents: chk.amount_cents,
            score: isPrefix ? 10 : 5
          });
        }
      }

      // Bank Deposits
      if (!parsed.typeFilter || parsed.typeFilter.startsWith('deposit')) {
        const depRows = db.prepare(`
          SELECT id, deposit_reference, total_amount_cents, deposit_date, status, memo
          FROM bank_deposits
          WHERE operator_id = ? AND deleted_at IS NULL AND (
            deposit_reference LIKE ? ESCAPE '\\' OR memo LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\'
          )
          ${parsed.statusFilter ? 'AND status = ?' : ''}
          LIMIT ?
        `).all(
          operatorId,
          likeTerm,
          likeTerm,
          prefixTerm,
          ...(parsed.statusFilter ? [parsed.statusFilter] : []),
          limitPerCategory * 2
        ) as any[];

        for (const dep of depRows) {
          financialsResults.push({
            id: dep.id,
            category: 'financials',
            entity_type: 'deposit',
            title: `Bank Deposit ${dep.deposit_reference || dep.id.slice(0, 8)}`,
            subtitle: `Total: $${(dep.total_amount_cents / 100).toFixed(2)} | Date: ${new Date(dep.deposit_date).toISOString().slice(0, 10)}`,
            url: `/accounting/deposits#deposit-${encodeURIComponent(dep.id)}`,
            status: dep.status,
            badge: 'Deposit',
            amount_cents: dep.total_amount_cents,
            score: 7
          });
        }
      }
    }

    // --- 4. MAINTENANCE WORK ORDERS ---
    if (canMaintenance && (!parsed.typeFilter || parsed.typeFilter === 'work_order' || parsed.typeFilter === 'maintenance')) {
      const woRows = db.prepare(`
        SELECT w.id, w.title, w.status, w.priority, p.name as property_name
        FROM work_orders w
        LEFT JOIN properties p ON w.property_id = p.id
        WHERE w.operator_id = ? AND w.deleted_at IS NULL AND (
          w.title LIKE ? ESCAPE '\\' OR w.description LIKE ? ESCAPE '\\' OR w.id LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\'
        )
        ${parsed.statusFilter ? 'AND w.status = ?' : ''}
        LIMIT ?
      `).all(
        ...(parsed.statusFilter
          ? [operatorId, likeTerm, likeTerm, prefixTerm, likeTerm, parsed.statusFilter, limitPerCategory * 2]
          : [operatorId, likeTerm, likeTerm, prefixTerm, likeTerm, limitPerCategory * 2])
      ) as any[];

      for (const wo of woRows) {
        const isPrefix = wo.title.toLowerCase().startsWith(searchTerm.toLowerCase()) || wo.id.toLowerCase().startsWith(searchTerm.toLowerCase());
        maintenanceResults.push({
          id: wo.id,
          category: 'maintenance',
          entity_type: 'work_order',
          title: `WO: ${wo.title}`,
          subtitle: `Property: ${wo.property_name || 'Unassigned'} | Priority: ${wo.priority} | Status: ${wo.status}`,
          url: `/maintenance/show?id=${encodeURIComponent(wo.id)}`,
          status: wo.status,
          badge: wo.priority,
          score: isPrefix ? 9 : 4
        });
      }
    }

    // Sort each category by score desc, title asc
    const sortFn = (a: SearchResultItem, b: SearchResultItem) => b.score - a.score || a.title.localeCompare(b.title);
    propertiesResults.sort(sortFn);
    peopleResults.sort(sortFn);
    financialsResults.sort(sortFn);
    maintenanceResults.sort(sortFn);

    const combinedAll = [
      ...propertiesResults,
      ...peopleResults,
      ...financialsResults,
      ...maintenanceResults
    ].sort(sortFn);

    return {
      query: queryStr,
      total: combinedAll.length,
      has_filtered_results: hasFilteredResults,
      results: combinedAll,
      categories: {
        properties: propertiesResults.slice(0, limitPerCategory),
        people: peopleResults.slice(0, limitPerCategory),
        financials: financialsResults.slice(0, limitPerCategory),
        maintenance: maintenanceResults.slice(0, limitPerCategory)
      }
    };
  }
}

export const SearchService = UniversalSearchService;

