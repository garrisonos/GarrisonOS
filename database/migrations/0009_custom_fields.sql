-- Dynamic Custom Fields Schema
-- Supports customizable sections/cards and typed field definitions for primary entities

CREATE TABLE IF NOT EXISTS custom_field_sections (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('property', 'unit', 'lease', 'contact', 'work_order', 'bill')),
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cf_sections_operator ON custom_field_sections(operator_id, entity_type) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS custom_field_definitions (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    section_id TEXT REFERENCES custom_field_sections(id),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('property', 'unit', 'lease', 'contact', 'work_order', 'bill')),
    field_name TEXT NOT NULL,
    field_label TEXT NOT NULL,
    data_type TEXT NOT NULL CHECK (data_type IN ('string', 'number', 'currency', 'boolean', 'date', 'select')),
    is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
    default_value TEXT,
    options_json TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_fields_unique ON custom_field_definitions(operator_id, entity_type, field_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_custom_fields_section ON custom_field_definitions(operator_id, section_id) WHERE deleted_at IS NULL;
