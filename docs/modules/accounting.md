# Accounting & General Ledger Module

The **Accounting** module (`modules/accounting/`) implements a native, immutable double-entry General Ledger engine, standard Chart of Accounts mapping aligned with IRS Schedule E and QuickBooks, Trial Balance reporting, tenant lease ledger calculations, and automated monthly billing.

---

## 1. Native Double-Entry General Ledger Architecture

GarrisonOS enforces first-class double-entry bookkeeping with strict zero-sum debit/credit balance proofs across all operational activity.

### 1.1. Core Tables & Invariants

* **`journal_entries`**: Header table tracking sequentially numbered transactions (`entry_number` per tenant), accounting date (`date_ms`), descriptive memo, source tracking (`source_type`, `source_id`), posting timestamp, and optional link to reversing entries (`reversed_by_entry_id`).
* **`journal_lines`**: Itemized lines enforcing non-negative integer cents:
  $$\sum \text{debit\_cents} \equiv \sum \text{credit\_cents} > 0$$
  Each line belongs to an account in `chart_of_accounts`, and must satisfy:
  $$\text{CHECK }((\text{debit} > 0 \land \text{credit} = 0) \lor (\text{credit} > 0 \land \text{debit} = 0))$$
  Lines optionally attach granular dimensions: `property_id`, `unit_id`, and `contact_id`.

### 1.2. Operational Event Mappings

Every operational event posts a balanced double-entry journal entry:

| Operational Activity | Source Type | Debit Line | Credit Line |
| :--- | :--- | :--- | :--- |
| **Rent / Fee Invoicing** | `rent_billing` / `charge` | Accounts Receivable (`#1100`) | Rental Income (`#4010`) / Fee Income |
| **Tenant Rent Payment** | `tenant_payment` / `payment` | Operating Checking (`#1010`) | Accounts Receivable (`#1100`) |
| **Vendor Repair Expense** | `maintenance_expense` / `expense` | Repairs & Maintenance (`#5100`) | Operating Checking (`#1010`) / AP |
| **Security Deposit Inflow** | `deposit_inflow` | Security Deposit Trust (`#1020`) | Tenant Security Deposits Held (`#2100`) |
| **Security Deposit Refund** | `deposit_return` | Tenant Security Deposits Held (`#2100`) | Security Deposit Trust (`#1020`) |
| **Deposit Applied to Rent** | `deposit_deduction` | Tenant Security Deposits Held (`#2100`) | Accounts Receivable (`#1100`) |
| **Reversals / Voids** | `reversal` | Exact opposite lines of original entry | Exact opposite lines of original entry |

---

## 2. IRS Schedule E Tax Categorization

Operating expenses align with standard IRS Form 1040 Schedule E line items:

