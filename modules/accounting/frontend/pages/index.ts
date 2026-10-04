import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';
import { renderPagination } from '../../../../web/templates/pagination.js';

function formatDate(epochMs: number): string {
  try {
    const d = new Date(epochMs);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch {
    return '';
  }
}

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function handle(ctx: PageContext): Promise<PageResult> {
  const typeFilter = ctx.query['type'] || '';
  const categoryFilter = ctx.query['category'] || '';
  const propertyFilter = ctx.query['property_id'] || '';
  const page = Math.max(1, parseInt(ctx.query['page'] || '1', 10) || 1);
  const limit = 15;
  const csrfToken = ctx.session.getCsrfToken();
  let error: string | null = null;

  if (ctx.method === 'POST' && ctx.body['action'] === 'create_transaction') {
    if (!validateCsrf(csrfToken, ctx.body['csrf_token'])) {
      return {
        title: 'Error',
        status: 403,
        content: html`<div class="alert alert-danger">CSRF token validation failed.</div>`
      };
    }

    try {
      const amountCents = Math.round(parseFloat(ctx.body['amount'] ?? '0') * 100);
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        throw new Error('Amount must be greater than zero.');
      }
      const txDate = new Date(ctx.body['transaction_date'] ?? Date.now()).getTime();

      await ctx.api.post('/api/v1/accounting/transactions', {
        transaction_type: ctx.body['transaction_type'] ?? 'payment',
        category: ctx.body['category'] ?? 'rent',
        amount_cents: amountCents,
        transaction_date: txDate,
        description: ctx.body['description'] ?? '',
        payment_method: ctx.body['payment_method'] || null,
        reference_number: ctx.body['reference_number'] || null,
        property_id: ctx.body['property_id'] || null
      });

      ctx.session.addFlash('success', 'Transaction successfully recorded');
      return { redirect: '/accounting', content: '' };
    } catch (err: any) {
      error = err.message;
    }
  }

  let transactions: any[] = [];
  let properties: any[] = [];

  try {
    const params = new URLSearchParams();
    if (typeFilter) params.set('transaction_type', typeFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    if (propertyFilter) params.set('property_id', propertyFilter);
    const queryStr = params.toString() ? `?${params.toString()}` : '';

    const res = await ctx.api.get(`/api/v1/accounting/transactions${queryStr}`);
    transactions = res?.data?.transactions || [];

    const propRes = await ctx.api.get('/api/v1/properties');
    properties = propRes?.data?.properties || [];
  } catch (err: any) {
    error = error || err.message;
  }

  const filteredTransactions = propertyFilter
    ? transactions.filter((t) => t.property_id === propertyFilter)
    : transactions;

  const total = filteredTransactions.length;
  const paginatedTransactions = filteredTransactions.slice((page - 1) * limit, page * limit);

  const errorAlert = error
    ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>`
    : raw('');

  const txByProperty = new Map<string, number>();
  for (const t of transactions) {
    if (t.property_id) {
      txByProperty.set(t.property_id, (txByProperty.get(t.property_id) || 0) + 1);
    }
  }

  const transactionRows = paginatedTransactions.length > 0
    ? paginatedTransactions.map((t) => {
        let badgeClass = 'badge-info';
        if (t.transaction_type === 'payment') badgeClass = 'badge-success';
        else if (t.transaction_type === 'charge') badgeClass = 'badge-warning';
        else if (t.transaction_type === 'expense') badgeClass = 'badge-danger';

        const typeFormatted = (t.transaction_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        const catFormatted = (t.category || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

        let amountHtml: SafeHtml;
        if (t.transaction_type === 'payment' || t.transaction_type === 'deposit_inflow') {
          amountHtml = html`<span class="text-success font-bold">+$${formatCurrency(t.amount_cents)}</span>`;
        } else if (t.transaction_type === 'expense') {
          amountHtml = html`<span class="text-danger font-bold">-$${formatCurrency(t.amount_cents)}</span>`;
        } else {
          amountHtml = html`<span class="font-bold">$${formatCurrency(t.amount_cents)}</span>`;
        }

        return html`
          <tr data-entity="transaction" data-id="${t.id}">
            <td>${formatDate(t.transaction_date)}</td>
            <td><span class="badge ${badgeClass}">${typeFormatted}</span></td>
            <td>${catFormatted}</td>
            <td><a href="/accounting?id=${encodeURIComponent(t.id)}" data-entity-id="${t.id}" data-entity-type="transaction"><strong>${t.description}</strong></a></td>
            <td>${t.payment_method ? t.payment_method.toUpperCase() : '—'}</td>
            <td>${amountHtml}</td>
          </tr>
        `;
      })
    : [html`
        <tr>
          <td colspan="6" class="text-center text-muted">No transactions matching criteria.</td>
        </tr>
      `];

  const propertyOptions = properties.map((p) => html`<option value="${p.id}">${p.name} (${txByProperty.get(p.id) || 0})</option>`);
  const today = new Date().toISOString().split('T')[0];

  const buildTypeUrl = (type: string, propId: string) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (categoryFilter) params.set('category', categoryFilter);
    if (propId) params.set('property_id', propId);
    const qs = params.toString();
    return `/accounting${qs ? `?${qs}` : ''}`;
  };

  const content = html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Financial Ledger</h1>
        <p class="page-subtitle">Cash-basis income, expenses, and tenant transactions.</p>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="document.getElementById('addTxModal').showModal()">+ Record Transaction</button>
        <a href="/accounting/general-ledger" class="btn btn-secondary">General Ledger</a>
        <a href="/accounting/trial-balance" class="btn btn-secondary">Trial Balance</a>
        <a href="/accounting/rent-roll" class="btn btn-secondary">Rent Roll</a>
        <a href="/accounting/schedule-e" class="btn btn-secondary">Schedule E</a>
        <a href="/accounting/quickbooks" class="btn btn-secondary">QuickBooks Sync</a>
      </div>
    </div>

    ${errorAlert}

    <!-- Filters Bar -->
    <div class="filter-bar card" style="display: flex; gap: 1rem; align-items: center; justify-content: space-between; flex-wrap: wrap;">
      <div class="filter-pills">
        <a href="${buildTypeUrl('', propertyFilter)}" class="filter-pill ${!typeFilter ? 'active' : ''}">All</a>
        <a href="${buildTypeUrl('payment', propertyFilter)}" class="filter-pill ${typeFilter === 'payment' ? 'active' : ''}">Payments</a>
        <a href="${buildTypeUrl('charge', propertyFilter)}" class="filter-pill ${typeFilter === 'charge' ? 'active' : ''}">Charges</a>
        <a href="${buildTypeUrl('expense', propertyFilter)}" class="filter-pill ${typeFilter === 'expense' ? 'active' : ''}">Expenses</a>
        <a href="${buildTypeUrl('deposit_inflow', propertyFilter)}" class="filter-pill ${typeFilter === 'deposit_inflow' ? 'active' : ''}">Deposits</a>
      </div>

      <form method="GET" action="/accounting" style="display: flex; gap: 0.5rem; align-items: center; margin: 0;">
        ${typeFilter ? html`<input type="hidden" name="type" value="${typeFilter}">` : raw('')}
        ${categoryFilter ? html`<input type="hidden" name="category" value="${categoryFilter}">` : raw('')}
        <select class="form-select form-input-sm" name="property_id" onchange="this.form.submit()" style="max-width: 260px;">
          <option value="">All Properties (${transactions.length})</option>
          ${properties.map((p) => html`
            <option value="${p.id}" ${propertyFilter === p.id ? 'selected' : ''}>${p.name} (${txByProperty.get(p.id) || 0})</option>
          `)}
        </select>
        ${propertyFilter ? html`<a href="${buildTypeUrl(typeFilter, '')}" class="btn btn-sm btn-secondary">Clear</a>` : raw('')}
      </form>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Ledger Entries (${total})</h2>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Category</th>
              <th>Description</th>
              <th>Payment Method</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            ${transactionRows}
          </tbody>
        </table>
      </div>
      ${renderPagination({
        page,
        limit,
        total,
        baseUrl: '/accounting',
        queryParams: { type: typeFilter, category: categoryFilter, property_id: propertyFilter }
      })}
    </div>

    <!-- Modal: Record Transaction -->
    <dialog id="addTxModal" class="modal">
      <form method="POST" action="/accounting" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="create_transaction">
        <div class="modal-header">
          <h3>Record Transaction</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('addTxModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="transaction_type">Type *</label>
              <select class="form-select" id="transaction_type" name="transaction_type" required>
                <option value="payment">Payment Received (Income)</option>
                <option value="expense">Operating Expense (Outflow)</option>
                <option value="charge">Charge Invoiced (Owed)</option>
                <option value="deposit_inflow">Security Deposit Trust Inflow</option>
              </select>
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="category">Category *</label>
              <select class="form-select" id="category" name="category" required>
                <optgroup label="Income">
                  <option value="rent">Rent</option>
                  <option value="late_fee">Late Fee</option>
                  <option value="pet_fee">Pet Fee</option>
                  <option value="utility_rebill">Utility Rebill</option>
                  <option value="security_deposit">Security Deposit</option>
                  <option value="other_income">Other Income</option>
                </optgroup>
                <optgroup label="Schedule E Expenses">
                  <option value="repairs">Repairs</option>
                  <option value="cleaning_maintenance">Cleaning & Maintenance</option>
                  <option value="utilities">Utilities</option>
                  <option value="property_taxes">Property Taxes</option>
                  <option value="insurance">Insurance</option>
                  <option value="management_fees">Management Fees</option>
                  <option value="mortgage_interest">Mortgage Interest</option>
                  <option value="supplies">Supplies</option>
                  <option value="legal_professional">Legal & Professional</option>
                  <option value="advertising">Advertising</option>
                  <option value="capital_improvement">Capital Improvement</option>
                </optgroup>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="amount">Amount ($) *</label>
              <input class="form-input" type="number" id="amount" name="amount" step="0.01" required placeholder="0.00">
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="transaction_date">Date *</label>
              <input class="form-input" type="date" id="transaction_date" name="transaction_date" required value="${today}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="description">Description *</label>
            <input class="form-input" type="text" id="description" name="description" required placeholder="e.g. September Rent Payment or Replaced Water Heater">
          </div>
          <div class="form-row">
            <div class="form-group col-6">
              <label class="form-label" for="payment_method">Payment Method</label>
              <select class="form-select" id="payment_method" name="payment_method">
                <option value="">-- None / N/A --</option>
                <option value="zelle">Zelle</option>
                <option value="ach">ACH Transfer</option>
                <option value="check">Paper Check</option>
                <option value="cash">Cash</option>
                <option value="credit_card">Credit Card</option>
                <option value="direct_deposit">Direct Deposit</option>
              </select>
            </div>
            <div class="form-group col-6">
              <label class="form-label" for="reference_number">Ref # / Check #</label>
              <input class="form-input" type="text" id="reference_number" name="reference_number" placeholder="e.g. #1048">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="property_id">Associated Property</label>
            <select class="form-select" id="property_id" name="property_id">
              <option value="">-- Portfolio Wide / None --</option>
              ${propertyOptions}
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('addTxModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Transaction</button>
        </div>
      </form>
    </dialog>
  `;

  return {
    title: 'Accounting & Ledger',
    content
  };
}
