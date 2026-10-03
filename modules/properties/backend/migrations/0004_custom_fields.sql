-- Add custom_fields JSON column to properties and units
ALTER TABLE properties ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';
ALTER TABLE units ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';
