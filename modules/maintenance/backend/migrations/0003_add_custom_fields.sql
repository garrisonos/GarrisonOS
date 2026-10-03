-- Migration 0003: Add custom_fields JSON column to work_orders table
ALTER TABLE work_orders ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}';
