# GarrisonOS Canonical Domain Models & Database Schemas

This document serves as the canonical domain dictionary and entity schema reference for **GarrisonOS**. It details the relational database schemas, column specifications, foreign key relationships, constraints, and double-entry accounting invariants across all current modules, Foundational MVP deliverables, and post-MVP horizons.

All schemas strictly adhere to the engineering guardrails established in [`AGENTS.md`](../../AGENTS.md):
- **Primary Keys**: UUIDv7 strings (`TEXT PRIMARY KEY`) generated via RFC 9562 standard.
- **Operator Isolation**: Every operational table enforces row-level isolation via `operator_id TEXT NOT NULL REFERENCES operators(id)`.
- **Financial Rigor**: Stored strictly as **INTEGER cents** (e.g., \$1,250.00 = `125000`). Floating-point arithmetic is prohibited.
- **Timestamps**: UTC epoch milliseconds stored as **INTEGER**.
- **Soft Deletes**: Standardized `deleted_at INTEGER` column on all operational tables (`NULL` when active, epoch ms when deleted).
- **Cross-Dialect Portability**: 100% forward-compatible with PostgreSQL (ANSI SQL, standard constraint syntax, single-quote literals).

---

## 1. Core System, Security & Governance

### 1.1 Operators (`operators`)
System multi-tenancy boundary representing the managing property management entity.
```sql
CREATE TABLE IF NOT EXISTS operators (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subdomain TEXT UNIQUE,
    settings_json TEXT NOT NULL DEFAULT '{}',
    storage_quota_bytes INTEGER NOT NULL DEFAULT 10737418240, -- 10 GB default
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
```

### 1.2 Users & Authentication (`users`)
Operator staff, property managers, subusers, and administrative users.
```sql
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('system_owner', 'system_manager', 'owner', 'manager', 'leasing_agent', 'assistant', 'maintenance', 'auditor', 'viewer', 'read_only')),
    token_version INTEGER NOT NULL DEFAULT 1,
    is_system_user INTEGER NOT NULL DEFAULT 0 CHECK (is_system_user IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_operator_email ON users(operator_id, email) WHERE deleted_at IS NULL;
```

### 1.3 Scoped Subuser Whitelists (`user_portfolio_access`, `user_module_access`)
Junction tables enforcing dual-scoping security restrictions on operator subusers.
```sql
CREATE TABLE IF NOT EXISTS user_portfolio_access (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    portfolio_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_portfolio_access_unique ON user_portfolio_access(operator_id, user_id, portfolio_id);
CREATE INDEX IF NOT EXISTS idx_user_portfolio_access_lookup ON user_portfolio_access(operator_id, user_id);

CREATE TABLE IF NOT EXISTS user_module_access (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    module_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_module_access_unique ON user_module_access(operator_id, user_id, module_id);
CREATE INDEX IF NOT EXISTS idx_user_module_access_lookup ON user_module_access(operator_id, user_id);
```

### 1.4 Configurable Role-Based Access Control (`roles`, `role_permissions`)
Granular permission matrix supporting custom operator roles.
```sql
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    name TEXT NOT NULL,
    description TEXT,
    is_system_role INTEGER NOT NULL DEFAULT 0 CHECK (is_system_role IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_operator_name ON roles(operator_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS role_permissions (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    role_id TEXT NOT NULL REFERENCES roles(id),
    resource TEXT NOT NULL, -- e.g. 'accounting', 'leases', 'maintenance', 'properties', 'contacts'
    action TEXT NOT NULL,   -- e.g. 'view', 'create', 'edit', 'delete', 'approve_bill', 'print_check'
    created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_unique ON role_permissions(operator_id, role_id, resource, action);
```

### 1.5 Universal Document Attachments & Media (`attachments`)
Universal document storage metadata across all operational entities.
```sql
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    entity_type TEXT NOT NULL, -- 'lease', 'property', 'unit', 'contact', 'work_order', 'bill'
    entity_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    is_sanitized INTEGER NOT NULL DEFAULT 1 CHECK (is_sanitized IN (0, 1)),
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_attachments_operator_entity ON attachments(operator_id, entity_type, entity_id) WHERE deleted_at IS NULL;
```

