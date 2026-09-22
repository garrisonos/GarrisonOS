import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { ChartOfAccountsRepository } from './chart_of_accounts.js';
import { JournalService, JournalEntryRecord } from './journal.js';
import { eventBus } from '../../../core/events.js';

export interface ClientCapitalContributionRecord {
  id: string;
  operator_id: string;
  client_contact_id: string;
  portfolio_id: string;
  property_id: string | null;
  contribution_date: number;
  amount_cents: number;
  destination_account_id: string;
  reference_number: string | null;
  memo: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_name?: string;
  portfolio_name?: string;
  property_name?: string;
  destination_account_name?: string;
}

export interface ClientDistributionRecord {
  id: string;
  operator_id: string;
  client_contact_id: string;
  portfolio_id: string;
  property_id: string | null;
  distribution_date: number;
  amount_cents: number;
  source_account_id: string;
  disbursement_method: 'check' | 'ach' | 'wire';
  check_number: string | null;
  reference_number: string | null;
  memo: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_name?: string;
  portfolio_name?: string;
  property_name?: string;
  source_account_name?: string;
}

export interface ManagementFeeAgreementRecord {
  id: string;
  operator_id: string;
  portfolio_id: string | null;
  property_id: string | null;
  calculation_method: 'percentage_collected_revenue' | 'flat_fee_per_unit' | 'flat_monthly_fee';
  percentage_bps: number;
  flat_fee_cents: number;
  fee_gl_account_id: string;
  pass_through_expenses: number;
  created_at: number;
  deleted_at: number | null;
  portfolio_name?: string;
  property_name?: string;
  fee_account_name?: string;
}

export interface PortfolioCashSummary {
  portfolio_id: string;
  portfolio_name: string;
  as_of_date_ms: number;
  total_contributions_cents: number;
  total_distributions_cents: number;
  total_operating_receipts_cents: number;
  total_operating_disbursements_cents: number;
  net_operating_cash_cents: number;
  available_for_distribution_cents: number;
  property_summaries: Array<{
    property_id: string;
    property_name: string;
    operating_receipts_cents: number;
    operating_disbursements_cents: number;
    net_cash_cents: number;
  }>;
}

export class ClientAccountingRepository {
  /**
   * Record a capital contribution from a client/owner and post balanced double-entry
   * journal lines: Debit Operating Checking (1010), Credit Owner Capital (3010).
   */
  public static createCapitalContribution(data: {
    client_contact_id: string;
    portfolio_id: string;
    property_id?: string | null;
    amount_cents: number;
    contribution_date?: number;
    destination_account_id?: string;
    reference_number?: string | null;
    memo?: string | null;
  }): ClientCapitalContributionRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    ChartOfAccountsRepository.ensureDefaultAccounts();

    const amount = Math.abs(data.amount_cents);
    if (!amount || amount <= 0) {
      throw new Error('Capital contribution amount must be a positive integer in cents.');
    }

