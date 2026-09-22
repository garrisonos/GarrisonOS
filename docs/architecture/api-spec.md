# GarrisonOS REST API & EventBus Specification

This document provides the canonical API specification and EventBus topic contract for **GarrisonOS**. It details endpoint contracts, request/response payload schemas, parameter validation rules, error formats, and asynchronous event choreography across the core engine and modular subsystems.

All endpoints adhere to the engineering standards established in [`AGENTS.md`](../../AGENTS.md):
- **Standard Envelopes**: Conform strictly to `api/response.ts` (`successResponse`, `errorResponse`).
- **Context Extraction**: Zero parameter leakage — `operator_id` is never accepted in request bodies or route parameters; it is extracted implicitly via `RequestContext.getOperatorId()`.
- **Numeric Validation**: Bounded validation guards (`Number.isInteger()`, `Number.isFinite()`).
- **Error Hygiene**: SQL statements, driver errors, and stack traces are never leaked in error payloads.

---

## 1. REST API Envelopes & Conventions

### 1.1 Success Response Envelope
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "total": 120,
    "page": 1,
    "limit": 50
  }
}
```

### 1.2 Error Response Envelope
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invoice amount must be a positive integer in cents",
    "details": []
  }
}
```

### 1.3 Bulk Transactional Response Envelope
For high-volume transactional ingestion (`POST /api/v1/:resource/bulk`):
```json
{
  "success": true,
  "data": {
    "total_processed": 25,
    "success_count": 24,
    "failed_count": 1,
    "created_records": [ ... ],
    "errors": [
      {
        "index": 12,
        "code": "VALIDATION_ERROR",
        "message": "Unit number already exists in building"
      }
    ]
  }
}
```

### 1.4 Universal Date-Range Window & Sorting Conventions
All collection `GET` endpoints support standardized temporal filtering and dynamic multi-column sorting:
* **Date Windows (UTC epoch ms)**:
  - `last_modified_start` / `last_modified_end`: Filters records modified within interval.
  - `post_date_start` / `post_date_end`: Filters accounting journals and transactions by accounting date.
  - `start_date_start` / `start_date_end`: Filters leases and contracts by commencement window.
* **Sorting (`order_by`)**:
  - Format: `order_by=field1:asc,field2:desc` (defaults to ascending if direction is omitted).
* **Custom Fields Flag**:
  - `include_custom_fields=true`: Embeds validated dynamic custom fields in entity data envelopes.

Standard Error Codes:
- `VALIDATION_ERROR` (HTTP 400): Malformed payload or failed domain assertion.
- `UNAUTHORIZED` (HTTP 401): Missing, expired, or invalid session token.
- `FORBIDDEN` (HTTP 403): User lacks required RBAC permissions for the resource.
- `NOT_FOUND` (HTTP 404): Target entity does not exist or belongs to another operator.
- `CONFLICT` (HTTP 409): Unique constraint violation or concurrency collision.
- `INTERNAL_ERROR` (HTTP 500): Unexpected system fault (details logged server-side).

---

## 2. Platform Governance & Operator Subuser APIs

### 2.1 Platform Operators Governance
* `GET /api/v1/system/operators`: List all operators on the instance (Platform Owner & System Managers only).
* `POST /api/v1/system/operators`: Provision a new operator and owner user with configurable storage quota (Platform Owner only).
* `PUT /api/v1/system/operators/:id`: Update operator name, storage quota bytes (Platform Owner & System Managers).
* `DELETE /api/v1/system/operators/:id`: Soft-delete operator and all its users (Platform Master Owner only).

### 2.2 Platform System Managers ("Minions of the Owner")
* `GET /api/v1/system/managers`: List platform system managers (Platform Owner only).
* `POST /api/v1/system/managers`: Provision a new platform manager (`is_system_user = 1`, `role = system_manager`) assisting with platform administration.
* `DELETE /api/v1/system/managers/:id`: Soft-delete platform manager (Platform Owner only; cannot delete self).

