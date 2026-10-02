-- Migration 0009: Dynamic Custom Field Definitions Schema
CREATE TABLE IF NOT EXISTS custom_field_definitions (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('property', 'building', 'unit', 'lease', 'contact', 'work_order')),
    field_name TEXT NOT NULL,
    field_label TEXT NOT NULL,
    data_type TEXT NOT NULL CHECK (data_type IN ('string', 'number', 'boolean', 'date', 'select')),
    options_json TEXT,
    is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cf_defs_op_entity ON custom_field_definitions(operator_id, entity_type) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_defs_op_entity_name ON custom_field_definitions(operator_id, entity_type, field_name) WHERE deleted_at IS NULL;
