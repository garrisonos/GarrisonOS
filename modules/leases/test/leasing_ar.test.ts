import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { LeasesRepository } from '../backend/repository.js';
import { AccountingRepository } from '../../accounting/backend/repository.js';
import { generateMonthlyRentCharges } from '../../accounting/backend/billing.js';
import { JournalService } from '../../accounting/backend/journal.js';
import { ChartOfAccountsRepository } from '../../accounting/backend/chart_of_accounts.js';

describe('Leases Module - Leasing AR & Fee Policy Engine', () => {
  beforeEach(() => {
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  function setupLeaseFixture(operatorId: string) {
    ChartOfAccountsRepository.ensureDefaultAccounts();
    const db = getDatabase();
    const now = Date.now();
    const propertyId = generateUUIDv7();
    const unitId = generateUUIDv7();
    const contactId = generateUUIDv7();
    const leaseId = generateUUIDv7();

    db.prepare(`
      INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
      VALUES (?, ?, 'Highland Towers', 'multi_family', '100 Highland Ave', 'Austin', 'TX', '78704', ?, ?)
    `).run(propertyId, operatorId, now, now);

    db.prepare(`
      INSERT INTO units (id, operator_id, property_id, unit_number, market_rent_cents, status, created_at, updated_at)
      VALUES (?, ?, ?, '4B', 200000, 'occupied', ?, ?)
    `).run(unitId, operatorId, propertyId, now, now);

    db.prepare(`
      INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, email, created_at, updated_at)
      VALUES (?, ?, 'tenant', 'John', 'Doe', 'john@example.com', ?, ?)
    `).run(contactId, operatorId, now, now);

    // Active lease starting Jan 1 2026, ending Dec 31 2026
    const startDate = Date.UTC(2026, 0, 1);
    const endDate = Date.UTC(2026, 11, 31);

    db.prepare(`
      INSERT INTO leases (
        id, operator_id, unit_id, status, start_date, end_date,
        rent_amount_cents, security_deposit_cents, deposit_held_cents,
        rent_due_day, late_fee_grace_days, late_fee_amount_cents,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'active', ?, ?, 200000, 200000, 200000, 1, 5, 7500, ?, ?)
    `).run(leaseId, operatorId, unitId, startDate, endDate, now, now);

    db.prepare(`
      INSERT INTO lease_contacts (id, operator_id, lease_id, contact_id, role, is_financially_responsible, created_at)
      VALUES (?, ?, ?, ?, 'primary_tenant', 1, ?)
    `).run(generateUUIDv7(), operatorId, leaseId, contactId, now);

    return { propertyId, unitId, contactId, leaseId, startDate, endDate };
  }

  it('configures itemized recurring charges and generates monthly billing with base rent', () => {
    runInOperatorContext('leasing-ar-test', () => {
      const fixture = setupLeaseFixture('leasing-ar-test');

      // Add pet rent and parking fee recurring charges
      const petCharge = LeasesRepository.addRecurringCharge({
        lease_id: fixture.leaseId,
        charge_category: 'pet_rent',
        amount_cents: 5000, // $50.00
        description: 'Monthly Pet Rent - Dog'
      });
      assert.ok(petCharge.id);
      assert.equal(petCharge.amount_cents, 5000);

      const parkingCharge = LeasesRepository.addRecurringCharge({
        lease_id: fixture.leaseId,
        charge_category: 'parking_fee',
        amount_cents: 12500, // $125.00
        description: 'Reserved Parking Space #14'
      });
      assert.ok(parkingCharge.id);

      // List recurring charges
      const charges = LeasesRepository.listRecurringCharges(fixture.leaseId);
      assert.equal(charges.length, 2);

      // Run monthly billing for February 2026
      const billingResult = generateMonthlyRentCharges('2026-02');
      assert.equal(billingResult.leasesProcessed, 1);
      // 1 base rent + 2 recurring charges = 3 charges created
      assert.equal(billingResult.chargesCreated, 3);
      // $2,000 + $50 + $125 = $2,175.00 (217500 cents)
      assert.equal(billingResult.totalChargesCents, 217500);

      // Verify idempotency on second run
      const idempotentRun = generateMonthlyRentCharges('2026-02');
      assert.equal(idempotentRun.chargesCreated, 0);
      assert.equal(idempotentRun.skippedExisting, 3);

      // Soft delete recurring charge
      const deleted = LeasesRepository.deleteRecurringCharge(parkingCharge.id);
      assert.ok(deleted);
      const remainingCharges = LeasesRepository.listRecurringCharges(fixture.leaseId);
      assert.equal(remainingCharges.length, 1);
    });
  });

  it('manages late fee policies, calculates delinquency, and applies double-entry late fees', () => {
    runInOperatorContext('leasing-ar-test', () => {
      const fixture = setupLeaseFixture('leasing-ar-test');

      // Post an unpaid rent charge of $2,000.00 on Jan 1 2026
      const chargeDate = Date.UTC(2026, 0, 1);
      AccountingRepository.createTransaction({
        transaction_type: 'charge',
        category: 'rent',
        amount_cents: 200000,
        transaction_date: chargeDate,
        description: 'January Rent',
        lease_id: fixture.leaseId,
        property_id: fixture.propertyId,
        unit_id: fixture.unitId,
        payer_contact_id: fixture.contactId
      });

      // Create late fee policy: 5% of delinquent balance, 5-day grace, $150 statutory cap
      const policy = LeasesRepository.createLateFeePolicy({
        property_id: fixture.propertyId,
        grace_period_days: 5,
        due_day: 1,
        calculation_type: 'percentage_of_delinquency',
        percentage_bps: 500, // 5%
        delinquency_threshold_cents: 5000,
        statutory_cap_cents: 15000
      });
      assert.ok(policy.id);

      // Check on Jan 4 (day 4 <= 1 + 5 = 6) -> within grace period, fee = 0
      const jan4 = Date.UTC(2026, 0, 4);
      const calcJan4 = LeasesRepository.calculateLateFee(fixture.leaseId, jan4);
      assert.equal(calcJan4.fee_cents, 0);
      assert.equal(calcJan4.is_delinquent, false);

      // Check on Jan 10 (day 10 > 6) -> past grace period
      // Balance is $2,000. 5% of $2,000 = $100.00 (10000 cents)
      const jan10 = Date.UTC(2026, 0, 10);
      const calcJan10 = LeasesRepository.calculateLateFee(fixture.leaseId, jan10);
      assert.equal(calcJan10.is_delinquent, true);
      assert.equal(calcJan10.fee_cents, 10000);
      assert.equal(calcJan10.days_past_due, 4);

      // Apply late fee
      const applyResult = LeasesRepository.applyLateFee(fixture.leaseId, jan10);
      assert.ok(applyResult.applied);
      assert.equal(applyResult.fee_cents, 10000);
      assert.ok(applyResult.journal_entry_id);

      // Verify double-entry GL postings: Dr: 1100 AR, Cr: 4020 Late Fee Income
      const je = JournalService.getEntryById(applyResult.journal_entry_id);
      assert.ok(je);
      const arLine = je.lines?.find((l) => l.account_number === '1100');
      const lateFeeLine = je.lines?.find((l) => l.account_number === '4020');

      assert.ok(arLine);
      assert.equal(arLine.debit_cents, 10000);
      assert.ok(lateFeeLine);
      assert.equal(lateFeeLine.credit_cents, 10000);

      // Verify idempotency: cannot apply second late fee for same month
      const secondApply = LeasesRepository.applyLateFee(fixture.leaseId, jan10);
      assert.equal(secondApply.applied, false);
      assert.ok(secondApply.reason?.includes('already assessed'));
    });
  });

  it('records lease concessions and credits, reducing tenant AR balance', () => {
    runInOperatorContext('leasing-ar-test', () => {
      const fixture = setupLeaseFixture('leasing-ar-test');

      // Charge $2,000 rent
      AccountingRepository.createTransaction({
        transaction_type: 'charge',
        category: 'rent',
        amount_cents: 200000,
        transaction_date: Date.UTC(2026, 0, 1),
        description: 'January Rent',
        lease_id: fixture.leaseId
      });

      // Apply $300 concession (move-in promotional discount)
      const concession = LeasesRepository.addCreditConcession({
        lease_id: fixture.leaseId,
        credit_type: 'promotional_concession',
        amount_cents: 30000, // $300.00
        reason: 'New Year Move-in Special',
        effective_date: Date.UTC(2026, 0, 2)
      });

      assert.ok(concession.id);
      assert.equal(concession.amount_cents, 30000);

      // Verify GL entries: Dr: 4050 Lease Concessions, Cr: 1100 AR
      const credits = LeasesRepository.listCreditConcessions(fixture.leaseId);
      assert.equal(credits.length, 1);

      const je = JournalService.listEntries({ source_type: 'credit_concession' }).entries[0];
      assert.ok(je);
      const concessionLine = je.lines?.find((l) => l.account_number === '4050');
      const arLine = je.lines?.find((l) => l.account_number === '1100');
      assert.ok(concessionLine);
      assert.equal(concessionLine.debit_cents, 30000);
      assert.ok(arLine);
      assert.equal(arLine.credit_cents, 30000);

      // Verify tenant balance reduced to $1,700.00
      const balance = AccountingRepository.getLeaseBalance(fixture.leaseId);
      assert.equal(balance.balanceCents, 170000);
    });
  });

  it('issues security deposit refunds and enforces trust accounting invariants', () => {
    runInOperatorContext('leasing-ar-test', () => {
      const fixture = setupLeaseFixture('leasing-ar-test');
      // Fixture lease holds $2,000.00 (200000 cents) security deposit

      // Attempting to refund $2,500.00 when only $2,000.00 is held should fail
      assert.throws(() => {
        LeasesRepository.issueDepositRefund({
          lease_id: fixture.leaseId,
          recipient_contact_id: fixture.contactId,
          refund_type: 'deposit_disposition',
          refund_amount_cents: 250000,
          disbursement_method: 'ach'
        });
      }, /exceeds currently held deposit balance/);

      // Refund $1,800.00 (e.g. after $200 repairs deduction)
      const refund = LeasesRepository.issueDepositRefund({
        lease_id: fixture.leaseId,
        recipient_contact_id: fixture.contactId,
        refund_type: 'deposit_disposition',
        refund_amount_cents: 180000,
        disbursement_method: 'check',
        check_number: 'CK-1092',
        disbursement_date: Date.UTC(2026, 11, 31)
      });

      assert.ok(refund.id);
      assert.equal(refund.refund_amount_cents, 180000);

      // Verify deposit_held_cents on lease decremented from $2,000 to $200
      const lease = LeasesRepository.getLeaseById(fixture.leaseId);
      assert.equal(lease?.deposit_held_cents, 20000);

      // List deposit refunds
      const refunds = LeasesRepository.listDepositRefunds(fixture.leaseId);
      assert.equal(refunds.length, 1);
      assert.equal(refunds[0]?.check_number, 'CK-1092');

      // Verify GL entries: Dr: 2100 Tenant Security Deposits Held, Cr: 1020 Trust Bank
      const je = JournalService.listEntries({ source_type: 'deposit_refund' }).entries[0];
      assert.ok(je);
      const liabilityLine = je.lines?.find((l) => l.account_number === '2100');
      const trustBankLine = je.lines?.find((l) => l.account_number === '1020');

      assert.ok(liabilityLine);
      assert.equal(liabilityLine.debit_cents, 180000);
      assert.ok(trustBankLine);
      assert.equal(trustBankLine.credit_cents, 180000);

      // Overpayment Return: leaves deposit_held_cents unchanged and Dr 1100 AR / Cr 1010 Operating Bank
      const overpaymentRefund = LeasesRepository.issueDepositRefund({
        lease_id: fixture.leaseId,
        recipient_contact_id: fixture.contactId,
        refund_type: 'overpayment_return',
        refund_amount_cents: 15000,
        disbursement_method: 'ach',
        disbursement_date: Date.UTC(2026, 11, 31)
      });

      assert.ok(overpaymentRefund.id);
      assert.equal(overpaymentRefund.refund_amount_cents, 15000);

      // Verify deposit_held_cents is NOT decremented
      const leaseAfterOverpayment = LeasesRepository.getLeaseById(fixture.leaseId);
      assert.equal(leaseAfterOverpayment?.deposit_held_cents, 20000);

      // Verify GL entries: Dr: 1100 AR, Cr: 1010 Operating Checking
      const overpaymentJe = JournalService.listEntries({ source_type: 'refund' }).entries[0];
      assert.ok(overpaymentJe);
      const arDebitLine = overpaymentJe.lines?.find((l) => l.account_number === '1100');
      const opBankCreditLine = overpaymentJe.lines?.find((l) => l.account_number === '1010');

      assert.ok(arDebitLine);
      assert.equal(arDebitLine.debit_cents, 15000);
      assert.ok(opBankCreditLine);
      assert.equal(opBankCreditLine.credit_cents, 15000);
    });
  });

  it('correctly handles zero AR balance without falling back to legacy transactions', () => {
    runInOperatorContext('leasing-ar-test', () => {
      const fixture = setupLeaseFixture('leasing-ar-test');

      // Post $2,000 rent charge via GL
      const rentDate = Date.UTC(2026, 0, 1);
      const arAcc = ChartOfAccountsRepository.getAccountByMapping('accounts_receivable')!;
      const rentAcc = ChartOfAccountsRepository.getAccountByMapping('rent')!;
      const opBankAcc = ChartOfAccountsRepository.getAccountByMapping('operating_bank')!;

      JournalService.postEntry({
        date_ms: rentDate,
        memo: 'January Rent Billed',
        source_type: 'rent',
        lines: [
          { account_id: arAcc.id, debit_cents: 200000, credit_cents: 0, lease_id: fixture.leaseId, property_id: fixture.propertyId },
          { account_id: rentAcc.id, debit_cents: 0, credit_cents: 200000, lease_id: fixture.leaseId, property_id: fixture.propertyId }
        ]
      });

      // Tenant pays $2,000 in full on Jan 2
      JournalService.postEntry({
        date_ms: Date.UTC(2026, 0, 2),
        memo: 'January Rent Paid',
        source_type: 'payment',
        lines: [
          { account_id: opBankAcc.id, debit_cents: 200000, credit_cents: 0, lease_id: fixture.leaseId, property_id: fixture.propertyId },
          { account_id: arAcc.id, debit_cents: 0, credit_cents: 200000, lease_id: fixture.leaseId, property_id: fixture.propertyId }
        ]
      });

      // Create late fee policy: 5% delinquency, 5 days grace, due day 1
      LeasesRepository.createLateFeePolicy({
        property_id: fixture.propertyId,
        grace_period_days: 5,
        due_day: 1,
        calculation_type: 'percentage_of_delinquency',
        percentage_bps: 500
      });

      // Check on Jan 10 (past grace period). AR balance is 0, so should NOT be delinquent and fee is 0
      const jan10 = Date.UTC(2026, 0, 10);
      const calc = LeasesRepository.calculateLateFee(fixture.leaseId, jan10);
      assert.equal(calc.is_delinquent, false);
      assert.equal(calc.fee_cents, 0);
      assert.equal(calc.balance_cents, 0);
    });
  });
});