### 2.3 Operator Team & Subuser Management
* `GET /api/v1/users`: List subusers belonging to the caller's operator organization.
* `POST /api/v1/users`: Provision a subuser with role (`leasing_agent`, `assistant`, `maintenance`, `auditor`, `viewer`), `allowed_modules: string[]`, and `allowed_portfolios: string[]`.
* `GET /api/v1/users/:id`: Get subuser profile with module and portfolio whitelist.
* `PUT /api/v1/users/:id`: Update subuser profile, role, password, `allowed_modules`, or `allowed_portfolios`.
* `DELETE /api/v1/users/:id`: Soft-delete subuser (blocks deletion of sole remaining owner).

---

## 3. Four-Tier Asset Hierarchy: Properties & Buildings APIs

### 3.1 Buildings Management
* `GET /api/v1/properties/:id/buildings`: List all buildings located within a property parcel.
* `POST /api/v1/properties/:id/buildings`: Create a new building under a property parcel:
  ```json
  {
    "name": "North Tower",
    "building_number": "Bldg-A",
    "floors": 4,
    "notes": "Four-story residential wing"
  }
  ```
* `GET /api/v1/buildings/:id`: Retrieve building details with parent property reference.
* `PUT /api/v1/buildings/:id`: Update building name, number, floor count, or notes.
* `DELETE /api/v1/buildings/:id`: Soft-delete building record.

### 3.2 Units with Structural Links
* `POST /api/v1/properties/:id/units`: Accepts optional `building_id` linking the unit directly to a physical building within the parcel.
* `GET /api/v1/properties/units/:id`: Returns unit details including linked `building_id`.
* `PUT /api/v1/properties/units/:id`: Re-assign or update `building_id`.

---

## 4. Accounts Payable (AP) & Vendor Invoicing Subsystem

### 4.1 List Bills
* **Endpoint**: `GET /api/v1/accounting/bills`
* **Query Parameters**:
  - `vendor_id` (string, optional): Filter by vendor UUIDv7.
  - `status` (string, optional): `draft`, `pending_approval`, `approved`, `partially_paid`, `paid`, `voided`.
  - `due_before` (integer, optional): UTC epoch ms.
  - `limit` (integer, optional, default: 50, max: 100).
  - `page` (integer, optional, default: 1).
* **Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "018f9a21-7000-7c23-8bc1-1234567890ab",
      "vendor_id": "018f9a21-6543-7a12-8bc1-abcdef123456",
      "invoice_number": "INV-2026-089",
      "invoice_date": 1789500000000,
      "due_date": 1792092000000,
      "payment_terms": "net_30",
      "subtotal_cents": 45000,
      "tax_cents": 0,
      "total_amount_cents": 45000,
      "status": "approved",
      "work_order_id": "018f9a21-4321-7b34-8bc1-fedcba654321",
      "cost_plus_markup_bps": 1000,
      "created_at": 1789500100000
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 50 }
}
```

### 4.2 Create Bill with Allocations
* **Endpoint**: `POST /api/v1/accounting/bills`
* **Request Body**:
```json
{
  "vendor_id": "018f9a21-6543-7a12-8bc1-abcdef123456",
  "invoice_number": "INV-2026-089",
  "invoice_date": 1789500000000,
  "due_date": 1792092000000,
  "payment_terms": "net_30",
  "work_order_id": "018f9a21-4321-7b34-8bc1-fedcba654321",
  "cost_plus_markup_bps": 1000,
  "notes": "Emergency plumbing valve replacement",
  "allocations": [
    {
      "property_id": "018f9a21-1111-7c22-8bc1-111111111111",
      "unit_id": "018f9a21-2222-7c22-8bc1-222222222222",
      "gl_account_id": "018f9a21-3333-7c22-8bc1-333333333333",
      "amount_cents": 45000,
      "description": "Plumbing repairs"
    }
  ]
}
```
* **Response (201 Created)**: Returns created bill record with allocations.

### 4.3 Approve Bill
* **Endpoint**: `POST /api/v1/accounting/bills/:id/approve`
* **Permission**: `accounting:bills:approve`
* **Behavior**: Transitions bill status to `approved`, creates double-entry journal entry (Debit `Expense Account`, Credit `2010 Accounts Payable`), and publishes `bill.approved` event.
* **Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "id": "018f9a21-7000-7c23-8bc1-1234567890ab",
    "status": "approved",
    "approved_at": 1789500500000,
    "journal_entry_id": "018f9a21-8888-7c22-8bc1-888888888888"
  }
}
```

