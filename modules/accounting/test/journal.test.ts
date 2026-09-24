import { test, describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { JournalService } from '../backend/journal.js';
import { ChartOfAccountsRepository } from '../backend/chart_of_accounts.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';

describe('Accounting Module - Native Double-Entry Journal Service', () => {
  before(() => {
    getDatabase({ inMemory: true });
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('enforces debit and credit zero-sum balanced invariant', () => {
    runInOperatorContext('tenant-journal-test', () => {
      ChartOfAccountsRepository.ensureDefaultAccounts();
      const accounts = ChartOfAccountsRepository.listAccounts();
      const ar = accounts.find((a) => a.category_mapping === 'accounts_receivable')!;
      const rent = accounts.find((a) => a.category_mapping === 'rent')!;

      // 1. Post valid balanced entry
      const entry = JournalService.postEntry({
        memo: 'Test Monthly Rent Charge',
        source_type: 'rent_billing',
        lines: [
          {
            account_id: ar.id,
            debit_cents: 150000,
            credit_cents: 0,
            description: 'Tenant AR'
          },
          {
            account_id: rent.id,
            debit_cents: 0,
            credit_cents: 150000,
            description: 'Rental Revenue'
          }
        ]
      });

      assert.ok(entry.id);
      assert.equal(entry.entry_number, 1);
      assert.equal(entry.total_debit_cents, 150000);
      assert.equal(entry.total_credit_cents, 150000);
      assert.equal(entry.lines?.length, 2);

      // 2. Reject unbalanced entry (Debits != Credits)
      assert.throws(() => {
        JournalService.postEntry({
          memo: 'Unbalanced entry test',
          source_type: 'manual_journal',
          lines: [
            { account_id: ar.id, debit_cents: 150000, credit_cents: 0 },
            { account_id: rent.id, debit_cents: 0, credit_cents: 120000 }
          ]
        });
      }, /Unbalanced journal entry/);

      // 3. Reject entry with both debit and credit on single line
      assert.throws(() => {
        JournalService.postEntry({
          memo: 'Invalid line test',
          source_type: 'manual_journal',
          lines: [
            { account_id: ar.id, debit_cents: 10000, credit_cents: 10000 },
            { account_id: rent.id, debit_cents: 0, credit_cents: 0 }
          ]
        });
      }, /never both or neither/);

      // 4. Reject negative amounts
      assert.throws(() => {
        JournalService.postEntry({
          memo: 'Negative amount test',
          source_type: 'manual_journal',
          lines: [
            { account_id: ar.id, debit_cents: -5000, credit_cents: 0 },
            { account_id: rent.id, debit_cents: 0, credit_cents: -5000 }
          ]
        });
      }, /Debit and credit amounts must be non-negative/);
    });
  });

  it('posts reversal entry accurately and marks original entry reversed', () => {
    runInOperatorContext('tenant-journal-test', () => {
      ChartOfAccountsRepository.ensureDefaultAccounts();
      const accounts = ChartOfAccountsRepository.listAccounts();
      const bank = accounts.find((a) => a.category_mapping === 'operating_bank')!;
      const repairs = accounts.find((a) => a.category_mapping === 'repairs')!;

      // Post initial expense entry
      const original = JournalService.postEntry({
        memo: 'Roof Repair Invoice',
        source_type: 'maintenance_expense',
        lines: [
          { account_id: repairs.id, debit_cents: 45000, credit_cents: 0 },
          { account_id: bank.id, debit_cents: 0, credit_cents: 45000 }
        ]
      });

      assert.ok(original.id);
      assert.equal(original.reversed_by_entry_id, null);

      // Reverse entry
      const reversal = JournalService.reverseEntry(original.id, 'Invoice cancelled by contractor');
      assert.ok(reversal.id);
      assert.equal(reversal.source_type, 'reversal');
      assert.equal(reversal.source_id, original.id);

      // Verify original entry is linked
      const updatedOriginal = JournalService.getEntryById(original.id)!;
      assert.equal(updatedOriginal.reversed_by_entry_id, reversal.id);

      // Verify lines are swapped (Debit becomes Credit, Credit becomes Debit)
      const revRepairsLine = reversal.lines?.find((l) => l.account_id === repairs.id);
      const revBankLine = reversal.lines?.find((l) => l.account_id === bank.id);

      assert.equal(revRepairsLine?.credit_cents, 45000);
      assert.equal(revRepairsLine?.debit_cents, 0);
      assert.equal(revBankLine?.debit_cents, 45000);
      assert.equal(revBankLine?.credit_cents, 0);

      // Cannot reverse again
      assert.throws(() => {
        JournalService.reverseEntry(original.id, 'Duplicate reversal');
      }, /already been reversed/);
    });
  });

  it('allows historical account references only in internal historical-reference mode', () => {
    runInOperatorContext('tenant-historical-reference-test', () => {
      const db = getDatabase();
      ChartOfAccountsRepository.ensureDefaultAccounts();
      const accounts = ChartOfAccountsRepository.listAccounts();
      const bank = accounts.find((a) => a.category_mapping === 'operating_bank')!;
      const repairs = accounts.find((a) => a.category_mapping === 'repairs')!;

      db.prepare(`
        UPDATE chart_of_accounts
        SET deleted_at = ?
        WHERE id = ? AND operator_id = ?
      `).run(Date.now(), bank.id, 'tenant-historical-reference-test');

      assert.throws(() => {
        JournalService.postEntry({
          memo: 'Blocked deleted account reference',
          source_type: 'manual_journal',
          lines: [
            { account_id: bank.id, debit_cents: 10000, credit_cents: 0 },
            { account_id: repairs.id, debit_cents: 0, credit_cents: 10000 }
          ]
        });
      }, /Account '.*' does not exist or does not belong to the current (?:operator|tenant)/);

      const entry = JournalService.postEntry({
        memo: 'Historical account reference permitted internally',
        source_type: 'manual_journal',
        lines: [
          { account_id: bank.id, debit_cents: 25000, credit_cents: 0 },
          { account_id: repairs.id, debit_cents: 0, credit_cents: 25000 }
        ]
      }, undefined, { historicalReferenceMode: true });

      assert.ok(entry.id);
      assert.equal(entry.lines?.length, 2);
    });
  });

  it('computes perfectly balanced Trial Balance report', () => {
    runInOperatorContext('tenant-trial-balance-test', () => {
      ChartOfAccountsRepository.ensureDefaultAccounts();
      const accounts = ChartOfAccountsRepository.listAccounts();
      const ar = accounts.find((a) => a.category_mapping === 'accounts_receivable')!;
      const rent = accounts.find((a) => a.category_mapping === 'rent')!;
      const bank = accounts.find((a) => a.category_mapping === 'operating_bank')!;

      // 1. Rent Charge: Dr AR $2,000, Cr Rent $2,000
      JournalService.postEntry({
        memo: 'Unit 101 Rent Charge',
        source_type: 'rent_billing',
        lines: [
          { account_id: ar.id, debit_cents: 200000, credit_cents: 0 },
          { account_id: rent.id, debit_cents: 0, credit_cents: 200000 }
        ]
      });

      // 2. Tenant Payment: Dr Bank $2,000, Cr AR $2,000
      JournalService.postEntry({
        memo: 'Unit 101 Rent Payment',
        source_type: 'tenant_payment',
        lines: [
          { account_id: bank.id, debit_cents: 200000, credit_cents: 0 },
          { account_id: ar.id, debit_cents: 0, credit_cents: 200000 }
        ]
      });

      const report = JournalService.getTrialBalance();
      assert.ok(report.isBalanced);
      assert.equal(report.totalDebitCents, 400000);
      assert.equal(report.totalCreditCents, 400000);

      const arReport = report.accounts.find((a) => a.account_id === ar.id);
      const bankReport = report.accounts.find((a) => a.account_id === bank.id);
      const rentReport = report.accounts.find((a) => a.account_id === rent.id);

      assert.equal(arReport?.net_balance_cents, 0); // Settled
      assert.equal(bankReport?.net_balance_cents, 200000); // Asset debit
      assert.equal(rentReport?.net_balance_cents, 200000); // Revenue credit
    });
  });

  it('excludes future journal entries from Trial Balance as-of cutoff date', () => {
    runInOperatorContext('tenant-cutoff-test', () => {
      ChartOfAccountsRepository.ensureDefaultAccounts();
      const accounts = ChartOfAccountsRepository.listAccounts();
      const ar = accounts.find((a) => a.category_mapping === 'accounts_receivable')!;
      const rent = accounts.find((a) => a.category_mapping === 'rent')!;

      const cutoff = 1700000000000;

      // 1. Entry before cutoff
      JournalService.postEntry({
        date_ms: cutoff - 10000,
        memo: 'Historical Rent Charge',
        source_type: 'rent_billing',
        lines: [
          { account_id: ar.id, debit_cents: 100000, credit_cents: 0 },
          { account_id: rent.id, debit_cents: 0, credit_cents: 100000 }
        ]
      });

      // 2. Future entry after cutoff
      JournalService.postEntry({
        date_ms: cutoff + 100000,
        memo: 'Future Rent Charge',
        source_type: 'rent_billing',
        lines: [
          { account_id: ar.id, debit_cents: 250000, credit_cents: 0 },
          { account_id: rent.id, debit_cents: 0, credit_cents: 250000 }
        ]
      });

      // As-of cutoff report should only sum historical entry
      const report = JournalService.getTrialBalance(cutoff);
      assert.ok(report.isBalanced);
      assert.equal(report.totalDebitCents, 100000);
      assert.equal(report.totalCreditCents, 100000);

      const arItem = report.accounts.find((a) => a.account_id === ar.id);
      assert.equal(arItem?.total_debit_cents, 100000);
    });
  });

  it('rejects foreign entity references belonging to other tenants', () => {
    runInOperatorContext('tenant-a', () => {
      ChartOfAccountsRepository.ensureDefaultAccounts();
    });

    runInOperatorContext('tenant-b', () => {
      ChartOfAccountsRepository.ensureDefaultAccounts();
      const tenantBAccounts = ChartOfAccountsRepository.listAccounts();
      const bRent = tenantBAccounts.find((a) => a.category_mapping === 'rent')!;

      runInOperatorContext('tenant-a', () => {
        const tenantAAccounts = ChartOfAccountsRepository.listAccounts();
        const aAr = tenantAAccounts.find((a) => a.category_mapping === 'accounts_receivable')!;

        // Attempting to use tenant B's account in tenant A's journal entry must fail
        assert.throws(() => {
          JournalService.postEntry({
            memo: 'Cross tenant attack',
            source_type: 'manual_journal',
            lines: [
              { account_id: aAr.id, debit_cents: 50000, credit_cents: 0 },
              { account_id: bRent.id, debit_cents: 0, credit_cents: 50000 }
            ]
          });
        }, /does not exist or does not belong to the current (?:operator|tenant)/);
      });
    });
  });

  it('preserves zero-activity accounts with zero balances in property-specific trial balance', () => {
    runInOperatorContext('prop-tb-zero-activity-test', () => {
      ChartOfAccountsRepository.ensureDefaultAccounts();
      const allAccounts = ChartOfAccountsRepository.listAccounts();
      assert.ok(allAccounts.length > 5);

      const ar = allAccounts.find((a) => a.category_mapping === 'accounts_receivable')!;
      const rent = allAccounts.find((a) => a.category_mapping === 'rent')!;
      const db = getDatabase();
      const now = Date.now();
      const targetPropertyId = 'prop-unit-alpha-1';
      const otherPropertyId = 'prop-unit-beta-2';

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'prop-tb-zero-activity-test', 'Property Alpha', 'multi_family', '100 Main', 'Austin', 'TX', '78701', ?, ?),
               (?, 'prop-tb-zero-activity-test', 'Property Beta', 'multi_family', '200 Main', 'Austin', 'TX', '78701', ?, ?)
      `).run(targetPropertyId, now, now, otherPropertyId, now, now);

      // Post activity only for targetPropertyId on two accounts
      JournalService.postEntry({
        memo: 'Property Alpha Rent Charge',
        source_type: 'rent_billing',
        lines: [
          { account_id: ar.id, debit_cents: 125000, credit_cents: 0, property_id: targetPropertyId },
          { account_id: rent.id, debit_cents: 0, credit_cents: 125000, property_id: targetPropertyId }
        ]
      });

      // Post activity on another property
      JournalService.postEntry({
        memo: 'Property Beta Rent Charge',
        source_type: 'rent_billing',
        lines: [
          { account_id: ar.id, debit_cents: 200000, credit_cents: 0, property_id: otherPropertyId },
          { account_id: rent.id, debit_cents: 0, credit_cents: 200000, property_id: otherPropertyId }
        ]
      });

      // Query property-scoped trial balance for Property Alpha
      const report = JournalService.getTrialBalance(undefined, targetPropertyId);
      assert.ok(report.isBalanced);
      assert.equal(report.totalDebitCents, 125000);
      assert.equal(report.totalCreditCents, 125000);

      // Verify that all Chart of Accounts accounts remain present in the report
      assert.equal(report.accounts.length, allAccounts.length);

      // Verify zero-activity account has 0 debit and 0 credit
      const bank = allAccounts.find((a) => a.category_mapping === 'operating_bank')!;
      const bankItem = report.accounts.find((a) => a.account_id === bank.id);
      assert.ok(bankItem);
      assert.equal(bankItem.total_debit_cents, 0);
      assert.equal(bankItem.total_credit_cents, 0);
      assert.equal(bankItem.net_balance_cents, 0);

      // Verify active account has exact property amount
      const arItem = report.accounts.find((a) => a.account_id === ar.id);
      assert.ok(arItem);
      assert.equal(arItem.total_debit_cents, 125000);
      assert.equal(arItem.total_credit_cents, 0);
    });
  });
});

