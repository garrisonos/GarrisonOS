# Zero-Dependency REST API Reference

The GarrisonOS REST API is exposed by the headless Node.js backend (`api/server.ts`) listening by default on `http://127.0.0.1:3000`.

---

## 1. Request Headers & Operator Identity Resolution

| Header | Required | Description |
| :--- | :--- | :--- |
| `X-Operator-ID` | Conditional | UUIDv7 of the active operator context for operational routes |
| `Authorization` | Optional | `Bearer <signed_hmac_token>` for authenticated endpoints |
| `X-Request-ID` | Optional | Client correlation ID (generated automatically if omitted) |
| `Content-Type` | Optional | `application/json` for state-modifying requests |
| `Origin` | Optional | Must match an origin in `CORS_ALLOWED_ORIGINS` for browser cross-origin access |

### Operator Resolution Rules
1. **Header Resolution**: When inspecting request headers, `X-Operator-ID` establishes operator identity for operational endpoints.
2. **Token Fallback**: If `X-Operator-ID` is not provided in headers, non-batch operational endpoints resolve operator identity from the verified Bearer token's `opid` claim.
3. **Mismatch Enforcement**: If an operator header is provided alongside a Bearer token, the header identity and token claim must agree. Mismatches return `401 UNAUTHORIZED`.
4. **Missing Operator**: If no operator identity can be resolved on non-public endpoints, the server returns `400 OPERATOR_REQUIRED`.
5. **Batch Processing**: `/api/v1/batch` strictly ignores `X-Operator-ID` header; operator and user identities are derived exclusively from the verified Bearer token.

---

## 2. Response Envelopes

All JSON responses conform to standardized envelopes:

### Success Response (`HTTP 200 / 201`)

```json
{
  "success": true,
  "data": {
    "id": "018d9f4e-28b3-7a91-91bc-0a75bc89a712",
    "name": "Oakwood Apartments"
  },
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 25
  }
}
```

