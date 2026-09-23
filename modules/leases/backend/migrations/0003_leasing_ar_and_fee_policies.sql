-- Migration 0003: Leasing Accounts Receivable, Fee Policies, Concessions & Security Deposit Refunds

CREATE TABLE IF NOT EXISTS recurring_lease_charges (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    lease_id TEXT NOT NULL REFERENCES leases(id),
    charge_category TEXT NOT NULL CHECK (charge_category IN ('base_rent', 'pet_rent', 'parking_fee', 'storage_fee', 'utility_surcharge', 'amenity_fee')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    gl_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
    billing_frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_frequency IN ('monthly', 'quarterly', 'annually', 'one_time')),
    billing_day INTEGER NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 31),
    description TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_recurring_charges_lease ON recurring_lease_charges(operator_id, lease_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS late_fee_policies (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    portfolio_id TEXT REFERENCES portfolios(id),
    property_id TEXT REFERENCES properties(id),
    grace_period_days INTEGER NOT NULL DEFAULT 5,
    due_day INTEGER NOT NULL DEFAULT 1,
    calculation_type TEXT NOT NULL CHECK (calculation_type IN ('flat_fee', 'percentage_of_delinquency', 'daily_accrual')),
    flat_fee_cents INTEGER DEFAULT 0,
    percentage_bps INTEGER DEFAULT 0,
    delinquency_threshold_cents INTEGER NOT NULL DEFAULT 5000,
    statutory_cap_cents INTEGER,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_late_fee_operator ON late_fee_policies(operator_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS lease_credits_and_concessions (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    lease_id TEXT NOT NULL REFERENCES leases(id),
    credit_type TEXT NOT NULL CHECK (credit_type IN ('promotional_concession', 'maintenance_inconvenience', 'discretionary_credit', 'bad_debt_writeoff')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    gl_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
    reason TEXT NOT NULL,
    effective_date INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lease_credits_lease ON lease_credits_and_concessions(operator_id, lease_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS security_deposit_refunds (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    lease_id TEXT NOT NULL REFERENCES leases(id),
    recipient_contact_id TEXT NOT NULL REFERENCES contacts(id),
    refund_type TEXT NOT NULL CHECK (refund_type IN ('deposit_disposition', 'overpayment_return')),
    refund_amount_cents INTEGER NOT NULL CHECK (refund_amount_cents > 0),
    funding_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
    disbursement_method TEXT NOT NULL CHECK (disbursement_method IN ('check', 'ach')),
    check_number TEXT,
    disbursement_date INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deposit_refunds_lease ON security_deposit_refunds(operator_id, lease_id) WHERE deleted_at IS NULL;
