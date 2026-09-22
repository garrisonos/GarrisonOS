# GarrisonOS: Architecture Specification & Bootstrap Blueprint

GarrisonOS is a zero-dependency, open-source property management platform engineered for independent property managers, self-managing landlords, and small real estate operators managing portfolios of up to 50 units (single-family residences, small multifamily properties, and scattered sites).

This document serves as the canonical architectural blueprint, engineering standard, domain specification, and step-by-step execution roadmap for bootstrapping the repository and delivering the MVP.

---

## 1. Non-Negotiable Engineering Guardrails

1. **Zero External Runtime Dependencies:**
   - **Backend Engine:** Relies exclusively on the Node.js standard library (`node:http`, `node:sqlite`, `node:crypto`, `node:async_hooks`, `node:events`, `node:fs`, `node:path`, `node:test`, `node:assert`). No npm runtime packages (no Express, Fastify, Drizzle, Prisma, TypeORM, Zod, or external UUID libraries). Only compile-time `@types/node` and `typescript` are permitted as development dependencies.
   - **Frontend Presentation:** Relies exclusively on native TypeScript SSR with Node.js standard modules (`node:http`, `node:crypto`, `node:fs`, `node:path`), automatic XSS-safe tagged template HTML (`html` in `web/lib/html.ts`), and semantic HTML5 with vanilla CSS Custom Properties. No external runtime npm packages, bundlers, or client-side JavaScript frameworks.

2. **Code Attribution & Quality:**
   - Write clean, concise, idiomatic, professional human-grade code.
   - Forbid generic placeholder comments (e.g., `// TODO: Implement your logic here`).
   - Commit messages must follow standard conventional commit syntax (e.g., `feat(core): add request context store`).

3. **Strict Multi-Operator Isolation & Row-Level Protection:**
   - Every operational database table MUST include an `operator_id TEXT NOT NULL` column.
   - Distinguishes software system multi-tenancy (**Operator**) from real-estate rental occupants (**Tenants**), reserving **Organization** for commercial property portfolios.
   - Operator context must be resolved via `AsyncLocalStorage` from the `X-Operator-ID` header, token opid claim, or operator host/path routing.
   - Business services and repositories must NEVER accept `operator_id` from request bodies or URL parameters; it must always be pulled implicitly from the request execution context.
   - All database queries must enforce operator isolation in `WHERE` clauses, supported by compound indexes `(operator_id, ...)`.

4. **Identity & Data Representation Standards:**
   - **Primary Keys:** RFC 9562 **UUIDv7** (time-sortable, 48-bit UNIX timestamp + sub-millisecond precision + random bits) generated natively via `node:crypto.randomBytes()`.
   - **Currency & Financials:** Stored strictly as **INTEGER cents** (e.g., \$1,500.00 = `150000`). Floating-point arithmetic for currency is strictly prohibited.
   - **Timestamps:** Stored strictly as **INTEGER milliseconds** (UTC epoch ms via `Date.now()`).
   - **Soft Deletes:** Standardized `deleted_at INTEGER` column across all operational entity tables (NULL if active, timestamp ms if deleted).

5. **Standard Dialect-Agnostic SQL & Atomic Transactions:**
   - Write standard ANSI SQL queries that remain portable and engine-agnostic.
   - Database operations use parameterized queries exclusively to guarantee protection against SQL injection.
   - Multi-step operations (e.g., lease signing with deposits, move-out disposition, recurring rent generation) must execute inside atomic transactions using a native `db.transaction((tx) => ...)` wrapper.

6. **Decoupled API-First Architecture:**
   - The web presentation layer MUST NOT connect directly to the SQLite database.
   - The web frontend communicates with the Core Engine purely via internal HTTP REST calls, forwarding session authentication, user context, and the active `X-Operator-ID`.