### 4.4 Disburse Bill Payment (Check / ACH / Card)
* **Endpoint**: `POST /api/v1/accounting/bills/disbursements`
* **Permission**: `accounting:bills:disburse`
* **Request Body**:
```json
{
  "vendor_id": "018f9a21-6543-7a12-8bc1-abcdef123456",
  "disbursement_account_id": "018f9a21-1010-7c22-8bc1-101010101010",
  "disbursement_date": 1789501000000,
  "disbursement_method": "check",
  "check_number": "1042",
  "payee_name": "Apex Plumbing Services LLC",
  "memo": "Payment for INV-2026-089",
  "lines": [
    {
      "bill_id": "018f9a21-7000-7c23-8bc1-1234567890ab",
      "allocated_amount_cents": 45000
    }
  ]
}
```
* **Response (201 Created)**: Creates disbursement, marks bill as `paid`, posts double-entry transaction (Debit `2010 Accounts Payable`, Credit `1010 Operating Checking`), and publishes `bill.disbursed` event.

### 4.5 Vendor Credit Memos & Bill Offsets
* **List Vendor Credits**: `GET /api/v1/accounting/vendor_credits` (filters: `vendor_id`, `status`, `post_date_start`, `post_date_end`, `limit`, `page`)
* **Create Vendor Credit**: `POST /api/v1/accounting/vendor_credits`
  - Payload: `{ "vendor_id": "...", "credit_number": "VC-1001", "total_amount_cents": 15000, "credit_date": 1789501000000, "gl_account_id": "...", "reason": "Vendor volume discount", "reference_number": "REF-9921" }`
  - Ledger Invariant: Debit `2010 Accounts Payable`, Credit `5010 Operating Expense`.
* **Apply Vendor Credit to Bill**: `POST /api/v1/accounting/vendor_credits/:id/apply`
  - Payload: `{ "bill_id": "...", "applied_amount_cents": 15000, "applied_date": 1789502000000 }`
* **Update Vendor Credit**: `PUT /api/v1/accounting/vendor_credits/:id`

### 4.6 Recurring Scheduled Bills
* **Endpoint**: `POST /api/v1/accounting/bills/recurring`
  - Payload: `{ "vendor_id": "...", "frequency": "monthly", "day_of_month": 1, "allocations": [ ... ], "notes": "Monthly pest control" }`

### 4.7 Bill Payment Register & Lookup
* **List Bill Payments**: `GET /api/v1/accounting/bills/payments` (supports `vendor_id`, `date_start`, `date_end`, `limit`, `page`)
* **Get Bill Payment**: `GET /api/v1/accounting/bills/payments/:id`
* **Update Reference**: `PATCH /api/v1/accounting/bills/payments/:id` (payload: `{ "reference_number": "WIRE-9921" }`)

---

## 5. Vendor Check Register & Pure TypeScript PDF Check Printing

### 5.1 Vendor Check Register CRUD
* **List Vendor Checks**: `GET /api/v1/accounting/vendor_checks` (filters: `vendor_id`, `portfolio_id`, `post_date_start`, `post_date_end`, `limit`, `page`; kebab alias `/vendor-checks` supported)
* **Create Manual Check**: `POST /api/v1/accounting/vendor_checks`
  - Payload: `{ "vendor_id": "...", "bank_account_id": "...", "check_number": "001045", "amount_cents": 32000, "payee_name": "...", "memo": "..." }`
* **Update Check Details**: `PUT /api/v1/accounting/vendor_checks/:id`

### 5.2 Generate Print Check PDF
* **Endpoint**: `POST /api/v1/accounting/checks/print`
* **Permission**: `accounting:checks:print`
* **Request Body**:
```json
{
  "disbursement_ids": [
    "018f9a21-9999-7c22-8bc1-999999999999"
  ],
  "template_type": "voucher_check_top",
  "starting_check_number": 1042
}
```
* **Response (200 OK)**:
  - Header: `Content-Type: application/pdf`
  - Header: `Content-Disposition: attachment; filename="checks_20260918_1042.pdf"`
  - Body: Binary stream conforming strictly to ISO 32000-1 (PDF 1.4), rendered natively via pure TypeScript vector writer with millimeter alignment.

