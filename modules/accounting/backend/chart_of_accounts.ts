import { getDatabase, withTransaction } from '../../../database/client.js';
import { RequestContext } from '../../../core/context.js';
import { generateUUIDv7 } from '../../../core/crypto.js';

export interface ChartOfAccountRecord {
  id: string;
  operator_id: string;
  tenant_id?: string;
  account_number: string | null;
  account_name: string;
  account_type:
    | 'Bank'
    | 'AccountsReceivable'
    | 'OtherCurrentAsset'
    | 'AccountsPayable'
    | 'OtherCurrentLiability'
    | 'Equity'
    | 'Income'
    | 'Expense'
    | 'CostOfGoodsSold';
  qb_account_type: string;
  category_mapping: string | null;
  description: string | null;
  is_system_default: number;
  is_active: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
}


export interface DefaultAccountDefinition {
  account_number: string;
  account_name: string;
  account_type: ChartOfAccountRecord['account_type'];
  qb_account_type: string;
  category_mapping: string | null;
  description: string;
}

export const DEFAULT_PROPERTY_MANAGEMENT_COA: DefaultAccountDefinition[] = [
  // --- Asset Accounts ---
  {
    account_number: '1010',
    account_name: 'Operating Checking',
    account_type: 'Bank',
    qb_account_type: 'Bank',
    category_mapping: 'operating_bank',
    description: 'Primary operating account for collecting rent and paying property expenses'
  },
  {
    account_number: '1020',
    account_name: 'Security Deposit Trust Checking',
    account_type: 'Bank',
    qb_account_type: 'Bank',
    category_mapping: 'trust_bank',
    description: 'Dedicated escrow/trust account holding refundable tenant security deposits'
  },
  {
    account_number: '1100',
    account_name: 'Accounts Receivable (Tenant Receivables)',
    account_type: 'AccountsReceivable',
    qb_account_type: 'AccountsReceivable',
    category_mapping: 'accounts_receivable',
    description: 'Outstanding tenant balances for rent, fees, and utility charges'
  },

  // --- Liability Accounts ---
  {
    account_number: '2010',
    account_name: 'Accounts Payable',
    account_type: 'AccountsPayable',
    qb_account_type: 'AccountsPayable',
    category_mapping: 'accounts_payable',
    description: 'Outstanding vendor invoices and contractor bills'
  },
  {
    account_number: '2100',
    account_name: 'Tenant Security Deposits Held',
    account_type: 'OtherCurrentLiability',
    qb_account_type: 'OtherCurrentLiability',
    category_mapping: 'security_deposit',
    description: 'Liability representing security deposit funds held in trust for tenants'
  },
  {
    account_number: '2110',
    account_name: 'Prepaid Rent',
    account_type: 'OtherCurrentLiability',
    qb_account_type: 'OtherCurrentLiability',
    category_mapping: 'prepaid_rent',
    description: 'Rent collected in advance of the applicable rental period'
  },

  // --- Income Accounts ---
  {
    account_number: '4010',
    account_name: 'Rental Income',
    account_type: 'Income',
    qb_account_type: 'Income',
    category_mapping: 'rent',
    description: 'Scheduled tenant monthly rent revenues'
  },
  {
    account_number: '4020',
    account_name: 'Late Fee Income',
    account_type: 'Income',
    qb_account_type: 'Income',
    category_mapping: 'late_fee',
    description: 'Assessed late fees and penalty charges'
  },
  {
    account_number: '4030',
    account_name: 'Pet Fee Income',
    account_type: 'Income',
    qb_account_type: 'Income',
    category_mapping: 'pet_fee',
    description: 'Monthly and one-time pet rents/fees'
  },
  {
    account_number: '4040',
    account_name: 'Utility Rebill Reimbursements',
    account_type: 'Income',
    qb_account_type: 'Income',
    category_mapping: 'utility_rebill',
    description: 'Tenant utility chargebacks and reimbursement income'
  },
  {
    account_number: '4090',
    account_name: 'Other Operating Income',
    account_type: 'Income',
    qb_account_type: 'Income',
    category_mapping: 'other_income',
    description: 'Miscellaneous property operational income'
  },

  // --- IRS Schedule E Expense Accounts ---
  {
    account_number: '5010',
    account_name: 'Advertising & Marketing',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'advertising',
    description: 'Listing syndication, photography, signage, and marketing (Schedule E line 5)'
  },
  {
    account_number: '5020',
    account_name: 'Auto & Travel',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'auto_travel',
    description: 'Property site visits, mileage, travel (Schedule E line 6)'
  },
  {
    account_number: '5030',
    account_name: 'Cleaning & Maintenance',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'cleaning_maintenance',
    description: 'Turnover cleaning, janitorial, groundskeeping (Schedule E line 7)'
  },
  {
    account_number: '5040',
    account_name: 'Commissions & Leasing Fees',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'commissions',
    description: 'Brokerage and tenant placement commissions (Schedule E line 8)'
  },
  {
    account_number: '5050',
    account_name: 'Property Insurance',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'insurance',
    description: 'Landlord hazard, liability, flood insurance (Schedule E line 9)'
  },
  {
    account_number: '5060',
    account_name: 'Legal & Professional Fees',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'legal_professional',
    description: 'Eviction attorneys, CPA tax preparation, compliance (Schedule E line 10)'
  },
  {
    account_number: '5070',
    account_name: 'Property Management Fees',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'management_fees',
    description: 'Professional property management commissions (Schedule E line 11)'
  },
  {
    account_number: '5080',
    account_name: 'Mortgage Interest',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'mortgage_interest',
    description: 'Mortgage interest paid to financial institutions (Schedule E line 12)'
  },
  {
    account_number: '5090',
    account_name: 'Other Interest',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'other_interest',
    description: 'Credit facility or promissory note interest (Schedule E line 13)'
  },
  {
    account_number: '5100',
    account_name: 'Repairs & Maintenance',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'repairs',
    description: 'Plumbing, electrical, HVAC, appliance fixes (Schedule E line 14)'
  },
  {
    account_number: '5110',
    account_name: 'Supplies & Materials',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'supplies',
    description: 'Hardware, keys, smoke detectors, air filters (Schedule E line 15)'
  },
  {
    account_number: '5120',
    account_name: 'Property Taxes',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'property_taxes',
    description: 'County/municipal real estate property taxes (Schedule E line 16)'
  },
  {
    account_number: '5130',
    account_name: 'Utilities (Owner Paid)',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'utilities',
    description: 'Water, sewer, trash, gas, common power (Schedule E line 17)'
  },
  {
    account_number: '5140',
    account_name: 'HOA & Condo Assessments',
    account_type: 'Expense',
    qb_account_type: 'Expense',
    category_mapping: 'hoa_fees',
    description: 'Homeowners association dues and assessments (Schedule E line 19)'
  },
  {
    account_number: '1500',
    account_name: 'Capital Improvements & Additions',
    account_type: 'OtherCurrentAsset',
    qb_account_type: 'FixedAsset',
    category_mapping: 'capital_improvement',
    description: 'Depreciable capital expenditures (roof, HVAC replacement)'
  },

  // --- Equity Accounts ---
  {
    account_number: '3010',
    account_name: 'Owner Capital Contributions',
    account_type: 'Equity',
    qb_account_type: 'Equity',
    category_mapping: 'owner_capital',
    description: 'Capital funds invested by property owners/clients into property operations'
  },
  {
    account_number: '3020',
    account_name: 'Owner Draws & Distributions',
    account_type: 'Equity',
    qb_account_type: 'Equity',
    category_mapping: 'owner_draw',
    description: 'Net cash distributions and capital withdrawals disbursed to property owners'
  },

  // --- Additional Income & Contra Accounts ---
  {
    account_number: '4050',
    account_name: 'Lease Concessions & Discounts',
    account_type: 'Income',
    qb_account_type: 'Income',
    category_mapping: 'concessions',
    description: 'Promotional rent discounts, move-in credits, and courtesy concessions'
  },
  {
    account_number: '4060',
    account_name: 'Parking & Storage Fee Income',
    account_type: 'Income',
    qb_account_type: 'Income',
    category_mapping: 'parking_fee',
    description: 'Recurring parking stall and storage unit rental revenues'
  }
];

