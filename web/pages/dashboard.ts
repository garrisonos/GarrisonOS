import { html, raw, SafeHtml } from '../lib/html.js';
import { DashboardCard, HookRegistry } from '../lib/hooks.js';
import { PageContext, PageResult } from '../lib/page-context.js';

/**
 * Bedroom occupancy breakdown structure.
 */
export interface BedroomTypeMetric {
  bedroomType: string;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  occupancyRatePercentage: number;
}

/**
 * Occupancy metrics response structure.
 */
export interface OccupancyMetrics {
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  occupancyRatePercentage: number;
  totalMarketRentCents: number;
  byBedroomType: BedroomTypeMetric[];
}

/**
 * Financial rent roll summary structure.
 */
export interface FinancialSummary {
  totalUnits: number;
  totalScheduledRentCents: number;
  totalDelinquencyCents: number;
  delinquentUnitsCount: number;
}

/**
 * Maintenance metrics structure.
 */
export interface MaintenanceMetrics {
  openOrders: number;
  completedThisMonth: number;
  avgResolutionTimeHours: number;
}

/**
 * Portfolio entity summary for dropdown filtering.
 */
export interface PortfolioOption {
  id: string;
  name: string;
  property_count?: number;
  unit_count?: number;
}

/**
 * Property entity summary for dropdown filtering.
 */
export interface PropertyOption {
  id: string;
  name: string;
  portfolio_id?: string | null;
  unit_count?: number;
}

/**
 * Options required to render the full dashboard page.
 */
export interface DashboardPageOptions {
  portfolios: PortfolioOption[];
  properties: PropertyOption[];
  selectedPortfolio?: string;
  selectedPropertyId?: string;
  focusPreset: 'overview' | 'occupancy' | 'financial' | 'maintenance';
  occupancyMetrics: OccupancyMetrics;
  financialSummary: FinancialSummary;
  maintenanceMetrics: MaintenanceMetrics;
  dashboardCards: DashboardCard[];
  recentTransactions: Array<{
    id: string;
    transaction_date: number;
    transaction_type: string;
    description: string;
    amount_cents: number;
  }>;
  openWorkOrders: Array<{
    id: string;
    title: string;
    property_id?: string;
    property_name: string;
    priority: string;
  }>;
}

/**
 * Format timestamp into readable human month & day.
 *
 * @param epochMs Milliseconds timestamp.
 * @returns Formatted date string.
 */
function formatDate(epochMs: number): string {
  try {
    if (!Number.isFinite(epochMs)) return '';
    const d = new Date(epochMs);
    if (!Number.isFinite(d.getTime())) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
  } catch {
    return '';
  }
}

/**
 * Format cents into USD currency string.
 *
 * @param cents Integer currency in cents.
 * @returns Formatted currency string.
 */
function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Donut chart slice definition.
 */
interface DonutSlice {
  label: string;
  value: number;
  color: string;
  countLabel?: string;
}

/**
 * Renders a lightweight, responsive native SVG donut chart with center metric and legend.
 *
 * @param slices Array of slices to render.
 * @param centerVal Big bold center headline text.
 * @param centerLbl Subtitle label beneath center value.
 * @returns SafeHtml representing the SVG and legend markup.
 */
