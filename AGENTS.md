# GarrisonOS Contributor & Engineering Guardrails

This document establishes the mandatory engineering standards, architectural constraints, and contribution rules for GarrisonOS. All human contributors and automated agents (GitHub Copilot, Devstral, local models, coding assistants) must strictly adhere to these rules without exception.

---

## 1. Zero External Runtime Dependencies

GarrisonOS runs exclusively on native runtimes. Do not import, install, or reference external npm or Composer packages for production execution.

### Permitted vs. Prohibited Dependency Matrix

| Domain | Allowed Standard Library | STRICTLY PROHIBITED (Do Not Import) |
| :--- | :--- | :--- |
| **HTTP Server** | `node:http` | `express`, `fastify`, `koa`, `connect` |
| **Database** | `node:sqlite` (`DatabaseSync`) | `sqlite3`, `better-sqlite3`, `drizzle-orm`, `prisma`, `typeorm` |
| **Cryptography & IDs** | `node:crypto` (`scrypt`, `randomBytes`, `timingSafeEqual`) | `uuid`, `nanoid`, `bcrypt`, `argon2`, `jsonwebtoken` |
| **Validation** | Native manual validation guards & strict equality (`===`) | `zod`, `joi`, `yup`, `validator` |
| **Configuration** | Native `process.env` & Node `--env-file` | `dotenv`, `dotenv-expand` |
| **Async Context** | `node:async_hooks` (`AsyncLocalStorage`) | Custom context managers |
| **Testing** | `node:test`, `node:assert` | `jest`, `mocha`, `chai`, `vitest`, `supertest` |
| **Frontend Presentation** | Native TypeScript SSR (`web/lib/html.ts`, `node:http`) | PHP, Composer packages, Laravel, Symfony, React, Vue, build bundlers |

* **Permitted devDependencies**: Only `typescript` and `@types/node` are permitted.
* **Portable Path Hygiene**: Never hardcode host- or user-specific absolute filesystem paths (e.g., `C:\Users\...`, `/home/user/...`). All paths must use `node:path` primitives (`path.join()`, `path.resolve()`) or standard environment variables (`STORAGE_PATH`, `SQLITE_PATH`).

---

## 2. Persistence, SQLite & PostgreSQL Forward Compatibility

### Engine & Database API

* **Runtime Database**: Embedded SQLite via Node.js built-in `node:sqlite.DatabaseSync`.
* **Synchronous API Guardrail**: `node:sqlite.DatabaseSync` is **synchronous**. Never write `await db.prepare(...)`, `await db.exec(...)`, or promise-based queries.
* Database connections must enforce operational PRAGMAs (see `database/client.ts`):

  ```sql
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
  ```

* Multi-step state mutations must execute within explicit transaction boundaries via `withTransaction(fn)` or `BEGIN IMMEDIATE`.
* **Parameterized Queries**: Raw SQL string concatenation and template literal variable interpolation are strictly prohibited. Every query must use parameterized placeholders (`?`).

### MANDATORY: PostgreSQL Forward Compatibility & Portable SQL

While GarrisonOS runs on an embedded SQLite engine for zero-dependency local execution, **all database schemas, migrations, queries, and DDL MUST be strictly forward-compatible with PostgreSQL**. The system is architected to allow dropping in a native PostgreSQL driver in the future without modifying domain queries or migration history.

Automated agents and contributors must observe these cross-dialect portability rules:

