# Properties Module

The **Properties** module (`modules/properties/`) manages physical real estate portfolios, buildings, and rentable unit inventories.

---

## 1. Domain Entities

### Portfolios (`portfolios`)

Represents ownership entities (such as an LLC, holding company, or individual trust).

* `id` (UUIDv7): Primary key
* `operator_id` (UUIDv7): Owning operator instance
* `name` (TEXT): Entity name (e.g., "Maple Ridge Holdings LLC")
* `tax_id` (TEXT): Employer Identification Number (EIN) or SSN last 4

### Properties (`properties`)

Represents physical physical locations, buildings, or parcels.

* `id` (UUIDv7): Primary key
* `operator_id` (UUIDv7): Owning operator instance
* `portfolio_id` (UUIDv7): Parent ownership portfolio
* `name` (TEXT): Building/Property name
* `property_type` (TEXT): `single_family`, `multi_family`, `condo`, `townhouse`, `commercial`
* `address_line1`, `address_line2`, `city`, `state`, `postal_code`
* `year_built` (INTEGER)
* `published_for_rent`, `published_for_sale` (INTEGER boolean): Syndication visibility flags
* `posting_title`, `featured_image_url` (TEXT): Marketing listing metadata
* `pets_allowed`, `pet_dog_allowed`, `pet_cat_allowed` (INTEGER boolean)
* `pet_deposit_cents`, `pet_fee_cents`, `pet_rent_cents`, `pet_weight_limit_lbs`

### Units (`units`)

Represents distinct rentable living or commercial units within a property.

* `id` (UUIDv7): Primary key
* `operator_id` (UUIDv7): Owning operator instance
* `property_id` (UUIDv7): Parent physical property
* `building_id` (UUIDv7): Optional physical building within property parcel
* `unit_number` (TEXT): e.g. "101", "Unit A", "Main"
* `status` (TEXT): `vacant`, `occupied`, `notice_given`, `turnover`, `maintenance_hold`
* `bedrooms` (REAL), `bathrooms` (REAL), `square_feet` (INTEGER)
* `market_rent_cents` (INTEGER cents)
* `target_rent_cents`, `target_deposit_cents` (INTEGER cents)
* `available_date` (INTEGER ms)
* `published_for_rent` (INTEGER boolean)
* `pets_allowed` (INTEGER boolean), `pet_deposit_cents`, `pet_rent_cents`

---

## 2. Unit Turnover & Make-Ready Workflow

GarrisonOS provides integrated unit turnover management:

* **State Transitions**: Units transition through distinct lifecycle stages: `vacant` $\leftrightarrow$ `turnover` $\leftrightarrow$ `maintenance_hold`.
* **Make-Ready Automation**: When transitioning a unit to `turnover`, the operator is prompted to automatically generate a make-ready work order (`category = 'make_ready'`) in the Maintenance module, tracking turnover tasks, inspection items, and turnaround costs.

---

## 3. API Endpoints

* `GET /api/v1/properties/portfolios`: List portfolios with property counts
* `POST /api/v1/properties/portfolios`: Create portfolio
* `GET /api/v1/properties`: List properties with unit vacancy stats and syndication filters
* `POST /api/v1/properties`: Create property
* `GET /api/v1/properties/:id`: Get property details, buildings, and unit list
* `PUT /api/v1/properties/:id`: Update property, marketing syndication flags, and pet policies
* `DELETE /api/v1/properties/:id`: Soft delete property
* `POST /api/v1/properties/:id/units`: Create unit under property
* `GET /api/v1/properties/units/:unit_id`: Get unit details
* `PUT /api/v1/properties/units/:unit_id`: Update unit details, syndication terms, and status
* `GET /api/v1/amenities`: List standardized amenities catalog
* `POST /api/v1/amenities`: Create an operator-scoped amenity definition
* `PUT /api/v1/amenities/:id`: Update amenity name, category, or description
* `DELETE /api/v1/amenities/:id`: Soft delete amenity
* `GET /api/v1/properties/:id/amenities`: Get assigned amenities for a property parcel
* `PUT /api/v1/properties/:id/amenities`: Update assigned amenities for a property parcel
* `GET /api/v1/properties/units/:unit_id/amenities`: Get assigned amenities for a unit (including inherited property amenities)
* `PUT /api/v1/properties/units/:unit_id/amenities`: Update assigned amenities, exclusions, or overrides for a unit
* `GET /api/v1/properties/:id/flyer-pdf`: Generate branded vector PDF marketing flyer

---

## 4. Standardized Amenities Catalog, Unit Inheritance & Syndication

### 4.1. Standardized Amenities Across 5 Categories
Amenities are categorized into 5 standardized groups in the `amenity_definitions` table:
* **Community**: Swimming Pool, Fitness Center, Clubhouse, Business Center, Package Lockers, Covered Parking, Electric Vehicle Charging, Rooftop Terrace, BBQ Picnic Area, Elevator.
* **Unit**: In-Unit Washer/Dryer, Stainless Steel Appliances, Central Air Conditioning, Balcony/Patio, Dishwasher, Walk-In Closets, Hardwood Flooring, Quartz Countertops, Smart Thermostat, High-Speed Internet Included.
* **Accessibility**: Wheelchair Accessible, Ground Floor Unit, Roll-In Shower, Accessible Parking, Wide Doorways, Grab Bars Installed.
* **Pet**: Dogs Allowed, Cats Allowed, Dog Park / Pet Run, Pet Washing Station, No Pet Rent.
* **Eco-Friendly**: Solar Panels, ENERGY STAR Appliances, Low-Flow Fixtures, LED Lighting Throughout, Recycling Center On-Site.

### 4.2. Property-to-Unit Inheritance & Unit Overrides
* **Automatic Inheritance**: When an amenity is assigned to a property (e.g., Community Swimming Pool, Package Lockers), all units within that property inherit the amenity by default (`is_inherited = true`).
* **Unit Exclusions & Specifics**: Units can explicitly exclude inherited property amenities (`is_excluded = 1`) or declare unit-exclusive amenities (e.g., private in-unit laundry or private balcony).

### 4.3. Marketing Syndication & Flyer Generator
* **Syndication Portals**: Operators can toggle portal distribution flags (`syndicate_zillow`, `syndicate_trulia`, `syndicate_hotpads`, `syndicate_apartments_com`, `syndicate_craigslist`) and configure promotional headlines, descriptions, specials, and dedicated marketing contact personnel.
* **Vector Marketing Flyer PDF**: The `/api/v1/properties/:id/flyer-pdf` endpoint produces a high-resolution, zero-dependency ANSI-compliant vector PDF flyer bundling property details, active unit rental matrix, categorized amenity badges, and marketing contact info.
