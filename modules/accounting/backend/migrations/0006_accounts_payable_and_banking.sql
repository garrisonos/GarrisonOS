-- Migration 0006: Accounts Payable (AP), Vendor Credits, Vendor Checks, and Bank Deposits

-- 1. Bills & Expense Allocations
CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    vendor_id TEXT NOT NULL REFERENCES contacts(id),
    invoice_number TEXT NOT NULL,
    invoice_date INTEGER NOT NULL,
    due_date INTEGER NOT NULL,
    payment_terms TEXT NOT NULL DEFAULT 'net_30' CHECK (payment_terms IN ('due_on_receipt', 'net_15', 'net_30', 'net_60')),
    reference_number TEXT,
    subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents > 0),
    tax_cents INTEGER NOT NULL DEFAULT 0,
    total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),
    amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0 AND amount_paid_cents <= total_amount_cents),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'partially_paid', 'paid', 'voided')),
    approved_by TEXT REFERENCES users(id),
    approved_at INTEGER,
    work_order_id TEXT REFERENCES work_orders(id),
    cost_plus_markup_bps INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bills_operator_vendor ON bills(operator_id, vendor_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bills_operator_status ON bills(operator_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bills_operator_due ON bills(operator_id, due_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS bill_allocations (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    bill_id TEXT NOT NULL REFERENCES bills(id),
    portfolio_id TEXT REFERENCES portfolios(id),
    property_id TEXT REFERENCES properties(id),
    unit_id TEXT REFERENCES units(id),
    gl_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    amount_settled_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_settled_cents >= 0 AND amount_settled_cents <= amount_cents),
    description TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bill_allocations_bill ON bill_allocations(operator_id, bill_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bill_allocations_property ON bill_allocations(operator_id, property_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bill_allocations_account ON bill_allocations(operator_id, gl_account_id) WHERE deleted_at IS NULL;

-- 2. Recurring Scheduled Bills
CREATE TABLE IF NOT EXISTS recurring_bills (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    vendor_id TEXT NOT NULL REFERENCES contacts(id),
    template_reference TEXT,
    start_date INTEGER NOT NULL,
    end_date INTEGER,
    interval_count INTEGER NOT NULL DEFAULT 1,
    interval_unit TEXT NOT NULL CHECK (interval_unit IN ('week', 'month', 'quarter', 'year')),
    total_occurrences INTEGER,
    remaining_occurrences INTEGER,
    next_run_date INTEGER NOT NULL,
    default_disbursement_account_id TEXT REFERENCES chart_of_accounts(id),
    auto_disburse INTEGER NOT NULL DEFAULT 0 CHECK (auto_disburse IN (0, 1)),
    allocations_template_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_recurring_bills_next ON recurring_bills(operator_id, next_run_date) WHERE deleted_at IS NULL;

-- 3. Vendor Credit Memos & Bill Offsets
CREATE TABLE IF NOT EXISTS vendor_credits (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    vendor_id TEXT NOT NULL REFERENCES contacts(id),
    credit_number TEXT NOT NULL,
    credit_date INTEGER NOT NULL,
    total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),
    remaining_amount_cents INTEGER NOT NULL CHECK (remaining_amount_cents >= 0 AND remaining_amount_cents <= total_amount_cents),
    gl_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
    reason TEXT,
    reference_number TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partially_applied', 'fully_applied', 'voided')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_vendor_credits_vendor ON vendor_credits(operator_id, vendor_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_credits_status ON vendor_credits(operator_id, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS vendor_credit_allocations (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    credit_id TEXT NOT NULL REFERENCES vendor_credits(id),
    bill_id TEXT NOT NULL REFERENCES bills(id),
    applied_amount_cents INTEGER NOT NULL CHECK (applied_amount_cents > 0),
    applied_date INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_alloc_credit ON vendor_credit_allocations(operator_id, credit_id);
CREATE INDEX IF NOT EXISTS idx_credit_alloc_bill ON vendor_credit_allocations(operator_id, bill_id);

-- 4. Vendor Check Register & Check Printing
CREATE TABLE IF NOT EXISTS vendor_checks (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    bank_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
    vendor_id TEXT NOT NULL REFERENCES contacts(id),
    check_number TEXT NOT NULL,
    check_date INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    payee_name TEXT NOT NULL,
    memo TEXT,
    status TEXT NOT NULL DEFAULT 'printed' CHECK (status IN ('draft', 'printed', 'cleared', 'voided', 'reissued')),
    voided_at INTEGER,
    void_reason TEXT,
    cleared_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_checks_number ON vendor_checks(operator_id, bank_account_id, check_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_checks_vendor ON vendor_checks(operator_id, vendor_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_checks_status ON vendor_checks(operator_id, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS vendor_check_allocations (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    check_id TEXT NOT NULL REFERENCES vendor_checks(id),
    bill_id TEXT NOT NULL REFERENCES bills(id),
    allocated_amount_cents INTEGER NOT NULL CHECK (allocated_amount_cents > 0),
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_check_alloc_check ON vendor_check_allocations(operator_id, check_id);
CREATE INDEX IF NOT EXISTS idx_check_alloc_bill ON vendor_check_allocations(operator_id, bill_id);

-- 5. Bank Deposits & Batched Clearing
CREATE TABLE IF NOT EXISTS bank_deposits (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    bank_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
    deposit_date INTEGER NOT NULL,
    total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),
    deposit_reference TEXT,
    memo TEXT,
    status TEXT NOT NULL DEFAULT 'cleared' CHECK (status IN ('cleared', 'voided')),
    voided_at INTEGER,
    void_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bank_deposits_operator ON bank_deposits(operator_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bank_deposits_account ON bank_deposits(operator_id, bank_account_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS bank_deposit_lines (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    bank_deposit_id TEXT NOT NULL REFERENCES bank_deposits(id),
    source_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deposit_lines_parent ON bank_deposit_lines(operator_id, bank_deposit_id);
