-- Add custom_fields JSON column to work_orders
ALTER TABLE work_orders ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';
