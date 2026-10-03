-- Add custom_fields JSON column to contacts
ALTER TABLE contacts ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';
