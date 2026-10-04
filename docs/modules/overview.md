# Drop-in Module Architecture

GarrisonOS organizes all domain capabilities into self-contained modules located under `modules/[module_name]/`.

---

## 1. Module Structure Contract

Each module encapsulates its complete vertical slice:

```text
modules/[module_name]/
├── module.json                # Module manifest & UI slot registrations
├── backend/
│   ├── migrations/            # SQL DDL migrations (e.g. 0001_module_name.sql)
│   ├── routes.ts              # REST API endpoint definitions & handlers
│   ├── events.ts              # EventBus subscriber registrations
│   └── repository.ts          # Data access layer & SQL queries
├── frontend/
│   ├── hooks.ts               # Nav menu items, dashboard cards & detail tabs
│   └── pages/                 # Pure TypeScript SSR view templates (web/lib/html.ts)
└── test/
    └── [module_name].test.ts  # Co-located unit and integration test suite
```

---

## 2. Module Manifest (`module.json`)

The manifest declares the module identity, UI slots, and dependencies. The application version is sourced from the repository root `VERSION` file and injected by the module loader:

```json
{
  "id": "accounting",
  "name": "Accounting & Financials",
  "description": "Double-entry trust ledger, Client Accounting, Accounts Payable, billing cycles, IRS Schedule E, and 3-way reconciliation.",
  "navigation": [
    {
      "label": "Accounting",
      "route": "/accounting",
      "icon": "banknote",
      "order": 40,
      "section": "core"
    }
  ],
  "slots": [
    "dashboard.metrics",
    "lease.details.tabs"
  ],
  "dependencies": [
    "properties",
    "contacts",
    "leases"
  ]
}
```

---

## 3. Dynamic Module Discovery & Lifecycle

On startup, `core/module-loader.ts` discovers and initializes modules through the following stages:

1. **Manifest Parsing**: Reads and validates `module.json`.
2. **Topological Migration**: Discovers all SQL migration scripts in `backend/migrations/` and executes unapplied migrations in topological dependency order.
3. **Route Mounting**: Calls `registerRoutes(router)` to mount REST endpoints under `/api/v1/[module_name]`.
4. **Event Registration**: Calls `registerSubscribers(eventBus)` to attach listeners for cross-module events.
5. **UI Aggregation**: Pure TypeScript SSR framework (`web/lib/hook-registry.ts`) discovers navigation menus and composite dashboard widgets.

---

## 4. Module Inventory & Near-Term Roadmap Capabilities

For complete entity schemas and REST API endpoint specifications, refer to:

- [Domain Models Specification](../architecture/domain-models.md)
- [API Specification](../architecture/api-spec.md)

| Module | Core Responsibility | Current Status | Roadmap Deliverables & Horizons |
| :--- | :--- | :--- | :--- |
| **`accounting`** | Fiduciary & Operational Financials | Active (Core) | Accounts Payable, check printing, deposits; Tier 1 Core Reports (Rent Roll, P&L, GL Detail, Delinquency Aging in Sprint 6); Tier 2–4 reports; electronic payments & NACHA rails (Sprint 9). |
| **`attachments`** | Universal Media & Document Safety | Active (Core) | Universal polymorphic attachments, EXIF metadata stripping, PDF script sanitization, storage quotas. |
| **`backup`** | Data Portability & Disaster Recovery | Active (Core) | Hot SQLite snapshots, automated `BackupScheduler` daemon, vacuuming, unified `.tar.gz` media backups. |
| **`contacts`** | Directory & Tax Compliance | Active (Core) | Multi-role directory (tenants, owners, vendors), trade classifications, visual W-9 compliance badges. |
| **`conversations`** | Polymorphic Threaded Notes | Active (Core) | Universal threaded conversation messages across properties, units, leases, work orders, contacts. |
| **`leases`** | Rental Contracts & Receivables | Active (Core) | Multi-party signatories, renewals, terminations, itemized recurring charges, late fee policies, credits; eSign (Sprint 8); Section 8 (Sprint 9). |
| **`maintenance`** | Maintenance & Work Orders | Active (Core) | Work order lifecycle, priority triage, vendor dispatch, spend thresholds, linked AP bills; checklists & timecards (Sprint 6); capital projects (Sprint 7). |
| **`properties`** | Physical & Organizational Inventory | Active (Core) | Portfolios, properties, buildings, units, turnover state machine, amenities catalog, custom fields; parking & rentable assets (Sprint 7). |
| **`importer`** | Self-Service Data Migration | Planned (Sprint 6 Core) | Universal CSV/Excel pre-import validator, entity mappers, and opening balance GL journal importer. |
| **`inspections`** | Move-In/Out Condition Audits | Planned (Sprint 7 Core) | Mobile-first walk-through condition inspections, photo logs, tenant counter-signing, turnover automation. |
| **`prospects`** | Lead-to-Lease CRM & Marketing | Planned (Sprint 8 Core) | Inquiring lead capture, campaign source attribution, interactive Kanban pipeline, showing tour scheduler. |
| **`plugins/*`** | External Integrations & Extensions | Planned (Post-1.0 Horizons) | Dedicated platform syndication (Zillow, Apartments.com, Realtor.com), screening, telephony, AI OCR, IoT locks. |

---

## 5. Architectural Invariants

1. **Zero Cross-Module Direct Imports**: Modules must never import directly from another module's internal files.
2. **Asynchronous Cross-Module Communication**: All inter-module communication must use the in-process `EventBus` (`core/events.ts`).
3. **Resilient Event Listeners**: All event subscribers must wrap their handlers in `try/catch` blocks to protect background execution flows.
4. **Zero External Runtime Dependencies**: All core modules execute strictly on Node.js standard libraries (`node:http`, `node:sqlite`, `node:crypto`, `node:fs`, `node:path`). External third-party integrations belong exclusively in `plugins/`.
