-- Migration 0004: Add custom_fields JSON column to leases table
ALTER TABLE leases ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';