7. **Security & Session Hygiene:**
   - State-modifying requests submitted from the web presentation layer require cryptographically secure session CSRF tokens (`validateCsrf()`).
   - Public authentication endpoints enforce sliding-window in-memory rate limiting against brute-force attacks.
   - Passwords hashed using native `node:crypto.scrypt` with a 16-byte random salt and verified via `node:crypto.timingSafeEqual`.

8. **Drop-in Modular Architecture:**
   - Feature domains live in self-contained directories under `modules/[module_name]/`.
   - The Core Engine must auto-discover and load module migrations, backend routes, event listeners, and frontend navigation/slots dynamically at boot.
   - Modules must remain loosely coupled; cross-module communication is conducted via the asynchronous in-process Event Bus.

9. **Purity of Repository:**
   - This codebase is 100% pure open-source GarrisonOS. Do not reference downstream, commercial, or proprietary forks anywhere in the code, comments, or documentation.

---

## 2. Target Directory Structure

```text
garrison-os/
├── .github/
│   └── workflows/
│       ├── ci.yml             # Automated build and test workflow
│       ├── cla.yml            # Automated CLA Assistant check workflow
│       └── security.yml       # Automated hygiene and Betterleaks secret scanning
├── .betterleaksignore         # Secret scanning baseline exception rules
├── .env.example
├── .gitignore
├── AGENTS.md                  # Contributor & engineering guardrails
├── CONTRIBUTING.md            # Contribution guide & dual-licensing policy
├── Dockerfile                 # Multi-stage zero-dependency Alpine production container
├── docker-compose.yml         # Turnkey Docker Compose service orchestration
├── LICENSE                    # AGPLv3 with Section 7(b) UI attribution addendum
├── package.json               # Zero runtime dependencies (typescript, @types/node)
├── tsconfig.json              # Strict TypeScript compiler configuration
│
├── deploy/                    # Production Hosting & Proxy Templates
│   ├── systemd/garrison.service # Hardened systemd service with sandbox security
│   ├── caddy/Caddyfile        # Automated TLS reverse proxy configuration
│   └── nginx/nginx.conf       # High-performance reverse proxy with rate limiting
│
├── docs/                      # Comprehensive Documentation Hierarchy
│   ├── README.md
│   ├── architecture/
│   ├── modules/
│   ├── api/
│   ├── development/
│   ├── deployment/
│   └── legal/
│
├── core/                      # Engine Foundation & Runtime
│   ├── context.ts             # AsyncLocalStorage operator & user context
│   ├── crypto.ts              # Native RFC 9562 UUIDv7 generator, scrypt hashing, auth tokens
│   ├── events.ts              # Native EventEmitter event bus with dead-letter failure tracking
│   ├── rbac.ts                # Fine-grained configurable Role-Based Access Control matrix
│   ├── storage.ts             # Native node:fs file storage abstraction & local driver
│   ├── module-loader.ts       # Dynamic scanner & registry for /modules
│   └── index.ts
│
├── api/                       # Zero-Dependency HTTP Layer
│   ├── router.ts              # Static-first HTTP router (methods, specificity, params, parsing)
│   ├── middleware.ts          # Operator resolution, auth verification, CORS, rate limiting, RBAC guards
│   ├── response.ts            # Standardized JSON response envelopes & status codes
│   ├── server.ts              # Native node:http server harness & health checks
│   └── index.ts
│
├── database/                  # Storage Engine & Migrations
│   ├── client.ts              # node:sqlite client with WAL mode, pragmas & transaction helper
│   ├── migrator.ts            # Native SQL migration runner with _migrations tracker
│   ├── seed.ts                # Deterministic date-relative 20-unit sample portfolio seeder
│   └── migrations/            # Core system migrations
│       ├── 0001_core_schema.sql
│       ├── 0002_add_token_version.sql
│       ├── 0003_add_operator_storage_quota.sql
│       ├── 0004_create_attachments.sql
│       ├── 0005_create_role_permissions.sql
│       └── 0006_platform_roles_and_subusers.sql
│
├── modules/                   # Drop-in Functional Modules
│   ├── properties/            # Portfolios, Properties, and Units
│   ├── contacts/              # Humans directory (tenants, owners, vendors, emergency)
│   ├── leases/                # Lease agreements, terms & lease_contacts junction
│   ├── accounting/            # Cash-basis ledger, billing cycles, Schedule E & balances
│   ├── maintenance/           # Work order tracking, vendor dispatch, cost conversion
│   ├── backup/                # Hot vacuum, POSIX tar media backup, and disaster recovery
│   └── attachments/           # Universal media/doc storage with EXIF & PDF sanitization
│
├── web/                       # Presentation Layer (Native TypeScript SSR / Semantic HTML5)
│   ├── index.ts               # Front controller, CSRF validator & dynamic route dispatcher
│   ├── lib/                   # Native HTTP client, session, auth, CSRF, and HTML template engine
│   ├── templates/             # Layouts, navigation, headers, and flash alerts
│   ├── pages/                 # Dashboard, login, setup, and module view pages
│   └── public/                # Design tokens (CSS Custom Properties), styles, minimal JS
│
└── test/                      # Native node:test & node:assert Suite
    ├── helpers.ts             # In-memory SQLite fixtures & mock HTTP harnesses
    ├── crypto.test.ts         # UUIDv7 format, bit validation, scrypt hashing & token tests
    ├── context.test.ts        # AsyncLocalStorage propagation & concurrency tests
    ├── isolation.test.ts      # Cross-operator data isolation & leak prevention tests
    ├── router.test.ts         # Static-first route matching, params, body parsing tests
    ├── modules.test.ts        # Module auto-discovery & migration runner tests
    └── e2e/                   # Multi-step end-to-end user lifecycle integration tests
        └── lifecycle.test.ts  # Full operator journey from bootstrap to deposit refund
```

