# GarrisonOS Canonical Development Roadmap

This document outlines the canonical development roadmap to Foundational MVP Feature-Complete Alpha (**v0.1.0-alpha**, achieved at the completion of **Sprint 5**) and subsequent major releases for **GarrisonOS**. It synthesizes architectural requirements, sprint milestones, clean-room domain specifications, and continuous progress metrics grounded in the [Comprehensive Project Review](LLMREVIEW20260915.md), [Domain Models Specification](architecture/domain-models.md), and [API Specification](architecture/api-spec.md).

---

## 1. Executive Progress & Project Health Scorecard

Continuous evaluations track implementation maturity against the non-negotiable engineering guardrails established in [`AGENTS.md`](../AGENTS.md).

### Overall Project Health Progression

| Metric Category | Baseline (2026-09-15) | Post-Sprint 1 (2026-09-17) | Post-Sprint 2 (2026-09-17) | Post-Sprint 3 (2026-09-18) | Post-Sprint 4 (2026-09-23) | Target (v0.1.0-alpha - Sprint 5) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Architecture & Design** | 92% | 96% | 98% | 100% | **100%** | 100% |
| **Core Implementation** | 85% | 92% | 96% | 98% | **100%** | 100% |
| **Module Completeness** | 65% | 84% | 92% | 96% | **98%** | 100% (Foundational MVP) |
| **Testing & Verification** | 75% | 85% | 96% | 98% | **99%** | 100% (Full regression) |
| **Documentation & Hygiene** | 80% | 90% | 95% | 100% | **100%** | 100% (Synchronized) |
| **Security & Isolation** | 78% | 88% | 94% | 99% | **100%** | 100% (Audited) |
| **Production Readiness** | 50% | 65% | 92% | 96% | **98%** | 100% (Packaged Installers) |
| **Composite Project Score** | **78% (B+)** | **86% (B+)** | **95% (A)** | **98% (A+)** | **99% (A+)** | **100% (A+) Feature-Complete Alpha** |

---

### MVP Phase Completion Tracking

Progress across the seven canonical architectural phases leading to Foundational MVP:

| Phase | Description | Baseline | Current | Grade | Status | MVP Target Milestone |
| :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| **1** | Core Engine, Multi-Operator & Admin GUI | 85% | **100%** | A+ | Complete | Admin Management GUI & Configurable RBAC (Sprint 3) |
| **2** | Base Entity, Inventory & Attachments | 70% | **100%** | A+ | Complete | Universal Document Attachments & Safety (Sprint 3) |
| **3** | Core Property Operations & Conversations | 65% | **100%** | A+ | Complete | Universal Entity Conversations & Preventative Scheduling (Sprint 4) |
| **4** | Financial Ledger, Client Accounting & AP | 88% | **98%** | A+ | Exceptional | Client Accounting (Sprint 4), AP & PDF Checks (Sprint 5) |
| **5** | Native Presentation & Public Tenant Portal | 60% | **92%** | A- | Strong | Public Tenant Portal on Subdomain `portal.<domain>` (Sprint 5) |
| **6** | Data Portability, Resilience & Media Backup | 100% | **100%** | A+ | Complete | Packaging physical attachment media in backup archives (Sprint 3) |
| **7** | MVP Verification, Packaging & GUI Installers| 55% | **90%** | A- | Near Complete | Turnkey Click-Through GUI Installers (Windows/macOS/Linux) (Sprint 5) |

---

### Module Health Scorecard

