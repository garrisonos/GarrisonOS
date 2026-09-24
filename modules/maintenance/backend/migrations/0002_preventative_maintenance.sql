-- Preventative Maintenance Scheduling Subsystem
CREATE TABLE IF NOT EXISTS preventative_maintenance_schedules (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES operators(id),
    property_id TEXT REFERENCES properties(id),
    building_id TEXT REFERENCES buildings(id),
    unit_id TEXT REFERENCES units(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('hvac', 'electrical', 'plumbing', 'fire_safety', 'roofing', 'landscaping', 'winterization', 'general')),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'emergency')),
    frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'semi_annually', 'annually', 'seasonal')),
    seasonal_month INTEGER,
    lead_days INTEGER NOT NULL DEFAULT 7,
    assigned_vendor_contact_id TEXT REFERENCES contacts(id),
    estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
    last_generated_at INTEGER,
    next_due_date INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_prev_maint_operator ON preventative_maintenance_schedules(operator_id, next_due_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prev_maint_property ON preventative_maintenance_schedules(operator_id, property_id) WHERE deleted_at IS NULL;