### Error Response (`HTTP 4xx / 5xx`)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The provided payload contains invalid or missing fields.",
    "details": [
      { "field": "amount_cents", "issue": "Must be a positive integer" }
    ]
  }
}
```

### Error Codes

* `OPERATOR_REQUIRED` (`400`)
* `VALIDATION_ERROR` (`400`)
* `UNAUTHORIZED` (`401`)
* `FORBIDDEN` (`403`)
* `PERMISSION_DENIED` (`403`)
* `NOT_FOUND` (`404`)
* `CONFLICT` (`409`)
* `QUOTA_EXCEEDED` (`413`)
* `RATE_LIMITED` (`429`)
* `INTERNAL_ERROR` (`500`)

---

## 3. Core System Endpoints

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Public | Liveness check returning status and uptime |
| `GET` | `/ready` | Public | Readiness check verifying SQLite database connectivity |
| `POST` | `/api/v1/auth/login` | Public (Rate Limited) | Authenticate user credentials and return signed HMAC token with `opid` |
| `POST` | `/api/v1/system/setup` | Public | Initial system bootstrap supporting `setup_mode` (`single` or `multi`), provisioning owner account and optional demo building/units |
| `GET` | `/api/v1/system/operators` | Platform Owner / Manager | List all tenant operators across the platform instance |
| `POST` | `/api/v1/system/operators` | Admin / System Secret | Provision a new operator and owner user with configurable storage quota, seeding Chart of Accounts |
| `PUT` | `/api/v1/system/operators/:id` | Platform Owner / Manager | Update operator name, storage quota, or configuration |
| `DELETE` | `/api/v1/system/operators/:id` | Platform Owner | Soft delete operator and associated operator users |
| `GET` | `/api/v1/system/managers` | Platform Owner | List platform administrator managers ("minions of the owner") |
| `POST` | `/api/v1/system/managers` | Platform Owner | Provision a platform system manager with platform-wide administrative visibility |
| `DELETE` | `/api/v1/system/managers/:id` | Platform Owner | Soft delete a platform system manager |
| `POST` | `/api/v1/system/restore` | Public (Unconfigured) | Disaster recovery restoring SQLite database and physical media attachments from `.tar.gz` archive |
| `POST` | `/api/v1/batch` | Authenticated | Execute up to 10 authenticated `GET` requests concurrently. Operator and user identity come only from the verified bearer token; each response is indexed as `response_N`. Non-JSON responses return `NON_JSON_RESPONSE` for that item without failing the complete batch. |
| `GET` | `/api/v1/system/backup` | Admin | Trigger WAL checkpoint and create database snapshot |

---

## 4. Module & Subsystem Endpoint Directory

### User & Subuser Management (Operator Level)

* `GET /api/v1/users`: List team members and subusers for the authenticated operator
* `POST /api/v1/users`: Provision a subuser (e.g. `leasing_agent`, `assistant`, `maintenance`) with configurable `allowed_modules` and `allowed_portfolios`
* `GET /api/v1/users/:id`: Get subuser profile with module and portfolio permissions
* `PUT /api/v1/users/:id`: Update subuser profile, role, password, `allowed_modules`, or `allowed_portfolios`
* `DELETE /api/v1/users/:id`: Soft delete subuser (prevents deletion of the last owner)

### Universal Attachments

* `GET /api/v1/attachments`: List attachments with polymorphic entity filters (`entity_type`, `entity_id`) and pagination (`limit`, `offset`)
* `POST /api/v1/attachments`: Upload attachment (multipart/form-data with `file`, `entity_type`, `entity_id`, optional `description`), performs automatic EXIF stripping, PDF sanitization, and quota verification
* `GET /api/v1/attachments/:id`: Get attachment metadata
* `GET /api/v1/attachments/:id/download`: Stream sanitized binary attachment file
* `DELETE /api/v1/attachments/:id`: Soft delete attachment record and remove physical file from disk

### Properties, Buildings, Units & Amenities (4-Tier Asset Hierarchy)

* `GET /api/v1/properties`: List properties with portfolio, status, and syndication filters
* `POST /api/v1/properties`: Create property
* `GET /api/v1/properties/:id`: Get property with units and associated buildings
* `PUT /api/v1/properties/:id`: Update property terms, marketing attributes, and pet policies
* `DELETE /api/v1/properties/:id`: Soft delete property
* `GET /api/v1/properties/:id/buildings`: List buildings in a property
* `POST /api/v1/properties/:id/buildings`: Create building within a property (`name`, `building_number`, `floors`, `notes`)
* `GET /api/v1/buildings/:id`: Get building details
* `PUT /api/v1/buildings/:id`: Update building
* `DELETE /api/v1/buildings/:id`: Soft delete building
* `POST /api/v1/properties/:id/units`: Create unit under property (supports optional `building_id`)
* `GET /api/v1/properties/units/:unit_id`: Get unit details including `building_id`
* `PUT /api/v1/properties/units/:unit_id`: Update unit details including `building_id`
* `GET /api/v1/amenities`: List standardized amenities catalog (`category` filter)
* `POST /api/v1/amenities`: Create an operator-scoped amenity definition (names are unique per operator)
* `PUT /api/v1/amenities/:id`: Update amenity name/category/description
* `DELETE /api/v1/amenities/:id`: Soft delete amenity
* `GET /api/v1/properties/:id/amenities`: Get assigned amenities for a property parcel
* `PUT /api/v1/properties/:id/amenities`: Replace/sync assigned amenities for a property parcel
* `GET /api/v1/properties/units/:unit_id/amenities`: Get assigned amenities for an individual unit
* `PUT /api/v1/properties/units/:unit_id/amenities`: Replace/sync assigned amenities for an individual unit

### Contacts & Vendors

* `GET /api/v1/contacts`: Query contacts with role, trade, insurance, and search filters
* `POST /api/v1/contacts`: Create contact (tenant, client, vendor, emergency contact)
* `GET /api/v1/contacts/:id`: Contact details, linked entities, insurance compliance, and default billing terms
* `PUT /api/v1/contacts/:id`: Update contact details, default GL accounts, and payment terms
* `DELETE /api/v1/contacts/:id`: Soft delete contact

### Leases & Receivables (AR)

* `GET /api/v1/leases`: List leases with status, delinquency, and unit filters
* `POST /api/v1/leases`: Create lease with signatories and financial terms
* `GET /api/v1/leases/:id`: Get lease details, signatories, and active recurring charge schedule
* `PUT /api/v1/leases/:id`: Update lease terms
* `POST /api/v1/leases/:id/signatories`: Add signatory
* `POST /api/v1/leases/:id/renew`: Execute lease extension/renewal
* `POST /api/v1/leases/:id/terminate`: Issue notice to vacate and set move-out date
* `GET /api/v1/leases/:id/recurring_charges`: List active recurring charge line items
* `POST /api/v1/leases/:id/recurring_charges`: Create recurring charge (pet rent, parking, utilities)
* `DELETE /api/v1/leases/:id/recurring_charges/:charge_id`: Soft delete recurring charge
* `GET /api/v1/leases/:id/credits`: List discounts, rent concessions, and adjustments
* `POST /api/v1/leases/:id/credits`: Post promotional concession or tenant credit adjustment
* `GET /api/v1/leases/:id/clauses`: List custom lease clauses and legal addenda
* `POST /api/v1/leases/:id/clauses`: Attach custom lease clause
* `PUT /api/v1/leases/:id/clauses/:clause_id`: Update clause title, text, or sort order
* `DELETE /api/v1/leases/:id/clauses/:clause_id`: Remove custom lease clause

### Accounting, Accounts Payable (AP) & Banking

* `GET /api/v1/accounting/transactions`: List financial transactions
* `POST /api/v1/accounting/transactions`: Record charge, payment, or expense
* `GET /api/v1/accounting/ledger/:lease_id`: Calculate running balance
* `POST /api/v1/accounting/generate-rent-charges`: Trigger monthly recurring rent billing run
* `POST /api/v1/accounting/deposit-disposition`: Settle move-out security deposit
* `GET /api/v1/accounting/export/rent-roll.csv`: Stream Rent Roll CSV
* `GET /api/v1/accounting/export/schedule-e.csv`: Stream Schedule E CSV
* `GET /api/v1/accounting/export/ledger/:lease_id.csv`: Stream Ledger Statement CSV
* `GET /api/v1/accounting/chart-of-accounts`: List Chart of Accounts
* `POST /api/v1/accounting/chart-of-accounts`: Create general ledger account
* `PUT /api/v1/accounting/chart-of-accounts/:id`: Update general ledger account
* `GET /api/v1/accounting/quickbooks/preview`: Preview balanced double-entry journal entries
* `GET /api/v1/accounting/export/quickbooks/qbo-journal.csv`: Export QuickBooks Online Journal Entry batch CSV
* `GET /api/v1/accounting/export/quickbooks/desktop.iif`: Export QuickBooks Desktop IIF format
* `GET /api/v1/accounting/reconciliation/three-way`: Statutory Three-Way Bank Reconciliation report
* `GET /api/v1/accounting/reports/1099-nec`: Annual IRS Form 1099-NEC vendor expense summary report
* `GET /api/v1/accounting/disposition/timeline`: Statutory move-out deposit deduction deadline schedule
* `GET /api/v1/accounting/export/quickbooks/bank-feed.qbo`: Export Web Connect (.QBO) bank feed
* `GET /api/v1/accounting/bills`: List vendor bills with approval and settlement status
* `POST /api/v1/accounting/bills`: Create vendor bill with split property/unit allocations
* `GET /api/v1/accounting/bills/:id`: Get bill details and allocation line items
* `PUT /api/v1/accounting/bills/:id`: Update draft bill
* `POST /api/v1/accounting/bills/:id/approve`: Approve bill for disbursement
* `POST /api/v1/accounting/bills/:id/void`: Void bill and reverse journal allocations
* `GET /api/v1/accounting/bills/recurring`: List scheduled recurring bill templates
* `POST /api/v1/accounting/bills/recurring`: Create recurring bill template
* `GET /api/v1/accounting/vendor_checks`: List printed and draft vendor checks from register
* `POST /api/v1/accounting/vendor_checks`: Record paper check payment settling one or more bills
* `GET /api/v1/accounting/vendor_checks/:id`: Get check details and bill settlements
* `POST /api/v1/accounting/vendor_checks/:id/void`: Void check and restore unpaid bill balances
* `GET /api/v1/accounting/vendor_credits`: List vendor credit memos
* `POST /api/v1/accounting/vendor_credits`: Record vendor credit memo / refund
* `POST /api/v1/accounting/vendor_credits/:id/apply`: Apply credit memo balance against open vendor bills
* `GET /api/v1/accounting/bank_deposits`: List bank deposit batches
* `POST /api/v1/accounting/bank_deposits`: Create bank deposit grouping payments into bank clearing account
* `GET /api/v1/accounting/client_contributions`: List client owner capital contributions
* `POST /api/v1/accounting/client_contributions`: Record investor/owner capital infusion
* `GET /api/v1/accounting/client_distributions`: List client owner draw disbursements
* `POST /api/v1/accounting/client_distributions`: Execute client draw disbursement
* `POST /api/v1/accounting/management_fees/calculate`: Preview management fees across portfolios
* `POST /api/v1/accounting/management_fees/post`: Post management fee journal entries

### Maintenance & Work Orders

* `GET /api/v1/maintenance`: List work orders
* `POST /api/v1/maintenance`: Create work order
* `GET /api/v1/maintenance/:id`: Work order details, assigned vendor, and costs
* `PUT /api/v1/maintenance/:id`: Update work order status and costs
* `PUT /api/v1/maintenance/:id/close`: Complete work order workflow (`completion_notes`, `actual_cost_cents`, `completed_at`)
* `GET /api/v1/maintenance/:id/tasks`: List work order checklist tasks
* `POST /api/v1/maintenance/:id/tasks`: Create subtask checklist item
* `PUT /api/v1/maintenance/:id/tasks/:task_id`: Mark subtask complete or reassign
* `DELETE /api/v1/maintenance/:id`: Soft delete work order
* `GET /api/v1/maintenance/preventative_schedules`: List preventative maintenance schedules
* `POST /api/v1/maintenance/preventative_schedules`: Create recurring preventative maintenance schedule
* `GET /api/v1/maintenance/preventative_schedules/:id`: Get schedule details
* `PUT /api/v1/maintenance/preventative_schedules/:id`: Update schedule cadence, vendor, or due date
* `DELETE /api/v1/maintenance/preventative_schedules/:id`: Soft delete schedule
* `POST /api/v1/maintenance/preventative_schedules/run`: Manually trigger due work order generation pass across all due schedules
* `POST /api/v1/maintenance/preventative_schedules/:id/trigger`: Manually trigger immediate work order creation from a specific schedule

### Universal Conversations & Notes

* `GET /api/v1/conversations`: List threaded conversations by polymorphic parent (`entity_type`, `entity_id`)
* `POST /api/v1/conversations`: Create conversation thread attached to an entity
* `GET /api/v1/conversations/:conversation_id`: Get thread messages and participants
* `POST /api/v1/conversations/:conversation_id/messages`: Post message or note to thread
* `DELETE /api/v1/conversations/:conversation_id`: Soft delete conversation thread

### Custom Fields Engine

* `GET /api/v1/custom_fields/definitions`: List custom field schemas filtered by `entity_type`
* `POST /api/v1/custom_fields/definitions`: Register custom field definition
* `PUT /api/v1/custom_fields/definitions/:id`: Update field label, required status, or options
* `DELETE /api/v1/custom_fields/definitions/:id`: Soft delete custom field definition
* `PUT /api/v1/:entity_type/:id/custom_fields`: Update entity custom field values

### Backup & Disaster Recovery

* `GET /api/v1/backups`: List backup archives and snapshots with pagination
* `POST /api/v1/backups`: Create backup snapshot (`full_system` bundling SQLite DB and physical attachments into `.tar.gz`, or `operator_data` JSON export)
* `GET /api/v1/backups/:id`: Get backup metadata and verification status
* `GET /api/v1/backups/:id/download`: Stream compressed backup archive
* `POST /api/v1/backups/:id/verify`: Verify SHA-256 cryptographic digest of archive
* `POST /api/v1/backups/:id/restore`: Restore operator data from archive
* `DELETE /api/v1/backups/:id`: Soft delete backup record and remove archive from disk
