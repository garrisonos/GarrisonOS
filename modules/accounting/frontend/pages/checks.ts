import { PageContext, PageResult } from '../../../../web/lib/page-context.js';
import { html, raw, SafeHtml } from '../../../../web/lib/html.js';
import { csrfField, validateCsrf } from '../../../../web/lib/csrf.js';
import { renderPagination } from '../../../../web/templates/pagination.js';

export async function handle(ctx: PageContext): Promise<PageResult> {
  const csrfToken = ctx.session.getCsrfToken();
  let error: string | null = null;

  const bankAccountId = ctx.query['bank_account_id'] || '';
  const statusFilter = ctx.query['status'] || '';
  const page = Math.max(1, parseInt(ctx.query['page'] || '1', 10) || 1);
  const pageSize = 10;

  // POST Actions: Issue Check, Void Check
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
      if (action === 'issue_check') {
        const rawAmount = parseFloat(ctx.body['amount'] || '0') || 0;
        const amountCents = Math.round(rawAmount * 100);

        const billIds = Array.isArray(ctx.body['bill_ids'])
          ? ctx.body['bill_ids']
          : ctx.body['bill_ids'] ? [ctx.body['bill_ids']] : [];

        const billAllocations = billIds.map((bId: string) => ({
          bill_id: bId,
          allocated_amount_cents: amountCents
        }));

        const checkDateMs = ctx.body['check_date'] ? new Date(ctx.body['check_date']).getTime() : Date.now();

        await ctx.api.post('/api/v1/accounting/checks', {
          bank_account_id: ctx.body['bank_account_id'],
          vendor_id: ctx.body['vendor_id'],
          check_number: ctx.body['check_number'],
          check_date: checkDateMs,
          amount_cents: amountCents,
          payee_name: ctx.body['payee_name'],
          memo: ctx.body['memo'] || null,
          bill_allocations: billAllocations.length > 0 ? billAllocations : undefined
        });

        ctx.session.addFlash('success', `Check #${ctx.body['check_number']} issued successfully`);
        return { redirect: '/accounting/checks', content: '' };
      } else if (action === 'void_check') {
        const checkId = ctx.body['check_id'];
        await ctx.api.post(`/api/v1/accounting/checks/${encodeURIComponent(checkId)}/void`, {
          reason: ctx.body['void_reason'] || 'Void requested by operator'
        });
        ctx.session.addFlash('success', 'Check voided and bills reopened');
        return { redirect: '/accounting/checks', content: '' };
      }
    } catch (err: any) {
      error = err.message;
    }
  }

  // Fetch checks list
  let checks: any[] = [];
  try {
    let url = '/api/v1/accounting/checks?limit=100';
    if (bankAccountId) url += `&bank_account_id=${encodeURIComponent(bankAccountId)}`;
    if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;
    const listRes = await ctx.api.get(url);
    checks = listRes?.data || [];
  } catch (err: any) {
    error = error || err.message;
  }

  // Fetch all checks for accurate filter counts and next check number calculation across the entire register
  let allChecksForCounts: any[] = [];
  try {
    let offset = 0;
    const fetchLimit = 200;
    while (offset < 10000) {
      const pageRes = await ctx.api.get(`/api/v1/accounting/checks?limit=${fetchLimit}&offset=${offset}`);
      const items = pageRes?.data || [];
      allChecksForCounts.push(...items);
      const total = pageRes?.meta?.total ?? items.length;
      if (items.length === 0 || allChecksForCounts.length >= total) {
        break;
      }
      offset += items.length;
    }
  } catch (_) {
    allChecksForCounts = checks;
  }

  const checksByAccount = new Map<string, number>();
  let printedCount = 0;
  let clearedCount = 0;
  let voidedCount = 0;
  for (const c of allChecksForCounts) {
    if (c.bank_account_id) {
      checksByAccount.set(c.bank_account_id, (checksByAccount.get(c.bank_account_id) || 0) + 1);
    }
    if (c.status === 'printed') printedCount++;
    else if (c.status === 'cleared') clearedCount++;
    else if (c.status === 'voided') voidedCount++;
  }

  // Fetch bank accounts for dropdown
  let bankAccounts: any[] = [];
  try {
    const coaRes = await ctx.api.get('/api/v1/accounting/chart-of-accounts');
    bankAccounts = (coaRes?.data?.accounts || coaRes?.data || []).filter((a: any) => a.account_type === 'Bank');
  } catch (_) {}

  // Calculate next check number suggestion
  let nextCheckNum = 1001;
  for (const c of allChecksForCounts) {
    const num = parseInt(c.check_number, 10);
    if (!isNaN(num) && num >= nextCheckNum) {
      nextCheckNum = num + 1;
    }
  }

  // Pagination
  const totalFiltered = checks.length;
  const totalPages = Math.ceil(totalFiltered / pageSize) || 1;
  const paginatedChecks = checks.slice((page - 1) * pageSize, page * pageSize);

  const content = html`
    <div class="page-header">
      <div>
        <h1 class="page-title">Check Register & Disbursements</h1>
        <p class="page-subtitle text-muted">
          Print physical checks, batch verify remittance vouchers, and track payment clearing.
        </p>
      </div>
      <div style="display: flex; gap: 0.75rem;">
        <button type="button" class="btn btn-primary" onclick="document.getElementById('issue-check-dialog').showModal()">
          + Issue Check
        </button>
      </div>
    </div>

    ${error ? html`<div class="alert alert-danger" style="margin-bottom: 1.5rem;">${error}</div>` : raw('')}

    <!-- Filters Bar -->
    <div class="card" style="padding: 1rem 1.25rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
      <form method="GET" action="/accounting/checks" style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <label for="bank_account_id" style="font-weight: 600; font-size: 0.85rem;">Bank Account:</label>
          <select id="bank_account_id" name="bank_account_id" class="form-control form-control-sm" onchange="this.form.submit()">
            <option value="">All Bank Accounts (${allChecksForCounts.length})</option>
            ${bankAccounts.map(
              (acc) => html`
                <option value="${acc.id}" ${bankAccountId === acc.id ? raw('selected') : raw('')}>
                  ${acc.account_number} ${acc.account_name} (${checksByAccount.get(acc.id) || 0})
                </option>
              `
            )}
          </select>
        </div>

        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <label for="status" style="font-weight: 600; font-size: 0.85rem;">Status:</label>
          <select id="status" name="status" class="form-control form-control-sm" onchange="this.form.submit()">
            <option value="">All Statuses (${allChecksForCounts.length})</option>
            <option value="printed" ${statusFilter === 'printed' ? raw('selected') : raw('')}>Printed / Outstanding (${printedCount})</option>
            <option value="cleared" ${statusFilter === 'cleared' ? raw('selected') : raw('')}>Cleared (${clearedCount})</option>
            <option value="voided" ${statusFilter === 'voided' ? raw('selected') : raw('')}>Voided (${voidedCount})</option>
          </select>
        </div>

        ${bankAccountId || statusFilter
          ? html`<a href="/accounting/checks" class="btn btn-sm btn-subtle">Reset Filters</a>`
          : raw('')}
      </form>

      <div>
        <small class="text-muted" style="font-weight: 600;">Total Checks: ${checks.length}</small>
      </div>
    </div>

    <!-- Check Register Table -->
    <div class="card" style="padding: 0; overflow-x: auto; margin-bottom: 1.5rem;">
      <table class="table" style="margin-bottom: 0;" id="checks-table">
        <thead>
          <tr>
            <th style="width: 44px; text-align: center;">
              <input type="checkbox" id="check-all-box" title="Select all checks for printing" />
            </th>
            <th style="width: 130px;">Check #</th>
            <th style="width: 110px;">Date</th>
            <th>Payee</th>
            <th>Bank Account</th>
            <th style="width: 130px; text-align: right;">Total Amount</th>
            <th style="width: 120px; text-align: center;">Status</th>
            <th style="width: 120px;">Cleared Date</th>
            <th style="width: 130px; text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${paginatedChecks.length > 0
            ? paginatedChecks.map((c) => {
                return html`
                  <tr
                    class="check-row"
                    id="check-${c.id}"
                    data-entity-type="check"
                    data-entity-id="${c.id}"
                    data-amount-cents="${c.amount_cents}"
                    data-status="${c.status}"
                  >
                    <td style="text-align: center; vertical-align: middle;">
                      ${c.status !== 'voided'
                        ? html`<input type="checkbox" class="check-select-box" value="${c.id}" data-amount-cents="${c.amount_cents}" />`
                        : raw('')}
                    </td>
                    <td style="font-weight: 700; font-family: var(--font-mono); white-space: nowrap;">
                      <a href="/accounting/checks?id=${encodeURIComponent(c.id)}" data-entity-id="${c.id}" data-entity-type="check">#${c.check_number}</a>
                      <button
                        type="button"
                        class="btn-copy-id"
                        data-action="copy-id"
                        data-target-id="${c.id}"
                        title="Copy Check UUID"
                        style="background: none; border: none; cursor: pointer; opacity: 0.6; padding: 0 4px;"
                      >
                        📋
                      </button>
                    </td>
                    <td>${new Date(c.check_date).toISOString().slice(0, 10)}</td>
                    <td style="font-weight: 600;">${c.payee_name}</td>
                    <td class="text-muted">${c.bank_account_name || 'Operating Checking'}</td>
                    <td style="text-align: right; font-weight: 700; font-family: var(--font-mono);">$${(c.amount_cents / 100).toFixed(2)}</td>
                    <td style="text-align: center;">
                      <span class="badge ${c.status === 'cleared' ? 'badge-success' : c.status === 'voided' ? 'badge-danger' : 'badge-primary'}">
                        ${c.status.toUpperCase()}
                      </span>
                    </td>
                    <td class="text-muted">
                      ${c.cleared_at ? new Date(c.cleared_at).toISOString().slice(0, 10) : '—'}
                    </td>
                    <td style="text-align: right; white-space: nowrap;">
                      <a
                        href="/api/v1/accounting/checks/${encodeURIComponent(c.id)}/pdf"
                        target="_blank"
                        class="btn btn-sm btn-secondary"
                        style="padding: 0.25rem 0.6rem;"
                      >
                        🖨️ PDF
                      </a>
                      ${c.status !== 'voided'
                        ? html`
                            <button
                              type="button"
                              class="btn btn-sm btn-subtle btn-open-void"
                              style="color: var(--danger); margin-left: 0.25rem;"
                              data-check-id="${c.id}"
                              data-check-num="${c.check_number}"
                            >
                              Void
                            </button>
                          `
                        : raw('')}
                    </td>
                  </tr>
                `;
              })
            : html`
                <tr>
                  <td colspan="9" style="text-align: center; padding: 3rem 1.5rem;">
                    <div class="empty-state">
                      <span style="font-size: 2.5rem; display: block; margin-bottom: 0.5rem;">💳</span>
                      <h4>Check Register Empty</h4>
                      <p class="text-muted" style="max-width: 450px; margin: 0 auto 1rem;">
                        Disbursements issued to vendors, contractors, and owners will be logged here with automatic double-entry General Ledger reconciliation.
                      </p>
                      <button type="button" class="btn btn-primary" onclick="document.getElementById('issue-check-dialog').showModal()">
                        + Issue First Check
                      </button>
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
      total: totalFiltered,
      baseUrl: '/accounting/checks',
      queryParams: { bank_account_id: bankAccountId, status: statusFilter }
    })}

    <!-- Sticky Batch Action Bar (Float at bottom when checks selected) -->
    <div id="batch-action-bar" class="card" style="display: none; position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%); width: 90%; max-width: 800px; padding: 1rem 1.5rem; box-shadow: var(--shadow-lg); border: 2px solid var(--primary); z-index: 100; justify-content: space-between; align-items: center; background: var(--bg-surface);">
      <div>
        <strong id="batch-count">0</strong> checks selected | Total: <strong id="batch-total" style="color: var(--primary);">$0.00</strong>
      </div>
      <div style="display: flex; gap: 0.75rem;">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-batch-clear">Deselect All</button>
        <button type="button" class="btn btn-primary" id="btn-batch-print-modal">🖨️ Batch Print Selected</button>
      </div>
    </div>

    <!-- Batch PDF Preview Iframe Modal -->
    <dialog id="batch-preview-dialog" class="modal modal-box modal-xl" style="width: 90%; max-width: 950px; height: 85vh; border-radius: var(--radius-lg); border: 1px solid var(--border-color); padding: 0; background: var(--bg-surface); color: var(--text-main);">
      <div style="padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface);">
        <h2 style="font-size: 1.15rem; font-weight: 700; margin: 0; color: var(--text-main);">Consolidated Check Batch Vector PDF Preview</h2>
        <div style="display: flex; gap: 0.5rem;">
          <button type="button" class="btn btn-sm btn-primary" id="btn-iframe-print">🖨️ Print Batch</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('batch-preview-dialog').close()">Close</button>
        </div>
      </div>
      <div style="height: calc(85vh - 65px); background: #525659;">
        <iframe id="batch-pdf-frame" src="about:blank" style="width: 100%; height: 100%; border: none;"></iframe>
      </div>
    </dialog>

    <!-- Issue Check Dialog Modal -->
    <dialog id="issue-check-dialog" class="modal modal-box" style="max-width: 600px; width: 95%; border-radius: var(--radius-lg); border: 1px solid var(--border-color); padding: 0; background: var(--bg-surface); color: var(--text-main);">
      <div style="padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface);">
        <h2 style="font-size: 1.25rem; font-weight: 700; margin: 0; color: var(--text-main);">Issue Vendor Check</h2>
        <button type="button" class="btn btn-sm btn-subtle" onclick="document.getElementById('issue-check-dialog').close()">✕</button>
      </div>
      <form method="POST" action="/accounting/checks" class="modal-box" style="padding: 1.5rem; background: var(--bg-surface); color: var(--text-main);">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="issue_check" />

        <div class="form-group" style="margin-bottom: 1rem;">
          <label for="bank_account_id_input">Disbursement Bank Account *</label>
          <select id="bank_account_id_input" name="bank_account_id" class="form-control" required>
            ${bankAccounts.map((acc) => html`<option value="${acc.id}">${acc.account_number} ${acc.account_name}</option>`)}
          </select>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
          <div class="form-group">
            <label for="check_number">Check # *</label>
            <input type="text" id="check_number" name="check_number" class="form-control" value="${nextCheckNum}" required />
          </div>
          <div class="form-group">
            <label for="check_date">Check Date *</label>
            <input type="date" id="check_date" name="check_date" class="form-control" value="${new Date().toISOString().slice(0, 10)}" required />
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 1rem;">
          <label for="payee_name">Payee Name *</label>
          <input type="text" id="payee_name" name="payee_name" class="form-control" placeholder="Acme Maintenance LLC" required />
        </div>

        <div class="form-group" style="margin-bottom: 1rem;">
          <label for="amount">Check Amount ($) *</label>
          <input type="number" step="0.01" id="amount" name="amount" class="form-control" placeholder="0.00" required style="font-size: 1.2rem; font-weight: 700;" />
        </div>

        <div class="form-group" style="margin-bottom: 1.5rem;">
          <label for="memo">Check Memo / Reference</label>
          <input type="text" id="memo" name="memo" class="form-control" placeholder="October Property Repairs" />
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('issue-check-dialog').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Issue & Post Check</button>
        </div>
      </form>
    </dialog>

    <!-- Void Check Dialog Modal -->
    <dialog id="void-check-dialog" class="modal modal-box" style="max-width: 480px; width: 95%; border-radius: var(--radius-lg); border: 1px solid var(--border-color); padding: 0; background: var(--bg-surface); color: var(--text-main);">
      <div style="padding: 1.5rem; border-bottom: 1px solid var(--border-color); background: var(--bg-surface);">
        <h2 style="font-size: 1.2rem; font-weight: 700; margin: 0; color: var(--danger);">Void Issued Check</h2>
      </div>
      <form method="POST" action="/accounting/checks" class="modal-box" style="padding: 1.5rem; background: var(--bg-surface); color: var(--text-main);">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="void_check" />
        <input type="hidden" name="check_id" id="void_check_id" value="" />

        <p style="margin-bottom: 1rem; font-size: 0.95rem;">
          Voiding check <strong id="void_check_num"></strong> will automatically reverse General Ledger journal entries and reopen any settled bills.
        </p>

        <div class="form-group" style="margin-bottom: 1.5rem;">
          <label for="void_reason">Mandatory Void Reason *</label>
          <input type="text" id="void_reason" name="void_reason" class="form-control" placeholder="e.g. Check lost in transit or incorrect amount" required />
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('void-check-dialog').close()">Cancel</button>
          <button type="submit" class="btn btn-danger">Confirm Void</button>
        </div>
      </form>
    </dialog>

    <script>
      function openVoidModal(id, num) {
        document.getElementById('void_check_id').value = id;
        document.getElementById('void_check_num').textContent = '#' + num;
        document.getElementById('void-check-dialog').showModal();
      }
      document.addEventListener('click', function(event) {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest('.btn-open-void');
        if (button && button.dataset.checkId) {
          openVoidModal(button.dataset.checkId, button.dataset.checkNum || '');
        }
      });
    </script>
  `;

  return {
    title: 'Check Register & Disbursements',
    content
  };
}