### 1.6 Immutable Audit Logs (`audit_logs`)
Tamper-evident audit trail capturing all state-modifying actions.
```sql
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    user_id TEXT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL, -- 'create', 'update', 'delete', 'login', 'approve_bill', 'disbursement'
    changes_json TEXT,
    ip_address TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_operator_entity ON audit_logs(operator_id, entity_type, entity_id);
```

---

## 2. Properties, Units & Facilities

### 2.1 Portfolios (`portfolios`)
Organizational groupings of properties (often mapping to client/investor ownership).
```sql
CREATE TABLE IF NOT EXISTS portfolios (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    client_contact_id TEXT REFERENCES contacts(id), -- Primary client/investor link
    name TEXT NOT NULL,
    description TEXT,
    custom_fields TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_portfolios_operator ON portfolios(operator_id) WHERE deleted_at IS NULL;
```

### 2.2 Properties (`properties`)
Physical real estate parcels or sites (e.g. multi-family complexes, apartment communities, or single-family homes).
```sql
CREATE TABLE IF NOT EXISTS properties (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
    name TEXT NOT NULL,
    property_type TEXT NOT NULL CHECK (property_type IN ('single_family', 'multi_family', 'commercial')),
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'USA',
    year_built INTEGER,
    published_for_rent INTEGER NOT NULL DEFAULT 0 CHECK (published_for_rent IN (0, 1)),
    published_for_sale INTEGER NOT NULL DEFAULT 0 CHECK (published_for_sale IN (0, 1)),
    featured_for_rent INTEGER NOT NULL DEFAULT 0 CHECK (featured_for_rent IN (0, 1)),
    syndicate INTEGER NOT NULL DEFAULT 0 CHECK (syndicate IN (0, 1)),
    posting_title TEXT,
    specials TEXT,
    short_description TEXT,
    long_description TEXT,
    target_rent_cents INTEGER,
    target_deposit_cents INTEGER,
    other_monthly_charges_cents INTEGER,
    available_date INTEGER,
    pets_allowed INTEGER NOT NULL DEFAULT 0 CHECK (pets_allowed IN (0, 1)),
    pet_deposit_cents INTEGER DEFAULT 0,
    pet_fee_cents INTEGER DEFAULT 0,
    pet_rent_cents INTEGER DEFAULT 0,
    pet_dog_allowed INTEGER NOT NULL DEFAULT 0 CHECK (pet_dog_allowed IN (0, 1)),
    pet_cat_allowed INTEGER NOT NULL DEFAULT 0 CHECK (pet_cat_allowed IN (0, 1)),
    pet_other_allowed INTEGER NOT NULL DEFAULT 0 CHECK (pet_other_allowed IN (0, 1)),
    smoking_allowed INTEGER NOT NULL DEFAULT 0 CHECK (smoking_allowed IN (0, 1)),
    pet_weight_limit_lbs INTEGER,
    featured_image_url TEXT,
    custom_fields TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_properties_operator_portfolio ON properties(operator_id, portfolio_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_properties_operator_published ON properties(operator_id, published_for_rent) WHERE deleted_at IS NULL;
```

### 2.3 Buildings (`buildings`)
Structural edifices or distinct wings located within a property parcel.
```sql
CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    property_id TEXT NOT NULL REFERENCES properties(id),
    name TEXT NOT NULL,
    building_number TEXT,
    floors INTEGER DEFAULT 1,
    notes TEXT,
    published_for_rent INTEGER NOT NULL DEFAULT 0 CHECK (published_for_rent IN (0, 1)),
    published_for_sale INTEGER NOT NULL DEFAULT 0 CHECK (published_for_sale IN (0, 1)),
    featured_for_rent INTEGER NOT NULL DEFAULT 0 CHECK (featured_for_rent IN (0, 1)),
    syndicate INTEGER NOT NULL DEFAULT 0 CHECK (syndicate IN (0, 1)),
    posting_title TEXT,
    specials TEXT,
    short_description TEXT,
    long_description TEXT,
    available_date INTEGER,
    target_rent_cents INTEGER,
    target_deposit_cents INTEGER,
    other_monthly_charges_cents INTEGER,
    pets_allowed INTEGER NOT NULL DEFAULT 0 CHECK (pets_allowed IN (0, 1)),
    pet_dog_allowed INTEGER NOT NULL DEFAULT 0 CHECK (pet_dog_allowed IN (0, 1)),
    pet_cat_allowed INTEGER NOT NULL DEFAULT 0 CHECK (pet_cat_allowed IN (0, 1)),
    pet_other_allowed INTEGER NOT NULL DEFAULT 0 CHECK (pet_other_allowed IN (0, 1)),
    smoking_allowed INTEGER NOT NULL DEFAULT 0 CHECK (smoking_allowed IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_buildings_operator_property ON buildings(operator_id, property_id) WHERE deleted_at IS NULL;
```

