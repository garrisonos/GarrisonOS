-- Migration 0003: Property & Unit Amenities Catalog, Junctions, Syndication & Custom Fields
CREATE TABLE IF NOT EXISTS amenities (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('community', 'unit', 'accessibility', 'pet', 'eco')),
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_amenities_operator_category ON amenities(operator_id, category) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_amenities_operator_name ON amenities(operator_id, name) WHERE deleted_at IS NULL;

-- Property Amenities Junction
CREATE TABLE IF NOT EXISTS property_amenities (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    property_id TEXT NOT NULL REFERENCES properties(id),
    amenity_id TEXT NOT NULL REFERENCES amenities(id),
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_property_amenities_op_prop ON property_amenities(operator_id, property_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_property_amenities_op_amenity ON property_amenities(operator_id, amenity_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_amenities_unique ON property_amenities(operator_id, property_id, amenity_id) WHERE deleted_at IS NULL;

-- Unit Amenities Junction
CREATE TABLE IF NOT EXISTS unit_amenities (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    unit_id TEXT NOT NULL REFERENCES units(id),
    amenity_id TEXT NOT NULL REFERENCES amenities(id),
    created_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_unit_amenities_op_unit ON unit_amenities(operator_id, unit_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_unit_amenities_op_amenity ON unit_amenities(operator_id, amenity_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_amenities_unique ON unit_amenities(operator_id, unit_id, amenity_id) WHERE deleted_at IS NULL;

-- Expand properties with syndication & custom fields
ALTER TABLE properties ADD COLUMN published_for_rent INTEGER NOT NULL DEFAULT 0 CHECK (published_for_rent IN (0, 1));
ALTER TABLE properties ADD COLUMN posting_title TEXT;
ALTER TABLE properties ADD COLUMN marketing_description TEXT;
ALTER TABLE properties ADD COLUMN pet_policy TEXT;
ALTER TABLE properties ADD COLUMN specials TEXT;
ALTER TABLE properties ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';

-- Expand units with syndication & custom fields
ALTER TABLE units ADD COLUMN published_for_rent INTEGER NOT NULL DEFAULT 0 CHECK (published_for_rent IN (0, 1));
ALTER TABLE units ADD COLUMN posting_title TEXT;
ALTER TABLE units ADD COLUMN marketing_description TEXT;
ALTER TABLE units ADD COLUMN pet_policy TEXT;
ALTER TABLE units ADD COLUMN specials TEXT;
ALTER TABLE units ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';

-- Expand buildings with custom fields
ALTER TABLE buildings ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';
