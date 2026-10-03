-- Add custom_fields JSON column to leases
ALTER TABLE leases ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';
