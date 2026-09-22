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

      // Post rental income into 4010 for this property in month 2026-09
      const rentAcc = ChartOfAccountsRepository.getAccountByMapping('rent')!;
      const arAcc = ChartOfAccountsRepository.getAccountByMapping('accounts_receivable')!;
      const rentDate = Date.UTC(2026, 8, 15);

      JournalService.postEntry({
        date_ms: rentDate,
        memo: 'Monthly Rent Collected',
        source_type: 'rent',
        lines: [
          { account_id: arAcc.id, debit_cents: 250000, credit_cents: 0, property_id: propertyId },
          { account_id: rentAcc.id, debit_cents: 0, credit_cents: 250000, property_id: propertyId }
        ]
      });

      // Calculate fee: 8% of $2,500.00 = $200.00 (20000 cents)
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
});