### 2.4 Units (`units`)
Rentable physical premises within a property or building.
```sql
CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    property_id TEXT NOT NULL REFERENCES properties(id),
    building_id TEXT REFERENCES buildings(id),
    unit_number TEXT NOT NULL,
    bedrooms REAL NOT NULL DEFAULT 1.0,
    bathrooms REAL NOT NULL DEFAULT 1.0,
    square_feet INTEGER,
    market_rent_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant', 'occupied', 'turnover', 'maintenance_hold')),
    published_for_rent INTEGER NOT NULL DEFAULT 0 CHECK (published_for_rent IN (0, 1)),
    published_for_sale INTEGER NOT NULL DEFAULT 0 CHECK (published_for_sale IN (0, 1)),
    featured_for_rent INTEGER NOT NULL DEFAULT 0 CHECK (featured_for_rent IN (0, 1)),
    syndicate INTEGER NOT NULL DEFAULT 0 CHECK (syndicate IN (0, 1)),
    posting_title TEXT,
    specials TEXT,
    short_description TEXT,
    long_description TEXT,
    target_rent_cents INTEGER,
    target_deposit_cents INTEGER,
    other_monthly_charges_cents INTEGER,
    available_date INTEGER,
    pets_allowed INTEGER NOT NULL DEFAULT 0 CHECK (pets_allowed IN (0, 1)),
    pet_dog_allowed INTEGER NOT NULL DEFAULT 0 CHECK (pet_dog_allowed IN (0, 1)),
    pet_cat_allowed INTEGER NOT NULL DEFAULT 0 CHECK (pet_cat_allowed IN (0, 1)),
    pet_other_allowed INTEGER NOT NULL DEFAULT 0 CHECK (pet_other_allowed IN (0, 1)),
    smoking_allowed INTEGER NOT NULL DEFAULT 0 CHECK (smoking_allowed IN (0, 1)),
    pet_deposit_cents INTEGER DEFAULT 0,
    pet_rent_cents INTEGER DEFAULT 0,
    featured_image_url TEXT,
    custom_fields TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_units_operator_property ON units(operator_id, property_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_units_operator_building ON units(operator_id, building_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_units_operator_status ON units(operator_id, status) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_property_number ON units(property_id, unit_number) WHERE deleted_at IS NULL;
```

### 2.5 Amenities Dictionary & Junctions (`amenities`, `property_amenities`, `unit_amenities`)
Standardized catalog of property and unit amenities supporting syndication filters and listing presentation.
```sql
CREATE TABLE IF NOT EXISTS amenities (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('community', 'unit', 'accessibility', 'pet', 'eco')),
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_amenities_operator_name ON amenities(operator_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS property_amenities (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    property_id TEXT NOT NULL REFERENCES properties(id),
    amenity_id TEXT NOT NULL REFERENCES amenities(id),
    created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_amenities_unique ON property_amenities(operator_id, property_id, amenity_id);
CREATE INDEX IF NOT EXISTS idx_property_amenities_property ON property_amenities(operator_id, property_id);

CREATE TABLE IF NOT EXISTS unit_amenities (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    unit_id TEXT NOT NULL REFERENCES units(id),
    amenity_id TEXT NOT NULL REFERENCES amenities(id),
    created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_amenities_unique ON unit_amenities(operator_id, unit_id, amenity_id);
CREATE INDEX IF NOT EXISTS idx_unit_amenities_unit ON unit_amenities(operator_id, unit_id);
```

