# Contributing to GarrisonOS

Thank you for your interest in contributing to **GarrisonOS**! We welcome community contributions to build the premier zero-dependency, open-source property management platform.

Please review this guide before submitting issues or Pull Requests. All participants are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 1. Contributor License Agreement (CLA v2) & Multi-Edition Architecture

To ensure that GarrisonOS remains legally protected and sustainable, all contributors must sign our [Contributor License Agreement (CLA v2)](docs/legal/CLA.md) before their contributions can be merged.

### Multi-Edition Architecture & Why We Require a CLA

GarrisonOS is engineered under a **Multi-Edition Architecture**:
1. **Community Edition (GNU AGPLv3)**: 100% free and open-source property management platform including all baseline capabilities developed to date.
2. **Standard Edition (GarrisonOS Fair-Code v1.0)**: The official distribution, free for production use up to 50 managed units (with a 51–60 unit grace window), requiring a paid commercial license for 61+ units and prohibiting third-party commercial SaaS hosting.
3. **Enterprise Edition (Commercial)**: Custom unit limits and air-gapped offline Ed25519 cryptographic key support for high-scale portfolios and institutions.

Under our **CLA v2**:
1. **You keep ownership** of your contributions.
2. You grant the Project Owners a perpetual, worldwide, royalty-free license to distribute your contributions across the Community Edition (GNU AGPLv3), Standard Edition (Fair-Code v1.0), and Enterprise commercial editions.
3. You grant a defensive patent license protecting the project and its users from patent litigation.

### Automated CLA Check

When you open a Pull Request, an automated **CLA Assistant** GitHub Action will check whether your GitHub account has signed the agreement. If you have not yet signed, the bot will post a comment on your PR with a link and simple instructions to agree in one click (by posting: `I have read the CLA Document and I hereby sign the CLA`).

---

## 2. Engineering Standards & Architecture Guardrails

All contributions must strictly adhere to the project's non-negotiable architectural principles:

1. **Zero External Runtime Dependencies**:
   - **Backend**: Only standard Node.js built-ins (`node:http`, `node:sqlite`, `node:crypto`, `node:async_hooks`, `node:events`, `node:fs`, `node:path`, `node:test`, `node:assert`). No npm packages at runtime. Only `@types/node` and `typescript` as build-time dev dependencies.
   - **Frontend**: Native PHP with standard extensions (`pdo_sqlite`, `curl`, `session`, `filter`) and semantic HTML5 with vanilla CSS Custom Properties. No Composer packages, Tailwind/Vite build steps, or JavaScript frameworks.
2. **Strict Multi-Tenancy**:
   - Every operational database table must include `tenant_id TEXT NOT NULL`.
   - Business logic must never accept `tenant_id` from request parameters; it must always be resolved implicitly from `RequestContext` via `AsyncLocalStorage`.
3. **Data & Identity Standards**:
   - Primary keys must be RFC 9562 **UUIDv7**.
   - Currency values must be stored strictly as **INTEGER cents**.
   - Timestamps must be stored as **INTEGER milliseconds** (UTC epoch).
   - Use `deleted_at INTEGER` for soft deletes.
4. **Code Quality & Path Hygiene**:
   - Write clean, idiomatic, human-grade code without generic boilerplate, placeholder comments, or conversational text.
   - Never hardcode host- or user-specific absolute filesystem paths (`/home/...`, `C:\Users\...`). Use `node:path` relative lookups and environment variables.
   - Follow Conventional Commits format (e.g., `feat(properties): add unit status filter`, `fix(accounting): correct delinquency grace period calculation`).