| Rule Area | Compliant (Portable & PostgreSQL-Compatible) | FORBIDDEN (SQLite-Only / Non-Portable) |
| :--- | :--- | :--- |
| **Primary Keys** | `id TEXT PRIMARY KEY` (UUIDv7 string) | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| **String Literals** | Standard ANSI single quotes: `'active'` | Double quotes (`"active"`) or backticks (`` `active` ``) |
| **Upserts** | ANSI standard: `ON CONFLICT (...) DO UPDATE / DO NOTHING` | `INSERT OR REPLACE`, `INSERT OR IGNORE` |
| **Date & Time** | UTC epoch milliseconds: `INTEGER` (via `Date.now()`) | `datetime('now')`, `strftime(...)`, `unixepoch()` |
| **Type Rigor** | Strictly adhere to declared types (`TEXT`, `INTEGER`) | Storing text in numeric columns (SQLite dynamic affinity bypass) |
| **Booleans** | `INTEGER NOT NULL DEFAULT 0 CHECK (col IN (0, 1))` | Unconstrained integers or dialect-specific boolean keywords |
| **JSON Fields** | Stored as `TEXT`; parsed/serialized in application layer | Native dialect-specific JSON query functions |
| **Partial Indexes** | ANSI partial index syntax: `WHERE deleted_at IS NULL` | Non-standard index expressions |

### Row-Level Operator Isolation (Multi-Operator Architecture)

* **Separation of Architectural vs. Domain Concepts**:
  * **Operator (Software System Multi-Tenancy)**: The property management firm, owner-operator, or managing entity isolation boundary. Operational tables use `operator_id TEXT NOT NULL REFERENCES operators(id)`.
  * **Tenant (Real Estate Domain Entity)**: Renters, leaseholders, residents, or occupants of properties. They are represented within modules (e.g., `contact_type = 'tenant'`, `role = 'primary_tenant'`, `calculateTenantBalance()`, Tenant Ledgers).
  * **Organization**: Reserved for commercial real estate entities (future roadmap).
* Every operational database table must contain an `operator_id TEXT NOT NULL REFERENCES operators(id)` (with `tenant_id` retained where appropriate for backward compatibility).
* Compound indexes supporting queries must lead with `operator_id` (e.g., `CREATE INDEX idx_orders_operator_created ON orders(operator_id, created_at);`).
* **Zero Parameter Leakage**: Business logic, repositories, and routes must **NEVER** accept `operator_id` or `tenant_id` from client request bodies, query parameters, or URL route parameters.
* Always extract operator context implicitly from `RequestContext.getOperatorId()` (see `core/context.ts`):

  ```typescript
  // CORRECT:
  const operatorId = RequestContext.getOperatorId();
  const stmt = db.prepare('SELECT * FROM properties WHERE operator_id = ? AND id = ? AND deleted_at IS NULL');
  const property = stmt.get(operatorId, propertyId);

  // FORBIDDEN:
  // app.get('/api/properties/:operator_id') <-- NEVER put operator_id in routes or request payloads
  ```

### Data Representation Standards

* **Primary Keys**: RFC 9562 UUIDv7 strings generated natively via `node:crypto.randomBytes`. Always import `generateUUIDv7` from `core/crypto.ts`.
* **Financial Amounts**: Stored strictly as **INTEGER cents** (e.g., $1,250.00 is stored as `125000`). Floating-point currency math is prohibited. Ledger transactions are append-only and immutable.
* **Timestamps**: Stored strictly as **INTEGER milliseconds** (UTC epoch ms via `Date.now()`).
* **Soft Deletes**: Standardized `deleted_at INTEGER` column on all operational tables (`NULL` when active, epoch ms when deleted). All operational queries must filter `WHERE deleted_at IS NULL` by default.

### Schema Migrations

* Migrations reside in `modules/<module_name>/backend/migrations/` (or `database/migrations/` for core) and are named sequentially: `0001_<description>.sql`, `0002_<description>.sql`.
* All schema evolution must be **additive and backward-compatible** (new tables or nullable columns only). Renaming, removing, or altering the types of existing columns is prohibited without a documented backward-compatible migration path.

---

## 3. Modular Architecture & REST API Contracts

### Module Isolation