---

## 3. Directory & Vendor Compliance (`contacts`)

Directory of tenants, clients (owners), vendors, and contractors.
```sql
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    contact_type TEXT NOT NULL CHECK (contact_type IN ('tenant', 'owner', 'client', 'vendor', 'guarantor', 'emergency', 'prospect')),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    company_name TEXT,
    email TEXT,
    phone TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    tax_id_last4 TEXT,
    tax_id_encrypted TEXT,
    tax_payer_name TEXT,
    tax_classification TEXT CHECK (tax_classification IN ('individual', 'llc', 'corporation', 'partnership', 'llc_single', 'llc_partnership', 'llc_corporation', 'other')),
    trade_specialization TEXT CHECK (trade_specialization IN ('Plumbing', 'Electrical', 'HVAC', 'General Contracting', 'Appliance Repair', 'Roofing', 'Landscaping', 'Painting', 'Pest Control', 'Cleaning', 'Locksmith', 'Legal / Professional', 'Other')),
    vendor_specialty TEXT, -- backward-compatible alias for trade_specialization
    w9_received INTEGER NOT NULL DEFAULT 0 CHECK (w9_received IN (0, 1)),
    vendor_insured INTEGER NOT NULL DEFAULT 0 CHECK (vendor_insured IN (0, 1)),
    insurance_expiration_date INTEGER,
    default_gl_account_id TEXT REFERENCES chart_of_accounts(id),
    default_bill_split_account_id TEXT REFERENCES chart_of_accounts(id),
    markup_account_id TEXT REFERENCES chart_of_accounts(id),
    markup_percentage_bps INTEGER DEFAULT 0,
    payment_term_days INTEGER DEFAULT 30,
    name_on_check TEXT,
    custom_fields TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_contacts_operator_type ON contacts(operator_id, contact_type) WHERE deleted_at IS NULL;
```

---

## 4. Leasing & Receivables (AR)

### 4.1 Leases (`leases`, `lease_contacts`)
Contractual agreements between operator and tenants for unit possession.
```sql
CREATE TABLE IF NOT EXISTS leases (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    unit_id TEXT NOT NULL REFERENCES units(id),
    start_date INTEGER NOT NULL,
    end_date INTEGER NOT NULL,
    monthly_rent_cents INTEGER NOT NULL CHECK (monthly_rent_cents > 0),
    security_deposit_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'terminated', 'renewed', 'expired')),
    payment_due_day INTEGER NOT NULL DEFAULT 1 CHECK (payment_due_day BETWEEN 1 AND 31),
    notice_given_date INTEGER,
    move_out_date INTEGER,
    deposit_disposition_deadline INTEGER,
    custom_fields TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_leases_operator_unit ON leases(operator_id, unit_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS lease_contacts (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    lease_id TEXT NOT NULL REFERENCES leases(id),
    contact_id TEXT NOT NULL REFERENCES contacts(id),
    role TEXT NOT NULL CHECK (role IN ('primary_tenant', 'co_tenant', 'guarantor', 'occupant')),
    is_signatory INTEGER NOT NULL DEFAULT 1 CHECK (is_signatory IN (0, 1)),
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lease_contacts_unique ON lease_contacts(operator_id, lease_id, contact_id) WHERE deleted_at IS NULL;
```

### 4.2 Recurring Lease Charges (`recurring_lease_charges`)
Itemized recurring charges added to monthly billing runs (pet rent, parking, utilities).
```sql
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
```

