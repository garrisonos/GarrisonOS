import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { PropertiesRepository } from '../../properties/backend/repository.js';
import { ContactsRepository } from '../../contacts/backend/repository.js';
import { MaintenanceRepository } from '../backend/repository.js';
import { AccountsPayableRepository } from '../../accounting/backend/ap.js';
import { ChartOfAccountsRepository } from '../../accounting/backend/chart_of_accounts.js';
import { generateWorkOrderPdf } from '../../../web/lib/pdf.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';

describe('Work Order Expenses & Field Dispatch PDF', () => {
  before(() => {
    getDatabase({ inMemory: true });
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('enforces that vendor must exist and have contact_type = vendor when creating an expense bill', () => {
    runInOperatorContext('op-wo-exp-1', () => {
      const prop = PropertiesRepository.createProperty({
        name: 'Oakridge Terraces',
        property_type: 'multi_family',
        address_line1: '400 Oakridge Ave',
        city: 'Charlotte',
        state: 'NC',
        postal_code: '28202'
      });

      const wo = MaintenanceRepository.createWorkOrder({
        property_id: prop.id,
        title: 'Main HVAC Air Handler Short Circuit',
        description: 'Breaker keeps tripping when HVAC compressor cycles on',
        category: 'hvac',
        priority: 'high',
        estimated_cost_cents: 120000
      });

      const expenseAccount = ChartOfAccountsRepository.getAccountByAccountNumber('5100') ||
        ChartOfAccountsRepository.listAccounts().find((a: any) => a.account_type === 'Expense')!;

      // 1. Creating bill with a non-existent vendor ID must fail
      assert.throws(
        () => {
          AccountsPayableRepository.createBill({
            vendor_id: '00000000-0000-0000-0000-000000000000',
            work_order_id: wo.id,
            invoice_number: 'INV-FAKE-01',
            invoice_date: Date.now(),
            due_date: Date.now() + 86400000,
            total_amount_cents: 45000,
            allocations: [
              {
                property_id: prop.id,
                gl_account_id: expenseAccount.id,
                amount_cents: 45000
              }
            ]
          });
        },
        /not found or unauthorized/
      );

      // 2. Creating bill with a tenant contact (not a vendor) must fail
      const tenantContact = ContactsRepository.createContact({
        contact_type: 'tenant',
        first_name: 'Alice',
        last_name: 'Resident',
        email: 'alice@example.com'
      });

      assert.throws(
        () => {
          AccountsPayableRepository.createBill({
            vendor_id: tenantContact.id,
            work_order_id: wo.id,
            invoice_number: 'INV-TENANT-01',
            invoice_date: Date.now(),
            due_date: Date.now() + 86400000,
            total_amount_cents: 45000,
            allocations: [
              {
                property_id: prop.id,
                gl_account_id: expenseAccount.id,
                amount_cents: 45000
              }
            ]
          });
        },
        /is not a vendor.*Expenses must be associated with an existing vendor contact/
      );

      // 3. Creating bill with a registered vendor contact succeeds
      const vendorContact = ContactsRepository.createContact({
        contact_type: 'vendor',
        first_name: 'Dave',
        last_name: 'HVAC',
        company_name: 'Dave Cooling & Heating Co',
        vendor_specialty: 'hvac',
        w9_received: 1
      });

      const bill = AccountsPayableRepository.createBill({
        vendor_id: vendorContact.id,
        work_order_id: wo.id,
        invoice_number: 'INV-DAVE-101',
        invoice_date: Date.now(),
        due_date: Date.now() + 86400000,
        total_amount_cents: 45000,
        allocations: [
          {
            property_id: prop.id,
            gl_account_id: expenseAccount.id,
            amount_cents: 45000
          }
        ]
      });

      assert.ok(bill.id);
      assert.equal(bill.work_order_id, wo.id);
      assert.equal(bill.vendor_id, vendorContact.id);
    });
  });

  it('tracks work order budget, linked itemized expenses, variance, and over-budget status', () => {
    runInOperatorContext('op-wo-exp-2', () => {
      const prop = PropertiesRepository.createProperty({
        name: 'Highland Park Lofts',
        property_type: 'multi_family',
        address_line1: '120 Highland St',
        city: 'Raleigh',
        state: 'NC',
        postal_code: '27601'
      });

      const vendor = ContactsRepository.createContact({
        contact_type: 'vendor',
        first_name: 'Bob',
        last_name: 'Plumber',
        company_name: 'Bob Flow Solutions',
        vendor_specialty: 'plumbing',
        w9_received: 1
      });

      const expenseAccount = ChartOfAccountsRepository.getAccountByAccountNumber('5100') ||
        ChartOfAccountsRepository.listAccounts().find((a: any) => a.account_type === 'Expense')!;

      // Create work order with authorized budget of $500.00 (50,000 cents)
      const wo = MaintenanceRepository.createWorkOrder({
        property_id: prop.id,
        title: 'Emergency Water Heater Valve Leak',
        description: 'Unit 3B water heater pressure relief valve failed',
        category: 'plumbing',
        priority: 'emergency',
        vendor_contact_id: vendor.id,
        estimated_cost_cents: 50000
      });

      // Initial budget report before bills
      let expSummary = MaintenanceRepository.getWorkOrderExpenses(wo.id);
      assert.equal(expSummary.budget.estimated_cost_cents, 50000);
      assert.equal(expSummary.budget.total_invoiced_cents, 0);
      assert.equal(expSummary.budget.remaining_variance_cents, 50000);
      assert.equal(expSummary.budget.is_over_budget, false);
      assert.equal(expSummary.budget.percent_utilized, 0);
      assert.equal(expSummary.bills.length, 0);

      // 1. Add first bill: Parts ($180.00)
      const bill1 = AccountsPayableRepository.createBill({
        vendor_id: vendor.id,
        work_order_id: wo.id,
        invoice_number: 'INV-PARTS-001',
        invoice_date: Date.now() - 86400000,
        due_date: Date.now() + 14 * 86400000,
        total_amount_cents: 18000,
        allocations: [
          {
            property_id: prop.id,
            gl_account_id: expenseAccount.id,
            amount_cents: 18000
          }
        ]
      });
      assert.ok(bill1.id);

      // Verify work order actual_cost_cents was automatically updated
      let updatedWo = MaintenanceRepository.getWorkOrderById(wo.id);
      assert.equal(updatedWo?.actual_cost_cents, 18000);

      expSummary = MaintenanceRepository.getWorkOrderExpenses(wo.id);
      assert.equal(expSummary.budget.total_invoiced_cents, 18000);
      assert.equal(expSummary.budget.remaining_variance_cents, 32000); // 500 - 180 = 320
      assert.equal(expSummary.budget.is_over_budget, false);
      assert.equal(expSummary.budget.percent_utilized, 36); // 180 / 500 = 36%
      assert.equal(expSummary.bills.length, 1);
      assert.equal(expSummary.bills[0]?.vendor_name, 'Bob Plumber');
      assert.equal(expSummary.bills[0]?.vendor_company, 'Bob Flow Solutions');

      // 2. Add second bill: Emergency Labor ($370.00) => Total $550.00 (Exceeds $500.00 budget)
      const bill2 = AccountsPayableRepository.createBill({
        vendor_id: vendor.id,
        work_order_id: wo.id,
        invoice_number: 'INV-LABOR-002',
        invoice_date: Date.now(),
        due_date: Date.now() + 14 * 86400000,
        total_amount_cents: 37000,
        allocations: [
          {
            property_id: prop.id,
            gl_account_id: expenseAccount.id,
            amount_cents: 37000
          }
        ]
      });
      assert.ok(bill2.id);

      updatedWo = MaintenanceRepository.getWorkOrderById(wo.id);
      assert.equal(updatedWo?.actual_cost_cents, 55000);

      expSummary = MaintenanceRepository.getWorkOrderExpenses(wo.id);
      assert.equal(expSummary.budget.total_invoiced_cents, 55000);
      assert.equal(expSummary.budget.remaining_variance_cents, -5000); // Over by $50.00
      assert.equal(expSummary.budget.is_over_budget, true);
      assert.equal(expSummary.budget.percent_utilized, 110); // 550 / 500 = 110%
      assert.equal(expSummary.bills.length, 2);
    });
  });

  it('generates a comprehensive printable field technician dispatch PDF', () => {
    runInOperatorContext('op-wo-exp-3', () => {
      const prop = PropertiesRepository.createProperty({
        name: 'Cedar Crest Condos',
        property_type: 'condo',
        address_line1: '880 Cedar Crest Way',
        city: 'Durham',
        state: 'NC',
        postal_code: '27701'
      });

      const vendor = ContactsRepository.createContact({
        contact_type: 'vendor',
        first_name: 'Marcus',
        last_name: 'Vance',
        company_name: 'Vance Appliance Repair',
        vendor_specialty: 'appliance',
        phone: '919-555-0199',
        w9_received: 1
      });

      const tenant = ContactsRepository.createContact({
        contact_type: 'tenant',
        first_name: 'Sarah',
        last_name: 'Connor',
        phone: '919-555-0144',
        email: 'sarah.connor@example.com'
      });

      const wo = MaintenanceRepository.createWorkOrder({
        property_id: prop.id,
        requested_by_contact_id: tenant.id,
        vendor_contact_id: vendor.id,
        title: 'Refrigerator Freezer Coils Frozen Over',
        description: 'Freezer temperature is 45F, fan motor making loud buzzing noise. Replace defrost thermostat.',
        category: 'appliance',
        priority: 'high',
        permission_to_enter: true,
        entry_instructions: 'Key in Lockbox code 4821 by side gate',
        estimated_cost_cents: 35000
      });

      // 1. Fetch dispatch data contract
      const dispatchData = MaintenanceRepository.getWorkOrderDispatchData(wo.id);
      assert.ok(dispatchData);
      assert.equal(dispatchData.work_order_id, wo.id);
      assert.ok(dispatchData.ticket_number.startsWith('WO-'));
      assert.equal(dispatchData.title, 'Refrigerator Freezer Coils Frozen Over');
      assert.equal(dispatchData.property_name, 'Cedar Crest Condos');
      assert.ok(dispatchData.property_address.includes('880 Cedar Crest Way'));
      assert.equal(dispatchData.permission_to_enter, true);
      assert.equal(dispatchData.entry_instructions, 'Key in Lockbox code 4821 by side gate');
      assert.equal(dispatchData.requester_name, 'Sarah Connor');
      assert.equal(dispatchData.requester_phone, '919-555-0144');
      assert.equal(dispatchData.vendor_name, 'Marcus Vance');
      assert.equal(dispatchData.vendor_company, 'Vance Appliance Repair');

      // 2. Generate PDF binary buffer
      const pdfBuffer = generateWorkOrderPdf(dispatchData);
      assert.ok(pdfBuffer instanceof Buffer);
      assert.ok(pdfBuffer.length > 500);

      // Verify PDF 1.4 header and trailer invariants
      const pdfHeader = pdfBuffer.subarray(0, 8).toString('latin1');
      assert.ok(pdfHeader.startsWith('%PDF-1.4'));

      const pdfText = pdfBuffer.toString('latin1');
      assert.ok(pdfText.includes('FIELD MAINTENANCE DISPATCH & WORK ORDER SHEET'));
      assert.ok(pdfText.includes('Vance Appliance Repair'));
      assert.ok(pdfText.includes('4821'));
      assert.ok(pdfText.includes('%%EOF'));
    });
  });

  it('allows full editing of work order fields through updateWorkOrder', () => {
    runInOperatorContext('op-wo-exp-4', () => {
      const prop = PropertiesRepository.createProperty({
        name: 'Pinehurst Villas',
        property_type: 'townhouse',
        address_line1: '500 Pinehurst Dr',
        city: 'Cary',
        state: 'NC',
        postal_code: '27511'
      });

      const vendor = ContactsRepository.createContact({
        contact_type: 'vendor',
        first_name: 'Elena',
        last_name: 'Reyes',
        company_name: 'Reyes Electrical Masters',
        vendor_specialty: 'electrical',
        w9_received: 1
      });

      const wo = MaintenanceRepository.createWorkOrder({
        property_id: prop.id,
        title: 'Initial Title',
        description: 'Initial Description',
        category: 'other',
        priority: 'low',
        estimated_cost_cents: 10000
      });

      const updated = MaintenanceRepository.updateWorkOrder(wo.id, {
        title: 'Upgraded Panel Breaker Replacement',
        description: 'Replace standard 15A breaker with arc-fault AFCI breaker',
        category: 'electrical',
        priority: 'high',
        status: 'in_progress',
        vendor_contact_id: vendor.id,
        permission_to_enter: 1,
        entry_instructions: 'Ring doorbell twice before unlocking lockbox 1234',
        scheduled_date: Date.now() + 86400000,
        estimated_cost_cents: 42000
      });

      assert.ok(updated);
      assert.equal(updated.title, 'Upgraded Panel Breaker Replacement');
      assert.equal(updated.description, 'Replace standard 15A breaker with arc-fault AFCI breaker');
      assert.equal(updated.category, 'electrical');
      assert.equal(updated.priority, 'high');
      assert.equal(updated.status, 'in_progress');
      assert.equal(updated.vendor_contact_id, vendor.id);
      assert.equal(updated.vendor_name, 'Elena Reyes');
      assert.equal(updated.permission_to_enter, 1);
      assert.equal(updated.entry_instructions, 'Ring doorbell twice before unlocking lockbox 1234');
      assert.equal(updated.estimated_cost_cents, 42000);
    });
  });
});