| Module | Current | Grade | Key Capabilities Delivered & Near-Term MVP Scope |
| :--- | :---: | :---: | :--- |
| **Accounting** | **98%** | A+ | Append-only double-entry ledger, statutory trust fund segregation (`1010` vs `1020`), Three-Way Bank Reconciliation, Form 1099-NEC aggregation, Schedule E mapping. *In MVP*: Client Portfolio Accounting (Sprint 4), Accounts Payable (AP), Zero-Dependency PDF Check Printing, and Bank Deposit Batching (Sprint 5). |
| **Backup** | **98%** | A+ | In-process `BackupScheduler` daemon, hot vacuuming, automated retention pruning, snapshot export/import with SHA-256 integrity checks. *In MVP*: Bundling physical media attachments into verified backup archives (Sprint 3). |
| **Contacts** | **95%** | A | Multi-role directory, trade specializations, visual W-9 verification flags (`w9_received`), legal tax classifications, 1099-NEC audit links, and Universal Conversations. |
| **Maintenance** | **95%** | A | Work order lifecycle, priority triage (`emergency` $\to$ `low`), trade-filtered vendor dispatch modal, automated make-ready orders (`make_ready`), and preventative maintenance scheduling engine (`preventative_schedules`). |
| **Leases** | **95%** | A | Multi-party signatories (`primary_tenant`, `guarantor`), lease renewal modal, move-out termination notice workflow, statutory deposit countdowns, itemized recurring charges, late fee policies, credits/concessions, and tenant deposit refunds (`/leases/:id`). |
| **Properties** | **95%** | A | Portfolios, properties, unit inventories, vacancy metrics, unit turnover state machine (`vacant` $\leftrightarrow$ `turnover` $\leftrightarrow$ `maintenance_hold`), and polymorphic conversations. *In MVP*: Dynamic custom fields support (Sprint 5). |

---

### MVP Critical Path & Success Criteria

- [x] **Sprint 1 (Weeks 1–2): Core Foundation & Architecture Hardening** (Completed 2026-09-17)
  - [x] EventBus `AsyncLocalStorage` context loss resolved (`RequestContext.run()`).
  - [x] Database migration topological dependency sorting implemented.
  - [x] Stateless token vulnerability resolved (`token_version` tracking and validation).
  - [x] CORS origin restriction & fail-closed `APP_SECRET` verification.
  - [x] Statutory trust fund segregation (`1010` vs `1020`) & Three-Way Bank Reconciliation schedules.
  - [x] In-process `BackupScheduler` daemon with automated WAL checkpoints & vacuuming.
  - [x] 100% Pure TypeScript SSR rebase eliminating legacy PHP runtime.
- [x] **Sprint 2 (Weeks 3–4): Production Readiness & Interactive Workflows** (Completed 2026-09-17)
  - [x] Multi-step user journey E2E lifecycle test suite (`test/e2e/lifecycle.test.ts`).
  - [x] Hardened Systemd service unit (`deploy/systemd/garrison.service`) and zero-dependency Dockerfile (`node:24-alpine`).
  - [x] Unit turnover state machine (`vacant` $\leftrightarrow$ `turnover` $\leftrightarrow$ `maintenance_hold`) & make-ready automation.
  - [x] Lease renewal and move-out termination workflows with statutory deposit disposition timers.
  - [x] Vendor trade specialization badges & W-9 tax compliance indicators.
  - [x] Router static route precedence matching in `api/router.ts`.
- [x] **Sprint 3 (Weeks 5–6): System Governance, Universal Attachments & Backup Integration** (Completed 2026-09-18, v0.1.0-alpha)
  - [x] Operator lifecycle administration API (`POST /api/v1/system/operators`) & storage quota management.
  - [x] Global sliding-window rate limiting across all operational route handlers with metrics tracking.
  - [x] Admin Management GUI Subsystem (`/admin`, health telemetry, quota gauges, dead-letter failure log, module inspector).
  - [x] Highly Configurable Role-Based Access Control (RBAC) permission matrix (`resource:action`) and route guards.
  - [x] Universal Attachments Subsystem (`/api/v1/attachments`) with zero-dependency EXIF stripping and PDF sanitization.
  - [x] Extended `modules/backup` to package physical media attachments alongside SQLite database into POSIX `.tar.gz` archives.
  - [x] 3-Tier Multi-Operator & Platform Governance Model (Master Instance Owner, Platform System Managers, Operator Admins, and Operator Subusers).
  - [x] 4-Tier Real Estate Asset Hierarchy (`portfolios` $\to$ `properties` $\to$ `buildings` $\to$ `units`) with `buildings` table, unit links, and REST endpoints.
  - [x] Granular Subuser Permissions & Dual Scoping (`user_portfolio_access`, `user_module_access`, and User Management API `/api/v1/users`).
  - [x] Setup Wizard Architecture Selector (Single-Operator Mode vs. Multi-Operator Mode) with automatic environment binding.
  - [x] Pre-release security review & zero-dependency architectural compliance verification.