### 4.3 Late Fee Policies (`late_fee_policies`)
Jurisdiction-compliant rules governing late payment fees.
```sql
CREATE TABLE IF NOT EXISTS late_fee_policies (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    portfolio_id TEXT REFERENCES portfolios(id),
    property_id TEXT REFERENCES properties(id),
    grace_period_days INTEGER NOT NULL DEFAULT 5,
    due_day INTEGER NOT NULL DEFAULT 1,
    calculation_type TEXT NOT NULL CHECK (calculation_type IN ('flat_fee', 'percentage_of_delinquency', 'daily_accrual')),
    flat_fee_cents INTEGER DEFAULT 0,
    percentage_bps INTEGER DEFAULT 0, -- basis points (e.g. 500 = 5%)
    delinquency_threshold_cents INTEGER NOT NULL DEFAULT 5000, -- minimum balance to trigger ($50)
    statutory_cap_cents INTEGER, -- statutory maximum fee limit
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_late_fee_operator ON late_fee_policies(operator_id) WHERE deleted_at IS NULL;
```

### 4.4 Credits, Concessions & Adjustments (`lease_credits_and_concessions`)
```sql
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
```

### 4.5 Security Deposit Refunds (`security_deposit_refunds`)
Statutory move-out accounting and deposit refund issuance.
```sql
CREATE TABLE IF NOT EXISTS security_deposit_refunds (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    lease_id TEXT NOT NULL REFERENCES leases(id),
    recipient_contact_id TEXT NOT NULL REFERENCES contacts(id),
    refund_type TEXT NOT NULL CHECK (refund_type IN ('deposit_disposition', 'overpayment_return')),
    refund_amount_cents INTEGER NOT NULL CHECK (refund_amount_cents > 0),
    funding_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id), -- '1020 Trust Checking'
    disbursement_method TEXT NOT NULL CHECK (disbursement_method IN ('check', 'ach')),
    check_number TEXT,
    disbursement_date INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deposit_refunds_lease ON security_deposit_refunds(operator_id, lease_id) WHERE deleted_at IS NULL;
```

### 4.6 Lease Clauses & Standard Legal Addenda (`lease_clauses`)
Custom contractual terms, covenants, and legal addenda associated with specific leases.
```sql
CREATE TABLE IF NOT EXISTS lease_clauses (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    lease_id TEXT NOT NULL REFERENCES leases(id),
    clause_title TEXT NOT NULL,
    clause_text TEXT NOT NULL,
    is_mandatory INTEGER NOT NULL DEFAULT 0 CHECK (is_mandatory IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lease_clauses_lease ON lease_clauses(operator_id, lease_id) WHERE deleted_at IS NULL;
```

### 4.7 Commercial CAM & Expense Recovery Charges (`expense_recovery_charges`)
Pro-rata common area maintenance (CAM), insurance, and property tax pass-through recoveries.
```sql
CREATE TABLE IF NOT EXISTS expense_recovery_charges (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    lease_id TEXT NOT NULL REFERENCES leases(id),
    recovery_type TEXT NOT NULL CHECK (recovery_type IN ('cam', 'property_tax', 'insurance', 'utility')),
    calculation_basis TEXT NOT NULL CHECK (calculation_basis IN ('pro_rata_sqft', 'fixed_percentage', 'actual_expense')),
    share_percentage_bps INTEGER NOT NULL CHECK (share_percentage_bps BETWEEN 0 AND 10000), -- basis points (e.g. 1500 = 15.00%)
    estimated_monthly_cents INTEGER NOT NULL DEFAULT 0 CHECK (estimated_monthly_cents >= 0),
    reconciliation_frequency TEXT NOT NULL DEFAULT 'annually' CHECK (reconciliation_frequency IN ('monthly', 'quarterly', 'annually')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_expense_recovery_lease ON expense_recovery_charges(operator_id, lease_id) WHERE deleted_at IS NULL;
```

---

## 5. General Ledger, Accounts Payable (AP) & Banking

