import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { ClientAccountingRepository } from '../backend/client_accounting.js';
import { ChartOfAccountsRepository } from '../backend/chart_of_accounts.js';
import { JournalService } from '../backend/journal.js';

describe('Accounting Module - Client Accounting & Management Fees', () => {
  beforeEach(() => {
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('records capital contribution and posts double-entry GL (Dr: 1010, Cr: 3010)', () => {
    runInOperatorContext('client-acct-test', () => {
      const db = getDatabase();
      const portfolioId = generateUUIDv7();
      const propertyId = generateUUIDv7();
      const contactId = generateUUIDv7();
      const now = Date.now();

      // Seed portfolio, property, and client contact
      db.prepare(`
        INSERT INTO portfolios (id, operator_id, name, created_at, updated_at)
        VALUES (?, 'client-acct-test', 'Downtown Portfolio', ?, ?)
      `).run(portfolioId, now, now);

      db.prepare(`
        INSERT INTO properties (id, operator_id, portfolio_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'client-acct-test', ?, ?, 'multi_family', '123 Main', 'Austin', 'TX', '78701', ?, ?)
      `).run(propertyId, portfolioId, 'Property ' + propertyId, now, now);

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, email, created_at, updated_at)
        VALUES (?, 'client-acct-test', 'owner', 'Alice', 'Owner', 'alice@example.com', ?, ?)
      `).run(contactId, now, now);

      const contribution = ClientAccountingRepository.createCapitalContribution({
        portfolio_id: portfolioId,
        property_id: propertyId,
        client_contact_id: contactId,
        amount_cents: 500000, // $5,000.00
        contribution_date: now,
        memo: 'Initial property reserve capital'
      });

      assert.ok(contribution.id);
      assert.equal(contribution.amount_cents, 500000);

      // Verify journal entry lines
      const je = JournalService.listEntries({ source_type: 'client_contribution' }).entries[0];
      assert.ok(je);
      assert.equal(je.lines?.length, 2);

      const opLine = je.lines?.find((l) => l.account_number === '1010');
      const equityLine = je.lines?.find((l) => l.account_number === '3010');

      assert.ok(opLine);
      assert.equal(opLine.debit_cents, 500000);
      assert.equal(opLine.credit_cents, 0);

      assert.ok(equityLine);
      assert.equal(equityLine.debit_cents, 0);
      assert.equal(equityLine.credit_cents, 500000);

      // Verify net cash balance reflects contribution
      const cash = ClientAccountingRepository.getPortfolioCashSummary(portfolioId);
      assert.equal(cash.total_contributions_cents, 500000);
      assert.equal(cash.available_for_distribution_cents, 500000);
    });
  });

  it('records owner distribution and tracks available cash', () => {
    runInOperatorContext('client-acct-test', () => {
      const db = getDatabase();
      const portfolioId = generateUUIDv7();
      const propertyId = generateUUIDv7();
      const contactId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO portfolios (id, operator_id, name, created_at, updated_at)
        VALUES (?, 'client-acct-test', 'Austin Core Portfolio', ?, ?)
      `).run(portfolioId, now, now);

      db.prepare(`
        INSERT INTO properties (id, operator_id, portfolio_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'client-acct-test', ?, 'Parkside Plaza', 'multi_family', '456 Oak', 'Austin', 'TX', '78702', ?, ?)
      `).run(propertyId, portfolioId, now, now);

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, email, created_at, updated_at)
        VALUES (?, 'client-acct-test', 'owner', 'Bob', 'Investor', 'bob@example.com', ?, ?)
      `).run(contactId, now, now);

      // Fund property with $10,000 contribution
      ClientAccountingRepository.createCapitalContribution({
        portfolio_id: portfolioId,
        property_id: propertyId,
        client_contact_id: contactId,
        amount_cents: 1000000,
        contribution_date: now
      });

      // Distribute $4,000
      const dist = ClientAccountingRepository.createDistribution({
        portfolio_id: portfolioId,
        property_id: propertyId,
        client_contact_id: contactId,
        amount_cents: 400000,
        disbursement_method: 'ach',
        distribution_date: now,
        memo: 'Q3 Net Profit Draw'
      });

      assert.ok(dist.id);
      assert.equal(dist.amount_cents, 400000);

      // Verify GL postings: Dr: 3020 Owner Draws, Cr: 1010 Operating Checking
      const je = JournalService.listEntries({ source_type: 'client_draw' }).entries[0];
      assert.ok(je);
      const drawLine = je.lines?.find((l) => l.account_number === '3020');
      const opLine = je.lines?.find((l) => l.account_number === '1010');

      assert.ok(drawLine);
      assert.equal(drawLine.debit_cents, 400000);
      assert.ok(opLine);
      assert.equal(opLine.credit_cents, 400000);

      // Verify remaining cash available for distribution
      const cash = ClientAccountingRepository.getPortfolioCashSummary(portfolioId);
      assert.equal(cash.total_contributions_cents, 1000000);
      assert.equal(cash.total_distributions_cents, 400000);
      assert.equal(cash.available_for_distribution_cents, 600000);
    });
  });

  it('manages fee agreements and calculates percentage & flat fees accurately', () => {
    runInOperatorContext('client-acct-test', () => {
      const db = getDatabase();
      const portfolioId = generateUUIDv7();
      const propertyId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO portfolios (id, operator_id, name, created_at, updated_at)
        VALUES (?, 'client-acct-test', 'Lakeview Portfolio', ?, ?)
      `).run(portfolioId, now, now);

      db.prepare(`
        INSERT INTO properties (id, operator_id, portfolio_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'client-acct-test', ?, 'Lakeview Lofts', 'multi_family', '789 Pine', 'Austin', 'TX', '78703', ?, ?)
      `).run(propertyId, portfolioId, now, now);

      // Create 8% management fee agreement (800 bps)
      const agreement = ClientAccountingRepository.createManagementFeeAgreement({
        property_id: propertyId,
        calculation_method: 'percentage_collected_revenue',
        percentage_bps: 800
      });

      assert.ok(agreement.id);
      assert.equal(agreement.percentage_bps, 800);

      // Post rental charge and tenant cash payment for this property in month 2026-09
      const rentAcc = ChartOfAccountsRepository.getAccountByMapping('rent')!;
      const arAcc = ChartOfAccountsRepository.getAccountByMapping('accounts_receivable')!;
      const opBankAcc = ChartOfAccountsRepository.getAccountByMapping('operating_bank')!;
      const rentDate = Date.UTC(2026, 8, 15);

      // Rent charge: Dr AR, Cr Rent Income
      JournalService.postEntry({
        date_ms: rentDate,
        memo: 'Monthly Rent Charged',
        source_type: 'rent',
        lines: [
          { account_id: arAcc.id, debit_cents: 250000, credit_cents: 0, property_id: propertyId },
          { account_id: rentAcc.id, debit_cents: 0, credit_cents: 250000, property_id: propertyId }
        ]
      });

      // Tenant cash payment: Dr Operating Bank, Cr AR
      JournalService.postEntry({
        date_ms: rentDate + 1000,
        memo: 'Monthly Rent Payment Collected',
        source_type: 'payment',
        lines: [
          { account_id: opBankAcc.id, debit_cents: 250000, credit_cents: 0, property_id: propertyId },
          { account_id: arAcc.id, debit_cents: 0, credit_cents: 250000, property_id: propertyId }
        ]
      });

      // Calculate fee: 8% of $2,500.00 collected = $200.00 (20000 cents)
      const calc = ClientAccountingRepository.calculateManagementFee(agreement.id, '2026-09');
      assert.equal(calc.calculatedFeeCents, 20000);
      assert.equal(calc.collectedRevenueCents, 250000);

      // Post management fee double-entry
      const postResult = ClientAccountingRepository.postManagementFee(agreement.id, '2026-09');
      assert.ok(postResult.journalEntry);
      assert.equal(postResult.feeCents, 20000);

      // Verify GL entries: Dr: 5070 Management Fees Expense, Cr: 2010 AP
      const feeJe = JournalService.getEntryById(postResult.journalEntry.id);
      assert.ok(feeJe);
      const feeExpLine = feeJe.lines?.find((l) => l.account_number === '5070');
      const apLine = feeJe.lines?.find((l) => l.account_number === '2010');

      assert.ok(feeExpLine);
      assert.equal(feeExpLine.debit_cents, 20000);
      assert.ok(apLine);
      assert.equal(apLine.credit_cents, 20000);

      // Posting again in same month throws error for duplicate
      assert.throws(() => {
        ClientAccountingRepository.postManagementFee(agreement.id, '2026-09');
      }, /already posted/);
    });
  });

  it('enforces cash sufficiency on distributions and rejects trust accounts or non-bank accounts', () => {
    runInOperatorContext('client-acct-test', () => {
      const db = getDatabase();
      const portfolioId = generateUUIDv7();
      const propertyId = generateUUIDv7();
      const contactId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO portfolios (id, operator_id, name, created_at, updated_at)
        VALUES (?, 'client-acct-test', 'Westlake Portfolio', ?, ?)
      `).run(portfolioId, now, now);

      db.prepare(`
        INSERT INTO properties (id, operator_id, portfolio_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'client-acct-test', ?, 'Westlake Villa', 'single_family', '500 Westlake', 'Austin', 'TX', '78746', ?, ?)
      `).run(propertyId, portfolioId, now, now);

      db.prepare(`
        INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, email, created_at, updated_at)
        VALUES (?, 'client-acct-test', 'owner', 'Carol', 'Danvers', 'carol@example.com', ?, ?)
      `).run(contactId, now, now);

      const trustAcc = ChartOfAccountsRepository.getAccountByMapping('trust_bank')!;
      const expenseAcc = ChartOfAccountsRepository.getAccountByMapping('repairs')!;

      // 1. Rejects capital contribution into trust account
      assert.throws(() => {
        ClientAccountingRepository.createCapitalContribution({
          portfolio_id: portfolioId,
          property_id: propertyId,
          client_contact_id: contactId,
          amount_cents: 100000,
          contribution_date: now,
          destination_account_id: trustAcc.id
        });
      }, /Capital contributions must be deposited into an operating bank account/);

      // 2. Rejects capital contribution into non-bank account
      assert.throws(() => {
        ClientAccountingRepository.createCapitalContribution({
          portfolio_id: portfolioId,
          property_id: propertyId,
          client_contact_id: contactId,
          amount_cents: 100000,
          contribution_date: now,
          destination_account_id: expenseAcc.id
        });
      }, /Capital contributions must be deposited into an operating bank account/);

      // Fund property with $2,000 valid contribution
      ClientAccountingRepository.createCapitalContribution({
        portfolio_id: portfolioId,
        property_id: propertyId,
        client_contact_id: contactId,
        amount_cents: 200000,
        contribution_date: now
      });

      // 3. Rejects distribution from trust account
      assert.throws(() => {
        ClientAccountingRepository.createDistribution({
          portfolio_id: portfolioId,
          property_id: propertyId,
          client_contact_id: contactId,
          amount_cents: 50000,
          disbursement_method: 'ach',
          distribution_date: now,
          source_account_id: trustAcc.id
        });
      }, /Distributions must be funded from an operating bank account/);

      // 4. Rejects distribution exceeding available cash
      assert.throws(() => {
        ClientAccountingRepository.createDistribution({
          portfolio_id: portfolioId,
          property_id: propertyId,
          client_contact_id: contactId,
          amount_cents: 250000, // Available is $2,000.00
          disbursement_method: 'ach',
          distribution_date: now
        });
      }, /Insufficient available cash for distribution/);
    });
  });

  it('validates targetYearMonth format strictly and supports cash vs accrual basis in cash summary', () => {
    runInOperatorContext('client-acct-test', () => {
      const db = getDatabase();
      const portfolioId = generateUUIDv7();
      const propertyId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO portfolios (id, operator_id, name, created_at, updated_at)
        VALUES (?, 'client-acct-test', 'South Congress Portfolio', ?, ?)
      `).run(portfolioId, now, now);

      db.prepare(`
        INSERT INTO properties (id, operator_id, portfolio_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'client-acct-test', ?, 'SoCo Apartments', 'multi_family', '1400 S Congress', 'Austin', 'TX', '78704', ?, ?)
      `).run(propertyId, portfolioId, now, now);

      const agreement = ClientAccountingRepository.createManagementFeeAgreement({
        property_id: propertyId,
        calculation_method: 'percentage_collected_revenue',
        percentage_bps: 1000
      });

      // Invalid targetYearMonth formats
      assert.throws(() => {
        ClientAccountingRepository.calculateManagementFee(agreement.id, '2026-13');
      }, /Expected YYYY-MM/);

      assert.throws(() => {
        ClientAccountingRepository.calculateManagementFee(agreement.id, '2026-9');
      }, /Expected YYYY-MM/);

      assert.throws(() => {
        ClientAccountingRepository.calculateManagementFee(agreement.id, 'invalid');
      }, /Expected YYYY-MM/);

      // Verify cash vs accrual basis in cash summary
      const rentAcc = ChartOfAccountsRepository.getAccountByMapping('rent')!;
      const arAcc = ChartOfAccountsRepository.getAccountByMapping('accounts_receivable')!;
      const opBankAcc = ChartOfAccountsRepository.getAccountByMapping('operating_bank')!;
      const repairsAcc = ChartOfAccountsRepository.getAccountByMapping('repairs')!;

      // 1. Post rent charge: Dr AR, Cr Rent (Accrual income, but $0 cash in bank)
      JournalService.postEntry({
        date_ms: now,
        memo: 'Accrual Rent Billed',
        source_type: 'rent',
        lines: [
          { account_id: arAcc.id, debit_cents: 300000, credit_cents: 0, property_id: propertyId },
          { account_id: rentAcc.id, debit_cents: 0, credit_cents: 300000, property_id: propertyId }
        ]
      });

      // Cash summary on cash basis: $0 operating cash receipts
      const cashSummary = ClientAccountingRepository.getPortfolioCashSummary(portfolioId, now, 'cash');
      assert.equal(cashSummary.basis, 'cash');
      assert.equal(cashSummary.total_operating_receipts_cents, 0);

      // Cash summary on accrual basis: $3,000 operating cash receipts
      const accrualSummary = ClientAccountingRepository.getPortfolioCashSummary(portfolioId, now, 'accrual');
      assert.equal(accrualSummary.basis, 'accrual');
      assert.equal(accrualSummary.total_operating_receipts_cents, 300000);

      // 2. Post cash payment: Dr Operating Bank, Cr AR
      JournalService.postEntry({
        date_ms: now,
        memo: 'Cash Payment Received',
        source_type: 'payment',
        lines: [
          { account_id: opBankAcc.id, debit_cents: 300000, credit_cents: 0, property_id: propertyId },
          { account_id: arAcc.id, debit_cents: 0, credit_cents: 300000, property_id: propertyId }
        ]
      });

      // Now cash basis reflects the $3,000 cash collection
      const cashSummaryAfterPayment = ClientAccountingRepository.getPortfolioCashSummary(portfolioId, now, 'cash');
      assert.equal(cashSummaryAfterPayment.total_operating_receipts_cents, 300000);
      assert.equal(cashSummaryAfterPayment.available_for_distribution_cents, 300000);

      // 3. Post a cash expense: Dr Repairs, Cr Operating Bank
      JournalService.postEntry({
        date_ms: now,
        memo: 'Cash Repair Expense',
        source_type: 'expense',
        lines: [
          { account_id: repairsAcc.id, debit_cents: 100000, credit_cents: 0, property_id: propertyId },
          { account_id: opBankAcc.id, debit_cents: 0, credit_cents: 100000, property_id: propertyId }
        ]
      });

      // Gross cash flows are reported independently rather than netting bank activity.
      const cashSummaryAfterExpense = ClientAccountingRepository.getPortfolioCashSummary(portfolioId, now, 'cash');
      assert.equal(cashSummaryAfterExpense.total_operating_receipts_cents, 300000);
      assert.equal(cashSummaryAfterExpense.total_operating_disbursements_cents, 100000);
      assert.equal(cashSummaryAfterExpense.available_for_distribution_cents, 200000);
    });
  });
});
