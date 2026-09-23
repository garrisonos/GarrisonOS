import { html, raw, SafeHtml } from '../lib/html.js';
import { csrfField } from '../lib/csrf.js';
import { RecurringLeaseCharge, LeaseCreditConcession, SecurityDepositRefund } from '../../modules/leases/backend/repository.js';

export interface LeaseARProps {
  leaseId: string;
  csrfToken: string;
  depositHeldCents: number;
  recurringCharges: RecurringLeaseCharge[];
  credits: LeaseCreditConcession[];
  refunds: SecurityDepositRefund[];
  lateFeeInfo?: {
    isDelinquent: boolean;
    unpaidBalanceCents: number;
    proposedLateFeeCents: number;
    daysOverdue: number;
    policySummary?: string;
  };
  contacts: Array<{ id: string; first_name: string; last_name: string }>;
}

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(epochMs: number): string {
  if (!epochMs) return '—';
  const d = new Date(epochMs);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function renderLeaseARSubsystem(props: LeaseARProps): SafeHtml {
  const {
    leaseId,
    csrfToken,
    depositHeldCents,
    recurringCharges = [],
    credits = [],
    refunds = [],
    lateFeeInfo,
    contacts = []
  } = props;

  const chargeCategoryLabels: Record<string, string> = {
    base_rent: 'Base Rent',
    pet_rent: 'Pet Rent',
    parking_fee: 'Parking Fee',
    storage_fee: 'Storage Space',
    utility_surcharge: 'Utility Surcharge',
    amenity_fee: 'Amenity Fee'
  };

  const recurringRows = recurringCharges.length === 0
    ? html`<tr><td colspan="5" class="text-center text-muted">No recurring charges scheduled.</td></tr>`
    : recurringCharges.map((ch) => html`
        <tr>
          <td><strong>${chargeCategoryLabels[ch.charge_category] || ch.charge_category}</strong></td>
          <td>${ch.description}</td>
          <td class="amount-col font-bold">$${formatCurrency(ch.amount_cents)}</td>
          <td>Day ${ch.billing_day} (${ch.billing_frequency})</td>
          <td style="text-align: right;">
            <form method="POST" action="/leases/show?id=${encodeURIComponent(leaseId)}" style="display:inline;" onsubmit="return confirm('Remove recurring charge?');">
              ${csrfField(csrfToken)}
              <input type="hidden" name="action" value="delete_recurring_charge">
              <input type="hidden" name="charge_id" value="${ch.id}">
              <button type="submit" class="btn btn-sm btn-danger">Delete</button>
            </form>
          </td>
        </tr>
      `);

  const creditRows = credits.length === 0
    ? html`<tr><td colspan="4" class="text-center text-muted">No credits or concessions granted.</td></tr>`
    : credits.map((cr) => html`
        <tr>
          <td><strong>${cr.credit_type.replace(/_/g, ' ')}</strong></td>
          <td>${cr.reason}</td>
          <td class="amount-col font-bold amount-positive">-$${formatCurrency(cr.amount_cents)}</td>
          <td>${formatDate(cr.effective_date)}</td>
        </tr>
      `);

  const refundRows = refunds.length === 0
    ? html`<tr><td colspan="4" class="text-center text-muted">No deposit refunds recorded.</td></tr>`
    : refunds.map((rf) => html`
        <tr>
          <td><strong>${rf.refund_type.replace(/_/g, ' ')}</strong></td>
          <td class="amount-col font-bold">$${formatCurrency(rf.refund_amount_cents)}</td>
          <td>${rf.disbursement_method.replace(/_/g, ' ')} ${rf.check_number ? `#${rf.check_number}` : ''}</td>
          <td>${formatDate(rf.disbursement_date)}</td>
        </tr>
      `);

  const contactOptions = contacts.map(
    (c) => html`<option value="${c.id}">${c.last_name}, ${c.first_name}</option>`
  );

  return html`
    <div style="margin-top: 2rem;">
      <div class="tabs-bar">
        <a href="#recurring-charges" class="tab-link active">⚡ Recurring Charges</a>
        <a href="#concessions-credits" class="tab-link">🎁 Concessions & Credits</a>
        <a href="#deposit-disposition" class="tab-link">🛡️ Deposit Disposition ($${formatCurrency(depositHeldCents)})</a>
        <a href="#late-fee-monitor" class="tab-link">⏱️ Late Fee Delinquency</a>
      </div>

      <!-- Section: Recurring Charges -->
      <div id="recurring-charges" class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h3 class="card-title" style="margin:0;">Itemized Recurring Charges</h3>
            <small class="text-muted">Automated monthly billing items posted to the tenant ledger</small>
          </div>
          <button type="button" class="btn btn-sm btn-primary" onclick="document.getElementById('addRecurringModal').showModal()">
            + Add Recurring Charge
          </button>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th style="text-align:right;">Amount</th>
                <th>Billing Schedule</th>
                <th style="text-align:right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${recurringRows}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Section: Concessions & Credits & Late Fee Grid -->
      <div class="grid-2-col">
        <!-- Concessions & Credits -->
        <div id="concessions-credits" class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <h3 class="card-title" style="margin:0;">Rent Credits & Concessions</h3>
              <small class="text-muted">Move-in promotions, goodwill offsets, or fee waivers</small>
            </div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('addCreditModal').showModal()">
              + Grant Credit
            </button>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Reason</th>
                  <th style="text-align:right;">Credit Amount</th>
                  <th>Effective Date</th>
                </tr>
              </thead>
              <tbody>
                ${creditRows}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Late Fee Delinquency Monitor -->
        <div id="late-fee-monitor" class="card">
          <div class="card-header">
            <h3 class="card-title" style="margin:0;">Late Fee Delinquency Engine</h3>
            <small class="text-muted">Real-time statutory grace period and balance evaluation</small>
          </div>
          <div class="card-body">
            ${lateFeeInfo
              ? html`
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding: 0.75rem; background: var(--bg-subtle); border-radius: var(--radius-md);">
                    <div>
                      <span class="text-muted" style="font-size: 0.8rem; display:block;">Unpaid Past-Due Balance</span>
                      <strong class="font-mono ${lateFeeInfo.unpaidBalanceCents > 0 ? 'text-danger' : 'text-success'}" style="font-size: 1.25rem;">
                        $${formatCurrency(lateFeeInfo.unpaidBalanceCents)}
                      </strong>
                    </div>
                    <div>
                      <span class="text-muted" style="font-size: 0.8rem; display:block;">Days Delinquent</span>
                      <strong class="font-mono" style="font-size: 1.25rem;">${lateFeeInfo.daysOverdue} days</strong>
                    </div>
                    <div>
                      <span class="text-muted" style="font-size: 0.8rem; display:block;">Calculated Late Fee</span>
                      <strong class="font-mono text-danger" style="font-size: 1.25rem;">$${formatCurrency(lateFeeInfo.proposedLateFeeCents)}</strong>
                    </div>
                  </div>
                  <p class="text-muted" style="font-size: 0.85rem; margin-bottom: 1rem;">
                    ${lateFeeInfo.policySummary || 'Policy: Standard residential late fee after statutory grace period.'}
                  </p>
                  ${lateFeeInfo.isDelinquent && lateFeeInfo.proposedLateFeeCents > 0
                    ? html`
                        <form method="POST" action="/leases/show?id=${encodeURIComponent(leaseId)}">
                          ${csrfField(csrfToken)}
                          <input type="hidden" name="action" value="apply_late_fee">
                          <button type="submit" class="btn btn-danger" style="width: 100%;">
                            ⚠️ Assess Late Fee ($${formatCurrency(lateFeeInfo.proposedLateFeeCents)})
                          </button>
                        </form>
                      `
                    : html`
                        <div class="badge badge-success" style="padding: 0.4rem 0.8rem;">
                          ✓ Account Current (No Late Fee Due)
                        </div>
                      `}
                `
              : html`<p class="text-muted">No delinquency detected on this lease account.</p>`}
          </div>
        </div>
      </div>

      <!-- Section: Deposit Refunds -->
      <div id="deposit-disposition" class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h3 class="card-title" style="margin:0;">Security Deposit Dispositions & Refunds</h3>
            <small class="text-muted">Statutory escrow returns and itemized deduction disbursements</small>
          </div>
          ${depositHeldCents > 0
            ? html`
                <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('refundDepositModal').showModal()">
                  + Process Deposit Refund
                </button>
              `
            : raw('')}
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Disposition Type</th>
                <th style="text-align:right;">Refund Amount</th>
                <th>Payment Method</th>
                <th>Disbursement Date</th>
              </tr>
            </thead>
            <tbody>
              ${refundRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Modal: Add Recurring Charge -->
    <dialog id="addRecurringModal" class="modal">
      <form method="POST" action="/leases/show?id=${encodeURIComponent(leaseId)}" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="add_recurring_charge">
        <div class="modal-header">
          <h3>Add Recurring Lease Charge</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('addRecurringModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Charge Category *</label>
            <select name="charge_category" class="form-select" required>
              <option value="pet_rent">Pet Rent</option>
              <option value="parking_fee">Parking Space Fee</option>
              <option value="storage_fee">Storage Locker Fee</option>
              <option value="utility_surcharge">Utility Surcharge (RUBS)</option>
              <option value="amenity_fee">Building Amenity Fee</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Monthly Amount ($) *</label>
            <input type="number" name="amount" class="form-input" step="0.01" min="1" placeholder="50.00" required>
          </div>
          <div class="form-group">
            <label class="form-label">Description / Line Item Note *</label>
            <input type="text" name="description" class="form-input" placeholder="e.g. Assigned Spot #14 Parking" required>
          </div>
          <div class="form-row">
            <div class="col-6">
              <label class="form-label">Billing Day of Month</label>
              <input type="number" name="billing_day" class="form-input" min="1" max="28" value="1">
            </div>
            <div class="col-6">
              <label class="form-label">Billing Frequency</label>
              <select name="billing_frequency" class="form-select">
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('addRecurringModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Schedule Charge</button>
        </div>
      </form>
    </dialog>

    <!-- Modal: Add Credit / Concession -->
    <dialog id="addCreditModal" class="modal">
      <form method="POST" action="/leases/show?id=${encodeURIComponent(leaseId)}" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="add_credit">
        <div class="modal-header">
          <h3>Grant Lease Credit / Concession</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('addCreditModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Credit Type *</label>
            <select name="credit_type" class="form-select" required>
              <option value="promotional_concession">Promotional Move-in Concession</option>
              <option value="maintenance_inconvenience">Maintenance Inconvenience Credit</option>
              <option value="discretionary_credit">Discretionary Management Credit</option>
              <option value="bad_debt_writeoff">Bad Debt Write-off</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Credit Amount ($) *</label>
            <input type="number" name="amount" class="form-input" step="0.01" min="1" placeholder="250.00" required>
          </div>
          <div class="form-group">
            <label class="form-label">Business Reason / Justification *</label>
            <textarea name="reason" class="form-input" rows="3" placeholder="Explain the rationale for this credit..." required></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('addCreditModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Apply Credit</button>
        </div>
      </form>
    </dialog>

    <!-- Modal: Refund Security Deposit -->
    <dialog id="refundDepositModal" class="modal">
      <form method="POST" action="/leases/show?id=${encodeURIComponent(leaseId)}" class="modal-box">
        ${csrfField(csrfToken)}
        <input type="hidden" name="action" value="refund_deposit">
        <div class="modal-header">
          <h3>Process Security Deposit Refund</h3>
          <button type="button" class="btn-close" onclick="document.getElementById('refundDepositModal').close()">✕</button>
        </div>
        <div class="modal-body">
          <p class="text-muted" style="margin-bottom: 1rem;">
            Current escrow deposit balance: <strong>$${formatCurrency(depositHeldCents)}</strong>
          </p>
          <div class="form-group">
            <label class="form-label">Recipient Contact *</label>
            <select name="recipient_contact_id" class="form-select" required>
              <option value="">-- Select Signatory --</option>
              ${contactOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Refund Amount ($) *</label>
            <input type="number" name="amount" class="form-input" step="0.01" min="0.01" max="${(depositHeldCents / 100).toFixed(2)}" value="${(depositHeldCents / 100).toFixed(2)}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Disbursement Method *</label>
            <select name="disbursement_method" class="form-select" required>
              <option value="ach_transfer">Direct ACH Transfer</option>
              <option value="check">Physical Check</option>
              <option value="wire_transfer">Wire Transfer</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Check / Reference Number</label>
            <input type="text" name="check_number" class="form-input" placeholder="e.g. Check #1042">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('refundDepositModal').close()">Cancel</button>
          <button type="submit" class="btn btn-primary">Execute Disbursement</button>
        </div>
      </form>
    </dialog>
  `;
}