### 5.1 Chart of Accounts & General Ledger
```sql
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    account_number TEXT NOT NULL,
    name TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    sub_type TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    irs_schedule_e_line TEXT,
    quickbooks_account_name TEXT,
    quickbooks_account_type TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coa_operator_number ON chart_of_accounts(operator_id, account_number) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    entry_number INTEGER NOT NULL,
    entry_date INTEGER NOT NULL,
    memo TEXT,
    source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'billing_run', 'payment', 'maintenance_expense', 'deposit_held', 'deposit_disposition', 'bill', 'bill_disbursement', 'client_draw', 'client_contribution', 'management_fee')),
    source_id TEXT,
    reversed_by_entry_id TEXT,
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_operator_date ON journal_entries(operator_id, entry_date);

CREATE TABLE IF NOT EXISTS journal_lines (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
    account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
    entry_type TEXT NOT NULL CHECK (entry_type IN ('debit', 'credit')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    portfolio_id TEXT REFERENCES portfolios(id),
    property_id TEXT REFERENCES properties(id),
    unit_id TEXT REFERENCES units(id),
    memo TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(operator_id, account_id);
```

### 5.2 Accounts Payable: Bills & Allocations (`bills`, `bill_allocations`)
```sql
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

CREATE TABLE IF NOT EXISTS bill_allocations (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    bill_id TEXT NOT NULL REFERENCES bills(id),
    portfolio_id TEXT REFERENCES portfolios(id),
    property_id TEXT REFERENCES properties(id),
    unit_id TEXT REFERENCES units(id),
    gl_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    amount_settled_cents INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bill_allocations_bill ON bill_allocations(operator_id, bill_id) WHERE deleted_at IS NULL;
```

### 5.3 Bill Disbursements & Vendor Check Printing (`bill_disbursements`)
```sql
CREATE TABLE IF NOT EXISTS bill_disbursements (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    vendor_id TEXT NOT NULL REFERENCES contacts(id),
    disbursement_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id), -- '1010 Operating Checking'
    disbursement_date INTEGER NOT NULL,
    disbursement_method TEXT NOT NULL CHECK (disbursement_method IN ('check', 'ach', 'credit_card', 'wire')),
    check_number TEXT,
    payee_name TEXT NOT NULL,
    memo TEXT,
    total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),
    check_printed INTEGER NOT NULL DEFAULT 0 CHECK (check_printed IN (0, 1)),
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_disbursements_operator ON bill_disbursements(operator_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS bill_disbursement_lines (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    disbursement_id TEXT NOT NULL REFERENCES bill_disbursements(id),
    bill_id TEXT NOT NULL REFERENCES bills(id),
    allocated_amount_cents INTEGER NOT NULL CHECK (allocated_amount_cents > 0)
);
CREATE INDEX IF NOT EXISTS idx_disbursement_lines_bill ON bill_disbursement_lines(operator_id, bill_id);
```

### 5.4 Recurring Scheduled Bills (`recurring_bills`)
```sql
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
```

### 5.5 Bank Deposits & Clearing (`bank_deposits`)
```sql
CREATE TABLE IF NOT EXISTS bank_deposits (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    bank_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id), -- '1010 Operating' or '1020 Trust'
    deposit_date INTEGER NOT NULL,
    total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),
    deposit_reference TEXT,
    memo TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bank_deposits_operator ON bank_deposits(operator_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS bank_deposit_lines (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    bank_deposit_id TEXT NOT NULL REFERENCES bank_deposits(id),
    source_transaction_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0)
);
CREATE INDEX IF NOT EXISTS idx_deposit_lines_parent ON bank_deposit_lines(operator_id, bank_deposit_id);
```

### 5.6 Vendor Check Register & Check Printing (`vendor_checks`, `vendor_check_allocations`)
Disbursement check register tracking printed paper checks, MICR numbering, void reissues, and bill settlements.
```sql
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
```

### 5.7 Vendor Credits & Credit Applications (`vendor_credits`, `vendor_credit_allocations`)
AP credit memos and refunds issued by suppliers/vendors and applied against open bills.
```sql
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
```

---

## 6. Client Portfolio Accounting & Management Fees

### 6.1 Client Capital Contributions (`client_capital_contributions`)
```sql
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
```

### 6.2 Client Distributions / Draws (`client_distributions`)
```sql
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
```

