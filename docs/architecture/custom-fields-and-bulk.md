# Dynamic Custom Fields, Bulk Ingestion & Temporal Query Engine

GarrisonOS provides core engine enhancements supporting user-defined custom metadata, high-volume transactional bulk ingestion, and standardized temporal/sorting query parameters across all domain modules.

---

## 1. Dynamic Custom Fields Engine

The Custom Fields Engine enables property management firms and owner-operators to define arbitrary typed metadata fields on core operational entities without requiring database schema alterations or migrations.

### 1.1 Supported Entity Domains

Custom fields can be defined on the following entity types:
* `property`: Parcels, developments, and community campuses.
* `building`: Physical structures or residential towers within a property.
* `unit`: Individual living or commercial spaces.
* `lease`: Residential and commercial tenancy contracts.
* `contact`: Tenants, owners, vendors, and applicants.
* `work_order`: Maintenance tasks and service requests.

### 1.2 Schema Definition Table (`custom_field_definitions`)

Field definitions are operator-isolated and forward-compatible with PostgreSQL:

```sql
CREATE TABLE custom_field_definitions (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id),
  entity_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  data_type TEXT NOT NULL,
  options_json TEXT,
  is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CONSTRAINT uq_custom_field_operator_entity_name UNIQUE (operator_id, entity_type, field_name)
);
```

### 1.3 Data Types and Strict Validation Rules

| Data Type | Description | Strict Validation Rules |
| :--- | :--- | :--- |
| `string` | Freeform text value | Non-empty string; trimmed; strips null bytes. |
| `number` | Numeric metric or measurement | Must parse to a finite floating-point or integer number; rejects `NaN` and `Infinity`. |
| `boolean` | Binary flag | Normalized to boolean `true`/`false`. |
| `date` | Strict calendar date | Must strictly conform to Gregorian `YYYY-MM-DD`. Rejects invalid calendar days (e.g. `2026-02-31`, `2026-04-31`), enforces leap year validity (`2024-02-29` allowed; `2025-02-29` and `2100-02-29` rejected). |
| `select` | Single-choice enum from fixed set | Must match one of the pre-configured options stored in `options_json`. |

### 1.4 REST API Endpoints

* `GET /api/v1/custom_fields/definitions?entity_type=<type>`: List active definitions for an entity type.
* `POST /api/v1/custom_fields/definitions`: Create a new field definition.
* `GET /api/v1/custom_fields/definitions/:id`: Retrieve definition details.
* `PUT /api/v1/custom_fields/definitions/:id`: Update label, required status, or select options.
* `DELETE /api/v1/custom_fields/definitions/:id`: Soft-delete a definition.
* `PUT /api/v1/:entity_type/:id/custom_fields`: Atomically validate and update an entity's custom fields.

---

## 2. Standardized High-Volume Bulk Ingestion Engine

To support rapid onboarding and automated portfolio migration from legacy property management platforms, GarrisonOS offers standardized bulk ingestion.

### 2.1 Supported Bulk Endpoints

* `POST /api/v1/:resource/bulk` (where `:resource` is `amenities`, `properties`, `buildings`, `units`, `contacts`, `leases`, or `work_orders`).
* `POST /api/v1/properties/units/bulk`: Dedicated alias for unit batch imports.

### 2.2 Invariant: All-or-Nothing Transactional Rollback

Bulk ingestion enforces strict transactional atomicity. If a single item in a batch violates validation guards, unique constraints, foreign key references, or custom field schemas:
1. The entire database transaction is immediately aborted and rolled back.
2. Zero records from the batch are persisted in the database.
3. An HTTP 400 error envelope is returned identifying the exact item index and reason for failure.

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Bulk ingestion failed; all changes rolled back",
    "details": [
      {
        "index": 4,
        "code": "VALIDATION_ERROR",
        "message": "Custom field \"License Number\" (license_number) is required"
      }
    ]
  }
}
```

### 2.3 Batch Constraints

* **Payload Bounding**: Batches must contain between 1 and 100 items. Requests exceeding 100 items are rejected with HTTP 400.
* **Payload Envelopes**: Accepts array bodies (`[ ... ]`), `{ "items": [ ... ] }`, `{ "records": [ ... ] }`, or `{ "<resource>": [ ... ] }`.

---

## 3. Universal Temporal Query Filtering & Multi-Key Sorting

Universal query parameters provide uniform filtering and sorting across all collection endpoints.

### 3.1 Temporal Bounding (`*_start` and `*_end`)

Endpoints accepting date or timestamp queries parse `*_start` and `*_end` filters:
* Must be non-negative integer millisecond timestamps (`Date.now()`).
* Floats, negative values, and non-numeric strings trigger immediate HTTP 400 `VALIDATION_ERROR`.
* Enforces `*_start <= *_end`; inverted intervals are rejected fail-closed.

### 3.2 Multi-Key `order_by` Sorting

Endpoints accept structured multi-column sorting:
* Format: `order_by=field1:asc,field2:desc` (direction defaults to `ASC` if omitted).
* **Column Whitelisting**: Every requested column is strictly validated against a permitted whitelist for that resource. Unwhitelisted columns or injection tokens (e.g. `DROP`, `SLEEP`, `UNION`) immediately return HTTP 400.
* **Table Alias Qualification**: The query parser qualifies column names with table aliases (e.g. `w.created_at`) when executing multi-table joins to prevent ambiguous column errors.
