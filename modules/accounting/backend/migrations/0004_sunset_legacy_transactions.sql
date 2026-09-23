-- Migration 0004: Sunset Legacy Single-Entry Transactions & Consolidate Double-Entry General Ledger
-- Adds native lease_id reference to journal_lines for direct lease subledger querying

ALTER TABLE journal_lines ADD COLUMN lease_id TEXT REFERENCES leases(id);
CREATE INDEX IF NOT EXISTS idx_jl_operator_lease ON journal_lines(operator_id, lease_id);

-- Backfill lease_id onto existing journal_lines where linked to single-entry transactions
UPDATE journal_lines
SET lease_id = (
    SELECT t.lease_id
    FROM transactions t
    WHERE t.journal_entry_id = journal_lines.journal_entry_id
      AND t.operator_id = journal_lines.operator_id
      AND t.lease_id IS NOT NULL
)
WHERE lease_id IS NULL;