export class ChartOfAccountsRepository {
  /**
   * Seed standard Chart of Accounts defaults for the current operator if none exist.
   */
  public static ensureDefaultAccounts(dbInstance?: any): void {
    const operatorId = RequestContext.getOperatorId();
    const db = dbInstance || getDatabase();

    const countRow = db.prepare(`
      SELECT COUNT(*) as count FROM chart_of_accounts
      WHERE operator_id = ? AND deleted_at IS NULL
    `).get(operatorId) as { count: number };

    if (countRow.count === 0) {
      const seedAccounts = (tx: any) => {
        const stmt = tx.prepare(`
          INSERT INTO chart_of_accounts (
            id, operator_id, account_number, account_name, account_type,
            qb_account_type, category_mapping, description, is_system_default,
            is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
        `);

        const now = Date.now();
        for (const def of DEFAULT_PROPERTY_MANAGEMENT_COA) {
          stmt.run(
            generateUUIDv7(),
            operatorId,
            def.account_number,
            def.account_name,
            def.account_type,
            def.qb_account_type,
            def.category_mapping,
            def.description,
            now,
            now
          );
        }
      };

      if (dbInstance) {
        seedAccounts(dbInstance);
      } else {
        withTransaction(seedAccounts, db);
      }
    }
  }

  public static listAccounts(includeInactive = false): ChartOfAccountRecord[] {
    this.ensureDefaultAccounts();
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    let sql = `
      SELECT * FROM chart_of_accounts
      WHERE operator_id = ? AND deleted_at IS NULL
    `;
    if (!includeInactive) {
      sql += ' AND is_active = 1';
    }
    sql += ' ORDER BY account_number ASC, account_name ASC';

    return db.prepare(sql).all(operatorId) as unknown as ChartOfAccountRecord[];
  }