### 5.3 Void Check
* **Endpoint**: `POST /api/v1/accounting/checks/void`
* **Permission**: `accounting:checks:void`
* **Request Body**:
```json
{
  "disbursement_id": "018f9a21-9999-7c22-8bc1-999999999999",
  "reason": "Printer alignment error on check stock"
}
```
* **Response (200 OK)**: Reverses the disbursement journal entry, marks check as void in the check register, returns allocated bills back to `approved` state.

---

## 6. Bank Deposits & Clearing Subsystem

### 6.1 List Undeposited Receipts
* **Endpoint**: `GET /api/v1/accounting/undeposited_funds` (kebab alias `/undeposited-funds` supported)
* **Response (200 OK)**: Lists all payments posted to `1030 Undeposited Funds` awaiting batching.

### 6.2 List & Query Bank Deposits
* **Endpoint**: `GET /api/v1/accounting/bank_deposits` (kebab alias `/bank-deposits` supported)
* **Query Parameters**: `bank_account_id`, `post_date_start`, `post_date_end`, `limit`, `page`.

### 6.3 Create Bank Deposit
* **Endpoint**: `POST /api/v1/accounting/bank_deposits` (kebab alias `/bank-deposits` supported)
* **Permission**: `accounting:deposits:create`
* **Request Body**:
```json
{
  "bank_account_id": "018f9a21-1020-7c22-8bc1-102010201020",
  "deposit_date": 1789505000000,
  "deposit_reference": "DEP-2026-09-18",
  "memo": "Deposit of 4 tenant rent checks",
  "source_transaction_ids": [
    "018f9a21-tx01-7c22-8bc1-tx01tx01tx01",
    "018f9a21-tx02-7c22-8bc1-tx02tx02tx02"
  ]
}
```
* **Response (201 Created)**: Generates clearing journal entry (Debit `1010/1020 Bank Checking`, Credit `1030 Undeposited Funds`) and groups receipts into a single statement-matched deposit slip.

### 6.4 Delete / Void Bank Deposit
* **Endpoint**: `DELETE /api/v1/accounting/bank_deposits/:id`
* **Behavior**: Unlinks receipt transactions returning them to `1030 Undeposited Funds` and posts reversing journal entry.

---

## 7. Client Portfolio Accounting & Management Fees

### 7.1 Record Client Capital Contribution
* **Endpoint**: `POST /api/v1/accounting/client_contributions` (kebab alias `/client-contributions` supported)
* **Request Body**:
```json
{
  "client_contact_id": "018f9a21-cl01-7c22-8bc1-cl01cl01cl01",
  "portfolio_id": "018f9a21-pf01-7c22-8bc1-pf01pf01pf01",
  "property_id": "018f9a21-pr01-7c22-8bc1-pr01pr01pr01",
  "contribution_date": 1789500000000,
  "amount_cents": 500000,
  "destination_account_id": "018f9a21-1010-7c22-8bc1-101010101010",
  "reference_number": "WIRE-48201",
  "memo": "HVAC replacement reserve capital"
}
```
* **Ledger Invariant**: Debit the supplied `destination_account_id`, Credit `3010 Client Capital`.

### 7.2 Query Client Capital Contributions
* **Endpoint**: `GET /api/v1/accounting/client_contributions`
* **Query Parameters**: `client_contact_id`, `portfolio_id`, `post_date_start`, `post_date_end`, `limit`, `page`.

### 7.3 Disburse Client Draw / Distribution
* **Endpoint**: `POST /api/v1/accounting/client_distributions` (kebab alias `/client-distributions` supported)
* **Request Body**:
```json
{
  "client_contact_id": "018f9a21-cl01-7c22-8bc1-cl01cl01cl01",
  "portfolio_id": "018f9a21-pf01-7c22-8bc1-pf01pf01pf01",
  "distribution_date": 1789506000000,
  "amount_cents": 345000,
  "source_account_id": "018f9a21-1010-7c22-8bc1-101010101010",
  "disbursement_method": "ach",
  "memo": "Monthly net operating cash distribution"
}
```
* **Ledger Invariant**: Debit `3020 Client Distributions`, Credit the supplied `source_account_id`.

### 7.4 Query Client Draws / Distributions
* **Endpoint**: `GET /api/v1/accounting/client_distributions`
* **Query Parameters**: `client_contact_id`, `portfolio_id`, `post_date_start`, `post_date_end`, `limit`, `page`.