### 6.3 Management Fee Agreements (`management_fee_agreements`)
```sql
CREATE TABLE IF NOT EXISTS management_fee_agreements (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    portfolio_id TEXT REFERENCES portfolios(id),
    property_id TEXT REFERENCES properties(id),
    calculation_method TEXT NOT NULL CHECK (calculation_method IN ('percentage_collected_revenue', 'flat_fee_per_unit', 'flat_monthly_fee')),
    percentage_bps INTEGER DEFAULT 0, -- basis points (e.g. 800 = 8.00%)
    flat_fee_cents INTEGER DEFAULT 0,
    fee_gl_account_id TEXT NOT NULL REFERENCES chart_of_accounts(id), -- '4010 Management Fees'
    pass_through_expenses INTEGER NOT NULL DEFAULT 0 CHECK (pass_through_expenses IN (0, 1)),
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fee_agreements_operator ON management_fee_agreements(operator_id) WHERE deleted_at IS NULL;
```

---

## 7. Maintenance & Work Orders

### 7.1 Work Orders (`work_orders`)
```sql
CREATE TABLE IF NOT EXISTS work_orders (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    unit_id TEXT NOT NULL REFERENCES units(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'emergency')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'completed', 'cancelled')),
    category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'make_ready', 'other')),
    assigned_vendor_id TEXT REFERENCES contacts(id),
    completion_notes TEXT,
    actual_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (actual_cost_cents >= 0),
    created_by_contact_id TEXT REFERENCES contacts(id), -- tenant submission link
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_work_orders_operator_unit ON work_orders(operator_id, unit_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned_vendor ON work_orders(operator_id, assigned_vendor_id) WHERE deleted_at IS NULL;
```

### 7.2 Work Order Subtasks (`work_order_tasks`) *(Sprint 6: Field Operations)*
```sql
CREATE TABLE IF NOT EXISTS work_order_tasks (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    work_order_id TEXT NOT NULL REFERENCES work_orders(id),
    task_name TEXT NOT NULL,
    assigned_user_id TEXT REFERENCES users(id),
    due_date INTEGER,
    is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wo_tasks_parent ON work_order_tasks(operator_id, work_order_id) WHERE deleted_at IS NULL;
```

### 7.3 Technician Timecards (`technician_timecards`) *(Sprint 6: Field Operations)*
```sql
CREATE TABLE IF NOT EXISTS technician_timecards (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    work_order_id TEXT NOT NULL REFERENCES work_orders(id),
    vendor_id TEXT NOT NULL REFERENCES contacts(id),
    work_date INTEGER NOT NULL,
    hours_logged REAL NOT NULL CHECK (hours_logged > 0),
    hourly_rate_cents INTEGER NOT NULL,
    bill_id TEXT REFERENCES bills(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_timecards_wo ON technician_timecards(operator_id, work_order_id) WHERE deleted_at IS NULL;
```

---

## 8. Communications & Dynamic Custom Fields

### 8.1 Universal Conversations & Threaded Notes (`conversations`, `conversation_messages`)
Polymorphic collaboration stream attached to operational entities.
```sql
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('lease', 'property', 'building', 'unit', 'contact', 'work_order', 'bill', 'portfolio')),
    entity_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1)),
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conversations_entity ON conversations(operator_id, entity_type, entity_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    author_user_id TEXT REFERENCES users(id),
    author_contact_id TEXT REFERENCES contacts(id),
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(operator_id, conversation_id) WHERE deleted_at IS NULL;
```

### 8.2 Dynamic Custom Fields Engine (`custom_field_definitions`)
Schema-agnostic field definitions validating parent `custom_fields` JSON objects.
```sql
CREATE TABLE IF NOT EXISTS custom_field_definitions (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('portfolio', 'property', 'building', 'unit', 'lease', 'contact', 'work_order', 'bill')),
    field_name TEXT NOT NULL,
    field_label TEXT NOT NULL,
    data_type TEXT NOT NULL CHECK (data_type IN ('string', 'number', 'boolean', 'date', 'currency', 'select')),
    is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
    default_value TEXT,
    options_json TEXT, -- array of options for 'select' type
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_fields_unique ON custom_field_definitions(operator_id, entity_type, field_name) WHERE deleted_at IS NULL;
```

---

## 9. Post-MVP Future Horizons Entity Blueprints