  public static getAccountById(id: string): ChartOfAccountRecord | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();

    const row = db.prepare(`
      SELECT * FROM chart_of_accounts
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(id, operatorId) as ChartOfAccountRecord | undefined;

    return row || null;
  }

  public static getAccountByMapping(categoryMapping: string, dbInstance?: any): ChartOfAccountRecord | null {
    this.ensureDefaultAccounts(dbInstance);
    const operatorId = RequestContext.getOperatorId();
    const db = dbInstance || getDatabase();

    const row = db.prepare(`
      SELECT * FROM chart_of_accounts
      WHERE operator_id = ? AND category_mapping = ? AND is_active = 1 AND deleted_at IS NULL
      LIMIT 1
    `).get(operatorId, categoryMapping) as ChartOfAccountRecord | undefined;

    return row || null;
  }

  public static getAccountByAccountNumber(accountNumber: string, dbInstance?: any): ChartOfAccountRecord | null {
    this.ensureDefaultAccounts(dbInstance);
    const operatorId = RequestContext.getOperatorId();
    const db = dbInstance || getDatabase();

    const row = db.prepare(`
      SELECT * FROM chart_of_accounts
      WHERE operator_id = ? AND account_number = ? AND is_active = 1 AND deleted_at IS NULL
      LIMIT 1
    `).get(operatorId, accountNumber) as ChartOfAccountRecord | undefined;

    return row || null;
  }

  public static createAccount(data: {
    account_number?: string | null;
    account_name: string;
    account_type: ChartOfAccountRecord['account_type'];
    qb_account_type: string;
    category_mapping?: string | null;
    description?: string | null;
  }): ChartOfAccountRecord {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const now = Date.now();
    const id = generateUUIDv7();

    db.prepare(`
      INSERT INTO chart_of_accounts (
        id, operator_id, account_number, account_name, account_type,
        qb_account_type, category_mapping, description, is_system_default,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
    `).run(
      id,
      operatorId,
      data.account_number || null,
      data.account_name,
      data.account_type,
      data.qb_account_type,
      data.category_mapping || null,
      data.description || null,
      now,
      now
    );

    return this.getAccountById(id)!;
  }

  public static updateAccount(
    id: string,
    data: {
      account_number?: string | null;
      account_name?: string;
      account_type?: ChartOfAccountRecord['account_type'];
      qb_account_type?: string;
      category_mapping?: string | null;
      description?: string | null;
      is_active?: number;
    }
  ): ChartOfAccountRecord | null {
    const operatorId = RequestContext.getOperatorId();
    const db = getDatabase();
    const existing = this.getAccountById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const params: any[] = [];

    if (data.account_number !== undefined) {
      updates.push('account_number = ?');
      params.push(data.account_number);
    }
    if (data.account_name !== undefined) {
      updates.push('account_name = ?');
      params.push(data.account_name);
    }
    if (data.account_type !== undefined) {
      updates.push('account_type = ?');
      params.push(data.account_type);
    }
    if (data.qb_account_type !== undefined) {
      updates.push('qb_account_type = ?');
      params.push(data.qb_account_type);
    }
    if (data.category_mapping !== undefined) {
      updates.push('category_mapping = ?');
      params.push(data.category_mapping);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description);
    }
    if (data.is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(data.is_active);
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = ?');
    params.push(Date.now());

    params.push(id, operatorId);

    db.prepare(`
      UPDATE chart_of_accounts
      SET ${updates.join(', ')}
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).run(...params);

    return this.getAccountById(id);
  }
}
