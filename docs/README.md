# GarrisonOS Documentation

<p align="center">
  <img src="assets/logo.png" alt="GarrisonOS Logo" width="220">
</p>

Welcome to the official documentation for **GarrisonOS**, the zero-dependency, open-source property management platform engineered for independent landlords, property managers, and real estate operators.

> [!WARNING]
> **Pre-Production Disclaimer**: GarrisonOS is currently in active pre-production development. It is not ready for production environments and should not be installed by end users until the official Foundational MVP General Availability release (**v0.1.0 GA**, targeted at Sprint 5).

---

## Documentation Navigation

```text
docs/
├── assets/                # Visual identity, brand logos, favicons, OG preview card & screenshots
├── ROADMAP.md             # Phased development roadmap (Sprints 1-7) & Foundational MVP criteria
├── LLMREVIEW20260915.md   # Comprehensive architectural review, phase metrics & scorecard
├── architecture/          # Core engine design, multi-tenancy, data schemas, and blueprints
│   ├── overview.md        # System architecture, zero-dependency engine, and request lifecycle
│   ├── multi-tenancy.md   # Strict operator isolation, AsyncLocalStorage, and X-Operator-ID
│   ├── domain-models.md   # [CANONICAL] Complete relational database schemas, tables & constraints
│   ├── api-spec.md        # [CANONICAL] Complete REST API endpoints, envelopes & EventBus topics
│   ├── bootstrap-spec.md  # Foundational architectural blueprint and engineering standards
│   └── technical-debt.md  # Architecture critique, failure-mode analysis, and technical debt log
│
├── modules/               # Self-contained domain module specifications
│   ├── overview.md        # Drop-in module architecture, module.json manifest, and contracts
│   ├── properties.md      # Portfolios, properties, units, turnover state machine & custom fields
│   ├── contacts.md        # Directory of tenants, clients, vendors, and W-9 tax compliance
│   ├── leases.md          # Lease agreements, recurring charges, late fee policies & deposit refunds
│   ├── accounting.md      # Double-entry GL, trust accounting, Client Accounting, AP & check printing
│   ├── maintenance.md     # Work order triage, vendor dispatch, make-ready automation & timecards
│   └── backup.md          # Point-in-time snapshots, physical media packaging & disaster recovery
│
├── api/                   # API overview and event references
│   ├── rest-api.md        # HTTP REST conventions, headers, and response envelopes
│   └── events.md          # Asynchronous in-process EventBus topic catalog
│
├── development/           # Contributor and developer guides
│   ├── getting-started.md # Local development prerequisites, build pipeline, and running services
│   ├── frontend-guide.md  # Native TypeScript SSR presentation layer, slots, CSRF, and CSS system
│   └── testing.md         # Zero-dependency test runner standards (node:test, node:assert)
│
├── deployment/            # Production deployment and system operations
│   ├── self-hosting.md    # Production setup, Systemd service, Dockerfile, and Reverse Proxy
│   ├── configuration.md   # Environment variables and security keys reference
│   └── backup-and-maintenance.md # SQLite WAL checkpointing, vacuuming, and media archive verification
│
└── legal/                 # Legal agreements and licensing
    └── CLA.md             # Individual Contributor License Agreement (CLA)
```

---

## Quick Reference Links

* **Roadmap**: [Foundational MVP Roadmap](ROADMAP.md) | [Comprehensive Technical Review](LLMREVIEW20260915.md)
* **Canonical Specifications**: [Domain Models Specification](architecture/domain-models.md) | [REST API Specification](architecture/api-spec.md) | [Bootstrap Specification](architecture/bootstrap-spec.md)
* **Core Architecture**: [Architecture Overview](architecture/overview.md) | [Multi-Tenancy Guide](architecture/multi-tenancy.md)
* **Domain Modules**: [Accounting & AP](modules/accounting.md) | [Leasing & AR](modules/leases.md) | [Properties](modules/properties.md) | [Contacts](modules/contacts.md) | [Maintenance](modules/maintenance.md) | [Backup](modules/backup.md)
* **Developer Workflow**: [Getting Started](development/getting-started.md) | [Testing Guide](development/testing.md) | [Frontend Presentation](development/frontend-guide.md)
* **Production Operations**: [Self-Hosting Guide](deployment/self-hosting.md) | [Configuration Reference](deployment/configuration.md)
* **Brand & Media Assets**: [Brand Assets & Media Kit](../README.md#brand-assets--media-kit) | [Primary Logo](assets/logo.png) | [Navigation Mark](assets/logo-nav.png) | [Social Card](assets/og-image.png)
* **Legal & Security**: [Contributor License Agreement](legal/CLA.md) | [Security Policy](../SECURITY.md) | [Project License](../LICENSE)