* `advertising` (#5010)
* `auto_travel` (#5020)
* `cleaning_maintenance` (#5030)
* `commissions` (#5040)
* `insurance` (#5050)
* `legal_professional` (#5060)
* `management_fees` (#5070)
* `mortgage_interest` (#5080)
* `other_interest` (#5090)
* `repairs` (#5100)
* `supplies` (#5110)
* `property_taxes` (#5120)
* `utilities` (#5130)
* `hoa_fees` (#5140)
* `capital_improvement` (#1500)

---

## 3. Financial Mathematics & Algorithms

### 3.1. Tenant Running Balance

$$\text{Tenant Balance} = \sum (\text{charges} + \text{deposit\_returns} + \text{deposit\_deductions}) - \sum (\text{payments} + \text{refunds})$$

From double-entry journal lines on Accounts Receivable:
$$\text{Tenant Receivable Balance} = \sum \text{Debits} - \sum \text{Credits}$$

### 3.2. Payment Priority Waterfall

When recording partial payments against an unpaid ledger, funds apply in strict order:
$$\text{Late Fees} \longrightarrow \text{Utility / Other Charges} \longrightarrow \text{Oldest Unpaid Rent} \longrightarrow \text{Current Month Rent}$$

### 3.3. Mid-Month Rent Proration

$$\text{Prorated Rent Cents} = \left\lfloor \frac{\text{Monthly Rent Cents}}{\text{Days in Month}} \times \text{Days Remaining (inclusive)} \right\rfloor$$

### 3.4. Net Operating Income (NOI)

$$\text{NOI} = \text{Operating Income (Rent, Fees)} - \text{Operating Expenses (Schedule E)}$$

---

## 4. API Endpoints

### 4.1. General Ledger & Invariants

* `GET /api/v1/accounting/trial-balance`: Live Trial Balance report verifying that total debits equal total credits
* `GET /api/v1/accounting/journal-entries`: Paginated list of double-entry journal entries with itemized lines
* `GET /api/v1/accounting/journal-entries/:id`: Fetch single journal entry by ID
* `POST /api/v1/accounting/journal-entries`: Post manual balanced journal entry
* `POST /api/v1/accounting/journal-entries/:id/reverse`: Post reversal entry and link `reversed_by_entry_id`
* `POST /api/v1/accounting/backfill-ledger`: Idempotently backfill historical single-entry transactions

### 4.2. Operational Transactions & Billing

* `GET /api/v1/accounting/transactions`: List transactions with filters (`type`, `category`, `lease_id`, `date range`)
* `POST /api/v1/accounting/transactions`: Post a transaction (automatically creates balanced double-entry journal entry)
* `DELETE /api/v1/accounting/transactions/:id`: Void a transaction (posts reversal journal entry)
* `GET /api/v1/accounting/balance/:lease_id`: Calculate running balance and itemized statement for a lease
* `POST /api/v1/accounting/generate-rent-charges`: Trigger automated recurring monthly billing run
* `POST /api/v1/accounting/deposit-disposition`: Finalize deposit trust payout and damage deductions

### 4.3. Statutory Compliance & Reconciliation

* `GET /api/v1/accounting/reconciliation/three-way`: Statutory Three-Way Bank Reconciliation report proving parity across Bank Balance, GL Trust Cash (`1020`), and Active Lease Deposit Liabilities (`2100`)
* `GET /api/v1/accounting/reports/1099-nec`: Annual IRS Form 1099-NEC vendor expense summary report with maintained statutory threshold flagging (`?year=YYYY`)
* `GET /api/v1/accounting/disposition/timeline`: Statutory move-out deposit deduction deadline and countdown schedule (`?move_out_date=...&state=...`)

### 4.4. Exports & External Compatibility

* `GET /api/v1/accounting/export/rent-roll.csv`: Stream Rent Roll CSV
* `GET /api/v1/accounting/export/schedule-e.csv`: Stream IRS Schedule E P&L breakdown CSV
* `GET /api/v1/accounting/export/ledger/:lease_id.csv`: Stream itemized tenant ledger statement CSV
* `GET /api/v1/accounting/chart-of-accounts`: List Chart of Accounts
* `POST /api/v1/accounting/chart-of-accounts`: Create general ledger account
* `PUT /api/v1/accounting/chart-of-accounts/:id`: Update general ledger account
* `GET /api/v1/accounting/quickbooks/preview`: Preview persistent double-entry journal entries for export
* `GET /api/v1/accounting/export/quickbooks/qbo-journal.csv`: Export QuickBooks Online Journal Entry batch CSV
* `GET /api/v1/accounting/export/quickbooks/desktop.iif`: Export QuickBooks Desktop IIF format
* `GET /api/v1/accounting/export/quickbooks/bank-feed.qbo`: Export Web Connect (.QBO) bank feed

### 4.5. Accounts Payable: Vendor Bills & Recurring Templates

* `GET /api/v1/accounting/bills`: List vendor bills with status, approval, and vendor filters
* `POST /api/v1/accounting/bills`: Create vendor bill with split property/unit allocations
* `GET /api/v1/accounting/bills/:id`: Get bill details and allocation line items
* `PUT /api/v1/accounting/bills/:id`: Update draft bill
* `POST /api/v1/accounting/bills/:id/approve`: Approve bill for disbursement
* `POST /api/v1/accounting/bills/:id/void`: Void bill and reverse journal allocations
* `GET /api/v1/accounting/bills/recurring`: List scheduled recurring bill templates
* `POST /api/v1/accounting/bills/recurring`: Create recurring bill template

### 4.6. Vendor Check Register & Check Printing

* `GET /api/v1/accounting/vendor_checks`: List printed and draft vendor checks from register
* `POST /api/v1/accounting/vendor_checks`: Record paper check payment settling one or more bills
* `GET /api/v1/accounting/vendor_checks/:id`: Get check details and bill settlements
* `POST /api/v1/accounting/vendor_checks/:id/void`: Void check and restore unpaid bill balances

### 4.7. Vendor Credit Memos & Bill Applications

* `GET /api/v1/accounting/vendor_credits`: List vendor credit memos
* `POST /api/v1/accounting/vendor_credits`: Record vendor credit memo / refund
* `POST /api/v1/accounting/vendor_credits/:id/apply`: Apply credit memo balance against open vendor bills

### 4.8. Bank Deposits & Undeposited Funds Clearing

* `GET /api/v1/accounting/bank_deposits`: List bank deposit batches
* `POST /api/v1/accounting/bank_deposits`: Create bank deposit grouping payments into bank clearing account

### 4.9. Client Accounting & Management Fee Automation

* `GET /api/v1/accounting/portfolios/:portfolio_id/cash_summary`: Retrieve real-time net operating cash summary and client cash balance (`?as_of=<ms>&basis=cash|accrual`, default `cash`)
* `POST /api/v1/accounting/capital_contributions`: Record investor/owner capital infusion (debit `1010 Operating Checking`, credit `3010 Owner Capital Contributions`)
* `GET /api/v1/accounting/capital_contributions`: List client owner capital contributions
* `GET /api/v1/accounting/capital_contributions/:id`: Get single capital contribution details
* `POST /api/v1/accounting/distributions`: Execute client draw disbursement (debit `3020 Owner Draws`, credit `1010 Operating Checking`)
* `GET /api/v1/accounting/distributions`: List client owner draw disbursements
* `GET /api/v1/accounting/distributions/:id`: Get single distribution details
* `POST /api/v1/accounting/management_fee_agreements`: Create property management fee agreement
* `GET /api/v1/accounting/management_fee_agreements`: List active and draft management fee agreements
* `GET /api/v1/accounting/management_fee_agreements/:id`: Get single management fee agreement details
* `POST /api/v1/accounting/management_fee_agreements/:id/calculate`: Preview calculated fee for target month (`YYYY-MM`)
* `POST /api/v1/accounting/management_fee_agreements/:id/post`: Post calculated monthly fee accrual (debit `5070 Management Fees Expense`, credit `2010 Accounts Payable`)

---

## 5. QuickBooks Compatibility Architecture

GarrisonOS exports directly from persistent General Ledger entries into standard accounting formats:

1. **Chart of Accounts (COA) Standard Mapping**:
   * **Bank (1010 Operating Checking, 1020 Security Deposit Trust Checking)**: Operating vs escrow cash segregation.
   * **Accounts Receivable (1100 Tenant Receivables)**: Invoiced rent, utility, and fee charges.
   * **Accounts Payable (2010 Accounts Payable)**: Outstanding vendor bills and accrued management fees payable.
   * **Current Liabilities (2100 Tenant Security Deposits Held)**: Escrow liabilities.
   * **Equity (3010 Owner Capital Contributions, 3020 Owner Draws)**: Client capital contributions and distributions.
   * **Income (4010 Rental Income, 4020 Late Fee Income, etc.)**: Operating revenues.
   * **Concessions (4050 Lease Concessions)**: Contra-revenue reductions.
   * **Operating Expenses (5010–5140, including 5070 Management Fees)**: Aligned with IRS Form 1040 Schedule E lines.

2. **Class & Customer Tracking**:
   * Each journal line maps the GarrisonOS `property_id` to a QuickBooks **Class** for granular property-level P&L reporting.
   * Payer/Payee contacts map to QuickBooks **Customer:Job** or **Vendor**.

3. **Universal QuickBooks Formats**:
   * **QuickBooks Online (QBO) Journal CSV**: Conforms to Intuit's batch journal import structure.
   * **QuickBooks Desktop (IIF)**: Tab-delimited transaction blocks (`!TRNS`/`!SPL`/`!ENDTRNS`).
   * **Web Connect (QBO/OFX)**: OFX 2.1 SGML/XML banking import for bank feed reconciliation.

---

## 6. Statutory Trust Accounting & Regulatory Compliance

To satisfy real estate commission licensing mandates across state jurisdictions, GarrisonOS enforces strict separation of fiduciary funds and automated audit proofs:

### 6.1. Non-Commingling Invariant

Tenant security deposits are the legal property of the tenant held in trust. The accounting engine rejects any journal entry that attempts to deposit tenant security funds into `1010 Operating Checking` or pay operating expenses from `1020 Security Deposit Trust Checking` without an equal and offsetting liability settlement (`2100 Tenant Security Deposits Held`).

### 6.2. Three-Way Bank Reconciliation

State real estate licensing laws require monthly verification proving three-way balance parity:
$$\text{Bank Statement Balance} \equiv \text{GL Trust Account Balance (1020)} \equiv \sum \text{Active Lease Deposit Liabilities}$$

The `/api/v1/accounting/reconciliation/three-way` endpoint audits this equation using empirical bank statement balances, persistent journal cash lines, and itemized active lease subledgers (filtered by status and temporal cutoff), outputting an itemized lease breakdown with discrepancy tracking.

### 6.3. Vendor Tax Compliance (IRS Form 1099-NEC)

Property managers must report annual non-employee compensation ($2,000 or more beginning tax year 2026, or $600 historically) paid to unincorporated contractors and repair vendors. GarrisonOS aggregates all payments linked to vendor contacts across both standalone transactions and double-entry journal lines (excluding reversed entries), generating an annual summary flagging qualifying vendors for IRS Form 1099-NEC filing based on the maintained statutory threshold for the requested tax year.

### 6.4. Statutory Move-Out Deduction Timelines

State laws establish strict statutory windows within which an itemized statement of deductions and remaining deposit refund must be delivered to a vacated tenant. GarrisonOS maintains verified statutory rules for supported jurisdictions (including NY [14 days], AZ [14 days], FL [15 days], CA [21 days], WA [21 days], CO [30 days], TX [30 days], IL [30 days], MA [30 days], NJ [30 days], and PA [30 days]), computing real-time countdown alerts and flagging overdue dispositions. Generic fallback (`US`) defaults to 30 days while unsupported state codes are explicitly rejected.

---

## 7. Accounts Payable, Banking & Client Accounting Engine

### 7.1. Vendor Invoicing & Split Allocations
Vendor bills represent formal obligations to pay third-party service providers. Bills support split line allocations across multiple properties, units, and GL expense accounts. Approving a bill posts a balanced double-entry transaction debiting the specified expense accounts and crediting Accounts Payable (`#2010`).

### 7.2. Check Register & MICR Printing
Physical checks printed through GarrisonOS adhere to standard MICR layout guidelines (top voucher, middle voucher, bottom check). Voiding a printed check automatically reverses the cash disbursement, restores the unpaid balances on the associated bills, and posts an audit log entry.

### 7.3. Vendor Credit Memos
Supplier rebates, overpayment adjustments, and vendor concessions are tracked as vendor credit memos. Credits may be partially or fully applied against outstanding vendor bills, reducing the remaining cash disbursement liability.

### 7.4. Bank Deposit Batching
Customer and tenant payments initially accumulate in `1030 Undeposited Funds`. The Bank Deposit workflow bundles multiple receipts into a single bank statement batch, debiting `1010 Operating Checking` and crediting `1030 Undeposited Funds` to mirror physical bank deposits.

### 7.5. Client Accounting & Automated Management Fees
For third-party property management operators, GarrisonOS segregates property revenues by client portfolio. Capital contributions record owner equity infusions, while owner draws track periodic profit distributions. Management fee agreements automatically calculate operator earned revenue based on collected rent percentages or unit counts, posting monthly entries debiting client operating expenses (`#5070 Management Fees Expense`) and crediting Accounts Payable (`#2010 Accounts Payable`).
