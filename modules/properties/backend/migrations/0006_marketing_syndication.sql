-- Migration 0006: Marketing Syndication and Extended Amenities Definitions

CREATE TABLE IF NOT EXISTS amenity_definitions (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    category TEXT NOT NULL CHECK (category IN ('community', 'unit', 'accessibility', 'pet', 'eco')),
    name TEXT NOT NULL,
    icon TEXT,
    is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_amenity_def_unique ON amenity_definitions(operator_id, category, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_amenity_def_operator ON amenity_definitions(operator_id, category) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing_syndication (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    property_id TEXT REFERENCES properties(id),
    unit_id TEXT REFERENCES units(id),
    headline TEXT,
    description TEXT,
    advertised_rent_cents INTEGER,
    target_deposit_cents INTEGER,
    available_date INTEGER,
    assigned_contact_id TEXT,
    channels_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_marketing_property ON marketing_syndication(operator_id, property_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_unit ON marketing_syndication(operator_id, unit_id) WHERE deleted_at IS NULL;