    // Verify client contact ownership
    const contact = db.prepare(`
      SELECT id, first_name, last_name, company_name FROM contacts
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(data.client_contact_id, operatorId) as any;
    if (!contact) {
      throw new Error(`Contact '${data.client_contact_id}' not found for current operator.`);
    }

    // Verify portfolio ownership
    const portfolio = db.prepare(`
      SELECT id, name FROM portfolios
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(data.portfolio_id, operatorId) as any;
    if (!portfolio) {
      throw new Error(`Portfolio '${data.portfolio_id}' not found for current operator.`);
    }

    // Verify property ownership if provided
    if (data.property_id) {
      const property = db.prepare(`
        SELECT id FROM properties
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).get(data.property_id, operatorId);
      if (!property) {
        throw new Error(`Property '${data.property_id}' not found for current operator.`);
      }
    }

    const destAccount = data.destination_account_id
      ? ChartOfAccountsRepository.getAccountById(data.destination_account_id)
      : ChartOfAccountsRepository.getAccountByMapping('operating_bank');
    if (!destAccount) {
      throw new Error('Destination bank account (Operating Checking) not found in Chart of Accounts.');
    }

    const equityAccount = ChartOfAccountsRepository.getAccountByMapping('owner_capital') ||
      ChartOfAccountsRepository.getAccountByAccountNumber('3010');
    if (!equityAccount) {
      throw new Error('Owner Capital account (3010) not found in Chart of Accounts.');
    }

    const id = generateUUIDv7();
    const now = Date.now();
    const contributionDate = data.contribution_date || now;

    withTransaction((tx) => {
      // 1. Post double-entry General Ledger entry
      JournalService.postEntry({
        date_ms: contributionDate,
        memo: data.memo || `Client Capital Contribution - ${portfolio.name}`,
        source_type: 'client_contribution',
        source_id: id,
        lines: [
          {
            account_id: destAccount.id,
            debit_cents: amount,
            credit_cents: 0,
            property_id: data.property_id || null,
            contact_id: data.client_contact_id,
            description: data.memo || 'Owner Capital Contribution Inflow'
          },
          {
            account_id: equityAccount.id,
            debit_cents: 0,
            credit_cents: amount,
            property_id: data.property_id || null,
            contact_id: data.client_contact_id,
            description: data.memo || 'Owner Equity Credit'
          }
        ]
      }, tx);

      // 2. Insert contribution record
      tx.prepare(`
        INSERT INTO client_capital_contributions (
          id, operator_id, client_contact_id, portfolio_id, property_id,
          contribution_date, amount_cents, destination_account_id, reference_number,
          memo, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        operatorId,
        data.client_contact_id,
        data.portfolio_id,
        data.property_id || null,
        contributionDate,
        amount,
        destAccount.id,
        data.reference_number || null,
        data.memo || null,
        now,
        now
      );
    }, db);

    return this.getCapitalContributionById(id)!;
  }

  /**
   * List client capital contributions for the current operator.
   */
  public static listCapitalContributions(filter?: {
    portfolio_id?: string;
    property_id?: string;
    client_contact_id?: string;
    start_date?: number;
    end_date?: number;
  }): ClientCapitalContributionRecord[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    let sql = `
      SELECT
        c.*,
        co.first_name || ' ' || co.last_name as client_name,
        p.name as portfolio_name,
        pr.name as property_name,
        coa.account_name as destination_account_name
      FROM client_capital_contributions c
      JOIN contacts co ON c.client_contact_id = co.id
      JOIN portfolios p ON c.portfolio_id = p.id
      LEFT JOIN properties pr ON c.property_id = pr.id
      JOIN chart_of_accounts coa ON c.destination_account_id = coa.id
      WHERE c.operator_id = ? AND c.deleted_at IS NULL
    `;
    const params: any[] = [operatorId];

    if (filter?.portfolio_id) {
      sql += ' AND c.portfolio_id = ?';
      params.push(filter.portfolio_id);
    }
    if (filter?.property_id) {
      sql += ' AND c.property_id = ?';
      params.push(filter.property_id);
    }
    if (filter?.client_contact_id) {
      sql += ' AND c.client_contact_id = ?';
      params.push(filter.client_contact_id);
    }
    if (filter?.start_date) {
      sql += ' AND c.contribution_date >= ?';
      params.push(filter.start_date);
    }
    if (filter?.end_date) {
      sql += ' AND c.contribution_date <= ?';
      params.push(filter.end_date);
    }

    sql += ' ORDER BY c.contribution_date DESC, c.created_at DESC';
    return db.prepare(sql).all(...params) as unknown as ClientCapitalContributionRecord[];
  }

  /**
   * Get a single capital contribution by ID.
   */
  public static getCapitalContributionById(id: string): ClientCapitalContributionRecord | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT
        c.*,
        co.first_name || ' ' || co.last_name as client_name,
        p.name as portfolio_name,
        pr.name as property_name,
        coa.account_name as destination_account_name
      FROM client_capital_contributions c
      JOIN contacts co ON c.client_contact_id = co.id
      JOIN portfolios p ON c.portfolio_id = p.id
      LEFT JOIN properties pr ON c.property_id = pr.id
      JOIN chart_of_accounts coa ON c.destination_account_id = coa.id
      WHERE c.id = ? AND c.operator_id = ? AND c.deleted_at IS NULL
    `).get(id, operatorId) as ClientCapitalContributionRecord | undefined;

    return row || null;
  }

  /**
   * Record a net operating cash distribution / draw disbursed to an owner/client and
   * post balanced double-entry journal lines: Debit Owner Draws (3020), Credit Operating Checking (1010).
   */
  public static createDistribution(data: {
    client_contact_id: string;
    portfolio_id: string;
    property_id?: string | null;
    amount_cents: number;
    distribution_date?: number;
    source_account_id?: string;
    disbursement_method: 'check' | 'ach' | 'wire';
    check_number?: string | null;
    reference_number?: string | null;
    memo?: string | null;
  }): ClientDistributionRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    ChartOfAccountsRepository.ensureDefaultAccounts();

    const amount = Math.abs(data.amount_cents);
    if (!amount || amount <= 0) {
      throw new Error('Distribution amount must be a positive integer in cents.');
    }

    const validMethods = ['check', 'ach', 'wire'];
    if (!validMethods.includes(data.disbursement_method)) {
      throw new Error(`Invalid disbursement_method '${data.disbursement_method}'. Must be one of: check, ach, wire.`);
    }

    // Verify contact
    const contact = db.prepare(`
      SELECT id, first_name, last_name FROM contacts
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(data.client_contact_id, operatorId);
    if (!contact) {
      throw new Error(`Contact '${data.client_contact_id}' not found for current operator.`);
    }