- [x] **Sprint 4 (Weeks 7–8): Financial Modernization, Client Accounting & Policy Engine** (Completed 2026-09-23, v0.1.0-alpha)
  - [x] Progressive sunset and deprecation of legacy single-entry accounting (`transactions` table) with backward-compatible fallbacks and reads, elevating double-entry GL as the primary source of truth, alongside cleanup of abandoned aliases (`tenants` view).
  - [x] Client Accounting & Management Fees: Fiduciary portfolio accounting, Client Capital Contributions (`client_capital_contributions`), automated management fee calculation (cash collections % / flat unit fee), and Client Distribution / Draw engine based on net operating cash with cash and accrual summary support.
  - [x] Leasing AR & Fee Policy Engine: Granular sub-resources for recurring lease charges (`recurring_lease_charges`), configurable late fee policies (`late_fee_policies`), one-off adjustments, discounts, promotional concessions, and move-out deposit disposition / overpayment refunds.
  - [x] Universal Conversations & Notes Subsystem: Polymorphic threaded notes and audit comments across properties, buildings, units, leases, contacts, and work orders.
  - [x] TypeScript SSR Presentation Layer (UI): Baseline whites & blues styling tokens, configurable branding presets & dark mode toggle, and initial draft SSR screens for Client Accounting, Lease AR, and Conversations.
  - [x] Zero-dependency notification dispatcher (SMTP / webhook) & preventative maintenance scheduling.
- [ ] **Sprint 5 (Weeks 9–10): Foundational Operations & Accounts Payable** (Planned, Target: v0.1.0-alpha Feature-Complete Alpha)
  - [ ] **Accounts Payable (AP) Core Subsystem**: Bill lifecycle (Draft, Unapproved, Approved, Paid, Voided), multi-property bill allocations (`bill_allocations`), and recurring scheduled bills (`recurring_bills`).
  - [ ] **Vendor Credit Memos & Bill Offsets**: Vendor credit issuance and allocation offsets against accounts payable liabilities.
  - [ ] **Vendor Check Register CRUD & PDF Printing**: Native vector stream check generator (`web/lib/pdf.ts`) supporting ANSI X9.100-140 check stock specifications, check number auditing, and void check operations.
  - [ ] **Bank Deposits & Batched Clearing**: Grouping undeposited receipts into statement-reconciled bank deposit slips with voiding capability.
  - [ ] **Amenities & Marketing Syndication Profiles**: Standardized amenities catalog (`/api/v1/amenities`), property/unit junctions, pet policies, and rental listing advertising metadata (`published_for_rent`, `posting_title`, `specials`).
  - [ ] **Dynamic Custom Fields Engine**: Metadata schema definitions API (`/api/v1/custom_fields/definitions`), entity mutation endpoints, and standardized `YYYY-MM-DD` date formatting.
  - [ ] **Standardized Bulk & Temporal API Conventions**: Transactional bulk creation (`POST /api/v1/:resource/bulk`), date interval filtering (`*_start`, `*_end`), and multi-key `order_by` sorting.
  - [ ] **Packaged GUI Installers**: Super-simple click-through graphical setup wizards for Windows (`.exe`/`.msi`), macOS (`.pkg`/`.dmg`), and Linux (`.deb`).
  - [ ] **Public-Facing Tenant Self-Service Portal**: Hosted on isolated subdomain (`portal.<domain>`) with magic-link passwordless email login, mobile-first presentation, and safe mobile maintenance photo uploads.
  - [ ] **TypeScript SSR Presentation Layer (UI)**: AP bill entry & multi-property allocation queue, Check register & printing batch preview screen, Bank deposit batching dashboard, Dynamic custom fields form renderer component, and Amenities/Marketing editor.

---

## 2. Canonical Architectural Phases

