-- Multi-Vendor Support for Maintenance Work Orders
CREATE TABLE IF NOT EXISTS work_order_vendors (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    work_order_id TEXT NOT NULL,
    vendor_contact_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'contractor',
    notes TEXT,
    assigned_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id),
    FOREIGN KEY (vendor_contact_id) REFERENCES contacts(id)
);
CREATE INDEX IF NOT EXISTS idx_wo_vendors_operator_wo ON work_order_vendors(operator_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_wo_vendors_operator_vendor ON work_order_vendors(operator_id, vendor_contact_id);

-- Hold reason column for work orders placed on hold
ALTER TABLE work_orders ADD COLUMN hold_reason TEXT;
