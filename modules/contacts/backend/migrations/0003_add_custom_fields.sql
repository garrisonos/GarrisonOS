-- Migration 0003: Add custom_fields JSON column to contacts table
ALTER TABLE contacts ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';
