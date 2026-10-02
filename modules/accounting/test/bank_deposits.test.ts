import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { BankDepositsRepository } from '../backend/bank_deposits.js';
import { ChartOfAccountsRepository } from '../backend/chart_of_accounts.js';
import { JournalService } from '../backend/journal.js';

describe('Accounting Module - Bank Deposits & Batched Clearing', () => {
  beforeEach(() => {
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('queries undeposited funds and bundles multiple receipts into a single bank deposit', () => {
    runInOperatorContext('deposit-test-op', () => {
      const db = getDatabase();
      const now = Date.now();

      const bankAccount = ChartOfAccountsRepository.getAccountByAccountNumber('1010')!;
      const undepositedAccount = ChartOfAccountsRepository.getAccountByAccountNumber('1030')!;
      const rentIncomeAccount = ChartOfAccountsRepository.getAccountByAccountNumber('4010')!;

      // Simulate 2 incoming tenant rent check payments debited to 1030 Undeposited Funds
      const entry1 = JournalService.postEntry({
        date_ms: now,
        memo: 'Tenant Rent Payment - Unit 101 (Check #4501)',
        source_type: 'tenant_payment',
        lines: [
          { account_id: undepositedAccount.id, debit_cents: 120000, credit_cents: 0 },
          { account_id: rentIncomeAccount.id, debit_cents: 0, credit_cents: 120000 }
        ]
      });

      const entry2 = JournalService.postEntry({
        date_ms: now,
        memo: 'Tenant Rent Payment - Unit 102 (Check #8812)',
        source_type: 'tenant_payment',
        lines: [
          { account_id: undepositedAccount.id, debit_cents: 150000, credit_cents: 0 },
          { account_id: rentIncomeAccount.id, debit_cents: 0, credit_cents: 150000 }
        ]
      });

      // Query undeposited receipts
      const undeposited = BankDepositsRepository.listUndepositedReceipts();
      assert.equal(undeposited.length, 2);
      assert.equal(undeposited[0]!.amount_cents, 120000);
      assert.equal(undeposited[1]!.amount_cents, 150000);

      // Create a batched bank deposit slip ($2,700.00)
      const deposit = BankDepositsRepository.createDeposit({
        bank_account_id: bankAccount.id,
        deposit_date: now,
        deposit_reference: 'DEP-2026-OCT-01',
        memo: 'Daily branch deposit',
        receipt_entry_ids: [entry1.id, entry2.id]
      });

      assert.ok(deposit.id);
      assert.equal(deposit.total_amount_cents, 270000);
      assert.equal(deposit.status, 'cleared');
      assert.equal(deposit.lines?.length, 2);

      // Verify undeposited receipts list is now empty
      const afterDeposit = BankDepositsRepository.listUndepositedReceipts();
      assert.equal(afterDeposit.length, 0);

      // Verify General Ledger clearing entry
      const glEntry = JournalService.listEntries({ source_type: 'bank_deposit' }).entries[0];
      assert.ok(glEntry);
      assert.equal(glEntry.source_id, deposit.id);

      const bankLine = glEntry.lines?.find((l) => l.account_id === bankAccount.id);
      const clearLine = glEntry.lines?.find((l) => l.account_id === undepositedAccount.id);

      assert.ok(bankLine);
      assert.equal(bankLine.debit_cents, 270000);
      assert.equal(bankLine.credit_cents, 0);

      assert.ok(clearLine);
      assert.equal(clearLine.debit_cents, 0);
      assert.equal(clearLine.credit_cents, 270000);
    });
  });

  it('voids a bank deposit slip, reversing the GL entry and returning receipts to undeposited status', () => {
    runInOperatorContext('deposit-test-op', () => {
      const now = Date.now();
      const bankAccount = ChartOfAccountsRepository.getAccountByAccountNumber('1010')!;
      const undepositedAccount = ChartOfAccountsRepository.getAccountByAccountNumber('1030')!;
      const rentIncomeAccount = ChartOfAccountsRepository.getAccountByAccountNumber('4010')!;

      const entry = JournalService.postEntry({
        date_ms: now,
        memo: 'Tenant Payment',
        source_type: 'tenant_payment',
        lines: [
          { account_id: undepositedAccount.id, debit_cents: 90000, credit_cents: 0 },
          { account_id: rentIncomeAccount.id, debit_cents: 0, credit_cents: 90000 }
        ]
      });

      const deposit = BankDepositsRepository.createDeposit({
        bank_account_id: bankAccount.id,
        deposit_date: now,
        deposit_reference: 'DEP-VOID-TEST',
        receipt_entry_ids: [entry.id]
      });

      assert.equal(BankDepositsRepository.listUndepositedReceipts().length, 0);

      // Void deposit
      const voided = BankDepositsRepository.voidDeposit(deposit.id, 'Bank teller entry error');
      assert.equal(voided.status, 'voided');

      // Receipts should be returned to undeposited pool
      const returned = BankDepositsRepository.listUndepositedReceipts();
      assert.equal(returned.length, 1);
      assert.equal(returned[0]!.amount_cents, 90000);

      // GL entry reversed
      const originalEntry = JournalService.listEntries({ source_type: 'bank_deposit' }).entries[0];
      assert.ok(originalEntry);
      assert.ok(originalEntry!.reversed_by_entry_id);
    });
  });
});