* Domain features live inside self-contained modules under `modules/<module_name>/` with dedicated `backend/`, `frontend/`, and `test/` subdirectories.
* Every module must provide a `module.json` manifest defining its metadata, routes, permissions, and dependencies.
* **Mandatory Edition Tagging**: Every `module.json` must explicitly declare `"edition": "community" | "commercial" | "enterprise"` and `"license": "AGPL-3.0-or-later" | "GarrisonOS-Fair-Code-1.0"`.
* **Agent Edition Clarification Mandate**: When introducing new capabilities, automated agents must explicitly verify the target edition. If user requirements are ambiguous about whether a capability belongs in Community, Standard, or Enterprise, agents MUST ask for clarification before writing code.
* **High-Granularity Modular Design**: To maintain clean edition boundaries without code entanglement, commercial or enterprise capabilities must never be hardcoded directly into baseline community modules. Instead:
  - Implement enterprise capabilities as **separate companion modules** (e.g. `modules/accounting_compliance/`).
  - Use **UI Slots** (`slots` in `module.json`) for presentation extension points so commercial tabs and metrics do not pollute Community templates.
  - Rely on the asynchronous `EventBus` (`core/events.ts`) for state synchronization across modules.
* **Zero Cross-Module Direct Imports**: Modules must never import directly from another module's internal implementation files.
* **Zero Cross-License Extraction**: Agents and contributors must never extract, backport, or relicense code from Fair-Code or Enterprise modules into the Community Edition or any open-source fork.
* **Handler Resilience**: All `EventBus` listeners must wrap their execution in `try/catch` blocks to ensure background failures do not crash the process or interrupt the request flow.

### Standardized REST API Envelopes

All API endpoints must return structured JSON envelopes conforming to `api/response.ts`:

```typescript
// Single entity or operation success (HTTP 200/201):
{
  "success": true,
  "data": { "id": "018f...", "name": "Sunset Apartments" }
}

// Paginated collection success (HTTP 200):
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "total": 120,
    "page": 1,
    "limit": 50
  }
}

// Error response (HTTP 4xx/5xx):
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Monthly rent must be a positive integer in cents",
    "details": [ ... ]
  }
}
```

* Use `successResponse(res, data, statusCode, meta)` and `errorResponse(res, code, message, statusCode)` from `api/response.ts`.
* Internal database driver errors, SQL statements, and stack traces must **NEVER** be leaked in HTTP responses.
* Enforce **strict equality** (`===` / `!==`) across all TypeScript code. Loose equality is prohibited.

---

## 4. Security & TypeScript Web Presentation

### Cryptography & Engine Isolation

* **Password Hashing**: Native `node:crypto.scrypt` with a random 16-byte salt, formatted as `$scrypt$N=16384,r=8,p=1$salt$hash`. Verification must use `node:crypto.timingSafeEqual` (use `hashPassword` and `verifyPassword` from `core/crypto.ts`).
* **Auth Tokens**: Signed HMAC-SHA256 tokens using native `node:crypto` (use `createToken` and `verifyToken` from `core/crypto.ts`).
* **Network & Loopback Binding**: The Node.js engine must bind strictly to `127.0.0.1` (loopback). Direct untrusted external network exposure is forbidden.
* **Edition Telemetry Invariants & Privacy**:
  - **Community Edition**: Operates strictly offline-first with **Zero Outbound Telemetry** by default. Network calls are permitted strictly when the operator opts in to the Value-Exchange feature (receiving real-time security bulletins and automated update notifications).
  - **Standard Edition**: The daily heartbeat ping is restricted to system metadata (`instance_id`, `version`, `active_unit_count`, `license_key_hash`). **Zero Tenant PII, bank details, or financial ledger data may EVER be transmitted in telemetry.**
  - **Enterprise Edition**: Must remain 100% functional in completely air-gapped environments without network access via Ed25519 offline license keys.
* **File Uploads & Media Storage**: Uploaded files must be stored outside the web root (`STORAGE_PATH`), validate explicit allowed MIME/extension whitelists, enforce byte size limits, and validate resolved paths against directory traversal attacks via `path.resolve()`.

### Safe TypeScript Web Presentation

* **XSS Prevention**: All dynamic values rendered in HTML templates must be escaped automatically using the tagged template `html` function from `web/lib/html.ts`:

  ```typescript
  html`<div>${userProvidedString}</div>`
  ```

  Use `raw()` only for verified trusted HTML fragments.