---

## 3. Drop-in Module Standard Specification

Every functional module under `modules/[module_name]/` must adhere strictly to the following contract.
The application version is sourced from the repository root `VERSION` file and injected into
loaded module metadata:

### 3.1. Module Manifest (`module.json`)

```json
{
  "id": "properties",
  "name": "Properties & Portfolios",
  "description": "Management of portfolios, physical properties, and rentable units.",
  "navigation": [
    {
      "label": "Properties",
      "route": "/properties",
      "icon": "building",
      "order": 10,
      "section": "core"
    }
  ],
  "slots": [
    "dashboard.metrics",
    "property.details.tabs"
  ],
  "dependencies": []
}
```

### 3.2. Backend Contracts (`backend/`)

- **`migrations/`**: Sequentially numbered SQL migrations prefixed with module identifier (e.g., `0001_properties.sql`). Executed automatically on boot.
- **`routes.ts`**: Exports `registerRoutes(router: Router): void`. Routes are mounted under `/api/v1/[module_id]`.
- **`events.ts`**: Exports `registerSubscribers(eventBus: EventBus): void`.
- **`repository.ts`**: Encapsulates all SQL execution, strictly accepting only the operator context from `RequestContext.get()` and query arguments.

### 3.3. Frontend Contracts (`frontend/`)

- Module pages and view extensions are authored using native TypeScript tagged template SSR (`web/lib/html.ts`).

### 3.4. Test Contracts (`test/`)

- **`[module_name].test.ts`**: Co-located unit and integration test suite executing under native `node:test` and `node:assert`. Covers module repositories, route endpoints, lifecycle states, and operator context isolation. Automatically discovered and executed on `node scripts/test.js [module_name]`.

---

## 4. MVP Domain Entities & Schemas

### 4.1. Core System Schema (`database/migrations/0001_core_schema.sql`)