### Phase 1: Core Engine, Multi-Operator & Admin Governance `[100% - Complete]`
* [x] Hardening zero-dependency Node.js HTTP/SQLite engine (`node:http`, `node:sqlite`, `node:crypto`).
* [x] Context propagation and operator isolation (`AsyncLocalStorage`, `X-Operator-ID`).
* [x] Unified auth, session management, and revocable token versioning (`token_version`).
* [x] In-process `EventBus` pub/sub backbone with context persistence.
* [x] Static-first route specificity matching eliminating wildcard collisions.
* [x] Operator lifecycle provisioning API (`POST /api/v1/system/operators`) & storage quota governance *(Sprint 3)*.
* [x] Admin Management GUI (error logs, health telemetry, dynamic module status) *(Sprint 3)*.
* [x] Highly Configurable Role-Based Access Control (RBAC) permission matrix *(Sprint 3)*.

---

### Phase 2: Base Entity, Inventory & Universal Attachments `[100% - Complete]`
* [x] Portfolios, properties, and rentable unit inventories with turnover status tracking.
* [x] Multi-role directory management (tenants, clients, vendors, emergency contacts).
* [x] Vendor compliance tracking (trade specializations, tax classifications, W-9 verification).
* [x] Universal Document Attachments Subsystem across leases, properties, and work orders *(Sprint 3)*.
* [x] Document & Media Safety Hygiene: Magic byte verification, strict MIME whitelisting, directory traversal defense, and PDF script sanitization *(Sprint 3)*.

---

### Phase 3: Core Property Operations & Communications `[100% - Complete]`
* [x] Leasing lifecycle: draft, active, renewal, and move-out termination workflows.
* [x] Maintenance & work orders: priority triage, trade-filtered vendor dispatch, make-ready automation.
* [x] Cross-module operational event publishing (`lease.created`, `work_order.completed`).
* [x] Universal Conversations & Threaded Notes across all operational entities *(Sprint 4)*.
* [x] Preventative recurring maintenance scheduling engine *(Sprint 4)*.

---

### Phase 4: Financial Ledger, Client Accounting & Accounts Payable `[98% - Exceptional]`
* [x] Immutable, append-only double-entry general ledger with strict integer-cents tracking (`journal_entries` and `journal_lines`).
* [x] Statutory trust accounting fund segregation (`1010 Operating Checking` vs. `1020 Trust Checking` and `2100 Tenant Security Deposits Held Liability`).
* [x] Automated Three-Way Bank Reconciliation verification schedules.
* [x] Standardized Chart of Accounts (IRS Schedule E lines and QuickBooks compatibility mapping).
* [x] Progressive sunset and deprecation of legacy single-entry `transactions` table with backward-compatible reads and fallbacks *(Sprint 4)*.
* [x] Client Portfolio Accounting & Management Fee Agreements (capital contributions, net cash draws, cash/accrual portfolio cash summary, automated fee calculations) *(Sprint 4)*.
* [x] Leasing AR & Fee Policy Engine (recurring auto-charges, late fee policy rules, concessions, deposit refunds) *(Sprint 4)*.
* [ ] Accounts Payable (AP) & Vendor Invoicing Subsystem (bills, multi-unit allocations, recurring bills) *(Sprint 5)*.
* [ ] Zero-Dependency Server-Rendered PDF Vendor Check Printing (ANSI check stock specs) *(Sprint 5)*.
* [ ] Bank Deposits & Batched Clearing for 3-way reconciliation *(Sprint 5)*.

---

### Phase 5: Native Presentation Layer & Public Tenant Portal `[92% - Strong]`
* [x] Native TypeScript SSR presentation architecture (`web/lib/html.ts`, `node:http`), layout shells, and CSS custom properties design system.
* [x] Complete removal of legacy PHP presentation code (39 files, 4,318 LOC eliminated).
* [x] Operator dashboards, search, and CRUD views for properties, contacts, leases, and work orders.
* [x] Interactive operator workflow modals (unit turnover, lease renewal, termination notices, vendor dispatch).
* [x] Financial reporting interfaces (income statements, rent roll, ledger balance views, 3-way reconciliation schedules).
* [ ] Public-Facing Tenant Self-Service Portal on isolated subdomain (`portal.<domain>`) with magic-link email login *(Sprint 5)*.
* [ ] Mobile-first responsive presentation for tenant balance checks and safe photo maintenance requests *(Sprint 5)*.

