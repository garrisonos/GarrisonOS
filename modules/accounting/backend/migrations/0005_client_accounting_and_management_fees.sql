-- Migration 0005: Client Accounting, Owner Equity, and Management Fees

CREATE TABLE IF NOT EXISTS client_capital_contributions (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    client_contact_id TEXT NOT NULL REFERENCES contacts(id),
    portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
    property_id TEXT REFERENCES properties(id),
    contribution_date INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    destination_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
    reference_number TEXT,
    memo TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_client_contrib_portfolio ON client_capital_contributions(operator_id, portfolio_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_client_contrib_client ON client_capital_contributions(operator_id, client_contact_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS client_distributions (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    client_contact_id TEXT NOT NULL REFERENCES contacts(id),
    portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
    property_id TEXT REFERENCES properties(id),
    distribution_date INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    source_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
    disbursement_method TEXT NOT NULL CHECK (disbursement_method IN ('check', 'ach', 'wire')),
    check_number TEXT,
    reference_number TEXT,
    memo TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_client_dist_portfolio ON client_distributions(operator_id, portfolio_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_client_dist_client ON client_distributions(operator_id, client_contact_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS management_fee_agreements (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    portfolio_id TEXT REFERENCES portfolios(id),
    property_id TEXT REFERENCES properties(id),
    calculation_method TEXT NOT NULL CHECK (calculation_method IN ('percentage_collected_revenue', 'flat_fee_per_unit', 'flat_monthly_fee')),
    percentage_bps INTEGER DEFAULT 0,
    flat_fee_cents INTEGER DEFAULT 0,
    fee_gl_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
    pass_through_expenses INTEGER NOT NULL DEFAULT 0 CHECK (pass_through_expenses IN (0, 1)),
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fee_agreements_operator ON management_fee_agreements(operator_id) WHERE deleted_at IS NULL;