```sql
-- Schema version tracking
CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    module TEXT NOT NULL,
    applied_at INTEGER NOT NULL
);

-- Multi-operator accounts (property management firm / landlord)
CREATE TABLE IF NOT EXISTS operators (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subdomain TEXT UNIQUE,
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

-- System operators and users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('system_owner', 'system_manager', 'owner', 'manager', 'leasing_agent', 'assistant', 'maintenance', 'auditor', 'viewer', 'read_only')),
    is_system_user INTEGER NOT NULL DEFAULT 0 CHECK (is_system_user IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (operator_id) REFERENCES operators(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_operator_email ON users(operator_id, email) WHERE deleted_at IS NULL;

-- Immutable Audit Log Trail
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    user_id TEXT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'login', 'billing_run')),
    changes_json TEXT,
    ip_address TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (operator_id) REFERENCES operators(id)
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_operator_entity ON audit_logs(operator_id, entity_type, entity_id);

-- File attachments & document metadata
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (operator_id) REFERENCES operators(id)
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(operator_id, entity_type, entity_id);
```

### 4.2. Properties Module (`modules/properties/backend/migrations/0001_properties.sql`)

```sql
-- Portfolios (Legal ownership entities / LLCs)
CREATE TABLE IF NOT EXISTS portfolios (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    name TEXT NOT NULL,
    tax_id TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (operator_id) REFERENCES operators(id)
);
CREATE INDEX IF NOT EXISTS idx_portfolios_operator ON portfolios(operator_id);

-- Physical Properties / Buildings
CREATE TABLE IF NOT EXISTS properties (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    portfolio_id TEXT,
    name TEXT NOT NULL,
    property_type TEXT NOT NULL CHECK (property_type IN ('single_family', 'multi_family', 'condo', 'townhouse', 'commercial')),
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    year_built INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);
CREATE INDEX IF NOT EXISTS idx_properties_operator_portfolio ON properties(operator_id, portfolio_id);

-- Rentable Units
CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    property_id TEXT NOT NULL,
    unit_number TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('vacant', 'occupied', 'notice_given', 'turnover', 'maintenance_hold')),
    bedrooms INTEGER NOT NULL DEFAULT 1,
    bathrooms REAL NOT NULL DEFAULT 1.0,
    square_feet INTEGER,
    market_rent_cents INTEGER NOT NULL DEFAULT 0,
    target_deposit_cents INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    FOREIGN KEY (property_id) REFERENCES properties(id)
);
CREATE INDEX IF NOT EXISTS idx_units_operator_property ON units(operator_id, property_id);
CREATE INDEX IF NOT EXISTS idx_units_operator_status ON units(operator_id, status);
```

### 4.3. Contacts Module (`modules/contacts/backend/migrations/0001_contacts.sql`)

```sql
-- Individual humans & organizations directory
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    contact_type TEXT NOT NULL CHECK (contact_type IN ('tenant', 'owner', 'vendor', 'guarantor', 'prospect', 'emergency')),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    company_name TEXT,
    email TEXT,
    phone TEXT,
    secondary_phone TEXT,
    tax_id_last4 TEXT,
    vendor_specialty TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (operator_id) REFERENCES operators(id)
);
CREATE INDEX IF NOT EXISTS idx_contacts_operator_type ON contacts(operator_id, contact_type);
CREATE INDEX IF NOT EXISTS idx_contacts_operator_name ON contacts(operator_id, last_name, first_name);
```

### 4.4. Leases Module (`modules/leases/backend/migrations/0001_leases.sql`)

```sql
-- Lease contracts
CREATE TABLE IF NOT EXISTS leases (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'expiring', 'renewed', 'terminated', 'month_to_month')),
    start_date INTEGER NOT NULL,
    end_date INTEGER NOT NULL,
    rent_amount_cents INTEGER NOT NULL,
    security_deposit_cents INTEGER NOT NULL DEFAULT 0,
    deposit_held_cents INTEGER NOT NULL DEFAULT 0,
    rent_due_day INTEGER NOT NULL DEFAULT 1,
    late_fee_grace_days INTEGER NOT NULL DEFAULT 5,
    late_fee_amount_cents INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    FOREIGN KEY (unit_id) REFERENCES units(id)
);
CREATE INDEX IF NOT EXISTS idx_leases_operator_unit ON leases(operator_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_leases_operator_status_dates ON leases(operator_id, status, start_date, end_date);

-- Lease-to-Contact Junction (Multi-party signing parties)
CREATE TABLE IF NOT EXISTS lease_contacts (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    lease_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('primary_tenant', 'co_tenant', 'guarantor', 'occupant')),
    is_financially_responsible INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    FOREIGN KEY (lease_id) REFERENCES leases(id),
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lease_contacts_unique ON lease_contacts(operator_id, lease_id, contact_id) WHERE deleted_at IS NULL;
```