    // Verify portfolio
    const portfolio = db.prepare(`
      SELECT id, name FROM portfolios
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(data.portfolio_id, operatorId) as any;
    if (!portfolio) {
      throw new Error(`Portfolio '${data.portfolio_id}' not found for current operator.`);
    }

    if (data.property_id) {
      const property = db.prepare(`
        SELECT id FROM properties
        WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).get(data.property_id, operatorId);
      if (!property) {
        throw new Error(`Property '${data.property_id}' not found for current operator.`);
      }
    }

    const sourceAccount = data.source_account_id
      ? ChartOfAccountsRepository.getAccountById(data.source_account_id)
      : ChartOfAccountsRepository.getAccountByMapping('operating_bank');
    if (!sourceAccount) {
      throw new Error('Source bank account (Operating Checking) not found in Chart of Accounts.');
    }

    const drawAccount = ChartOfAccountsRepository.getAccountByMapping('owner_draw') ||
      ChartOfAccountsRepository.getAccountByAccountNumber('3020');
    if (!drawAccount) {
      throw new Error('Owner Draws account (3020) not found in Chart of Accounts.');
    }

    const id = generateUUIDv7();
    const now = Date.now();
    const distributionDate = data.distribution_date || now;

    withTransaction((tx) => {
      // 1. Post double-entry General Ledger entry
      JournalService.postEntry({
        date_ms: distributionDate,
        memo: data.memo || `Client Distribution / Draw - ${portfolio.name}`,
        source_type: 'client_draw',
        source_id: id,
        lines: [
          {
            account_id: drawAccount.id,
            debit_cents: amount,
            credit_cents: 0,
            property_id: data.property_id || null,
            contact_id: data.client_contact_id,
            description: data.memo || 'Owner Draw / Distribution'
          },
          {
            account_id: sourceAccount.id,
            debit_cents: 0,
            credit_cents: amount,
            property_id: data.property_id || null,
            contact_id: data.client_contact_id,
            description: data.memo || `Disbursement (${data.disbursement_method.toUpperCase()})`
          }
        ]
      }, tx);

      // 2. Insert distribution record
      tx.prepare(`
        INSERT INTO client_distributions (
          id, operator_id, client_contact_id, portfolio_id, property_id,
          distribution_date, amount_cents, source_account_id, disbursement_method,
          check_number, reference_number, memo, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        operatorId,
        data.client_contact_id,
        data.portfolio_id,
        data.property_id || null,
        distributionDate,
        amount,
        sourceAccount.id,
        data.disbursement_method,
        data.check_number || null,
        data.reference_number || null,
        data.memo || null,
        now,
        now
      );
    }, db);

    return this.getDistributionById(id)!;
  }

  /**
   * List client distributions for the current operator.
   */
  public static listDistributions(filter?: {
    portfolio_id?: string;
    property_id?: string;
    client_contact_id?: string;
    start_date?: number;
    end_date?: number;
  }): ClientDistributionRecord[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    let sql = `
      SELECT
        d.*,
        co.first_name || ' ' || co.last_name as client_name,
        p.name as portfolio_name,
        pr.name as property_name,
        coa.account_name as source_account_name
      FROM client_distributions d
      JOIN contacts co ON d.client_contact_id = co.id
      JOIN portfolios p ON d.portfolio_id = p.id
      LEFT JOIN properties pr ON d.property_id = pr.id
      JOIN chart_of_accounts coa ON d.source_account_id = coa.id
      WHERE d.operator_id = ? AND d.deleted_at IS NULL
    `;
    const params: any[] = [operatorId];

    if (filter?.portfolio_id) {
      sql += ' AND d.portfolio_id = ?';
      params.push(filter.portfolio_id);
    }
    if (filter?.property_id) {
      sql += ' AND d.property_id = ?';
      params.push(filter.property_id);
    }
    if (filter?.client_contact_id) {
      sql += ' AND d.client_contact_id = ?';
      params.push(filter.client_contact_id);
    }
    if (filter?.start_date) {
      sql += ' AND d.distribution_date >= ?';
      params.push(filter.start_date);
    }
    if (filter?.end_date) {
      sql += ' AND d.distribution_date <= ?';
      params.push(filter.end_date);
    }

    sql += ' ORDER BY d.distribution_date DESC, d.created_at DESC';
    return db.prepare(sql).all(...params) as unknown as ClientDistributionRecord[];
  }

  /**
   * Get a single client distribution by ID.
   */
  public static getDistributionById(id: string): ClientDistributionRecord | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT
        d.*,
        co.first_name || ' ' || co.last_name as client_name,
        p.name as portfolio_name,
        pr.name as property_name,
        coa.account_name as source_account_name
      FROM client_distributions d
      JOIN contacts co ON d.client_contact_id = co.id
      JOIN portfolios p ON d.portfolio_id = p.id
      LEFT JOIN properties pr ON d.property_id = pr.id
      JOIN chart_of_accounts coa ON d.source_account_id = coa.id
      WHERE d.id = ? AND d.operator_id = ? AND d.deleted_at IS NULL
    `).get(id, operatorId) as ClientDistributionRecord | undefined;

    return row || null;
  }

  /**
   * Calculate portfolio-level net operating cash summary and available distribution balance.
   */
  public static getPortfolioCashSummary(portfolioId: string, asOfDateMs?: number): PortfolioCashSummary {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const asOf = asOfDateMs || Date.now();

    const portfolio = db.prepare(`
      SELECT id, name FROM portfolios WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(portfolioId, operatorId) as { id: string; name: string } | undefined;
    if (!portfolio) {
      throw new Error(`Portfolio '${portfolioId}' not found.`);
    }

    // Get properties belonging to this portfolio
    const properties = db.prepare(`
      SELECT id, name FROM properties
      WHERE portfolio_id = ? AND operator_id = ? AND deleted_at IS NULL
      ORDER BY name ASC
    `).all(portfolioId, operatorId) as Array<{ id: string; name: string }>;
    const propertyIds = properties.map((p) => p.id);

    // Sum capital contributions for this portfolio
    const contribRow = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) as total_cents
      FROM client_capital_contributions
      WHERE portfolio_id = ? AND operator_id = ? AND contribution_date <= ? AND deleted_at IS NULL
    `).get(portfolioId, operatorId, asOf) as { total_cents: number };
    const totalContributions = contribRow ? Number(contribRow.total_cents) : 0;

    // Sum distributions for this portfolio
    const distRow = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) as total_cents
      FROM client_distributions
      WHERE portfolio_id = ? AND operator_id = ? AND distribution_date <= ? AND deleted_at IS NULL
    `).get(portfolioId, operatorId, asOf) as { total_cents: number };
    const totalDistributions = distRow ? Number(distRow.total_cents) : 0;

    let totalReceipts = 0;
    let totalDisbursements = 0;
    const propertySummaries: PortfolioCashSummary['property_summaries'] = [];

    // Query operating income and expenses from journal_lines for each property
    for (const prop of properties) {
      // Income credits
      const incRow = db.prepare(`
        SELECT COALESCE(SUM(jl.credit_cents - jl.debit_cents), 0) as total_inc
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.deleted_at IS NULL
        JOIN chart_of_accounts coa ON jl.account_id = coa.id AND coa.deleted_at IS NULL
        WHERE jl.operator_id = ? AND jl.property_id = ? AND coa.account_type = 'Income'
          AND je.date_ms <= ? AND je.reversed_by_entry_id IS NULL
      `).get(operatorId, prop.id, asOf) as { total_inc: number };
      const propInc = Math.max(0, incRow ? Number(incRow.total_inc) : 0);

      // Operating expenses debits
      const expRow = db.prepare(`
        SELECT COALESCE(SUM(jl.debit_cents - jl.credit_cents), 0) as total_exp
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.deleted_at IS NULL
        JOIN chart_of_accounts coa ON jl.account_id = coa.id AND coa.deleted_at IS NULL
        WHERE jl.operator_id = ? AND jl.property_id = ? AND coa.account_type IN ('Expense', 'CostOfGoodsSold')
          AND je.date_ms <= ? AND je.reversed_by_entry_id IS NULL
      `).get(operatorId, prop.id, asOf) as { total_exp: number };
      const propExp = Math.max(0, expRow ? Number(expRow.total_exp) : 0);

      totalReceipts += propInc;
      totalDisbursements += propExp;

      propertySummaries.push({
        property_id: prop.id,
        property_name: prop.name,
        operating_receipts_cents: propInc,
        operating_disbursements_cents: propExp,
        net_cash_cents: propInc - propExp
      });
    }

    const netOperatingCash = totalReceipts - totalDisbursements;
    const availableForDistribution = Math.max(0, netOperatingCash + totalContributions - totalDistributions);

    return {
      portfolio_id: portfolio.id,
      portfolio_name: portfolio.name,
      as_of_date_ms: asOf,
      total_contributions_cents: totalContributions,
      total_distributions_cents: totalDistributions,
      total_operating_receipts_cents: totalReceipts,
      total_operating_disbursements_cents: totalDisbursements,
      net_operating_cash_cents: netOperatingCash,
      available_for_distribution_cents: availableForDistribution,
      property_summaries: propertySummaries
    };
  }

  /**
   * Create a management fee agreement for a portfolio or specific property.
   */
  public static createManagementFeeAgreement(data: {
    portfolio_id?: string | null;
    property_id?: string | null;
    calculation_method: 'percentage_collected_revenue' | 'flat_fee_per_unit' | 'flat_monthly_fee';
    percentage_bps?: number;
    flat_fee_cents?: number;
    fee_gl_account_id?: string;
    pass_through_expenses?: number;
  }): ManagementFeeAgreementRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    ChartOfAccountsRepository.ensureDefaultAccounts();

    const validMethods = ['percentage_collected_revenue', 'flat_fee_per_unit', 'flat_monthly_fee'];
    if (!validMethods.includes(data.calculation_method)) {
      throw new Error(`Invalid calculation_method '${data.calculation_method}'.`);
    }

    if (!data.portfolio_id && !data.property_id) {
      throw new Error('Management fee agreement must specify at least a portfolio_id or property_id.');
    }

    if (data.portfolio_id) {
      const portfolio = db.prepare(`
        SELECT id FROM portfolios WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).get(data.portfolio_id, operatorId);
      if (!portfolio) {
        throw new Error(`Portfolio '${data.portfolio_id}' not found.`);
      }
    }

    if (data.property_id) {
      const property = db.prepare(`
        SELECT id FROM properties WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
      `).get(data.property_id, operatorId);
      if (!property) {
        throw new Error(`Property '${data.property_id}' not found.`);
      }
    }

    const feeAccount = data.fee_gl_account_id
      ? ChartOfAccountsRepository.getAccountById(data.fee_gl_account_id)
      : (ChartOfAccountsRepository.getAccountByMapping('management_fees') ||
         ChartOfAccountsRepository.getAccountByAccountNumber('5070'));
    if (!feeAccount) {
      throw new Error('Property Management Fees account (5070) not found in Chart of Accounts.');
    }

    const id = generateUUIDv7();
    const now = Date.now();

    db.prepare(`
      INSERT INTO management_fee_agreements (
        id, operator_id, portfolio_id, property_id, calculation_method,
        percentage_bps, flat_fee_cents, fee_gl_account_id, pass_through_expenses,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      operatorId,
      data.portfolio_id || null,
      data.property_id || null,
      data.calculation_method,
      data.percentage_bps || 0,
      data.flat_fee_cents || 0,
      feeAccount.id,
      data.pass_through_expenses ? 1 : 0,
      now
    );

    return this.getManagementFeeAgreement(id)!;
  }

  /**
   * List management fee agreements.
   */
  public static listManagementFeeAgreements(filter?: {
    portfolio_id?: string;
    property_id?: string;
  }): ManagementFeeAgreementRecord[] {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    let sql = `
      SELECT
        m.*,
        p.name as portfolio_name,
        pr.name as property_name,
        coa.account_name as fee_account_name
      FROM management_fee_agreements m
      LEFT JOIN portfolios p ON m.portfolio_id = p.id
      LEFT JOIN properties pr ON m.property_id = pr.id
      JOIN chart_of_accounts coa ON m.fee_gl_account_id = coa.id
      WHERE m.operator_id = ? AND m.deleted_at IS NULL
    `;
    const params: any[] = [operatorId];

    if (filter?.portfolio_id) {
      sql += ' AND m.portfolio_id = ?';
      params.push(filter.portfolio_id);
    }
    if (filter?.property_id) {
      sql += ' AND m.property_id = ?';
      params.push(filter.property_id);
    }

    sql += ' ORDER BY m.created_at DESC';
    return db.prepare(sql).all(...params) as unknown as ManagementFeeAgreementRecord[];
  }

  /**
   * Get a single management fee agreement by ID.
   */
  public static getManagementFeeAgreement(id: string): ManagementFeeAgreementRecord | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT
        m.*,
        p.name as portfolio_name,
        pr.name as property_name,
        coa.account_name as fee_account_name
      FROM management_fee_agreements m
      LEFT JOIN portfolios p ON m.portfolio_id = p.id
      LEFT JOIN properties pr ON m.property_id = pr.id
      JOIN chart_of_accounts coa ON m.fee_gl_account_id = coa.id
      WHERE m.id = ? AND m.operator_id = ? AND m.deleted_at IS NULL
    `).get(id, operatorId) as ManagementFeeAgreementRecord | undefined;

    return row || null;
  }

  /**
   * Soft-delete a management fee agreement.
   */
  public static deleteManagementFeeAgreement(id: string): boolean {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();

    const res = db.prepare(`
      UPDATE management_fee_agreements SET deleted_at = ?
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(now, id, operatorId);

    return res.changes > 0;
  }

  /**
   * Calculate management fee for an agreement in a target billing month.
   */
  public static calculateManagementFee(
    agreementId: string,
    targetYearMonth?: string
  ): {
    agreement: ManagementFeeAgreementRecord;
    targetMonth: string;
    collectedRevenueCents: number;
    unitCount: number;
    calculatedFeeCents: number;
    feeDetails: string;
  } {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const agreement = this.getManagementFeeAgreement(agreementId);
    if (!agreement) {
      throw new Error(`Management fee agreement '${agreementId}' not found.`);
    }

    let year: number;
    let monthIndex: number;
    if (targetYearMonth) {
      const [yStr, mStr] = targetYearMonth.split('-');
      year = parseInt(yStr || '', 10);
      monthIndex = parseInt(mStr || '', 10) - 1;
    } else {
      const now = new Date();
      year = now.getUTCFullYear();
      monthIndex = now.getUTCMonth();
    }

    const monthStr = (monthIndex + 1).toString().padStart(2, '0');
    const yyyyMm = `${year}-${monthStr}`;
    const startMs = Date.UTC(year, monthIndex, 1, 0, 0, 0, 0);
    const endMs = Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999);

    // Resolve properties covered by agreement
    let propertyIds: string[] = [];
    if (agreement.property_id) {
      propertyIds = [agreement.property_id];
    } else if (agreement.portfolio_id) {
      const props = db.prepare(`
        SELECT id FROM properties WHERE portfolio_id = ? AND operator_id = ? AND deleted_at IS NULL
      `).all(agreement.portfolio_id, operatorId) as Array<{ id: string }>;
      propertyIds = props.map((p) => p.id);
    }

    let collectedRevenueCents = 0;
    let unitCount = 0;
    let calculatedFeeCents = 0;
    let feeDetails = '';

    if (propertyIds.length > 0) {
      // Sum rent revenues collected across covered properties
      const placeholders = propertyIds.map(() => '?').join(',');
      const revRow = db.prepare(`
        SELECT COALESCE(SUM(jl.credit_cents - jl.debit_cents), 0) as total_rev
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.deleted_at IS NULL
        JOIN chart_of_accounts coa ON jl.account_id = coa.id AND coa.deleted_at IS NULL
        WHERE jl.operator_id = ? AND jl.property_id IN (${placeholders})
          AND coa.account_type = 'Income'
          AND je.date_ms >= ? AND je.date_ms <= ?
          AND je.reversed_by_entry_id IS NULL
      `).get(operatorId, ...propertyIds, startMs, endMs) as { total_rev: number };
      collectedRevenueCents = Math.max(0, revRow ? Number(revRow.total_rev) : 0);

      // Count units
      const unitRow = db.prepare(`
        SELECT COUNT(*) as count FROM units
        WHERE property_id IN (${placeholders}) AND operator_id = ? AND deleted_at IS NULL
      `).get(...propertyIds, operatorId) as { count: number };
      unitCount = unitRow ? Number(unitRow.count) : 0;
    }

    switch (agreement.calculation_method) {
      case 'percentage_collected_revenue': {
        const rate = (agreement.percentage_bps || 0) / 10000;
        calculatedFeeCents = Math.round(collectedRevenueCents * rate);
        feeDetails = `${((agreement.percentage_bps || 0) / 100).toFixed(2)}% of $${(collectedRevenueCents / 100).toFixed(2)} collected revenue`;
        break;
      }
      case 'flat_fee_per_unit': {
        calculatedFeeCents = unitCount * (agreement.flat_fee_cents || 0);
        feeDetails = `${unitCount} units @ $${((agreement.flat_fee_cents || 0) / 100).toFixed(2)}/unit`;
        break;
      }
      case 'flat_monthly_fee': {
        calculatedFeeCents = agreement.flat_fee_cents || 0;
        feeDetails = `Flat monthly fee: $${(calculatedFeeCents / 100).toFixed(2)}`;
        break;
      }
    }

    return {
      agreement,
      targetMonth: yyyyMm,
      collectedRevenueCents,
      unitCount,
      calculatedFeeCents,
      feeDetails
    };
  }

  /**
   * Post management fee as a balanced journal entry:
   * Debit: 5070 Property Management Fees Expense
   * Credit: 2010 Accounts Payable (or operating checking if auto-debited)
   */
  public static postManagementFee(
    agreementId: string,
    targetYearMonth?: string
  ): {
    journalEntry: JournalEntryRecord;
    feeCents: number;
    targetMonth: string;
  } {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    ChartOfAccountsRepository.ensureDefaultAccounts();

    const calc = this.calculateManagementFee(agreementId, targetYearMonth);
    if (calc.calculatedFeeCents <= 0) {
      throw new Error(`Calculated fee is 0 cents for agreement '${agreementId}' in ${calc.targetMonth}. No journal entry posted.`);
    }

    const idempotencyRef = `mgmt_fee:${agreementId}:${calc.targetMonth}`;
    const existing = db.prepare(`
      SELECT id FROM journal_entries
      WHERE operator_id = ? AND source_type = 'management_fee' AND source_id = ? AND deleted_at IS NULL
    `).get(operatorId, idempotencyRef);
    if (existing) {
      throw new Error(`Management fee already posted for agreement '${agreementId}' in month ${calc.targetMonth}.`);
    }

    const apAccount = ChartOfAccountsRepository.getAccountByMapping('accounts_payable') ||
      ChartOfAccountsRepository.getAccountByAccountNumber('2010');
    if (!apAccount) {
      throw new Error('Accounts Payable account (2010) not found in Chart of Accounts.');
    }

    const entry = JournalService.postEntry({
      memo: `Property Management Fee - ${calc.feeDetails} (${calc.targetMonth})`,
      source_type: 'management_fee',
      source_id: idempotencyRef,
      lines: [
        {
          account_id: calc.agreement.fee_gl_account_id,
          debit_cents: calc.calculatedFeeCents,
          credit_cents: 0,
          property_id: calc.agreement.property_id || null,
          description: `Management Fee - ${calc.targetMonth}`
        },
        {
          account_id: apAccount.id,
          debit_cents: 0,
          credit_cents: calc.calculatedFeeCents,
          property_id: calc.agreement.property_id || null,
          description: `Accrued Management Fee - ${calc.targetMonth}`
        }
      ]
    });

    // Publish event
    try {
      eventBus.publish('accounting.management_fee_posted', {
        operatorId,
        agreementId,
        journalEntryId: entry.id,
        amountCents: calc.calculatedFeeCents,
        month: calc.targetMonth
      });
    } catch {
      // Event listener resilience
    }

    return {
      journalEntry: entry,
      feeCents: calc.calculatedFeeCents,
      targetMonth: calc.targetMonth
    };
  }
}