### 7.5 Management Fee Automation
* **Preview Management Fees**: `POST /api/v1/accounting/management_fees/calculate`
* **Post Management Fees**: `POST /api/v1/accounting/management_fees/post`

---

## 8. Leasing AR & Fee Policy Engine

### 8.1 Recurring Lease Charges
* **Create Schedule**: `POST /api/v1/leases/:id/recurring_charges` (kebab alias `/recurring-charges` supported)
  - Payload: `{ "charge_category": "pet_rent", "amount_cents": 3500, "gl_account_id": "...", "billing_frequency": "monthly", "billing_day": 1 }`
* **List Schedules**: `GET /api/v1/leases/:id/recurring_charges`

### 8.2 Granular Lease AR Transactions
* **Post Charge**: `POST /api/v1/leases/:id/charges` (and bulk creation: `POST /api/v1/leases/charges/bulk`)
* **List Charges**: `GET /api/v1/leases/:id/charges`
* **Post Rent Adjustment**: `POST /api/v1/leases/:id/adjustments`
* **Post Concession / Discount**: `POST /api/v1/leases/:id/discounts`
* **Apply Credit Memo**: `POST /api/v1/leases/:id/credits`
* **Disburse Move-Out Deposit Refund**: `POST /api/v1/leases/:id/refunds`

### 8.3 Lease Policies & Metadata Lookups
* **Get Active Late Fee Policy**: `GET /api/v1/leases/:id/late_fee_policy` (alias: `/late-fee-policy`)
* **Get Valid Lease Statuses**: `GET /api/v1/leases/statuses`
* **Get Linked Lease Work Orders**: `GET /api/v1/leases/:id/work_orders` (alias: `/work-orders`)

---

## 9. Universal Document Attachments & Media API

### 9.1 Upload Attachment
* **Endpoint**: `POST /api/v1/attachments`
* **Content-Type**: `multipart/form-data`
* **Form Fields**:
  - `entity_type` (string): `lease`, `property`, `building`, `unit`, `contact`, `work_order`, `bill`.
  - `entity_id` (string): UUIDv7 of parent entity.
  - `file` (binary): Document or image file.
  - `publish_to_tenant_portal` (boolean, optional, default: `0`).
  - `publish_to_client_portal` (boolean, optional, default: `0`).
* **Processing Guarantees**:
  - Automatically strips EXIF metadata on image files (eliminating GPS and device identifiers).
  - Downsamples oversized images to safe, compact dimensions (max 1920x1080 WebP/JPEG).
  - Validates PDF structure and rejects files containing interactive `/JavaScript`, `/JS`, or executable triggers.
  - Generates cryptographic SHA-256 checksum and saves to sandboxed path outside web root.
* **Response (201 Created)**: Returns attachment metadata record.

### 9.2 Download Attachment
* **Endpoint**: `GET /api/v1/attachments/:id/download`
* **Response (200 OK)**: Streaming sandboxed binary stream with security headers (`X-Content-Type-Options: nosniff`).

### 9.3 Update Attachment Metadata
* **Endpoint**: `PUT /api/v1/attachments/:id`
* **Request Body**: `{ "description": "Updated signed agreement", "publish_to_tenant_portal": true }`

---

## 10. Public-Facing Tenant Self-Service Portal (`portal.<domain>`)

All portal routes execute under dedicated subdomain host routing with independent session cookies and strict rate limits.

### 10.1 Request Magic Link
* **Endpoint**: `POST /portal/login`
* **Request Body**: `{ "email": "tenant@example.com" }`
* **Rate Limit**: Maximum 5 requests per 15 minutes per IP.
* **Behavior**: Verifies tenant lease status; dispatches HMAC-signed login token (15-minute validity) via SMTP.

### 10.2 Verify Magic Link
* **Endpoint**: `GET /portal/verify?token=...`
* **Behavior**: Validates cryptographic signature and expiration; issues secure HTTP-only session cookie scoped to `portal.<domain>`.

### 10.3 Submit Maintenance Request
* **Endpoint**: `POST /portal/maintenance/new`
* **Content-Type**: `multipart/form-data`
* **Form Fields**: `category`, `description`, `priority`, `photos[]`.
* **Behavior**: Strips EXIF metadata, downsamples images, creates work order associated with tenant unit, and publishes `work_order.created` event.