### 4.5. Accounting Module (`modules/accounting/backend/migrations/0001_accounting.sql`)

```sql
-- Single-entry cash-basis ledger aligned with IRS Schedule E
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'charge',           -- Invoiced amount owed by tenant
        'payment',          -- Inflow payment received from tenant
        'expense',          -- Outflow paid for property maintenance/operations
        'refund',           -- Money returned to tenant
        'deposit_inflow',   -- Security deposit collected into trust
        'deposit_return',   -- Security deposit returned to tenant at move-out
        'deposit_deduction' -- Security deposit applied to unpaid rent/damages
    )),
    category TEXT NOT NULL CHECK (category IN (
        -- Income Categories
        'rent', 'late_fee', 'pet_fee', 'utility_rebill', 'security_deposit', 'other_income',
        -- IRS Schedule E Operating Expense Categories
        'advertising', 'auto_travel', 'cleaning_maintenance', 'commissions', 'insurance',
        'legal_professional', 'management_fees', 'mortgage_interest', 'other_interest',
        'repairs', 'supplies', 'property_taxes', 'utilities', 'hoa_fees', 'capital_improvement'
    )),
    amount_cents INTEGER NOT NULL, -- Always positive integer cents
    transaction_date INTEGER NOT NULL,
    description TEXT NOT NULL,
    payment_method TEXT CHECK (payment_method IN ('zelle', 'check', 'cash', 'ach', 'direct_deposit', 'credit_card', 'other')),
    reference_number TEXT,
    property_id TEXT,
    unit_id TEXT,
    lease_id TEXT,
    payer_contact_id TEXT,
    payee_contact_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    FOREIGN KEY (property_id) REFERENCES properties(id),
    FOREIGN KEY (unit_id) REFERENCES units(id),
    FOREIGN KEY (lease_id) REFERENCES leases(id),
    FOREIGN KEY (payer_contact_id) REFERENCES contacts(id),
    FOREIGN KEY (payee_contact_id) REFERENCES contacts(id)
);
CREATE INDEX IF NOT EXISTS idx_tx_operator_lease_date ON transactions(operator_id, lease_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_tx_operator_property_date ON transactions(operator_id, property_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_tx_operator_type_category ON transactions(operator_id, transaction_type, category);
```

#### Financial Logic & Calculation Standards

1. **Running Tenant Balance**:
   $$\text{Tenant Balance} = \sum (\text{charges} + \text{deposit\_returns} + \text{deposit\_deductions}) - \sum (\text{payments} + \text{refunds})$$
   *(Positive balance indicates amount owed by tenant; zero is paid in full; negative is credit balance).*

2. **Payment Allocation Priority (Application of Funds)**:
   When partial payments are recorded against an outstanding ledger, funds are applied in strict hierarchy:
   $$\text{Late Fees} \longrightarrow \text{Utility Rebill / Other Charges} \longrightarrow \text{Oldest Rent Charges} \longrightarrow \text{Current Rent}$$

3. **Security Deposit Trust Disposition at Move-Out**:
   $$\text{Final Refund Amount} = \text{Deposit Held} - (\text{Unpaid Rent Charges} + \text{Itemized Damage Deductions})$$
   - When deductions occur, a `deposit_deduction` transaction converts trust liability into operating income or expense reimbursement.