function renderDonutChart(slices: DonutSlice[], centerVal: string, centerLbl: string): SafeHtml {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const circumference = 2 * Math.PI * 40; // ~251.327

  let accumulatedOffset = 0;
  const svgCircles: SafeHtml[] = [];

  if (total === 0) {
    // Empty state ring
    svgCircles.push(html`
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="transparent"
        stroke="var(--border-color)"
        stroke-width="12"
      />
    `);
  } else {
    for (const slice of slices) {
      if (slice.value <= 0) continue;
      const sliceRatio = slice.value / total;
      const strokeLength = sliceRatio * circumference;
      const dashArray = `${strokeLength.toFixed(2)} ${(circumference - strokeLength).toFixed(2)}`;
      const strokeOffset = (-accumulatedOffset).toFixed(2);

      svgCircles.push(html`
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="transparent"
          stroke="${slice.color}"
          stroke-width="12"
          stroke-dasharray="${dashArray}"
          stroke-dashoffset="${strokeOffset}"
          transform="rotate(-90 50 50)"
          style="transition: stroke-dasharray 0.3s ease;"
        />
      `);

      accumulatedOffset += strokeLength;
    }
  }

  const legendItems = slices.map((slice) => {
    const percentage = total > 0 ? Math.round((Math.max(0, slice.value) / total) * 100) : 0;
    const countDisplay = slice.countLabel || `${slice.value} (${percentage}%)`;

    return html`
      <div class="legend-item">
        <div class="legend-indicator">
          <span class="legend-dot" style="background-color: ${slice.color};"></span>
          <span>${slice.label}</span>
        </div>
        <span class="legend-val">${countDisplay}</span>
      </div>
    `;
  });

  return html`
    <div class="chart-body">
      <div class="chart-svg-wrapper">
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="transparent"
            stroke="var(--bg-subtle)"
            stroke-width="12"
          />
          ${svgCircles}
        </svg>
        <div class="chart-center-text">
          <div class="chart-center-val">${centerVal}</div>
          <div class="chart-center-lbl">${centerLbl}</div>
        </div>
      </div>
      <div class="chart-legend">
        ${legendItems}
      </div>
    </div>
  `;
}

/**
 * Builds query parameter string while updating the focus view preset.
 *
 * @param targetFocus New focus mode.
 * @param portfolio Selected portfolio.
 * @param propertyId Selected property.
 * @returns Query string.
 */
function buildFilterUrl(targetFocus: string, portfolio?: string, propertyId?: string): string {
  const parts: string[] = [];
  if (portfolio) parts.push(`portfolio=${encodeURIComponent(portfolio)}`);
  if (propertyId) parts.push(`property_id=${encodeURIComponent(propertyId)}`);
  if (targetFocus && targetFocus !== 'overview') parts.push(`focus=${encodeURIComponent(targetFocus)}`);
  return parts.length > 0 ? `/?${parts.join('&')}` : '/';
}

/**
 * Renders the primary dashboard page template with filters, configurable headline cards,
 * SVG charts, and compact recent activity tables.
 *
 * @param options Page configuration and data options.
 * @returns SafeHtml page content.
 */