---

### Phase 6: Data Portability, Resilience & Media Backup `[100% - Complete]`
* [x] Point-in-time database snapshotting and WAL checkpoint management.
* [x] Operator data export/import workflows with SHA-256 verification.
* [x] In-process `BackupScheduler` daemon with automated schedules, vacuuming, and retention pruning.
* [x] Automated disaster recovery verification tests and restore CLI (`scripts/restore.js`).
* [x] Extending backup archives to package physical attachment media alongside SQLite database snapshots *(Sprint 3)*.

---

### Phase 7: MVP Verification, Packaging & GUI Installers `[90% - Near Complete]`
* [x] End-to-end integration test suite (`test/e2e/lifecycle.test.ts`) validating full operator journey.
* [x] Hardened Systemd service unit (`deploy/systemd/garrison.service`) with Linux sandboxing.
* [x] Multi-stage zero-dependency Dockerfile (`node:24-alpine`) and `docker-compose.yml`.
* [x] Automated TLS reverse proxy configurations (Caddy / Nginx).
* [x] Comprehensive production deployment runbook (`docs/deployment/production-guide.md`).
* [ ] Packaged GUI Installers (turnkey click-through setup wizards for Windows, macOS, Linux) *(Sprint 5)*.
* [ ] Pre-release penetration audit and security review *(Sprint 3)*.
* [ ] Automated GitHub Actions release pipeline with cryptographic `SHA256SUMS` *(Sprint 3)*.

---

## 3. Canonical Sprint Execution Roadmap

GarrisonOS organizes engineering work into structured two-week execution sprints:

### Sprint 1 (Weeks 1–2): Core Foundation & Architecture Hardening
> **Status**: Completed (2026-09-17) | **Release Target**: v0.1.0-alpha.1 | **Effort**: 32 hours

| Work Stream | Key Deliverables | Status |
| :--- | :--- | :---: |
| **Critical Defect Remediation** | Resolved all P0 issues: EventBus context propagation, topological migration ordering, and stateless token revocation (`token_version`). | ✅ Completed |
| **Security & Network Hardening** | Restricted CORS to configured origin whitelist; enforced fail-closed `APP_SECRET` verification; added `/api/v1/batch` hydration endpoint. | ✅ Completed |
| **Statutory Trust Accounting** | Implemented fiduciary trust segregation (`1010` vs `1020`), Three-Way Bank Reconciliation schedules, IRS Form 1099-NEC vendor aggregation, and statutory move-out disposition timelines. | ✅ Completed |
| **Automated Backup Daemon** | Built in-process `BackupScheduler` daemon with automated WAL checkpoints, SQLite snapshots, vacuum/optimize routines, retention pruning, and dashboard controls. | ✅ Completed |
| **Pure TypeScript Rebase** | Eliminated 39 legacy PHP files (4,318 LOC); established 100% pure TypeScript SSR presentation layer (`web/lib/html.ts`, session manager, CSRF guard, hook registry). | ✅ Completed |
| **Compliance & Tooling** | Created zero-dependency hygiene scanner (`scripts/check-hygiene.js`), security blast radius checker (`scripts/check-security.js`), and low-token test runner (27 test suites passing). | ✅ Completed |

---

### Sprint 2 (Weeks 3–4): Production Readiness, Operator Workflows & Release Candidate
> **Status**: Completed (2026-09-17) | **Release Target**: v0.1.0-alpha.2 | **Effort**: 42 hours