4. **Automated Monthly Recurring Rent Generation**:
   - Endpoint: `POST /api/v1/accounting/generate-rent-charges`
   - Idempotency Key: `rent_charge:{lease_id}:{YYYY_MM}`
   - Mid-month proration formula for new leases:
     $$\text{Prorated Rent Cents} = \left\lfloor \frac{\text{Monthly Rent Cents}}{\text{Days in Month}} \times \text{Days Remaining (inclusive)} \right\rfloor$$

5. **Schedule E Tax & Net Operating Income (NOI)**:
   $$\text{NOI} = \sum \text{Operating Income (Rent, Fees)} - \sum \text{Operating Expenses (Schedule E Categories)}$$

6. **Chart of Accounts & QuickBooks Compatibility (`0002_quickbooks_compatibility.sql`)**:
   - Manages customizable standard Chart of Accounts mapping (`chart_of_accounts`) to QuickBooks standard account types (Bank, AccountsReceivable, OtherCurrentAsset, OtherCurrentLiability, Income, Expense).
   - Generates balanced double-entry journal entries from single-entry property operations with property class tracking.
   - Exports universal formats: QuickBooks Online Journal CSV, QuickBooks Desktop IIF, and Web Connect Bank Feed (.QBO).
   - Tracks export state with `quickbooks_export_logs` and audit timestamps on `transactions`.

### 4.6. Maintenance Module (`modules/maintenance/backend/migrations/0001_maintenance.sql`)

```sql
-- Work Orders and Repair Tracking
CREATE TABLE IF NOT EXISTS work_orders (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    property_id TEXT NOT NULL,
    unit_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'assigned', 'in_progress', 'on_hold', 'completed', 'cancelled')),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'emergency')),
    category TEXT NOT NULL CHECK (category IN ('plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'cosmetic', 'pest', 'other')),
    permission_to_enter INTEGER NOT NULL DEFAULT 1,
    entry_instructions TEXT,
    requested_by_contact_id TEXT,
    vendor_contact_id TEXT,
    scheduled_date INTEGER,
    completed_date INTEGER,
    estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
    actual_cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    FOREIGN KEY (property_id) REFERENCES properties(id),
    FOREIGN KEY (unit_id) REFERENCES units(id),
    FOREIGN KEY (requested_by_contact_id) REFERENCES contacts(id),
    FOREIGN KEY (vendor_contact_id) REFERENCES contacts(id)
);
CREATE INDEX IF NOT EXISTS idx_work_orders_operator_status ON work_orders(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_operator_property ON work_orders(operator_id, property_id, unit_id);
```

### 4.7. Expanded Foundational MVP Domain Models

For complete SQL schema definitions, constraints, indexes, and double-entry invariants across the full Foundational MVP scope, refer directly to the canonical [Domain Models Specification](domain-models.md) and [API Specification](api-spec.md):

- **Universal Document Attachments & Safety (`attachments`)**: Pre-MVP document storage across leases, properties, contacts, and work orders with automated EXIF stripping and PDF script sanitization (Sprint 3).
- **Client Portfolio Accounting (`client_capital_contributions`, `client_distributions`, `management_fee_agreements`)**: Fiduciary portfolio/property cash accounting, client contributions, net cash draws, and automated management fees (Sprint 4).
- **Leasing AR & Policy Engine (`recurring_lease_charges`, `late_fee_policies`, `lease_credits_and_concessions`, `security_deposit_refunds`)**: Itemized recurring rent/utility charges, late fee policy rules, concessions, and deposit refunds (Sprint 4).
- **Accounts Payable (AP) & Invoicing (`bills`, `bill_allocations`, `recurring_bills`)**: Vendor bill lifecycle, multi-unit expense allocations, and scheduled recurring bills (Sprint 5).
- **Zero-Dependency PDF Check Printing (`bill_disbursements`)**: Server-rendered ANSI X9.100-140 business and voucher check vector stream generator (Sprint 5).
- **Bank Deposits & Batched Clearing (`bank_deposits`, `bank_deposit_lines`)**: Deposit batching grouping multiple payments for Three-Way Bank Reconciliation (Sprint 5).
- **Dynamic Custom Fields (`custom_field_definitions`)**: Schema-free validated JSON attributes on parent operational entities (Sprint 5).