* **CSRF Protection**: All state-modifying requests (POST, PUT, DELETE) from the presentation layer must validate a cryptographic CSRF token stored in the HMAC-signed cookie session via `validateCsrf()` using `node:crypto.timingSafeEqual`.
* **Strict CSP**: Inline dynamic scripts and unvalidated DOM injections (`innerHTML`, `eval()`) are forbidden.
* **Zero External Dependencies**: The presentation layer executes natively on Node.js standard libraries (`node:http`, `node:crypto`, `node:fs`, `node:path`) with zero runtime npm packages, bundlers, or CSS preprocessors.

---

## 5. Contributor Workflow, Testing & Attribution

### Windows Terminal Execution Guardrail

When running terminal commands on Windows host environments:

* **NEVER** invoke bare `npm` or `npx` (causes `PSSecurityException` on `npm.ps1`).
* **ALWAYS** execute `npm.cmd`, `npx.cmd`, or `node <script>`:

  ```powershell
  # CORRECT:
  node scripts/test.js
  npm.cmd test
  npm.cmd run build

  # FORBIDDEN (Will fail on Windows):
  # npm test
  # npx tsc
  ```

### Targeted Test Execution

* **No Proactive Runs**: Do not proactively execute builds or test suites when modifying documentation (`*.md`), IDE settings, CI workflows, or static assets.
* **Single Module Changes**: Run only that module's test suite:

  ```powershell
  node scripts/test.js <module_name>
  # or: npm.cmd run test:module <module_name>
  ```

* **Core Subsystem Changes**: When modifying `core/`, `api/`, or `database/`, execute core tests:

  ```powershell
  node scripts/test.js core
  ```

* **Full Regression**: Execute full regression (`node scripts/test.js` or `npm.cmd test`) only before submitting a pull request or when modifying root compilation configurations.
* **Co-located Tests**: Every new module or capability must include automated tests co-located under `modules/<module_name>/test/` achieving full coverage of its public APIs.

### Attribution, Commits & Documentation Hygiene

* **No Agent or AI Attribution**: Contributors and automated agents must **NEVER** reference themselves or identify AI/LLM involvement anywhere in the repository (no "Generated by", no agent names, no LLM co-authors or provenance comments).
* **100% Docstring Coverage**: Every exported function, interface, class, method, module, and PHP public API must include complete docstrings (TSDoc/PHPDoc).
* **Conventional Commits**: Commit messages must follow the Conventional Commits specification with concise 50–72 character summaries:
  * `feat(scope): add new capability`
  * `fix(scope): resolve issue`
  * `test(scope): add test coverage`
  * `refactor(scope): streamline implementation`
* **Atomic Commits**: Keep commits focused and granular. Do not bundle unrelated features, refactors, or documentation into a single commit.
* **Code-Documentation Atomicity**: Any change to source code, schemas, APIs, module manifests, or configuration must be accompanied by corresponding updates to documentation under `docs/` and `CHANGELOG.md` within the same pull request.

---

## 6. Security Blast Radius & Defensive Engineering Guardrails

All contributors and automated agents must proactively anticipate, calculate, and mitigate the blast radius of every change. Changes must never introduce unverified assumptions into downstream callers or leave ingress attack vectors unshielded.

### 6.1 Downstream Blast Radius Mapping

Before modifying or introducing any service method, repository function, or public API:

* **Trace Callers & Dependents**: Use grep/ripgrep across `api/`, `core/`, `database/`, and `modules/` to identify all direct and indirect consumers of modified types, methods, or database tables.
* **Context Assumption Audit**: When reading `RequestContext.getTenantId()`, verify that every route leading to this execution is protected by authentication and tenant-membership verification. Never assume an endpoint is internal or pre-authenticated without explicit route-level guards.
* **Downstream Regression Testing**: When modifying core utilities (`core/context.ts`, `core/crypto.ts`, `database/client.ts`, `api/response.ts`), run all dependent module test suites (`node scripts/test.js <module_name>`), not just unit tests for the modified file.

