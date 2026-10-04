import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';
import { renderPagination } from '../../../../web/templates/pagination.js';

export async function handle(ctx: PageContext): Promise<PageResult> {
  const csrfToken = ctx.session.getCsrfToken();
  let error: string | null = null;
  const activeTab = (ctx.query['tab'] || 'queue').toLowerCase();
  const page = Math.max(1, parseInt(ctx.query['page'] || '1', 10) || 1);
  const pageSize = 10;

  // POST Actions: Create Batch Deposit, Void Deposit
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
      if (action === 'create_deposit') {
        const rawReceiptIds = ctx.body['receipt_ids'];
        const receiptIds = Array.isArray(rawReceiptIds)
          ? rawReceiptIds
          : rawReceiptIds ? [rawReceiptIds] : [];

        if (receiptIds.length === 0) {
          throw new Error('Please select at least one receipt to include in the deposit.');
        }

        const depositDateMs = ctx.body['deposit_date'] ? new Date(ctx.body['deposit_date']).getTime() : Date.now();

        await ctx.api.post('/api/v1/accounting/deposits', {
          bank_account_id: ctx.body['bank_account_id'],
          deposit_date: depositDateMs,
          memo: ctx.body['memo'] || null,
          deposit_number: ctx.body['deposit_number'] || null,
          source_entry_ids: receiptIds
        });

        ctx.session.addFlash('success', `Bank deposit created successfully (${receiptIds.length} items batched)`);
        return { redirect: '/accounting/deposits?tab=history', content: '' };
      } else if (action === 'void_deposit') {
        const depositId = ctx.body['deposit_id'];
        await ctx.api.post(`/api/v1/accounting/deposits/${encodeURIComponent(depositId)}/void`, {
          reason: ctx.body['void_reason'] || 'Void requested by operator'
        });
        ctx.session.addFlash('success', 'Deposit voided and receipts returned to undeposited funds');
        return { redirect: '/accounting/deposits?tab=history', content: '' };
      }
    } catch (err: any) {
      error = err.message;
    }
  }

  // Load undeposited receipts
  let undeposited: any[] = [];
  try {
    const undepRes = await ctx.api.get('/api/v1/accounting/deposits/undeposited');
    undeposited = undepRes?.data?.items || (Array.isArray(undepRes?.data) ? undepRes.data : []);
  } catch (err: any) {
    error = error || err.message;
  }

  // Load deposit history
  let depositsList: any[] = [];
  try {
    const depRes = await ctx.api.get('/api/v1/accounting/deposits?limit=50');
    depositsList = Array.isArray(depRes?.data) ? depRes.data : (depRes?.data?.deposits || []);
  } catch (err: any) {
    error = error || err.message;
  }

  // Fetch available operating bank accounts
  let bankAccounts: any[] = [];
  try {
    const coaRes = await ctx.api.get('/api/v1/accounting/chart-of-accounts');
    bankAccounts = (coaRes?.data?.accounts || coaRes?.data || []).filter((a: any) => a.account_type === 'Bank');
  } catch (_) {}

  const totalUndepositedCents = undeposited.reduce((acc, item) => acc + item.amount_cents, 0);

  const content = html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Bank Deposit Batching</h1>
        <p class="page-subtitle text-muted">
          Reconcile undeposited funds (GL 1030) into verified bank deposits and generate deposit slips.
        </p>
      </div>
    </div>

    ${error ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>` : raw('')}

    <!-- Tabs Navigation -->
    <div class="search-tabs" style="display: flex; border-bottom: 1px solid var(--border-color); margin-bottom: 1.5rem; gap: 0.5rem;">
      <a href="/accounting/deposits?tab=queue" class="tab-btn ${activeTab === 'queue' ? 'active' : ''}">
        Undeposited Funds Queue <span class="badge badge-secondary">${undeposited.length}</span>
      </a>
      <a href="/accounting/deposits?tab=history" class="tab-btn ${activeTab === 'history' ? 'active' : ''}">
        Deposit History & Reconciliations <span class="badge badge-secondary">${depositsList.length}</span>
      </a>
    </div>

    ${activeTab === 'queue'
      ? html`
          <form method="POST" action="/accounting/deposits" id="deposit-batch-form">
            ${csrfField(csrfToken)}
            <input type="hidden" name="action" value="create_deposit" />

            <!-- Deposit Setup & Live Running Calculator Card -->
            <div class="card" style="padding: 1.25rem; margin-bottom: 1.5rem; background: var(--bg-surface); border: 2px solid var(--border-color);">
              <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 1rem;">Prepare New Bank Deposit Batch</h3>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
                <div class="form-group">
                  <label for="bank_account_id">Target Bank Account *</label>
                  <select id="bank_account_id" name="bank_account_id" class="form-control" required>
                    ${bankAccounts.map((a) => html`<option value="${a.id}">${a.account_number} ${a.account_name}</option>`)}
                  </select>
                </div>
                <div class="form-group">
                  <label for="deposit_date">Deposit Date *</label>
                  <input type="date" id="deposit_date" name="deposit_date" class="form-control" value="${new Date().toISOString().slice(0, 10)}" required />
                </div>
                <div class="form-group">
                  <label for="deposit_number">Deposit Reference / Slip #</label>
                  <input type="text" id="deposit_number" name="deposit_number" class="form-control" placeholder="DEP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-01" />
                </div>
                <div class="form-group">
                  <label for="memo">Memo / Notes</label>
                  <input type="text" id="memo" name="memo" class="form-control" placeholder="Batch tenant rent collection" />
                </div>
              </div>

              <!-- Sticky Summary & Submission -->
              <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 1rem; flex-wrap: wrap; gap: 1rem;">
                <div>
                  <span style="font-size: 0.95rem;">
                    Selected: <strong id="deposit-selected-count">0</strong> / ${undeposited.length} items |
                    Deposit Amount: <strong id="deposit-selected-total" style="color: var(--primary); font-size: 1.15rem;">$0.00</strong>
                    <span class="text-muted" style="font-size: 0.85rem; margin-left: 0.5rem;">
                      (Queue Available: $${(totalUndepositedCents / 100).toFixed(2)})
                    </span>
                  </span>
                </div>
                <div style="display: flex; gap: 0.75rem;">
                  <button type="button" class="btn btn-sm btn-secondary" id="btn-select-all-deposits">Select All Visible</button>
                  <button type="submit" class="btn btn-primary" id="btn-submit-deposit">✓ Record Bank Deposit</button>
                </div>
              </div>
            </div>

            <!-- Undeposited Items Table -->
            <div class="card" style="padding: 0; overflow-x: auto; margin-bottom: 2rem;">
              <table class="table" style="margin-bottom: 0;" id="undeposited-table">
                <thead>
                  <tr>
                    <th style="width: 36px; text-align: center;">
                      <input type="checkbox" id="undeposited-all-box" title="Toggle all receipts" />
                    </th>
                    <th>Receipt Date</th>
                    <th>Payer / Remitter</th>
                    <th>Payment Method</th>
                    <th>Reference / Check #</th>
                    <th>Amount ($)</th>
                    <th style="text-align: right;">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  ${undeposited.length > 0
                    ? undeposited.map((r) => {
                        const entryId = r.journal_entry_id || r.source_entry_id || r.id;
                        const dateMs = r.date_ms || r.receipt_date;
                        const formattedDate = (dateMs && !isNaN(Number(dateMs)))
                          ? new Date(Number(dateMs)).toISOString().slice(0, 10)
                          : '—';
                        return html`
                          <tr
                            class="receipt-row"
                            id="receipt-${entryId}"
                            data-entity-type="receipt"
                            data-entity-id="${entryId}"
                            data-amount-cents="${r.amount_cents}"
                          >
                            <td style="text-align: center;">
                              <input
                                type="checkbox"
                                name="receipt_ids"
                                class="receipt-select-box"
                                value="${entryId}"
                                data-amount-cents="${r.amount_cents}"
                              />
                            </td>
                            <td>${formattedDate}</td>
                            <td style="font-weight: 600;">
                              ${r.remitter_name || r.memo || 'Tenant Payment'}
                              <button
                                type="button"
                                class="btn-copy-id"
                                data-action="copy-id"
                                data-target-id="${entryId}"
                                title="Copy ID"
                                style="background: none; border: none; cursor: pointer; opacity: 0.6; padding: 0 4px;"
                              >
                                📋
                              </button>
                            </td>
                            <td><span class="badge badge-secondary">${(r.payment_method || 'Check').toUpperCase()}</span></td>
                            <td class="font-mono text-muted">${r.reference || '—'}</td>
                            <td style="font-weight: 700; font-family: var(--font-mono);">$${(r.amount_cents / 100).toFixed(2)}</td>
                            <td style="text-align: right;">
                              <a
                                href="/api/v1/accounting/deposits/receipts/${encodeURIComponent(entryId)}/pdf"
                                target="_blank"
                                class="btn btn-sm btn-subtle"
                                title="Print Remitter PDF Receipt"
                              >
                                🧾 Receipt PDF
                              </a>
                            </td>
                          </tr>
                        `;
                      })
                    : html`
                        <tr>
                          <td colspan="7" style="text-align: center; padding: 3rem 1.5rem;">
                            <div class="empty-state">
                              <span style="font-size: 2.5rem; display: block; margin-bottom: 0.5rem;">🏦</span>
                              <h4>Undeposited Funds Clear</h4>
                              <p class="text-muted" style="max-width: 450px; margin: 0 auto 1rem;">
                                Payments collected from tenants and residents in the Leases module automatically appear here ready to batch into reconciled bank deposits.
                              </p>
                              <a href="/leases" class="btn btn-secondary">Go to Leases & Rent Roll</a>
                            </div>
                          </td>
                        </tr>
                      `}
                </tbody>
              </table>
            </div>
          </form>
        `
      : html`
          <!-- Tab 2: Deposit History -->
          ${(() => {
            const totalDeposits = depositsList.length;
            const totalPages = Math.ceil(totalDeposits / pageSize) || 1;
            const paginatedDeposits = depositsList.slice((page - 1) * pageSize, page * pageSize);

            return html`
              <div class="card" style="padding: 0; overflow-x: auto;">
                <table class="table" style="margin-bottom: 0;">
                  <thead>
                    <tr>
                      <th>Deposit Date</th>
                      <th>Slip / Reference</th>
                      <th>Target Bank Account</th>
                      <th>Total Amount</th>
                      <th>Status</th>
                      <th>Memo</th>
                      <th style="text-align: right;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${paginatedDeposits.length > 0
                      ? paginatedDeposits.map((d) => {
                          return html`
                            <tr
                              class="deposit-row"
                              id="deposit-${d.id}"
                              data-entity-type="deposit"
                              data-entity-id="${d.id}"
                              data-amount-cents="${d.total_amount_cents}"
                              data-status="${d.status}"
                            >
                              <td>${(d.deposit_date && !isNaN(Number(d.deposit_date))) ? new Date(Number(d.deposit_date)).toISOString().slice(0, 10) : '—'}</td>
                              <td style="font-weight: 700; font-family: var(--font-mono);">
                                ${d.deposit_number || d.id.slice(0, 8)}
                                <button
                                  type="button"
                                  class="btn-copy-id"
                                  data-action="copy-id"
                                  data-target-id="${d.id}"
                                  title="Copy ID"
                                  style="background: none; border: none; cursor: pointer; opacity: 0.6; padding: 0 4px;"
                                >
                                  📋
                                </button>
                              </td>
                              <td>${d.bank_account_name || 'Operating Checking'}</td>
                              <td style="font-weight: 700; font-family: var(--font-mono);">$${(d.total_amount_cents / 100).toFixed(2)}</td>
                              <td>
                                <span class="badge ${d.status === 'cleared' ? 'badge-success' : 'badge-danger'}">
                                  ${d.status.toUpperCase()}
                                </span>
                              </td>
                              <td class="text-muted">${d.memo || '—'}</td>
                              <td style="text-align: right; white-space: nowrap;">
                                <a
                                  href="/api/v1/accounting/deposits/${encodeURIComponent(d.id)}/pdf"
                                  target="_blank"
                                  class="btn btn-sm btn-secondary"
                                >
                                  🖨️ Deposit Slip PDF
                                </a>
                                ${d.status !== 'voided'
                                  ? html`
                                      <form method="POST" action="/accounting/deposits" style="display: inline; margin-left: 0.25rem;">
                                        ${csrfField(csrfToken)}
                                        <input type="hidden" name="action" value="void_deposit" />
                                        <input type="hidden" name="deposit_id" value="${d.id}" />
                                        <button
                                          type="submit"
                                          class="btn btn-sm btn-subtle"
                                          style="color: var(--danger);"
                                          onclick="return confirm('Voiding this deposit will unbatch and return all constituent receipts to undeposited funds. Proceed?')"
                                        >
                                          Void
                                        </button>
                                      </form>
                                    `
                                  : raw('')}
                              </td>
                            </tr>
                          `;
                        })
                      : html`
                          <tr>
                            <td colspan="7" style="text-align: center; padding: 3rem 1.5rem;">
                              <div class="empty-state">
                                <span style="font-size: 2.5rem; display: block; margin-bottom: 0.5rem;">📁</span>
                                <h4>No Deposit History</h4>
                                <p class="text-muted">Recorded bank deposits will be archived here with linked vector PDF deposit slips.</p>
                              </div>
                            </td>
                          </tr>
                        `}
                  </tbody>
                </table>
              </div>
              ${renderPagination({
                page,
                limit: pageSize,
                total: totalDeposits,
                baseUrl: '/accounting/deposits',
                queryParams: { tab: 'history' }
              })}
            `;
          })()}
        `}
  `;

  return {
    title: 'Bank Deposit Batching',
    content
  };
}