---

## 5. Core Engine & Subsystems Architecture

### 5.1. Context Propagation (`core/context.ts`)

Encapsulates request isolation via `node:async_hooks.AsyncLocalStorage`.

```typescript
export interface RequestContextData {
  operatorId?: string;
  userId?: string;
  correlationId: string;
}
```

- Methods: `RequestContext.run(context, fn)`, `RequestContext.get(): RequestContextData`, `RequestContext.tryGet(): RequestContextData | undefined`, `RequestContext.getOperatorId(): string`.
- Throws `Error('No active request context')` if accessed outside an active context.

### 5.2. Native RFC 9562 UUIDv7 & Cryptography (`core/crypto.ts`)

1. **UUIDv7 Generator**: Generates 128-bit time-ordered UUIDv7 identifiers using `node:crypto.randomBytes`:
   - **Bits 0–47**: 48-bit UNIX timestamp (milliseconds).
   - **Bits 48–51**: Version `7` (`0b0111`).
   - **Bits 52–63**: 12-bit random data (or sub-millisecond sequence).
   - **Bits 64–65**: Variant `2` (`0b10`).
   - **Bits 66–127**: 62-bit random entropy.
2. **Password Hashing**: Formats hashes as `$scrypt$N=16384,r=8,p=1$salt$hash` using `node:crypto.scrypt` with 16-byte random salt and constant-time comparison via `node:crypto.timingSafeEqual`.
3. **Session Tokens**: Stateless HMAC-SHA256 tokens signed with `APP_SECRET` containing operator claims (`opid`).

### 5.3. In-Process Event Bus (`core/events.ts`)

Decoupled asynchronous cross-module messaging using `node:events.EventEmitter`:

- Automatically stamps `operatorId` onto published payloads.
- Standard event catalog:
  - `lease.activated`: `{ leaseId, unitId, operatorId, rentAmountCents }`
  - `lease.terminated`: `{ leaseId, unitId, operatorId }`
  - `payment.recorded`: `{ transactionId, leaseId, amountCents, operatorId }`
  - `work_order.completed`: `{ workOrderId, propertyId, unitId, actualCostCents, operatorId }`
    *(Auto-triggers optional recording of an accounting expense transaction).*

### 5.4. Local Storage Driver (`core/storage.ts`)

- Abstract `StorageDriver` interface: `save(path, buffer, mimeType)`, `read(path)`, `delete(path)`, `exists(path)`.
- `LocalDiskStorageDriver` implementation uses `node:fs/promises`, sanitizes path traversal attempts, and stores files with sanitized UUID names in partitioned directories (`uploads/YYYY/MM/uuid`).

### 5.5. Dynamic Module Loader (`core/module-loader.ts`)

1. Scans `modules/` using `node:fs.readdirSync()`.
2. Reads and validates each `module.json` manifest.
3. Automatically applies any pending SQL migrations in `modules/[name]/backend/migrations/` via `database/migrator.ts`.
4. Imports and mounts routes from `modules/[name]/backend/routes.ts` under `/api/v1/[name]`.
5. Binds event subscribers from `modules/[name]/backend/events.ts` to `core/events.ts`.

---

## 6. Zero-Dependency API Layer

### 6.1. Native HTTP Router (`api/router.ts`)

- Built directly on `node:http.IncomingMessage` and `node:http.ServerResponse`.
- Supports standard HTTP verbs: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- Route parameter extraction (e.g., `/api/v1/properties/:id/units/:unit_id`).
- Automatic streaming JSON request body parser with a 1MB default payload ceiling.

### 6.2. Standard Response Envelopes (`api/response.ts`)

All REST endpoints return standardized JSON structures:

```typescript
// Success Response (HTTP 200/201)
{
  "success": true,
  "data": { ... },
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 25
  }
}

// Error Response (HTTP 4xx/5xx)
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR" | "NOT_FOUND" | "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "OPERATOR_REQUIRED" | "RATE_LIMITED" | "INTERNAL_ERROR",
    "message": "Human-readable description of error",
    "details": []
  }
}
```

### 6.3. Middleware Pipeline (`api/middleware.ts`)

1. **Security Headers**: Set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'`.
2. **Correlation ID**: Extract `X-Request-ID` or generate new UUIDv7.
3. **Sliding-Window Rate Limiting**: In-memory rate limiter applying across all routes, selecting operator, auth, or public buckets (auth default set to 10 requests per 15 minutes).
4. **Operator Resolution**: Extract `X-Operator-ID`, bearer token claims, or route/host subdomain. If missing on operator-scoped routes, reject immediately with `400 Bad Request` (`OPERATOR_REQUIRED`).
5. **Execution Wrapper**: Wrap downstream handler inside `RequestContext.run({ operatorId, userId, correlationId }, handler)`.
6. **Global Error Trap**: Catch unhandled exceptions and format safe 500 JSON responses.

### 6.4. Data Portability & Backup Endpoints

- `GET /api/v1/accounting/export/rent-roll.csv`: Streams standard CSV Rent Roll.
- `GET /api/v1/accounting/export/schedule-e.csv`: Streams IRS Schedule E year-end income & expense breakdown.
- `GET /api/v1/accounting/export/ledger/:lease_id.csv`: Streams itemized tenant ledger statement.
- `GET /api/v1/accounting/chart-of-accounts`: Lists Chart of Accounts.
- `GET /api/v1/accounting/quickbooks/preview`: Previews balanced double-entry journal entries.
- `GET /api/v1/accounting/export/quickbooks/qbo-journal.csv`: Streams QuickBooks Online Journal CSV.
- `GET /api/v1/accounting/export/quickbooks/desktop.iif`: Streams QuickBooks Desktop IIF.
- `GET /api/v1/accounting/export/quickbooks/bank-feed.qbo`: Streams Web Connect (.QBO) bank feed.
- `GET /api/v1/system/backup`: Safely creates a WAL-checkpointed snapshot of the SQLite database.

---

## 7. Native TypeScript Presentation Layer

### 7.1. Front Controller & SSR Engine (`web/index.ts`, `web/pages/`)

- Direct zero-dependency server-side rendering running on Node.js standard libraries (`node:http`, `node:crypto`, `node:fs`, `node:path`).
- Validates cryptographic CSRF token on all incoming `POST`, `PUT`, and `DELETE` requests before dispatching (`validateCsrf()`).
- Resolves presentation routes:
  - System and auth routes: `/`, `/login`, `/logout`, `/setup`.
  - Application routes: `/dashboard`, `/properties`, `/contacts`, `/leases`, `/accounting`, `/maintenance`.
- Automatic XSS-safe tagged template HTML rendering using `html` and `raw` from `web/lib/html.ts`.

### 7.2. Native API Client & Session (`web/lib/api-client.ts`, `web/lib/session.ts`)

- Client abstraction for internal REST API communication at `http://127.0.0.1:3000`.
- Forwards `X-Operator-ID` from HMAC-signed cookie session, along with `Authorization: Bearer <token>`.
- Automatically unwraps JSON envelopes and handles authentication failures with session invalidation.

### 7.3. UI Navigation & Extension Slots

- Layout navigation templates (`web/templates/header.ts`, `web/templates/layout.ts`) render responsive navigation and operator badges.
- Module-based extensibility for metric cards, detail extension tabs, and action dialogs.

### 7.4. Semantic HTML5 & Vanilla CSS Design System (`web/public/css/`)

- Uses CSS Custom Properties for typography, colors, borders, shadows, and light/dark theme variables.
- Fully responsive layout using CSS Grid and Flexbox without utility frameworks or external preprocessors.
- Native HTML `<dialog>` for modal interactions and accessible semantic tables for ledger data.