export function renderDashboardPage(options: DashboardPageOptions): SafeHtml {
  const {
    portfolios,
    properties,
    selectedPortfolio,
    selectedPropertyId,
    focusPreset,
    occupancyMetrics,
    financialSummary,
    maintenanceMetrics,
    recentTransactions,
    openWorkOrders
  } = options;

  // --- Dynamic Headline Numbers ---
  const headlineCards: SafeHtml[] = [];

  if (focusPreset === 'occupancy') {
    headlineCards.push(html`
      <div class="card metric-card">
        <div class="metric-label">Overall Occupancy</div>
        <div class="metric-value ${occupancyMetrics.occupancyRatePercentage >= 90 ? 'text-success' : 'text-warning'}">
          ${occupancyMetrics.occupancyRatePercentage}%
        </div>
        <div class="metric-subtitle">${occupancyMetrics.occupiedUnits} / ${occupancyMetrics.totalUnits} Units Occupied</div>
      </div>
    `);

    for (const b of occupancyMetrics.byBedroomType) {
      headlineCards.push(html`
        <div class="card metric-card">
          <div class="metric-label">${b.bedroomType} Occupancy</div>
          <div class="metric-value font-semibold">
            ${b.occupancyRatePercentage}%
          </div>
          <div class="metric-subtitle">${b.occupiedUnits} / ${b.totalUnits} Units (${b.vacantUnits} vacant)</div>
        </div>
      `);
    }
  } else if (focusPreset === 'financial') {
    const avgRent = occupancyMetrics.totalUnits > 0
      ? Math.round(financialSummary.totalScheduledRentCents / occupancyMetrics.totalUnits)
      : 0;
    const collectionRate = financialSummary.totalScheduledRentCents > 0
      ? Math.max(0, Math.round(((financialSummary.totalScheduledRentCents - financialSummary.totalDelinquencyCents) / financialSummary.totalScheduledRentCents) * 100))
      : 100;

    headlineCards.push(
      html`
        <div class="card metric-card">
          <div class="metric-label">Scheduled Monthly Rent</div>
          <div class="metric-value">$${formatCurrency(financialSummary.totalScheduledRentCents)}</div>
          <div class="metric-subtitle">$${formatCurrency(avgRent)} / unit avg</div>
        </div>
      `,
      html`
        <div class="card metric-card">
          <div class="metric-label">Total Past Due</div>
          <div class="metric-value ${financialSummary.totalDelinquencyCents > 0 ? 'text-danger' : 'text-success'}">
            $${formatCurrency(financialSummary.totalDelinquencyCents)}
          </div>
          <div class="metric-subtitle">${financialSummary.delinquentUnitsCount} Delinquent Unit${financialSummary.delinquentUnitsCount === 1 ? '' : 's'}</div>
        </div>
      `,
      html`
        <div class="card metric-card">
          <div class="metric-label">Collection Rate</div>
          <div class="metric-value ${collectionRate >= 95 ? 'text-success' : 'text-warning'}">${collectionRate}%</div>
          <div class="metric-subtitle">Rent collected vs scheduled</div>
        </div>
      `,
      html`
        <div class="card metric-card">
          <div class="metric-label">Market Rent Potential</div>
          <div class="metric-value">$${formatCurrency(occupancyMetrics.totalMarketRentCents)}</div>
          <div class="metric-subtitle">Based on active unit prices</div>
        </div>
      `
    );
  } else if (focusPreset === 'maintenance') {
    headlineCards.push(
      html`
        <div class="card metric-card">
          <div class="metric-label">Open Work Orders</div>
          <div class="metric-value ${maintenanceMetrics.openOrders > 0 ? 'text-warning' : 'text-success'}">
            ${maintenanceMetrics.openOrders}
          </div>
          <div class="metric-subtitle">Pending maintenance tickets</div>
        </div>
      `,
      html`
        <div class="card metric-card">
          <div class="metric-label">Completed This Month</div>
          <div class="metric-value text-success">${maintenanceMetrics.completedThisMonth}</div>
          <div class="metric-subtitle">Tickets closed & resolved</div>
        </div>
      `,
      html`
        <div class="card metric-card">
          <div class="metric-label">Avg Resolution Time</div>
          <div class="metric-value">${maintenanceMetrics.avgResolutionTimeHours}h</div>
          <div class="metric-subtitle">From ticket open to completion</div>
        </div>
      `,
      html`
        <div class="card metric-card">
          <div class="metric-label">Operational Status</div>
          <div class="metric-value text-success">Optimal</div>
          <div class="metric-subtitle">Dispatch & facilities online</div>
        </div>
      `
    );
  } else {
    // Default 'overview' preset
    const avgRent = occupancyMetrics.totalUnits > 0
      ? Math.round(financialSummary.totalScheduledRentCents / occupancyMetrics.totalUnits)
      : 0;

    headlineCards.push(
      html`
        <div class="card metric-card">
          <div class="metric-label">Occupancy Rate</div>
          <div class="metric-value ${occupancyMetrics.occupancyRatePercentage >= 90 ? 'text-success' : 'text-warning'}">
            ${occupancyMetrics.occupancyRatePercentage}%
          </div>
          <div class="metric-subtitle">${occupancyMetrics.occupiedUnits} / ${occupancyMetrics.totalUnits} Units Occupied</div>
        </div>
      `,
      html`
        <div class="card metric-card">
          <div class="metric-label">Total Past Due</div>
          <div class="metric-value ${financialSummary.totalDelinquencyCents > 0 ? 'text-danger' : 'text-success'}">
            $${formatCurrency(financialSummary.totalDelinquencyCents)}
          </div>
          <div class="metric-subtitle">${financialSummary.delinquentUnitsCount} Delinquent Unit${financialSummary.delinquentUnitsCount === 1 ? '' : 's'}</div>
        </div>
      `,
      html`
        <div class="card metric-card">
          <div class="metric-label">Open Work Orders</div>
          <div class="metric-value ${maintenanceMetrics.openOrders > 0 ? 'text-warning' : 'text-success'}">
            ${maintenanceMetrics.openOrders}
          </div>
          <div class="metric-subtitle">${maintenanceMetrics.completedThisMonth} closed this month</div>
        </div>
      `,
      html`
        <div class="card metric-card">
          <div class="metric-label">Monthly Scheduled Rent</div>
          <div class="metric-value">$${formatCurrency(financialSummary.totalScheduledRentCents)}</div>
          <div class="metric-subtitle">$${formatCurrency(avgRent)} / unit avg</div>
        </div>
      `
    );
  }

  // --- SVG Donut Chart 1: Bedroom Type Occupancy Breakdown ---
  const bedroomColors: Record<string, string> = {
    'Studio': '#3b82f6',
    '1 Bedroom': '#10b981',
    '2 Bedroom': '#8b5cf6',
    '3+ Bedroom': '#f59e0b',
  };

  const bedroomSlices: DonutSlice[] = (occupancyMetrics.byBedroomType || []).map((b: any) => {
    const label = b.bedroomType || b.label || 'Other';
    const total = b.totalUnits ?? b.total ?? 0;
    const occupied = b.occupiedUnits ?? b.occupied ?? 0;
    const rate = b.occupancyRatePercentage ?? b.occupancyRate ?? (total > 0 ? Math.round((occupied / total) * 100) : 0);
    return {
      label,
      value: total,
      color: bedroomColors[label] || '#64748b',
      countLabel: `${occupied}/${total} (${rate}%)`
    };
  });

  const occRateCenter = occupancyMetrics.occupancyRatePercentage ?? (occupancyMetrics as any).occupancyRate ?? 0;
  const bedroomChart = renderDonutChart(
    bedroomSlices,
    `${occRateCenter}%`,
    'Occupied'
  );

  // --- SVG Donut Chart 2: Rent Collection vs Delinquency ---
  const collectedCents = Math.max(0, financialSummary.totalScheduledRentCents - financialSummary.totalDelinquencyCents);
  const financialSlices: DonutSlice[] = [
    {
      label: 'Current / Collected',
      value: collectedCents,
      color: '#10b981',
      countLabel: `$${formatCurrency(collectedCents)}`
    },
    {
      label: 'Past Due Delinquency',
      value: financialSummary.totalDelinquencyCents,
      color: '#ef4444',
      countLabel: `$${formatCurrency(financialSummary.totalDelinquencyCents)}`
    }
  ];

  const financialChart = renderDonutChart(
    financialSlices,
    `$${formatCurrency(financialSummary.totalDelinquencyCents)}`,
    'Past Due'
  );

  // --- Filter Options ---
  const totalUnitsInProps = properties.reduce((sum, p) => sum + (p.unit_count || 0), 0);
  const portfolioOptions = portfolios.map((p) => {
    const countInfo = (p.property_count !== undefined)
      ? ` (${p.property_count} Properties • ${p.unit_count || 0} Units)`
      : '';
    return html`
      <option value="${p.name}" ${selectedPortfolio === p.name ? 'selected' : ''}>${p.name}${countInfo}</option>
    `;
  });

  const propertyOptions = properties.map((p) => {
    const countInfo = (p.unit_count !== undefined) ? ` (${p.unit_count} Units)` : '';
    return html`
      <option value="${p.id}" ${selectedPropertyId === p.id ? 'selected' : ''}>${p.name}${countInfo}</option>
    `;
  });

  // --- Compact Recent Transactions (5 Rows Max) ---
  const transactionsRows = recentTransactions.slice(0, 5).map((tx) => {
    let amountHtml: SafeHtml;
    if (tx.transaction_type === 'payment') {
      amountHtml = html`<span class="text-success font-bold">+$${formatCurrency(tx.amount_cents)}</span>`;
    } else if (tx.transaction_type === 'expense') {
      amountHtml = html`<span class="text-danger font-bold">-$${formatCurrency(tx.amount_cents)}</span>`;
    } else {
      amountHtml = html`<span>$${formatCurrency(tx.amount_cents)}</span>`;
    }

    const typeFormatted = tx.transaction_type
      ? tx.transaction_type.charAt(0).toUpperCase() + tx.transaction_type.slice(1)
      : '';

    return html`
      <tr data-entity="transaction" data-id="${tx.id}">
        <td>${formatDate(tx.transaction_date)}</td>
        <td><span class="badge">${typeFormatted}</span></td>
        <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <a href="/accounting?id=${encodeURIComponent(tx.id)}" data-entity-id="${tx.id}" data-entity-type="transaction"><strong>${tx.description}</strong></a>
        </td>
        <td class="text-right">${amountHtml}</td>
      </tr>
    `;
  });

  if (transactionsRows.length === 0) {
    transactionsRows.push(html`
      <tr>
        <td colspan="4" class="text-center text-muted">No recent transactions recorded.</td>
      </tr>
    `);
  }

  // --- Compact Pending Repairs (5 Rows Max) ---
  const workOrdersRows = openWorkOrders.slice(0, 5).map((wo) => {
    const priorityClass = wo.priority === 'emergency' ? 'badge-danger' : 'badge-warning';
    const priorityFormatted = wo.priority ? wo.priority.charAt(0).toUpperCase() + wo.priority.slice(1) : '';
    const ticketNumber = `WO-${wo.id.slice(-6).toUpperCase()}`;

    return html`
      <tr data-entity="work_order" data-id="${wo.id}">
        <td>
          <a href="/maintenance/show?id=${encodeURIComponent(wo.id)}" data-entity-id="${wo.id}" data-entity-type="work_order"><strong>${wo.title}</strong></a>
          <div class="text-xs text-muted font-mono">${ticketNumber}</div>
        </td>
        <td>
          ${wo.property_id
            ? html`<a href="/properties/show?id=${encodeURIComponent(wo.property_id)}" data-entity-id="${wo.property_id}" data-entity-type="property">${wo.property_name}</a>`
            : wo.property_name}
        </td>
        <td><span class="badge ${priorityClass}">${priorityFormatted}</span></td>
        <td class="text-right">
          <a href="/maintenance/show?id=${encodeURIComponent(wo.id)}" data-entity-id="${wo.id}" data-entity-type="work_order" class="btn btn-sm btn-secondary">Review</a>
        </td>
      </tr>
    `;
  });

  if (workOrdersRows.length === 0) {
    workOrdersRows.push(html`
      <tr>
        <td colspan="4" class="text-center text-muted">No open work orders pending.</td>
      </tr>
    `);
  }

  return html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Executive Portfolio Dashboard</h1>
        <p class="page-subtitle">Real-time occupancy, unit breakdown, cash position, and facilities status.</p>
      </div>
      <div class="btn-group">
        <a href="/accounting/rent-roll" class="btn btn-secondary">Rent Roll</a>
        <a href="/maintenance" class="btn btn-primary">+ Work Order</a>
      </div>
    </div>

    <!-- Filter Bar: Portfolio, Property, and View Presets -->
    <form method="GET" action="/" class="dashboard-filter-bar">
      <div class="filter-controls-group">
        <label for="portfolio-select" class="text-sm font-semibold">Portfolio:</label>
        <select id="portfolio-select" name="portfolio" class="filter-select" onchange="this.form.submit()">
          <option value="">All Portfolios</option>
          ${portfolioOptions}
        </select>

        <label for="property-select" class="text-sm font-semibold" style="margin-left: 0.5rem;">Property:</label>
        <select id="property-select" name="property_id" class="filter-select" onchange="this.form.submit()">
          <option value="">All Properties</option>
          ${propertyOptions}
        </select>

        ${selectedPortfolio || selectedPropertyId ? html`
          <a href="/" class="btn btn-sm btn-secondary" style="margin-left: 0.25rem;">Reset Filter</a>
        ` : raw('')}
      </div>

      <div class="filter-controls-group">
        <span class="text-sm text-muted font-semibold">Headline View:</span>
        <div class="focus-pills">
          <a href="${buildFilterUrl('overview', selectedPortfolio, selectedPropertyId)}"
             class="focus-pill ${focusPreset === 'overview' ? 'active' : ''}">Overview</a>
          <a href="${buildFilterUrl('occupancy', selectedPortfolio, selectedPropertyId)}"
             class="focus-pill ${focusPreset === 'occupancy' ? 'active' : ''}">Occupancy</a>
          <a href="${buildFilterUrl('financial', selectedPortfolio, selectedPropertyId)}"
             class="focus-pill ${focusPreset === 'financial' ? 'active' : ''}">Financial</a>
          <a href="${buildFilterUrl('maintenance', selectedPortfolio, selectedPropertyId)}"
             class="focus-pill ${focusPreset === 'maintenance' ? 'active' : ''}">Maintenance</a>
        </div>
      </div>
    </form>

    <!-- Configurable Headline KPI Metrics -->
    <div class="metrics-grid">
      ${headlineCards}
    </div>

    <!-- Responsive SVG Donut Charts -->
    <div class="chart-grid">
      <div class="chart-card">
        <div class="chart-header">
          <div>
            <h2 class="chart-title">Occupancy by Bedroom Type</h2>
            <div class="chart-subtitle">Unit distribution & physical occupancy</div>
          </div>
          <span class="badge">${occupancyMetrics.totalUnits} Units</span>
        </div>
        ${bedroomChart}
      </div>

      <div class="chart-card">
        <div class="chart-header">
          <div>
            <h2 class="chart-title">Rent Collection & Delinquency</h2>
            <div class="chart-subtitle">Scheduled revenue vs. uncollected past due</div>
          </div>
          <span class="badge ${financialSummary.totalDelinquencyCents > 0 ? 'badge-danger' : 'badge-success'}">
            ${financialSummary.delinquentUnitsCount} Delinquent
          </span>
        </div>
        ${financialChart}
      </div>
    </div>

    <!-- Compact Side-by-Side Activity Tables (Max 5 Rows) -->
    <div class="grid-2-col">
      <!-- Recent Cash Activity -->
      <div class="card" style="margin-bottom: 0;">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
          <h2 class="card-title">Recent Cash Activity</h2>
          <a href="/accounting" class="btn btn-sm btn-secondary">View Register</a>
        </div>
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 20%;">Date</th>
                <th style="width: 20%;">Type</th>
                <th style="width: 35%;">Description</th>
                <th style="width: 25%;" class="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${transactionsRows}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Pending Repairs -->
      <div class="card" style="margin-bottom: 0;">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
          <h2 class="card-title">Pending Repairs</h2>
          <a href="/maintenance" class="btn btn-sm btn-secondary">Work Orders</a>
        </div>
        <div class="table-responsive">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 35%;">Issue</th>
                <th style="width: 30%;">Property</th>
                <th style="width: 20%;">Priority</th>
                <th style="width: 15%;" class="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              ${workOrdersRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

/**
 * Handle incoming dashboard requests, parsing query filters, fetching scoped metrics,
 * and presenting the executive portfolio overview.
 *
 * @param ctx Page request context.
 * @returns Rendered PageResult.
 */
export async function handle(ctx: PageContext): Promise<PageResult> {
  const selectedPortfolio = ctx.query['portfolio'] || undefined;
  const selectedPropertyId = ctx.query['property_id'] || undefined;
  const rawFocus = ctx.query['focus'] || 'overview';
  const focusPreset: 'overview' | 'occupancy' | 'financial' | 'maintenance' =
    rawFocus === 'occupancy' || rawFocus === 'financial' || rawFocus === 'maintenance'
      ? rawFocus
      : 'overview';

  // 1. Fetch Portfolios and Properties for Filter Dropdowns
  let portfolios: PortfolioOption[] = [];
  try {
    const pfRes = await ctx.api.get('/api/v1/properties/portfolios');
    portfolios = pfRes?.data?.portfolios || [];
  } catch {
    portfolios = [];
  }

  let properties: PropertyOption[] = [];
  try {
    const propParams = new URLSearchParams();
    if (selectedPortfolio) propParams.set('portfolio', selectedPortfolio);
    const propQuery = propParams.toString() ? `?${propParams.toString()}` : '';
    const propRes = await ctx.api.get(`/api/v1/properties${propQuery}`);
    properties = propRes?.data?.properties || [];
  } catch {
    properties = [];
  }

  // 2. Fetch Filtered Occupancy Metrics
  let occupancyMetrics: OccupancyMetrics = {
    totalUnits: 0,
    occupiedUnits: 0,
    vacantUnits: 0,
    occupancyRatePercentage: 0,
    totalMarketRentCents: 0,
    byBedroomType: []
  };
  try {
    const params = new URLSearchParams();
    if (selectedPropertyId) params.set('property_id', selectedPropertyId);
    if (selectedPortfolio) params.set('portfolio', selectedPortfolio);
    const occQuery = params.toString() ? `?${params.toString()}` : '';
    const occRes = await ctx.api.get(`/api/v1/properties/metrics/occupancy${occQuery}`);
    if (occRes?.data?.metrics) {
      occupancyMetrics = occRes.data.metrics;
    }
  } catch {
    // Default fallback values
  }

  // 3. Fetch Filtered Rent Roll Summary (Delinquency and Scheduled Rent)
  let financialSummary: FinancialSummary = {
    totalUnits: 0,
    totalScheduledRentCents: 0,
    totalDelinquencyCents: 0,
    delinquentUnitsCount: 0
  };
  try {
    const rentRollParams = new URLSearchParams();
    if (selectedPropertyId) rentRollParams.set('property_id', selectedPropertyId);
    if (selectedPortfolio) rentRollParams.set('portfolio', selectedPortfolio);
    const rentRollQuery = rentRollParams.toString() ? `?${rentRollParams.toString()}` : '';
    const rentRollRes = await ctx.api.get(`/api/v1/accounting/rent-roll${rentRollQuery}`);
    if (rentRollRes?.data?.summary) {
      financialSummary = rentRollRes.data.summary;
    }
  } catch {
    // Default fallback values
  }

  // 4. Fetch Filtered Maintenance Metrics
  let maintenanceMetrics: MaintenanceMetrics = {
    openOrders: 0,
    completedThisMonth: 0,
    avgResolutionTimeHours: 0
  };
  try {
    const maintParams = new URLSearchParams();
    if (selectedPropertyId) maintParams.set('property_id', selectedPropertyId);
    if (selectedPortfolio) maintParams.set('portfolio', selectedPortfolio);
    const maintQuery = maintParams.toString() ? `?${maintParams.toString()}` : '';
    const maintRes = await ctx.api.get(`/api/v1/maintenance/metrics${maintQuery}`);
    if (maintRes?.data?.metrics) {
      maintenanceMetrics = maintRes.data.metrics;
    }
  } catch {
    // Default fallback values
  }

  // 5. Fetch Dashboard Extension Cards (Hooks)
  const cards = await HookRegistry.getDashboardCards(ctx.api);

  // 6. Fetch Recent Transactions (Limit 5)
  let recentTransactions: any[] = [];
  try {
    const txParams = new URLSearchParams({ limit: '5' });
    if (selectedPropertyId) txParams.set('property_id', selectedPropertyId);
    if (selectedPortfolio) txParams.set('portfolio', selectedPortfolio);
    const txRes = await ctx.api.get(`/api/v1/accounting/transactions?${txParams.toString()}`);
    recentTransactions = txRes?.data?.transactions || [];
  } catch {
    recentTransactions = [];
  }

  // 7. Fetch Open Work Orders (Limit 5)
  let openWorkOrders: any[] = [];
  try {
    const woParams = new URLSearchParams({ status: 'active', limit: '5' });
    if (selectedPropertyId) woParams.set('property_id', selectedPropertyId);
    if (selectedPortfolio) woParams.set('portfolio', selectedPortfolio);
    const woRes = await ctx.api.get(`/api/v1/maintenance/work-orders?${woParams.toString()}`);
    openWorkOrders = woRes?.data?.workOrders || [];
  } catch {
    openWorkOrders = [];
  }

  const content = renderDashboardPage({
    portfolios,
    properties,
    selectedPortfolio,
    selectedPropertyId,
    focusPreset,
    occupancyMetrics,
    financialSummary,
    maintenanceMetrics,
    dashboardCards: cards,
    recentTransactions,
    openWorkOrders
  });

  return {
    title: 'Executive Portfolio Dashboard',
    content
  };
}