| Work Stream | Key Deliverables | Status |
| :--- | :--- | :---: |
| **Turnkey Production Packaging** | Provided hardened Systemd service unit (`deploy/systemd/garrison.service`) and multi-stage, zero-dependency Dockerfile (`node:24-alpine`) with turnkey `docker-compose.yml`, reverse proxy configs (Caddy / Nginx), and deployment guide. | ✅ Completed |
| **Interactive Operator Workflows** | Wired interactive modals and state machines in TypeScript SSR: vacant-unit turnover (`vacant` $\leftrightarrow$ `turnover` $\leftrightarrow$ `maintenance_hold`), lease renewals/terminations, and maintenance vendor dispatch. | ✅ Completed |
| **Vendor Tax & Specialization UI** | Exposed vendor trade specialization badges (Plumbing, HVAC, etc.) and visual W-9 verification flags in contacts directory and detail views with schema migration (`0002_add_vendor_w9.sql`). | ✅ Completed |
| **Router Trie / Static Precedence** | Refactored `api/router.ts` dispatch matching to guarantee literal static segments take precedence over parameterized wildcard segments, preventing route registration collisions. | ✅ Completed |
| **Token Security Hardening** | Enforced mandatory numeric `token_version` check in `verifyTokenWithDatabase()`, rejecting legacy unversioned tokens to guarantee 100% session revocability. | ✅ Completed |
| **End-to-End (E2E) Test Suite** | Implemented comprehensive multi-step user-journey test suite (`test/e2e/lifecycle.test.ts`) validating portfolio setup, leasing, trust deposits, rent runs, maintenance dispatch, move-out turnover, and ledger parity. | ✅ Completed |

---

### Sprint 3 (Weeks 5–6): Operator Administration, Universal Attachments & Backup Integration
> **Status**: Completed (2026-09-18) | **Release Target**: v0.1.0-alpha | **Effort**: ~44 hours

| Priority | Task | Effort | Impact | Status |
| :---: | :--- | :---: | :---: | :---: |
| 14 | Operator lifecycle administration API (`POST /api/v1/system/operators` with legacy alias) & storage quota governance | 8h | High | ✅ Completed |
| 15 | Global sliding-window rate limiting across all operational routes | 6h | High | ✅ Completed |
| 16 | **Admin Management GUI Subsystem**: server-rendered administration dashboard providing: (a) system error reporting and failed task logs, (b) general operator health/quota telemetry, and (c) dynamic module management (inspect manifests, toggle module status) | 10h | High | ✅ Completed |
| 17 | **Highly Configurable Role-Based Access Control (RBAC)**: fine-grained permission matrix (`resource:action`), role definitions, and route authorization guards replacing static enum checks | 6h | High | ✅ Completed |
| 18 | **Universal Attachments Subsystem & Document Safety**: pre-MVP document management component across leases, properties, contacts, and work orders; strict safety hygiene (PDF structure validation, stripping embedded executable scripts, MIME whitelisting, directory traversal defense) | 8h | High | ✅ Completed |
| 19 | **Media & Attachment Backup Engine Integration**: extend `modules/backup` (`BackupScheduler`, export/import CLI) to package physical file attachments alongside the SQLite database into verified archives with SHA-256 integrity checks | 6h | High | ✅ Completed |

---

### Sprint 4 (Weeks 7–8): Financial Modernization, Client Accounting & Policy Engine
> **Status**: Completed (2026-09-23) | **Release Target**: v0.1.0-alpha | **Effort**: ~48 hours

| Priority | Task | Effort | Impact | Status |
| :---: | :--- | :---: | :---: | :---: |
| 20 | **Deprecation & Removal of Legacy Single-Entry Accounting & Abandoned Aliases**: sunset legacy `transactions` table, refactor all ledger and QuickBooks queries directly to `journal_entries`/`journal_lines`, remove legacy `tenants` compatibility view, and prune stale route aliases | 8h | High | ✅ Completed |
| 21 | **Client Accounting & Management Fees**: portfolio and property-level fiduciary accounting, Client Capital Contributions (`client_capital_contributions`), automated management fee calculation (% of rent / flat unit fee), and Client Distribution / Draw engine based on net operating cash | 10h | High | ✅ Completed |
| 22 | **Leasing AR & Fee Policy Engine**: itemized `recurring_lease_charges` (recurring pet rent, parking, utilities), configurable `late_fee_policies` (due day, grace period, flat/pct), credit memos/concessions, and tenant refunds | 10h | High | ✅ Completed |
| 23 | **Universal Conversations & Notes Subsystem**: polymorphic threaded notes and audit comments on leases, contacts, work orders, properties, buildings, and units | 6h | Medium | ✅ Completed |
| 24 | **Client Accounting & Lease AR SSR UI Views**: server-rendered client portfolio overview, capital contribution modal, Lease AR transaction manager, and Universal Conversation sidebar component (`web/templates/conversations.ts`) | 8h | High | ✅ Completed |
| 25 | Zero-dependency notification dispatcher (SMTP / webhook) & preventative maintenance scheduling engine (HVAC, alarms, winterization) | 6h | High | ✅ Completed |