---

## 11. Universal Conversations & Notes Subsystem

Polymorphic threaded notes and audit comments across all primary operational entities (`properties`, `buildings`, `units`, `leases`, `contacts`, `work_orders`, `bills`).

### 11.1 List Conversations
* **Canonical Endpoint**: `GET /api/v1/conversations`
* **Query Parameters**: `entity_type` (required), `entity_id` (required), `last_modified_start`, `last_modified_end`, `limit`, `page`.
* **Entity-Nested Alias**: `GET /api/v1/:entity_type/:id/conversations`

### 11.2 Create Conversation Thread
* **Canonical Endpoint**: `POST /api/v1/conversations`
* **Request Body**: `{ "entity_type": "property", "entity_id": "...", "subject": "HVAC unit maintenance history", "is_private": false }`
* **Entity-Nested Alias**: `POST /api/v1/:entity_type/:id/conversations` (payload: `{ "subject": "...", "is_private": false }`)

### 11.3 Add Message / Comment to Thread
* **Endpoint**: `POST /api/v1/conversations/:conversation_id/messages` (alias: `POST /api/v1/:entity_type/:id/conversations/:conversation_id/messages`)
* **Request Body**: `{ "body": "Technician replaced run capacitor. Testing compressor draw." }`

### 11.4 Delete Conversation Thread
* **Endpoint**: `DELETE /api/v1/conversations/:conversation_id` (alias: `DELETE /api/v1/:entity_type/:id/conversations/:conversation_id`)

---

## 12. Real Estate Amenities & Marketing Syndication Profiles

### 12.1 Standardized Amenities Catalog CRUD
* **List Amenities**: `GET /api/v1/amenities` (optional `category` filter: `community`, `unit`, `accessibility`, `pet`, `eco`)
* **Create Amenity**: `POST /api/v1/amenities` (payload: `{ "name": "Rooftop Deck", "category": "community", "description": "..." }`)
* **Update Amenity**: `PUT /api/v1/amenities/:id`
* **Delete Amenity**: `DELETE /api/v1/amenities/:id`

### 12.2 Property & Unit Amenity Junctions
* **Get Property Amenities**: `GET /api/v1/properties/:id/amenities`
* **Sync Property Amenities**: `PUT /api/v1/properties/:id/amenities` (payload: `{ "amenity_ids": [ ... ] }`)
* **Get Unit Amenities**: `GET /api/v1/properties/units/:unit_id/amenities`
* **Sync Unit Amenities**: `PUT /api/v1/properties/units/:unit_id/amenities` (payload: `{ "amenity_ids": [ ... ] }`)

### 12.3 Marketing & Syndication Attributes
Supported on `POST/PUT /api/v1/properties/:id`, `POST/PUT /api/v1/buildings/:id`, and `POST/PUT /api/v1/properties/units/:unit_id`:
* Syndication flags: `published_for_rent`, `published_for_sale`, `featured_for_rent`, `syndicate`.
* Advertising copy: `posting_title`, `specials`, `short_description`, `long_description`, `available_date`.
* Pricing targets: `target_rent_cents`, `target_deposit_cents`, `other_monthly_charges_cents`.
* Pet policies: `pets_allowed`, `pet_dog_allowed`, `pet_cat_allowed`, `pet_other_allowed`, `smoking_allowed`.

---

## 13. Dynamic Custom Fields Engine

### 13.1 Retrieve Schema Definitions
* **Endpoint**: `GET /api/v1/custom_fields/definitions` (kebab alias `/custom-fields/definitions` supported)
* **Query Parameter**: `entity_type` (`portfolio`, `property`, `building`, `unit`, `lease`, `contact`, `work_order`, `bill`).
* **Register Definition**: `POST /api/v1/custom_fields/definitions` (payload: `{ "entity_type": "...", "field_name": "gate_code", "field_label": "Gate Code", "data_type": "string", "is_required": false }`)
* **Update Definition**: `PUT /api/v1/custom_fields/definitions/:id`
* **Delete Definition**: `DELETE /api/v1/custom_fields/definitions/:id`

