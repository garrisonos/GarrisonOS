-- Add custom_fields JSON column to bills
ALTER TABLE bills ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';