---

### Sprint 5 (Weeks 9–10): Foundational Operations & Accounts Payable

> **Status**: Planned | **Release Target**: v0.1.0-alpha (Foundational MVP Feature-Complete Alpha) | **Effort**: ~60 hours

| Priority | Task | Effort | Impact | Status |
| :---: | :--- | :---: | :---: | :---: |
| 26 | **Packaged GUI Installers (Turnkey Click-Through Setup Wizards)**: graphical installer packaging (Windows `.exe`/`.msi` via NSIS/InnoSetup, macOS `.pkg`/`.dmg`, Linux `.deb`) bundling or detecting verified Node.js runtimes, provisioning system services/launch daemons, and launching initial browser handshake | 8h | High | Planned |
| 27 | **Public-Facing Tenant Self-Service Portal (Subdomain Architecture)**: `portal.<domain>` isolated subdomain routing, magic-link passwordless email authentication, mobile-first responsive presentation, and public security hardening (rate limiting, anti-brute force, zero session leakage) | 10h | High | Planned |
| 28 | **Accounts Payable (AP) Core Subsystem**: integrated into `modules/accounting/`, managing bill lifecycle (Draft, Unapproved, Approved, Paid, Voided), multi-property allocations (`bill_allocations`), and recurring bills (`recurring_bills`) | 8h | High | Planned |
| 29 | **Vendor Credit Memos & Bill Offsets**: vendor credit issuance (`vendor_credits`) and allocation offsets against accounts payable liabilities | 4h | High | Planned |
| 30 | **Zero-Dependency PDF Vendor Check Printing & Check Register**: native server-rendered PDF check generator (`web/lib/pdf.ts`) supporting ANSI X9.100-140 check stock specifications with check register CRUD and void operations | 6h | High | Planned |
| 31 | **Bank Deposits & Batched Clearing**: grouping multiple cash/check/electronic receipts into deposit slip batches (`bank_deposits`) for bank statement clearing reconciliation with voiding support | 4h | High | Planned |
| 32 | **Property & Unit Amenities Catalog & Marketing Syndication Profiles**: amenities catalog (`/api/v1/amenities`), property and unit junctions, pet policies, and rental listing advertising copy (`published_for_rent`, `posting_title`, `specials`) | 6h | High | Planned |
| 33 | **Dynamic Custom Fields Engine**: validated JSON column (`custom_fields`) on primary entities governed by `custom_field_definitions` schema table with standardized `YYYY-MM-DD` date formatting | 4h | Medium | Planned |
| 34 | **Standardized Bulk Ingestion & Temporal Query Conventions**: transactional bulk creation (`POST /api/v1/:resource/bulk`), timestamp interval filtering (`*_start`/`*_end`), and multi-key `order_by` sorting across all collections | 4h | High | Planned |
| 35 | **AP, Banking, Custom Fields & Marketing SSR UI Views**: AP bill entry with multi-property allocations, check register preview and print dashboard, bank deposit batching screen, dynamic custom field form generator, and amenities/marketing editor | 6h | High | Planned |

---

### Sprint 6 (Weeks 11–12): Dual-Engine Architecture & Field Operations

> **Status**: Planned | **Release Target**: v0.2.0-beta | **Effort**: ~52 hours

| Priority | Task | Effort | Impact | Status |
| :---: | :--- | :---: | :---: | :---: |
| 36 | Native PostgreSQL driver adapter implementing zero-dependency boundary | 16h | High | Planned |
| 37 | Dual-engine migration validation harness (SQLite & PostgreSQL) | 8h | High | Planned |
| 38 | Multi-instance clustering support behind load balancers with connection pooling | 8h | Medium | Planned |
| 39 | **Work Order Subtasks, Task Delegations & Comments**: task checklists (`work_order_tasks`), assignee delegation, task-level comments, and formal work order closure contract | 8h | High | Planned |
| 40 | **Field Technician Timecards & Labor Tracking**: billable hours, labor rates, and labor surcharges (`technician_timecards`) linked to vendor bills and work orders | 6h | High | Planned |
| 41 | **Field Maintenance SSR UI Views**: interactive work order subtask checklist component, task comments thread, and technician timecard logging modal | 6h | High | Planned |