### 6.2 Ingress Route Security & Zero-Trust Parameter Parsing

* **Mandatory Route Authentication**: All operational API routes must require an authenticated session and verified tenant membership. Unauthenticated public endpoints must be strictly limited to public system handshakes (`/health`, `/ready`, `/api/v1/auth/*`, `/api/v1/system/setup`, `/api/v1/system/restore`).
* **Strict Numeric Query Parsing**: Never pass raw `parseInt(req.query.param, 10)` into repository methods or SQL queries. All numeric query parameters must be validated with `Number.isInteger()` or `Number.isFinite()`, bounded to valid ranges, and return HTTP 400 `VALIDATION_ERROR` on failure:

  ```typescript
  // CORRECT:
  const rawAsOf = req.query['as_of'];
  let asOfDateMs: number | undefined;
  if (rawAsOf !== undefined) {
    const parsed = Number(rawAsOf);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Query parameter "as_of" must be a positive integer millisecond timestamp', 400);
    }
    asOfDateMs = parsed;
  }

  // FORBIDDEN (Propagates NaN into SQL or produces corrupt reports):
  // const asOf = req.query.as_of ? parseInt(req.query.as_of, 10) : undefined;
  ```

* **No NaN Propagation**: Numerical arguments must never evaluate to `NaN` when executing repository logic or SQL queries.

### 6.3 Fail-Closed Security & Infrastructure Invariants

* **Zero Fail-Open Logic**: Any security check (cryptographic checksum, HMAC token verification, signature comparison, permission check) **MUST FAIL CLOSED**.
* **Installer & Script Integrity**:
  * Checksum and signature verification in shell/PowerShell installers (`scripts/install.sh`, `scripts/install.ps1`) must be mandatory.
  * If a checksum file is missing, empty, malformed, or if required hashing utilities (`sha256sum`, `shasum`, `Get-FileHash`) are unavailable on the host, the script must immediately abort execution with a non-zero exit code (`exit 1` / `throw`).
  * Never silently proceed with extracting or running unverified release archives.
  * Archive asset filenames must match their corresponding entry in `SHA256SUMS` exactly; never verify GitHub's dynamic `tarball_url` against release binary checksums.

### 6.4 Financial & Accounting Audit Invariants

* **Temporal Cutoff Rigor**: Any report or reconciliation taking an `asOf` cutoff timestamp must strictly filter all joins, subledgers, transactions, and lease states to `<= asOf`. Combining historical general ledger balances with unbounded current-state subledgers is strictly prohibited.
* **Reversal Exclusion**: All financial aggregations, tax reports (e.g., Form 1099-NEC), and ledger inquiries must explicitly exclude reversed entries (`WHERE reversed_by_entry_id IS NULL` and `WHERE reversed_at IS NULL`).
* **Empirical Audit Truth**: Never declare "three-way bank reconciliation" or "statutory compliance" in APIs, responses, or documentation unless the implementation ingests and verifies against empirical external data (e.g. bank statements) and validates specific statutory jurisdictions rather than generic unverified fallbacks.

### 6.5 Pre-Commit Security Blast Radius Checklist

Before submitting any pull request or committing changes, contributors and agents must verify:

1. `npm.cmd run build` — TypeScript compiles with 0 errors.
2. `node scripts/check-hygiene.js` — Scanned files reveal 0 host path leaks or exposed secrets.
3. `node scripts/check-security.js` — Route parameters, fail-closed scripts, and security invariants verified.
4. `node scripts/test.js` — All unit and integration test suites pass with 100% success rate.

---

## 7. Agent Tool & Context Hygiene Directives

To safeguard context windows and maintain fast, reliable execution:

1. **Tool Slicing Mandate**: Agents must use `StartLine` and `EndLine` on `view_file` to read only the pertinent 50–120 lines. Dumping entire files larger than 100 lines into context is prohibited.
2. **Mechanical Verification First**: Run `npm.cmd run check:hygiene` and `npm.cmd test` rather than reading raw files to inspect whole-repo compliance.
