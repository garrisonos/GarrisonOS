# Contacts Module

The **Contacts** module (`modules/contacts/`) maintains a unified directory of all human individuals and business organizations associated with the property portfolio.

---

## 1. Contact Roles & Types

Every contact entity (`contacts`) is classified by role:

| `contact_type` | Description | Typical Use Cases |
| :--- | :--- | :--- |
| `tenant` | Resident leasing a property unit | Signatory on residential leases, tenant ledger balance |
| `client` | Beneficial owner or property investor | Portfolio reporting, owner capital contributions, distributions |
| `owner` | Compatibility role for a property owner | Existing owner records and legacy owner-facing workflows |
| `vendor` | Contractor or service provider | Maintenance work orders, plumbing, HVAC, electrical dispatch, AP bills, check register |
| `guarantor` | Financial co-signer | Lease backing |
| `prospect` | Potential applicant | Inquiries, touring |
| `emergency` | Emergency contact | Tenant safety reference |

---

## 2. Schema Definition (`contacts`)

* `id` (UUIDv7): Primary key
* `operator_id` (UUIDv7): Owning operator instance
* `contact_type` (TEXT): Role category (`tenant`, `owner`, `client`, `vendor`, `guarantor`, `prospect`, `emergency`)
* `first_name` (TEXT), `last_name` (TEXT)
* `company_name` (TEXT): For vendors or commercial entities
* `email` (TEXT), `phone` (TEXT), `secondary_phone` (TEXT)
* `tax_id_last4` (TEXT), `tax_id_encrypted` (TEXT): Encrypted EIN or SSN
* `tax_payer_name` (TEXT): Legal tax identity name
* `tax_classification` (TEXT): Legal tax status (`individual`, `llc`, `corporation`, `partnership`, `other`)
* `trade_specialization` (TEXT) / `vendor_specialty` (TEXT): Trade category (e.g. `Plumbing`, `Electrical`, `HVAC`, `General Contracting`)
* `w9_received` (INTEGER): W-9 on file status (`0` = Pending, `1` = Verified)
* `vendor_insured` (INTEGER): General liability insurance status (`0` = Unverified, `1` = Insured)
* `insurance_expiration_date` (INTEGER ms): Policy expiration date for compliance alerts
* `payment_term_days` (INTEGER): Default AP bill payment terms (e.g., 15, 30, 60 days)
* `name_on_check` (TEXT): Formatted payee name for MICR paper check printing
* `default_bill_split_account_id` (UUIDv7): Default Chart of Accounts expense account
* `markup_account_id` (UUIDv7): Optional cost-plus markup revenue GL account
* `markup_percentage_bps` (INTEGER): Default markup basis points on materials/labor
* `custom_fields` (TEXT JSON): Dynamic user-defined custom attributes
* `notes` (TEXT)
* `created_at`, `updated_at`, `deleted_at`

---

## 3. Vendor Compliance & 1099-NEC Reporting

The contacts module tracks vendor compliance and independent contractor taxation:

* **W-9 Tracking**: Contacts table displays visual indicators (`W-9 Verified` green badge vs `W-9 Pending` amber alert badge) to safeguard operators against non-compliant disbursements.
* **Insurance Expiration Alerts**: Tracks general liability and workers' comp policy expiration dates, warning operators prior to dispatching or issuing disbursements to uninsured vendors.
* **Trade Specialization**: Allows the maintenance dispatch workflow to filter and assign qualified vendors matching the required trade.
* **Tax Classification & 1099-NEC**: Captures legal structure classification alongside encrypted tax ID records for annual Form 1099-NEC non-employee compensation filing.
* **Default Billing Terms & Check Printing**: Pre-configures payment terms, default GL expense accounts, and check payee formatting to streamline Accounts Payable workflows.

---

## 4. API Endpoints

* `GET /api/v1/contacts`: List contacts (supports `?contact_type=tenant|owner|client|vendor|guarantor|prospect|emergency` and `?query=search`)
* `POST /api/v1/contacts`: Create a new contact
* `GET /api/v1/contacts/:id`: Fetch contact details, active leases, insurance status, and billing defaults
* `PUT /api/v1/contacts/:id`: Update contact details (including W-9 status, insurance, and tax classification)
* `DELETE /api/v1/contacts/:id`: Soft delete contact