---

### Sprint 7 (Weeks 13–14): Commercial Real Estate (CRE) & Integrated Banking Rails
> **Status**: Planned | **Release Target**: v0.3.0 | **Effort**: ~40 hours

| Priority | Task | Effort | Impact | Status |
| :---: | :--- | :---: | :---: | :---: |
| 42 | Triple Net (NNN) leases & Common Area Maintenance (CAM) reconciliation engine | 14h | High | Planned |
| 43 | CPI-indexed and fixed-percentage annual lease escalation schedules | 8h | Medium | Planned |
| 44 | Direct OFX/QBO bank statement import parser & reconciliation matching | 12h | High | Planned |
| 45 | Payment processor webhook ingestion & settlement journal entries | 6h | Medium | Planned |

---

## 4. Post-MVP Architectural Horizons

The following operational domains are cataloged in Post-MVP Architectural Horizons, with clean-room forward-compatibility covenants preserved in earlier database schemas:

1. **Property Condition Inspections Subsystem**:
   - Clean-room inspection hierarchy: `inspections` $\to$ `inspection_areas` $\to$ `inspection_items` with standard condition grading (`clean`, `good`, `fair`, `poor`, `damaged`), room-by-room checklists, inspector scheduling, and photo attachment logs.
   - *UI Presentation*: Mobile-first walk-through inspection interface optimized for tablet/mobile viewports with quick-toggle condition buttons and direct camera photo uploads.
   - *Forward compatibility*: Core `attachments` table provides photo storage. EventBus hooks for future `inspection.completed` events preserve the established unit states (`vacant`, `turnover`, `maintenance_hold`); entering `turnover` can trigger creation of a `make_ready` work order rather than a `make_ready` unit-state transition.
2. **Prospects & Lead-to-Lease Pipeline (CRM)**:
   - Inquiring applicant intake, tour scheduling, desired unit/budget/pet specs, marketing campaign source tracking, call tracking routing metadata (`campaign_tracking`), and one-click conversion to active lease.
   - *UI Presentation*: Interactive lead Kanban pipeline (`inquiry` $\to$ `showing_scheduled` $\to$ `application_submitted` $\to$ `approved` $\to$ `lease_drafted`), campaign attribution analytics, and prospect inquiry modal.
   - *Forward compatibility*: `contacts` table supports `contact_type = 'prospect'`; `leases` schema reserves nullable `prospect_id` origin link.
3. **Scheduled Tenant Auto-Payments (Electronic Rails)**:
   - Tokenized tenant bank account payment methods, scheduled recurring debit mandates (`scheduled_tenant_payments`), and automated general ledger clearing journal entries.
   - *UI Presentation*: Tenant self-service portal auto-pay enrollment wizard and payment method manager.
   - *Forward compatibility*: Double-entry accounting rules map directly to `1030 Undeposited Funds` and `1010 Operating Checking`.
4. **Commercial Real Estate (CRE) & Expense Recovery**:
   - Expense recovery charges (`expense_recovery_charges`) for pass-through utilities, CAM reconciliations, and modular commercial lease clause addenda (`lease_clauses`).
   - *UI Presentation*: Annual CAM reconciliation workbook spreadsheet view and commercial lease clause builder.
5. **Client Self-Service Portal**:
   - Subdomain portal (`client.<domain>`) for property owners/investors to view portfolio net cash flow, download distribution statements, and review repair work orders.
   - *Forward compatibility*: RBAC engine and session manager admit `client` role credentials natively.
6. **SMS Dispatch & Mobile Messaging Rails**:
   - Outbound messaging rails for tenant magic links, emergency maintenance alerts, and rent balance reminders via zero-dependency webhook dispatcher.
