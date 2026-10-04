-- Migration 0010: Dynamic Custom Field Sections and Card Groupings
CREATE TABLE IF NOT EXISTS custom_field_sections (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('property', 'building', 'unit', 'lease', 'contact', 'work_order', 'bill')),
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cf_sections_operator ON custom_field_sections(operator_id, entity_type) WHERE deleted_at IS NULL;

-- Add grouping and ordering columns to custom_field_definitions
ALTER TABLE custom_field_definitions ADD COLUMN section_id TEXT REFERENCES custom_field_sections(id);
ALTER TABLE custom_field_definitions ADD COLUMN default_value TEXT;
ALTER TABLE custom_field_definitions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