### 13.2 Update Entity Custom Field Values
* **Endpoint**: `PUT /api/v1/:entity_type/:id/custom_fields`
* **Request Body**: `{ "custom_fields": { "hoa_gate_code": "8492", "inspection_lockbox": "1122" } }`
* **Date Standard**: All custom field date values adhere strictly to ISO `YYYY-MM-DD`.

---

## 14. Field Operations & Post-MVP Specifications

### 14.1 Work Order Subtasks & Task Comments (Sprint 6)
* **List Tasks**: `GET /api/v1/maintenance/:id/tasks`
* **Create Task**: `POST /api/v1/maintenance/:id/tasks`
  - Payload: `{ "task_name": "Replace air intake filter", "due_date": 1789510000000, "assigned_user_id": "..." }`
* **Update Task**: `PUT /api/v1/maintenance/:id/tasks/:task_id`
* **Add Task Comment**: `POST /api/v1/maintenance/:id/tasks/:task_id/comments`
* **Close Work Order Contract**: `PUT /api/v1/maintenance/:id/close`
  - Payload: `{ "completion_notes": "All tasks verified. Tenant signed off.", "actual_cost_cents": 45000, "completed_at": 1789512000000 }`
  - Field Mapping: `completion_notes`, `actual_cost_cents`, and `completed_at` persist to the same-named `work_orders` fields.

### 14.2 Property Condition Inspections (Post-MVP Horizon)
* **List Inspections**: `GET /api/v1/inspections` (filters: `building_id`, `unit_id`, `status`, `inspector_id`, `date_start`, `date_end`)
* **Create Inspection**: `POST /api/v1/inspections`
  - Payload: `{ "property_id": "...", "unit_id": "...", "inspector_id": "...", "scheduled_date": 1789500000000, "general_notes": "Move-out walk-through" }`
* **Get Inspection with Areas & Checklist Items**: `GET /api/v1/inspections/:id`

### 14.3 Prospect CRM & Lead Inquiries (Post-MVP Horizon)
* **List Prospects**: `GET /api/v1/prospects` (filters: `status`, `desired_move_in_start`, `desired_move_in_end`)
* **Create Prospect Lead**: `POST /api/v1/prospects`
* **Get Prospect Statuses**: `GET /api/v1/prospects/statuses`
* **Campaign & Tracking Number Attribution**: `GET /api/v1/prospects/:id/campaign`

---

## 15. Asynchronous In-Process EventBus Contracts

All modules communicate asynchronously via `EventBus` (`core/events.ts`). Every subscriber executes inside a `try/catch` block to guarantee process resilience.

| Event Topic | Payload Parameters | Trigger Condition | Primary Subscribers |
| :--- | :--- | :--- | :--- |
| `bill.approved` | `operatorId`, `billId`, `amountCents`, `vendorId` | Bill transitions from draft to approved | Accounting (posts AP journal entry), Maintenance (tags work order expense) |
| `bill.disbursed` | `operatorId`, `disbursementId`, `billIds[]`, `totalCents` | Payment disbursed to vendor | Accounting (settles AP liability, check register audit) |
| `check.printed` | `operatorId`, `disbursementId`, `checkNumber` | Check batch PDF generated | Accounting (marks `check_printed = 1`, logs check number) |
| `bank.deposit_cleared` | `operatorId`, `depositId`, `totalCents`, `accountNumber` | Deposit batch submitted | Accounting (debits bank account, credits undeposited funds) |
| `client.distribution.posted`| `operatorId`, `distributionId`, `portfolioId`, `cents` | Client net cash draw disbursed | Accounting (posts equity reduction, generates distribution notice) |
| `lease.charge_accrued` | `operatorId`, `leaseId`, `category`, `cents` | Recurring charge generator runs | Accounting (posts receivable entry to tenant ledger) |
| `lease.late_fee_applied` | `operatorId`, `leaseId`, `feeCents`, `delinquentCents` | Delinquency policy triggers | Accounting (posts late fee receivable), Notifications (alerts tenant) |
| `attachment.uploaded` | `operatorId`, `attachmentId`, `entityType`, `entityId` | Document upload sanitized | Audit (records file checksum and metadata) |
| `work_order.closed` | `operatorId`, `workOrderId`, `actualCostCents` | Work order formally closed | Accounting (verifies expense allocation), Turnover state machine |