5. **Secret Scanning & Security**:
   - Never commit secrets, authentication tokens, private keys, or passwords to git history.
   - All commits and Pull Requests are scanned for exposed credentials using **[Betterleaks](https://github.com/betterleaks/betterleaks)** and our zero-dependency repository hygiene checker (`scripts/check-hygiene.js`).
   - If test fixtures or cryptographic mock data in test suites trigger false positives, record baseline exceptions in [`.betterleaksignore`](.betterleaksignore).

---

## 3. Development Workflow

### Prerequisites

- **Node.js**: v22.5.0 or newer (Node v24 LTS recommended)
- **PHP**: 8.2 or newer (with `pdo_sqlite`, `curl`, `filter`, and `session` enabled)

### Local Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/garrisonos/GarrisonOS.git
   cd GarrisonOS
   ```

2. Install compile-time dependencies:

   ```bash
   npm install
   ```

3. Run the automated preflight and setup tool:

   ```bash
   npm run setup
   # or with seed demo data:
   npm run setup -- --seed
   ```

4. Start development server (Node.js engine + PHP web frontend on <http://localhost:8080>):

   ```bash
   npm run dev
   # or with custom port:
   npm run dev -- --port=8080
   ```

---

## 4. Testing & Hygiene Requirements

All PRs introducing new modules, features, or bug fixes must include corresponding tests using the native Node.js test runner (`node:test` and `node:assert`):

- **Core Subsystem Tests**: Co-located in `test/` for core primitives, routers, crypto, and multi-tenant context.
- **Module-Packaged Tests**: Co-located within the module's `modules/[module_name]/test/` directory for repositories, routes, events, and business workflows.

```bash
# Run the full automated test suite (executes core and all module tests)
npm test
```

Tests must pass with zero failures and maintain 100% tenant isolation. All modules must package at least one automated test suite.

### Secret Scanning & Hygiene Verification

Before submitting changes, verify that no machine-specific host paths or sensitive credentials are introduced:

```bash
# Run repository hygiene and path check
npm run check:hygiene
```

On every pull request, the CI security workflow (`.github/workflows/security.yml`) executes both the hygiene checker and **Betterleaks**:

```bash
# Optional: Run Betterleaks locally if installed
betterleaks git . --gitleaks-ignore-path .betterleaksignore --exit-code 1
```

If synthetic test credentials or crypto fixtures trigger false positives, add the specific commit/file/rule signature to [`.betterleaksignore`](.betterleaksignore).

---

## 5. Submitting a Pull Request

1. Create a feature branch from `main` (`git checkout -b feat/my-new-feature`).
2. Implement your changes following all architectural guardrails.
3. Verify type correctness: `npm run build`.
4. Ensure all automated tests pass: `npm test`.
5. Verify path hygiene and secret scanning: `npm run check:hygiene`.
6. Commit your changes using conventional commit messages (`feat: ...`, `fix: ...`, `test: ...`).
7. Push to your fork and submit a Pull Request to `main`.
8. Ensure CI checks pass (including automated tests and the **Betterleaks Secret Scan**).
9. Fill out the Pull Request template checklist.
10. Sign the automated CLA when prompted by the CLA bot.

---

## 6. Attributions & Upstream Tooling

GarrisonOS leverages and attributes several key open-source tooling standards:

- **[Betterleaks](https://github.com/betterleaks/betterleaks)**: Automated secret and credential detection executed on CI for all pull requests.
- **[Contributor Covenant](https://www.contributor-covenant.org)**: Standard community Code of Conduct framework.
- **[CLA Assistant](https://cla-assistant.io/)**: Automated Contributor License Agreement signature workflow.
- **[Conventional Commits](https://www.conventionalcommits.org/)**: Commit specification standard for structured changelogs.

For the comprehensive directory of project acknowledgements and open-source attributions, see [ATTRIBUTIONS.md](ATTRIBUTIONS.md).

---

## 7. Issue & Pull Request Labels

GarrisonOS uses a structured label taxonomy to organize, prioritize, and automate issue triage and pull request lifecycles.

### Label Taxonomy

| Category | Prefix | Examples | Description |
| :--- | :--- | :--- | :--- |
| **Change Type** | `type/*` | `type/feat`, `type/fix`, `type/docs`, `type/security` | Aligned directly with Conventional Commits specifications. |
| **Subsystem Scope** | `scope/*` | `scope/core`, `scope/accounting`, `scope/api`, `scope/web` | Maps directly to modules and core architecture layers. |
| **Lifecycle Status** | `status/*` | `status/needs-review`, `status/ready-to-merge`, `status/ci-failing` | Reflects current pull request review and CI state. |
| **Issue Triage** | `triage/*` | `triage/accepted`, `triage/duplicate`, `triage/wontfix` | Indicates issue triaging decisions. |

### Automated PR Labeling & Status Tracking

GitHub Actions automatically manage labels to minimize manual overhead:

1. **Path-based Scopes & Types**: When a PR is opened, `.github/workflows/labeler.yml` inspects changed files and applies corresponding `scope/*` (e.g., `scope/accounting`) and `type/*` labels based on paths and conventional commit titles.
2. **Review Transitions**:
   - When opened or marked ready for review: `status/needs-review` is attached.
   - When opened as a draft: `status/draft` is attached.
   - When a review requests changes: `status/changes-requested` is attached.
   - When new commits are pushed after changes were requested: transitions back to `status/needs-review`.
   - When approved by a maintainer: `status/ready-to-merge` is attached.
3. **Automated CI / Check Feedback**:
   - If CI tests or security scans fail: `status/ci-failing` is attached to prevent reviewers from reviewing broken branches.
   - When checks turn green: `status/ci-failing` is automatically cleared.
4. **Merge & Completion**:
   - When merged: All operational `status/*` labels are removed and replaced with `status/merged`.