### 9.1 Property Condition Inspections
```sql
CREATE TABLE IF NOT EXISTS inspections (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    property_id TEXT NOT NULL REFERENCES properties(id),
    unit_id TEXT REFERENCES units(id),
    lease_id TEXT REFERENCES leases(id),
    inspector_id TEXT REFERENCES users(id),
    inspection_type TEXT NOT NULL CHECK (inspection_type IN ('move_in', 'move_out', 'annual', 'turnover', 'emergency')),
    scheduled_date INTEGER NOT NULL,
    completed_date INTEGER,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    general_notes TEXT,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS inspection_zones (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    inspection_id TEXT NOT NULL REFERENCES inspections(id),
    zone_name TEXT NOT NULL, -- e.g. 'Kitchen', 'Master Bedroom', 'Exterior'
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inspection_elements (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    zone_id TEXT NOT NULL REFERENCES inspection_zones(id),
    element_name TEXT NOT NULL, -- e.g. 'Oven', 'Flooring', 'Smoke Detector'
    condition_rating TEXT NOT NULL CHECK (condition_rating IN ('clean', 'good', 'fair', 'poor', 'damaged')),
    action_required TEXT CHECK (action_required IN ('none', 'repair', 'clean', 'replace')),
    estimated_cost_cents INTEGER DEFAULT 0,
    comments TEXT,
    attachment_id TEXT REFERENCES attachments(id),
    created_at INTEGER NOT NULL
);
```

### 9.2 Prospects & Lead-to-Lease Pipeline
```sql
CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    name TEXT NOT NULL,
    source_channel TEXT NOT NULL CHECK (source_channel IN ('listing_syndication', 'yard_sign', 'referral', 'website', 'social')),
    call_tracking_phone TEXT,
    start_date INTEGER NOT NULL,
    end_date INTEGER,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS prospects (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    contact_id TEXT NOT NULL REFERENCES contacts(id),
    campaign_id TEXT REFERENCES marketing_campaigns(id),
    desired_move_in_date INTEGER,
    desired_bedrooms REAL,
    desired_bathrooms REAL,
    budget_min_cents INTEGER,
    budget_max_cents INTEGER,
    has_pets INTEGER NOT NULL DEFAULT 0 CHECK (has_pets IN (0, 1)),
    pet_details TEXT,
    assigned_agent_id TEXT REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'inquiry' CHECK (status IN ('inquiry', 'showing_scheduled', 'showing_completed', 'application_submitted', 'approved', 'converted_to_lease', 'archived')),
    converted_lease_id TEXT REFERENCES leases(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_prospects_operator_status ON prospects(operator_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_campaign ON prospects(operator_id, campaign_id) WHERE deleted_at IS NULL;
```

### 9.3 Scheduled Tenant Auto-Payments (`scheduled_tenant_payments`)
Scheduled recurring tenant ACH/card payments executed against recurring charges and ledger balances.
```sql
CREATE TABLE IF NOT EXISTS scheduled_tenant_payments (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    lease_id TEXT NOT NULL REFERENCES leases(id),
    contact_id TEXT NOT NULL REFERENCES contacts(id),
    payment_channel TEXT NOT NULL DEFAULT 'ach' CHECK (payment_channel IN ('ach', 'credit_card', 'debit_card')),
    payment_method_token TEXT NOT NULL,
    day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
    payment_rule TEXT NOT NULL DEFAULT 'full_balance' CHECK (payment_rule IN ('full_balance', 'fixed_amount', 'max_cap')),
    fixed_amount_cents INTEGER CHECK (fixed_amount_cents IS NULL OR fixed_amount_cents > 0),
    max_cap_cents INTEGER CHECK (max_cap_cents IS NULL OR max_cap_cents > 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    last_executed_at INTEGER,
    next_run_date INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    CHECK (payment_rule <> 'fixed_amount' OR fixed_amount_cents IS NOT NULL),
    CHECK (payment_rule <> 'max_cap' OR max_cap_cents IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_scheduled_payments_lease ON scheduled_tenant_payments(operator_id, lease_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_payments_next ON scheduled_tenant_payments(operator_id, next_run_date) WHERE deleted_at IS NULL;
```
