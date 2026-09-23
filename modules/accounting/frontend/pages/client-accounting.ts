import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';

function formatDate(epochMs: number): string {
  if (!epochMs) return '—';
  try {
    const d = new Date(epochMs);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch {
    return '—';
  }
}

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function handle(ctx: PageContext): Promise<PageResult> {
  const basis = ctx.query['basis'] === 'accrual' ? 'accrual' : 'cash';
  const portfolioId = ctx.query['portfolio_id'] || '';
  const csrfToken = ctx.session.getCsrfToken();
  let error: string | null = null;

  if (ctx.method === 'POST') {
    if (!validateCsrf(csrfToken, ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF token validation failed.</div>`
      };
    }

    const action = ctx.body['action'] || '';
    try {
      if (action === 'record_contribution') {
        const amountCents = Math.round(parseFloat(ctx.body['amount'] || '0') * 100);
        await ctx.api.post('/api/v1/accounting/client_contributions', {
          client_contact_id: ctx.body['client_contact_id'],
          portfolio_id: ctx.body['portfolio_id'],
          property_id: ctx.body['property_id'] || null,
          amount_cents: amountCents,
          reference_number: ctx.body['reference_number'] || null,
          memo: ctx.body['memo'] || null
        });
        ctx.session.addFlash('success', 'Capital contribution recorded successfully');
        return { redirect: `/accounting/client-accounting?basis=${basis}`, content: '' };
      } else if (action === 'record_distribution') {
        const amountCents = Math.round(parseFloat(ctx.body['amount'] || '0') * 100);
        await ctx.api.post('/api/v1/accounting/client_distributions', {
          client_contact_id: ctx.body['client_contact_id'],
          portfolio_id: ctx.body['portfolio_id'],
          property_id: ctx.body['property_id'] || null,
          amount_cents: amountCents,
          disbursement_method: ctx.body['disbursement_method'] || 'ach_transfer',
          check_number: ctx.body['check_number'] || null,
          reference_number: ctx.body['reference_number'] || null,
          memo: ctx.body['memo'] || null
        });
        ctx.session.addFlash('success', 'Owner distribution recorded successfully');
        return { redirect: `/accounting/client-accounting?basis=${basis}`, content: '' };
      } else if (action === 'create_agreement') {
        const bps = ctx.body['percentage'] ? Math.round(parseFloat(ctx.body['percentage']) * 100) : 0;
        const flatFeeCents = ctx.body['flat_fee'] ? Math.round(parseFloat(ctx.body['flat_fee']) * 100) : 0;
        await ctx.api.post('/api/v1/accounting/management_fee_agreements', {
          portfolio_id: ctx.body['portfolio_id'] || null,
          property_id: ctx.body['property_id'] || null,
          calculation_method: ctx.body['calculation_method'] || 'percentage_of_collected_rent',
          percentage_bps: bps,
          flat_fee_cents: flatFeeCents,
          pass_through_expenses: ctx.body['pass_through_expenses'] === '1' ? 1 : 0
        });
        ctx.session.addFlash('success', 'Management fee agreement established');
        return { redirect: `/accounting/client-accounting?basis=${basis}`, content: '' };
      }
    } catch (err: any) {
      error = err.message;
    }
  }

  let contributions: any[] = [];
  let distributions: any[] = [];
  let agreements: any[] = [];
  let cashSummary: any = null;
  let contacts: any[] = [];
  let properties: any[] = [];

  try {
    const [cRes, dRes, aRes, contRes, propRes] = await Promise.all([
      ctx.api.get('/api/v1/accounting/client_contributions').catch(() => ({ data: { contributions: [] } })),
      ctx.api.get('/api/v1/accounting/client_distributions').catch(() => ({ data: { distributions: [] } })),
      ctx.api.get('/api/v1/accounting/management_fee_agreements').catch(() => ({ data: { agreements: [] } })),
      ctx.api.get('/api/v1/contacts').catch(() => ({ data: { contacts: [] } })),
      ctx.api.get('/api/v1/properties').catch(() => ({ data: { properties: [] } }))
    ]);

    contributions = cRes?.data?.contributions || [];
    distributions = dRes?.data?.distributions || [];
    agreements = aRes?.data?.agreements || [];
    contacts = contRes?.data?.contacts || [];
    properties = propRes?.data?.properties || [];

    // If portfolio specified or first available, fetch portfolio cash summary
    const targetPortfolio = portfolioId || (contributions[0]?.portfolio_id || distributions[0]?.portfolio_id || 'portfolio-demo');
    if (targetPortfolio) {
      const sRes = await ctx.api.get(`/api/v1/accounting/portfolios/${encodeURIComponent(targetPortfolio)}/cash_summary?basis=${basis}`).catch(() => ({ data: {} }));
      cashSummary = sRes?.data?.summary || null;
    }
  } catch (err: any) {
    error = error || err.message;
  }

  const totalContributionsCents = contributions.reduce((sum, c) => sum + (c.amount_cents || 0), 0);
  const totalDistributionsCents = distributions.reduce((sum, d) => sum + (d.amount_cents || 0), 0);
  const operatingCashCents = cashSummary?.operating_cash_cents ?? (totalContributionsCents - totalDistributionsCents);
  const reserveTargetCents = cashSummary?.reserve_requirement_cents ?? 500000;

  const errorAlert = error
    ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>`
    : raw('');

  const contributionRows = contributions.length === 0
    ? html`<tr><td colspan="5" class="text-center text-muted">No capital contributions recorded.</td></tr>`
    : contributions.map((c) => html`
        <tr>
          <td>${formatDate(c.contribution_date || c.created_at)}</td>
          <td><strong>${c.client_name || c.client_contact_id}</strong></td>
          <td>${c.reference_number || '—'}</td>
          <td>${c.memo || 'Capital injection'}</td>
          <td class="amount-col font-bold amount-positive">+$${formatCurrency(c.amount_cents)}</td>
        </tr>
      `);

  const distributionRows = distributions.length === 0
    ? html`<tr><td colspan="5" class="text-center text-muted">No owner draws or distributions recorded.</td></tr>`
    : distributions.map((d) => html`
        <tr>
          <td>${formatDate(d.distribution_date || d.created_at)}</td>
          <td><strong>${d.client_name || d.client_contact_id}</strong></td>
          <td>${d.disbursement_method.replace(/_/g, ' ')} ${d.check_number ? `#${d.check_number}` : ''}</td>
          <td>${d.memo || 'Periodic owner draw'}</td>
          <td class="amount-col font-bold amount-negative">-$${formatCurrency(d.amount_cents)}</td>
        </tr>
      `);

  const agreementRows = agreements.length === 0
    ? html`<tr><td colspan="4" class="text-center text-muted">No management fee agreements configured.</td></tr>`
    : agreements.map((a) => {
        const rateDesc = a.percentage_bps > 0
          ? `${(a.percentage_bps / 100).toFixed(2)}% of collected rent`
          : `$${formatCurrency(a.flat_fee_cents)} flat monthly`;
        return html`
          <tr>
            <td><strong>${a.portfolio_id || a.property_id || 'Portfolio Wide'}</strong></td>
            <td><span class="badge badge-info">${a.calculation_method.replace(/_/g, ' ')}</span></td>
            <td>${rateDesc}</td>
            <td>${a.pass_through_expenses ? html`<span class="badge badge-success">Yes</span>` : html`<span class="badge">No</span>`}</td>
          </tr>
        `;
      });

  const clientOptions = contacts
    .filter((c) => c.contact_type === 'owner' || c.contact_type === 'investor' || c.contact_type === 'client')
    .map((c) => html`<option value="${c.id}">${c.last_name}, ${c.first_name} (${c.contact_type})</option>`);

  const allContactOptions = contacts.map((c) => html`<option value="${c.id}">${c.last_name}, ${c.first_name}</option>`);

  const propertyOptions = properties.map((p) => html`<option value="${p.id}">${p.name}</option>`);

  const content = html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Client Accounting & Owner Ledgers</h1>
        <p class="page-subtitle">Fiduciary capital management, owner distributions, reserves, and management fee agreements.</p>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="document.getElementById('recordContributionModal').showModal()">+ Capital Contribution</button>
        <button class="btn btn-secondary" onclick="document.getElementById('recordDistributionModal').showModal()">+ Owner Distribution</button>
        <button class="btn btn-secondary" onclick="document.getElementById('createAgreementModal').showModal()">⚙️ Fee Agreement</button>
      </div>
    </div>

    ${errorAlert}

    <!-- Sub-navigation links & Accounting basis toggle -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1.5rem; flex-wrap:wrap; gap:1rem;">
      <div class="filter-pills">
        <a href="/accounting" class="filter-pill">Transactions</a>
        <a href="/accounting/client-accounting" class="filter-pill active">Client Accounting</a>
        <a href="/accounting/general-ledger" class="filter-pill">General Ledger</a>
        <a href="/accounting/trial-balance" class="filter-pill">Trial Balance</a>
        <a href="/accounting/rent-roll" class="filter-pill">Rent Roll</a>
        <a href="/accounting/schedule-e" class="filter-pill">Schedule E</a>
        <a href="/accounting/quickbooks" class="filter-pill">QuickBooks</a>
      </div>

      <div style="display:flex; align-items:center; gap:0.5rem; background:var(--bg-surface); padding:0.25rem 0.5rem; border:1px solid var(--border-color); border-radius:var(--radius-md);">
        <span style="font-size:0.8rem; font-weight:600; color:var(--text-muted);">Accounting Basis:</span>
        <a href="/accounting/client-accounting?basis=cash" class="btn btn-sm ${basis === 'cash' ? 'btn-primary' : 'btn-secondary'}">Cash Basis</a>
        <a href="/accounting/client-accounting?basis=accrual" class="btn btn-sm ${basis === 'accrual' ? 'btn-primary' : 'btn-secondary'}">Accrual Basis</a>
      </div>
    </div>

    <!-- KPI Metrics Grid -->
    <div class="metrics-grid">
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Total Capital Injected</span>
          <span class="kpi-icon">💰</span>
        </div>
        <div class="kpi-value font-mono amount-positive">$${formatCurrency(totalContributionsCents)}</div>
        <div class="kpi-trend positive">Owner contributions</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Total Owner Distributions</span>
          <span class="kpi-icon">📤</span>
        </div>
        <div class="kpi-value font-mono amount-negative">$${formatCurrency(totalDistributionsCents)}</div>
        <div class="kpi-trend neutral">Disbursed owner draws</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Operating Cash Balance</span>
          <span class="kpi-icon">🏦</span>
        </div>
        <div class="kpi-value font-mono ${operatingCashCents >= 0 ? 'text-main' : 'text-danger'}">$${formatCurrency(operatingCashCents)}</div>
        <div class="kpi-trend ${operatingCashCents >= reserveTargetCents ? 'positive' : 'negative'}">
          ${operatingCashCents >= reserveTargetCents ? '✓ Reserve requirement met' : '⚠️ Below reserve minimum'}
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-title">Operating Reserve Target</span>
          <span class="kpi-icon">🛡️</span>
        </div>
        <div class="kpi-value font-mono">$${formatCurrency(reserveTargetCents)}</div>
        <div class="kpi-trend neutral">Fiduciary threshold</div>
      </div>
    </div>

    <!-- Contributions & Distributions Split View -->
    <div class="grid-2-col">
      <!-- Capital Contributions -->
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h2 class="card-title">Capital Contributions</h2>
          <span class="badge badge-success">${contributions.length} recorded</span>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Owner / Investor</th>
                <th>Ref #</th>
                <th>Memo</th>
                <th style="text-align:right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${contributionRows}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Owner Distributions -->
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h2 class="card-title">Owner Distributions & Draws</h2>
          <span class="badge badge-warning">${distributions.length} recorded</span>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Recipient Owner</th>
                <th>Method</th>
                <th>Memo</th>
                <th style="text-align:right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${distributionRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Management Fee Agreements -->
    <div class="card" style="margin-top: 1.5rem;">
      <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 class="card-title" style="margin:0;">Management Fee Agreements</h2>
          <small class="text-muted">Automated property management compensation rules and calculation formulas</small>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="document.getElementById('createAgreementModal').showModal()">+ New Fee Agreement</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Scope</th>
              <th>Formula</th>
              <th>Rate / Flat Fee</th>
              <th>Pass-Through Expenses</th>
            </tr>
          </thead>
          <tbody>
            ${agreementRows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal: Record Capital Contribution -->
    <dialog id="recordContributionModal" class="modal">
      <form method="POST" action="/accounting/client-accounting?basis=${basis}" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="record_contribution">
        <div class="modal-header">
          <h3>Record Capital Contribution</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('recordContributionModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Client / Owner *</label>
            <select name="client_contact_id" class="form-select" required>
              <option value="">-- Choose Owner --</option>
              ${clientOptions.length > 0 ? clientOptions : allContactOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Portfolio Scope *</label>
            <input type="text" name="portfolio_id" class="form-input" value="portfolio-main" required>
          </div>
          <div class="form-group">
            <label class="form-label">Optional Property Earmark</label>
            <select name="property_id" class="form-select">
              <option value="">-- Entire Portfolio --</option>
              ${propertyOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Contribution Amount ($) *</label>
            <input type="number" name="amount" class="form-input" step="0.01" min="1" placeholder="10000.00" required>
          </div>
          <div class="form-group">
            <label class="form-label">Reference / Wire #</label>
            <input type="text" name="reference_number" class="form-input" placeholder="e.g. WIRE-884920">
          </div>
          <div class="form-group">
            <label class="form-label">Memo / Purpose</label>
            <input type="text" name="memo" class="form-input" placeholder="e.g. Q3 Roof Replacement Reserve Funding">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('recordContributionModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Record Contribution</button>
        </div>
      </form>
    </dialog>

    <!-- Modal: Record Owner Distribution -->
    <dialog id="recordDistributionModal" class="modal">
      <form method="POST" action="/accounting/client-accounting?basis=${basis}" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="record_distribution">
        <div class="modal-header">
          <h3>Record Owner Distribution / Draw</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('recordDistributionModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Recipient Owner *</label>
            <select name="client_contact_id" class="form-select" required>
              <option value="">-- Choose Owner --</option>
              ${clientOptions.length > 0 ? clientOptions : allContactOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Portfolio Scope *</label>
            <input type="text" name="portfolio_id" class="form-input" value="portfolio-main" required>
          </div>
          <div class="form-group">
            <label class="form-label">Distribution Amount ($) *</label>
            <input type="number" name="amount" class="form-input" step="0.01" min="1" placeholder="5000.00" required>
          </div>
          <div class="form-group">
            <label class="form-label">Disbursement Method *</label>
            <select name="disbursement_method" class="form-select" required>
              <option value="ach_transfer">Direct ACH Transfer</option>
              <option value="check">Check</option>
              <option value="wire_transfer">Wire Transfer</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Check / Ref Number</label>
            <input type="text" name="check_number" class="form-input" placeholder="e.g. Check #2041">
          </div>
          <div class="form-group">
            <label class="form-label">Memo</label>
            <input type="text" name="memo" class="form-input" placeholder="e.g. August Net Cash Flow Distribution">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('recordDistributionModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Process Distribution</button>
        </div>
      </form>
    </dialog>

    <!-- Modal: Create Management Fee Agreement -->
    <dialog id="createAgreementModal" class="modal">
      <form method="POST" action="/accounting/client-accounting?basis=${basis}" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="create_agreement">
        <div class="modal-header">
          <h3>Establish Management Fee Agreement</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('createAgreementModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Calculation Method *</label>
            <select name="calculation_method" class="form-select" required>
              <option value="percentage_of_collected_rent">Percentage of Collected Rent</option>
              <option value="flat_fee_per_unit">Flat Monthly Fee Per Unit</option>
              <option value="hybrid_greater">Hybrid (Greater of Percentage or Flat)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Percentage Rate (%)</label>
            <input type="number" name="percentage" class="form-input" step="0.01" min="0" max="100" placeholder="8.00" value="8.00">
          </div>
          <div class="form-group">
            <label class="form-label">Flat Fee Minimum / Amount ($)</label>
            <input type="number" name="flat_fee" class="form-input" step="0.01" min="0" placeholder="150.00" value="0.00">
          </div>
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
              <input type="checkbox" name="pass_through_expenses" value="1" checked>
              <span>Include pass-through utility & repair surcharges in collected basis</span>
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('createAgreementModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Agreement</button>
        </div>
      </form>
    </dialog>
  `;

  return {
    title: 'Client Accounting',
    content
  };
}
