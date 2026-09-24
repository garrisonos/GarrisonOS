import { createServer as createHttpServer, Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Router } from './router.js';
import {
  securityHeadersMiddleware,
  correlationMiddleware,
  rateLimitMiddleware,
  operatorContextMiddleware,
  RESERVED_SUBDOMAINS,
  requirePermission,
  requireRole
} from './middleware.js';
import { successResponse, errorResponse } from './response.js';
import { getDatabase, closeDatabase, withTransaction } from '../database/client.js';
import { eventBus } from '../core/events.js';
import { loadModules, getLoadedModules } from '../core/module-loader.js';
import { verifyPassword, hashPassword, createToken, generateUUIDv7 } from '../core/crypto.js';
import { RequestContext } from '../core/context.js';
import { getApplicationVersion } from '../core/version.js';
import { registerNotificationListeners } from '../core/notification-listener.js';
import {
  getUserPortfolioAccess,
  setUserPortfolioAccess,
  getUserModuleAccess,
  setUserModuleAccess,
  canAssignRole,
  hasPermission,
  loadOperatorRoleOverrides
} from '../core/rbac.js';

const NODE_ENV = process.env['NODE_ENV'] || 'development';
const APP_SECRET = process.env['APP_SECRET'] || (
  NODE_ENV === 'development' || NODE_ENV === 'test'
    ? 'garrison-os-development-secret'
    : ''
);
const PORT = parseInt(process.env['PORT'] || '3000', 10);
const HOST = process.env['HOST'] || '127.0.0.1';

type BackupSchedulerReadiness = 'not-mounted' | 'disabled' | 'running' | 'failed';

interface BackupSchedulerHandle {
  /** Starts the background scheduled backup timer. */
  start(): void;
  /** Gracefully stops active backup scheduler timers. */
  stop(): Promise<void>;
  /** Returns the current scheduler daemon status. */
  getStatus(): { enabled: boolean; running: boolean };
}

let activeBackupScheduler: BackupSchedulerHandle | null = null;
let backupSchedulerReadiness: BackupSchedulerReadiness = 'not-mounted';

/**
 * Validate that deployments outside local development use a strong HMAC secret.
 *
 * @param nodeEnv Runtime environment name.
 * @param appSecret Candidate HMAC secret.
 * @throws Error if secret length is below minimum outside development or test.
 */
export function validateEnvironment(nodeEnv: string, appSecret: string | undefined): void {
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    if (!appSecret || appSecret.length < 64 || !/^[0-9a-fA-F]{64,}$/.test(appSecret)) {
      throw new Error(
        'APP_SECRET must contain at least 32 bytes encoded as hexadecimal before starting the server outside development and test environments'
      );
    }
  }
}

/**
 * Create the API router and register core routes and middleware.
 *
 * @param serverPort Loopback port used by internal batch requests.
 * @returns A configured API router.
 */
export function createRouter(serverPort: number = PORT): Router {
  const router = new Router();

  // Attach middleware stack
  router.use(securityHeadersMiddleware);
  router.use(correlationMiddleware);
  router.use(rateLimitMiddleware);
  router.use(operatorContextMiddleware);

  // Health and readiness checks
  router.getBatchSafe('/health', (_req, res) => {
    successResponse(res, {
      status: 'ok',
      version: getApplicationVersion(),
      timestamp: Date.now()
    });
  });

  router.getBatchSafe('/ready', (_req, res) => {
    try {
      const db = getDatabase();
      db.prepare('SELECT 1').get();
      successResponse(res, {
        status: 'ready',
        database: 'connected',
        backupScheduler: backupSchedulerReadiness,
        timestamp: Date.now()
      });
    } catch (err: any) {
      errorResponse(res, 'SERVICE_UNAVAILABLE', `Database unreachable: ${err.message}`, 503);
    }
  });

  // Loaded modules introspection
  router.getBatchSafe('/api/v1/modules', (_req, res) => {
    const modules = getLoadedModules().map((m) => m.manifest);
    successResponse(res, { modules });
  });

  // Execute a bounded set of read-only API requests concurrently.
  router.post('/api/v1/batch', async (req, res) => {
    const requests = req.body?.requests;
    if (!Array.isArray(requests) || requests.length === 0 || requests.length > 10) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Batch requests must contain between 1 and 10 items', 400);
    }

    const validatedRequests: Array<{ path: string; method: 'GET' }> = [];
    for (const item of requests) {
      let targetUrl: URL;
      try {
        targetUrl = new URL(item?.path, 'http://batch.local');
      } catch {
        return errorResponse(res, 'VALIDATION_ERROR', 'Batch supports only relative GET requests', 400);
      }
      const pathname = targetUrl.pathname;
      if (
        !item ||
        typeof item.path !== 'string' ||
        item.path.length > 512 ||
        !item.path.startsWith('/') ||
        targetUrl.origin !== 'http://batch.local' ||
        !(pathname === '/health' || pathname === '/ready' || pathname.startsWith('/api/v1/')) ||
        pathname === '/api/v1/batch' ||
        !router.isBatchSafeGetPath(pathname) ||
        (item.method !== undefined && item.method !== 'GET')
      ) {
        return errorResponse(res, 'VALIDATION_ERROR', 'Batch supports only safe relative GET requests', 400);
      }
      validatedRequests.push({ path: item.path, method: 'GET' });
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Request-ID': req.correlationId || generateUUIDv7()
    };
    for (const headerName of ['authorization']) {
      const value = req.headers[headerName];
      if (typeof value === 'string') headers[headerName] = value;
    }

    try {
      const responseEntries = await Promise.all(validatedRequests.map(async ({ path, method }) => {
        try {
          const response = await fetch(`http://127.0.0.1:${serverPort}${path}`, { method, headers });
          const contentType = response.headers.get('content-type') || '';
          if (!contentType.toLowerCase().includes('application/json')) {
            return {
              path,
              status: response.status,
              success: false,
              error: {
                code: 'NON_JSON_RESPONSE',
                message: 'Batch requests support JSON responses only',
                contentType: contentType || 'unknown'
              }
            };
          }

          try {
            const envelope = await response.json() as Record<string, unknown>;
            return { path, status: response.status, ...envelope };
          } catch {
            return {
              path,
              status: 502,
              success: false,
              error: {
                code: 'INVALID_BATCH_RESPONSE',
                message: 'The endpoint returned an invalid JSON response'
              }
            };
          }
        } catch {
          return {
            path,
            status: 502,
            success: false,
            error: {
              code: 'BATCH_ITEM_FAILED',
              message: 'Unable to complete this batch request'
            }
          };
        }
      }));
      const responses: Record<string, Record<string, unknown>> = {};
      responseEntries.forEach((entry, index) => {
        responses[`response_${index}`] = entry;
      });
      successResponse(res, { responses }, 200, {
        total: responseEntries.length,
        page: 1,
        limit: responseEntries.length
      });
    } catch {
      errorResponse(res, 'BATCH_FAILED', 'Unable to complete batch request', 502);
    }
  });

  // Authentication: Operator Login
  router.post('/api/v1/auth/login', async (req, res) => {
    const { email, password, operator_id } = req.body || {};
    if (!email || !password) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Email and password are required', 400);
    }

    const operatorId = operator_id;
    const db = getDatabase();
    let query = 'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL';
    const params: any[] = [email];

    if (operatorId) {
      query += ' AND operator_id = ?';
      params.push(operatorId);
    }

    const user = db.prepare(query).get(...params) as any;
    if (!user) {
      return errorResponse(res, 'INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return errorResponse(res, 'INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    // Generate session token valid for 24 hours with token version
    const token = createToken(
      {
        sub: user.id,
        opid: user.operator_id,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + 86400,
        tv: user.token_version || 1
      },
      APP_SECRET
    );

    // Record audit log
    try {
      db.prepare(`
        INSERT INTO audit_logs (id, operator_id, user_id, entity_type, entity_id, action, changes_json, ip_address, created_at)
        VALUES (?, ?, ?, 'user', ?, 'login', ?, ?, ?)
      `).run(
        generateUUIDv7(),
        user.operator_id,
        user.id,
        user.id,
        JSON.stringify({ email: user.email }),
        (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1',
        Date.now()
      );
    } catch {
      // Non-blocking audit log
    }

    successResponse(res, {
      token,
      user: {
        id: user.id,
        operator_id: user.operator_id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role
      }
    });
  });

  // System Database Backup Snapshot
  router.getUnsafe('/api/v1/system/backup', (_req, res) => {
    try {
      const db = getDatabase();
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      const dbPath = process.env['SQLITE_PATH'] || './garrison.sqlite';
      const resolvedPath = path.resolve(dbPath);
      
      if (!fs.existsSync(resolvedPath)) {
        return errorResponse(res, 'NOT_FOUND', 'Database file not found', 404);
      }

      const fileStream = fs.createReadStream(resolvedPath);
      res.writeHead(200, {
        'Content-Type': 'application/x-sqlite3',
        'Content-Disposition': `attachment; filename="garrison-backup-${Date.now()}.sqlite"`
      });
      fileStream.pipe(res);
    } catch (err: any) {
      errorResponse(res, 'BACKUP_FAILED', err.message, 500);
    }
  });

  // System Setup Status
  router.get('/api/v1/system/status', (_req, res) => {
    try {
      const db = getDatabase();
      const row = db.prepare('SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL').get() as { count: number };
      const userCount = Number(row?.count || 0);
      const isConfigured = userCount > 0;
      const backupModuleEnabled = getLoadedModules().some((m) => m.manifest.id === 'backup');

      successResponse(res, {
        is_configured: isConfigured,
        user_count: userCount,
        backup_module_enabled: backupModuleEnabled
      });
    } catch (err: any) {
      errorResponse(res, 'SYSTEM_ERROR', err.message, 500);
    }
  });

  // System First-Launch Setup
  router.post('/api/v1/system/setup', async (req, res) => {
    const db = getDatabase();
    const countRow = db.prepare('SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL').get() as { count: number };
    if (Number(countRow?.count || 0) > 0) {
      return errorResponse(res, 'ALREADY_CONFIGURED', 'System is already configured with an administrator account', 403);
    }

    const {
      organization_name,
      first_name,
      last_name,
      email,
      password,
      seed_demo_data,
      setup_mode
    } = req.body || {};

    const cleanOrg = typeof organization_name === 'string' ? organization_name.trim() : '';
    const cleanFirst = typeof first_name === 'string' ? first_name.trim() : '';
    const cleanLast = typeof last_name === 'string' ? last_name.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanPassword = typeof password === 'string' ? password : '';
    const isMultiOperator = setup_mode === 'multi';
    const userRole = isMultiOperator ? 'system_owner' : 'owner';

    if (!cleanOrg) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Organization name is required', 400);
    }
    if (!cleanFirst || !cleanLast) {
      return errorResponse(res, 'VALIDATION_ERROR', 'First name and last name are required', 400);
    }
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      return errorResponse(res, 'VALIDATION_ERROR', 'A valid email address is required', 400);
    }
    if (cleanPassword.length < 8) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Password must be at least 8 characters long', 400);
    }

    const now = Date.now();
    const operatorId = generateUUIDv7();
    const userId = generateUUIDv7();
    const passwordHash = await hashPassword(cleanPassword);

    try {
      withTransaction((tx) => {
        // 1. Create primary operator
        tx.prepare(`
          INSERT INTO operators (id, name, subdomain, currency, created_at, updated_at)
          VALUES (?, ?, ?, 'USD', ?, ?)
        `).run(operatorId, cleanOrg, 'primary', now, now);

        // 2. Create owner user (is_system_user = 1)
        tx.prepare(`
          INSERT INTO users (id, operator_id, email, password_hash, first_name, last_name, role, token_version, is_system_user, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
        `).run(userId, operatorId, cleanEmail, passwordHash, cleanFirst, cleanLast, userRole, now, now);

        // 3. Audit log
        tx.prepare(`
          INSERT INTO audit_logs (id, operator_id, user_id, entity_type, entity_id, action, changes_json, ip_address, created_at)
          VALUES (?, ?, ?, 'system', ?, 'create', ?, ?, ?)
        `).run(
          generateUUIDv7(),
          operatorId,
          userId,
          operatorId,
          JSON.stringify({ organization_name: cleanOrg, email: cleanEmail, setup_mode: isMultiOperator ? 'multi' : 'single' }),
          (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1',
          now
        );

        // 4. If demo data requested, seed sample records under this new operator
        if (seed_demo_data === true) {
          // Initialize Chart of Accounts if table exists
          const tableCheck = tx.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chart_of_accounts'").get();
          if (tableCheck) {
            const accounts: [string, string, string, string][] = [
              ['1010', 'Operating Checking', 'Bank', 'Bank'],
              ['1100', 'Accounts Receivable', 'AccountsReceivable', 'AccountsReceivable'],
              ['2010', 'Security Deposits Liability', 'OtherCurrentLiability', 'OtherCurrentLiability'],
              ['4010', 'Rental Income', 'Income', 'Income'],
              ['4020', 'Late Fee Income', 'Income', 'Income'],
              ['5100', 'Repairs & Maintenance', 'Expense', 'Expense']
            ];
            for (const [num, name, type, qbType] of accounts) {
              tx.prepare(`
                INSERT INTO chart_of_accounts (id, operator_id, account_number, account_name, account_type, qb_account_type, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
              `).run(generateUUIDv7(), operatorId, num, name, type, qbType, now, now);
            }
          }

          // Sample portfolio
          const portId = generateUUIDv7();
          tx.prepare(`
            INSERT INTO portfolios (id, operator_id, name, notes, created_at, updated_at)
            VALUES (?, ?, 'Primary Portfolio', 'Initial sample portfolio created during onboarding', ?, ?)
          `).run(portId, operatorId, now, now);

          // Sample vendor contact
          const vendorId = generateUUIDv7();
          tx.prepare(`
            INSERT INTO contacts (id, operator_id, contact_type, first_name, last_name, company_name, email, phone, vendor_specialty, created_at, updated_at)
            VALUES (?, ?, 'vendor', 'Marcus', 'Vance', 'Apex Plumbing Services', 'marcus@apexplumb.local', '(555) 301-4401', 'Plumbing', ?, ?)
          `).run(vendorId, operatorId, now, now);

          // Sample property, building & unit
          const propId = generateUUIDv7();
          tx.prepare(`
            INSERT INTO properties (id, operator_id, portfolio_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
            VALUES (?, ?, ?, '104 Oakwood Drive', 'single_family', '104 Oakwood Dr', 'Asheville', 'NC', '28801', ?, ?)
          `).run(propId, operatorId, portId, now, now);

          const buildingId = generateUUIDv7();
          tx.prepare(`
            INSERT INTO buildings (id, operator_id, property_id, name, building_number, created_at, updated_at)
            VALUES (?, ?, ?, 'Main Building', '1', ?, ?)
          `).run(buildingId, operatorId, propId, now, now);

          const unitId = generateUUIDv7();
          tx.prepare(`
            INSERT INTO units (id, operator_id, property_id, building_id, unit_number, status, bedrooms, bathrooms, square_feet, market_rent_cents, target_deposit_cents, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'Main', 'vacant', 3, 2, 1450, 185000, 185000, ?, ?)
          `).run(unitId, operatorId, propId, buildingId, now, now);
        }
      }, db);

      process.env['OPERATOR_MODE'] = isMultiOperator ? 'multi' : 'single';

      const token = createToken(
        {
          sub: userId,
          opid: operatorId,
          role: userRole,
          exp: Math.floor(Date.now() / 1000) + 86400,
          tv: 1
        },
        APP_SECRET
      );

      successResponse(res, {
        token,
        setup_mode: isMultiOperator ? 'multi' : 'single',
        operator_id: operatorId,
        user: {
          id: userId,
          operator_id: operatorId,
          email: cleanEmail,
          first_name: cleanFirst,
          last_name: cleanLast,
          role: userRole,
          is_system_user: 1
        }
      }, 201);
    } catch (err: any) {
      errorResponse(res, 'SETUP_FAILED', `Failed to initialize system: ${err.message}`, 500);
    }
  });

  // System Administration: Provision Operator
  router.post('/api/v1/system/operators', async (req, res) => {
    const {
      name,
      organization_name,
      email,
      contact_email,
      password,
      admin_password,
      storage_quota_bytes,
      storage_quota,
      first_name,
      last_name,
      subdomain,
      slug,
      path_slug,
      currency
    } = req.body || {};

    const cleanName = typeof name === 'string' && name.trim()
      ? name.trim()
      : (typeof organization_name === 'string' ? organization_name.trim() : '');
    const cleanEmail = typeof email === 'string' && email.trim()
      ? email.trim().toLowerCase()
      : (typeof contact_email === 'string' ? contact_email.trim().toLowerCase() : '');
    const cleanPassword = typeof password === 'string'
      ? password
      : (typeof admin_password === 'string' ? admin_password : '');
    const cleanFirst = typeof first_name === 'string' && first_name.trim() ? first_name.trim() : 'Admin';
    const cleanLast = typeof last_name === 'string' && last_name.trim() ? last_name.trim() : 'User';
    const cleanCurrency = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'USD';

    if (!cleanName) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Operator name is required', 400);
    }
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      return errorResponse(res, 'VALIDATION_ERROR', 'A valid email address is required', 400);
    }
    if (cleanPassword.length < 8) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Password must be at least 8 characters long', 400);
    }

    const hasExplicitSubdomain = (
      subdomain !== undefined ||
      slug !== undefined ||
      path_slug !== undefined
    );
    const rawSubdomainCandidate = subdomain !== undefined ? subdomain : (slug !== undefined ? slug : path_slug);

    let cleanSubdomain: string;
    if (hasExplicitSubdomain) {
      const rawStr = typeof rawSubdomainCandidate === 'string' ? rawSubdomainCandidate.trim() : '';
      const normalized = rawStr
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);

      if (!normalized || RESERVED_SUBDOMAINS.has(normalized)) {
        return errorResponse(res, 'VALIDATION_ERROR', 'The specified subdomain or slug is invalid or reserved', 400);
      }
      cleanSubdomain = normalized;
    } else {
      let derived = cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);

      if (!derived || RESERVED_SUBDOMAINS.has(derived)) {
        derived = derived ? `${derived.slice(0, 23)}-operator` : `op-${generateUUIDv7().slice(0, 8)}`;
      }
      cleanSubdomain = derived;
    }

    const defaultQuota = Number(process.env['DEFAULT_STORAGE_QUOTA_BYTES']) || 10737418240; // 10 GB default
    const rawQuota = storage_quota_bytes !== undefined ? storage_quota_bytes : storage_quota;
    let cleanQuota = defaultQuota;
    if (rawQuota !== undefined && rawQuota !== null) {
      const parsedQuota = Number(rawQuota);
      if (!Number.isInteger(parsedQuota) || parsedQuota <= 0) {
        return errorResponse(res, 'VALIDATION_ERROR', 'Storage quota must be a positive integer in bytes', 400);
      }
      cleanQuota = parsedQuota;
    }

    const now = Date.now();
    const operatorId = generateUUIDv7();
    const userId = generateUUIDv7();
    const passwordHash = await hashPassword(cleanPassword);
    const db = getDatabase();

    try {
      withTransaction((tx) => {
        // Check duplicate email
        const existingUser = tx.prepare(
          'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL'
        ).get(cleanEmail);
        if (existingUser) {
          const err: any = new Error('A user with this email address already exists');
          err.code = 'CONFLICT';
          throw err;
        }

        // Check duplicate subdomain or path slug
        const existingSubdomain = tx.prepare(
          'SELECT id FROM operators WHERE subdomain = ? AND deleted_at IS NULL'
        ).get(cleanSubdomain);

        if (existingSubdomain) {
          if (hasExplicitSubdomain) {
            const err: any = new Error(`Subdomain or path '${cleanSubdomain}' is already in use`);
            err.code = 'CONFLICT';
            throw err;
          } else {
            // Auto-generated from name: disambiguate with random hex suffix
            cleanSubdomain = `${cleanSubdomain.slice(0, 26)}-${randomBytes(2).toString('hex')}`;
          }
        }

        // 1. Insert into operators
        tx.prepare(`
          INSERT INTO operators (id, name, subdomain, currency, storage_quota_bytes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(operatorId, cleanName, cleanSubdomain, cleanCurrency, cleanQuota, now, now);

        // 2. Insert owner user
        tx.prepare(`
          INSERT INTO users (id, operator_id, email, password_hash, first_name, last_name, role, token_version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'owner', 1, ?, ?)
        `).run(userId, operatorId, cleanEmail, passwordHash, cleanFirst, cleanLast, now, now);

        // 3. Seed default Chart of Accounts
        const tableCheck = tx.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chart_of_accounts'").get();
        if (tableCheck) {
          const defaultAccounts: [string, string, string, string, string, string][] = [
            ['1010', 'Operating Checking', 'Bank', 'Bank', 'operating_bank', 'Primary operating account for rent collection and property operations'],
            ['1020', 'Trust Checking', 'Bank', 'Bank', 'trust_bank', 'Dedicated escrow/trust account for security deposits'],
            ['1100', 'Accounts Receivable', 'AccountsReceivable', 'AccountsReceivable', 'accounts_receivable', 'Uncollected tenant rent and utility charges'],
            ['2010', 'Security Deposits Liability', 'OtherCurrentLiability', 'OtherCurrentLiability', 'security_deposits_liability', 'Tenant security deposits held in trust'],
            ['3010', "Owner's Equity", 'Equity', 'Equity', 'owner_equity', 'Owner invested capital and cumulative retained earnings'],
            ['4010', 'Rental Income', 'Income', 'Income', 'rental_income', 'Gross monthly residential and commercial rent receipts'],
            ['4020', 'Late Fee Income', 'Income', 'Income', 'late_fee_income', 'Assessed tenant late payment penalties'],
            ['5100', 'Repairs & Maintenance', 'Expense', 'Expense', 'repairs_maintenance', 'Day-to-day property repairs, handyman services, and routine turnover expenses'],
            ['5110', 'Management Fees', 'Expense', 'Expense', 'management_fees', 'Professional property management fee disbursements']
          ];
          for (const [num, acctName, type, qbType, mapping, desc] of defaultAccounts) {
            tx.prepare(`
              INSERT INTO chart_of_accounts (
                id, operator_id, account_number, account_name, account_type,
                qb_account_type, category_mapping, description, is_system_default,
                is_active, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
            `).run(generateUUIDv7(), operatorId, num, acctName, type, qbType, mapping, desc, now, now);
          }
        }

        // 4. Audit log
        const auditTableCheck = tx.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'").get();
        if (auditTableCheck) {
          tx.prepare(`
            INSERT INTO audit_logs (id, operator_id, user_id, entity_type, entity_id, action, changes_json, ip_address, created_at)
            VALUES (?, ?, ?, 'system', ?, 'create', ?, ?, ?)
          `).run(
            generateUUIDv7(),
            operatorId,
            userId,
            operatorId,
            JSON.stringify({ name: cleanName, email: cleanEmail, storage_quota_bytes: cleanQuota, subdomain: cleanSubdomain }),
            (() => {
              const rawIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
              return (rawIp.includes(',') ? rawIp.split(',')[0]!.trim() : rawIp.trim()) || '127.0.0.1';
            })(),
            now
          );
        }
      }, db);

      successResponse(
        res,
        {
          operator: {
            id: operatorId,
            name: cleanName,
            subdomain: cleanSubdomain,
            currency: cleanCurrency,
            storage_quota_bytes: cleanQuota,
            created_at: now
          },
          user: {
            id: userId,
            operator_id: operatorId,
            email: cleanEmail,
            role: 'owner',
            first_name: cleanFirst,
            last_name: cleanLast,
            created_at: now
          }
        },
        201
      );
    } catch (err: any) {
      if (err.code === 'CONFLICT') {
        return errorResponse(res, 'CONFLICT', err.message, 409);
      }
      errorResponse(res, 'INTERNAL_ERROR', 'Failed to provision operator', 500);
    }
  });

  // System Setup: Restore from Backup
  router.post('/api/v1/system/restore', async (req, res) => {
    const db = getDatabase();
    const countRow = db.prepare('SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL').get() as { count: number };
    if (Number(countRow?.count || 0) > 0) {
      return errorResponse(res, 'ALREADY_CONFIGURED', 'System is already configured. Restore via initial setup is unavailable.', 403);
    }

    const { backup_data, filename } = req.body || {};
    if (!backup_data || typeof backup_data !== 'string') {
      return errorResponse(res, 'VALIDATION_ERROR', 'Backup data payload is required (base64 encoded)', 400);
    }

    const cleanFilename = typeof filename === 'string' ? filename : 'restore-backup.sqlite.gz';
    const buffer = Buffer.from(backup_data, 'base64');
    if (buffer.length === 0) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Backup payload is empty', 400);
    }

    // Dynamic check for backup module service
    try {
      const backupServiceMod = await import('../modules/backup/backend/service.js').catch(() => null);
      if (!backupServiceMod || !backupServiceMod.BackupService) {
        return errorResponse(res, 'BACKUP_MODULE_NOT_AVAILABLE', 'The backup module is not loaded on this server', 400);
      }

      const tempDir = process.env['STORAGE_PATH'] ? path.resolve(process.env['STORAGE_PATH']) : path.resolve('./storage');
      fs.mkdirSync(tempDir, { recursive: true });
      const tempRestoreFile = path.join(tempDir, `initial-restore-${Date.now()}-${cleanFilename}`);
      fs.writeFileSync(tempRestoreFile, buffer);

      try {
        await backupServiceMod.BackupService.restoreFullDatabase(tempRestoreFile);
      } finally {
        if (fs.existsSync(tempRestoreFile)) {
          try { fs.unlinkSync(tempRestoreFile); } catch {}
        }
      }

      // Re-verify after restore
      const postDb = getDatabase();
      const postCountRow = postDb.prepare('SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL').get() as { count: number };
      const restoredUserCount = Number(postCountRow?.count || 0);

      if (restoredUserCount === 0) {
        return errorResponse(res, 'RESTORE_EMPTY', 'Restoration completed but no active users were found in the restored database', 400);
      }

      successResponse(res, {
        message: 'Database successfully restored from backup snapshot',
        users_restored: restoredUserCount
      });
    } catch (err: any) {
      errorResponse(res, 'RESTORE_FAILED', `Failed to restore database from backup: ${err.message}`, 500);
    }
  });

  // ==========================================
  // Operator Team & Subuser Management
  // ==========================================

  // List users under active operator
  router.get('/api/v1/users', async (req, res) => {
    const operatorId = RequestContext.tryGet()?.operatorId || req.operatorId;
    const callerId = RequestContext.tryGet()?.userId || req.userId;
    if (!operatorId || !callerId) {
      return errorResponse(res, 'FORBIDDEN', 'Authentication required', 403);
    }

    const db = getDatabase();
    const caller = db.prepare(
      'SELECT role, is_system_user FROM users WHERE id = ? AND deleted_at IS NULL'
    ).get(callerId) as { role: string; is_system_user?: number } | undefined;

    if (!caller) {
      return errorResponse(res, 'FORBIDDEN', 'User inactive or not authorized', 403);
    }

    const overrides = loadOperatorRoleOverrides(operatorId, db);
    const hasAdminAccess = caller.is_system_user === 1 ||
      ['system_owner', 'system_manager', 'owner', 'manager'].includes(caller.role) ||
      hasPermission(caller.role, 'system:admin', overrides);

    if (!hasAdminAccess) {
      return errorResponse(res, 'FORBIDDEN', 'Administrative privileges required to list team members', 403);
    }

    const users = db.prepare(`
      SELECT id, operator_id, email, first_name, last_name, role, is_system_user, created_at, updated_at
      FROM users
      WHERE operator_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC
    `).all(operatorId) as any[];

    const formatted = users.map((u) => ({
      id: u.id,
      operator_id: u.operator_id,
      email: u.email,
      first_name: u.first_name,
      last_name: u.last_name,
      role: u.role,
      is_system_user: u.is_system_user === 1 ? 1 : 0,
      allowed_portfolios: getUserPortfolioAccess(u.id, operatorId, db),
      allowed_modules: getUserModuleAccess(u.id, operatorId, db),
      created_at: u.created_at,
      updated_at: u.updated_at
    }));

    successResponse(res, { users: formatted });
  });

  // Provision new subuser under active operator
  router.post('/api/v1/users', async (req, res) => {
    const operatorId = RequestContext.tryGet()?.operatorId || req.operatorId;
    const callerId = RequestContext.tryGet()?.userId || req.userId;
    if (!operatorId || !callerId) {
      return errorResponse(res, 'FORBIDDEN', 'Authentication required', 403);
    }

    const db = getDatabase();
    const caller = db.prepare(
      'SELECT role, is_system_user FROM users WHERE id = ? AND deleted_at IS NULL'
    ).get(callerId) as { role: string; is_system_user?: number } | undefined;

    const isSystemAdmin = caller?.is_system_user === 1 || caller?.role === 'system_owner' || caller?.role === 'system_manager';
    const isOperatorAdmin = caller?.role === 'owner' || caller?.role === 'manager';

    if (!isSystemAdmin && !isOperatorAdmin) {
      return errorResponse(res, 'FORBIDDEN', 'Only operator owners or managers can provision subusers', 403);
    }

    const { email, password, first_name, last_name, role, portfolio_ids, allowed_portfolios, module_ids, allowed_modules } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanPassword = typeof password === 'string' ? password : '';
    const cleanFirst = typeof first_name === 'string' ? first_name.trim() : '';
    const cleanLast = typeof last_name === 'string' ? last_name.trim() : '';
    const cleanRole = typeof role === 'string' ? role.trim().toLowerCase() : 'leasing_agent';
    const effectivePortfolios = Array.isArray(portfolio_ids) ? portfolio_ids : (Array.isArray(allowed_portfolios) ? allowed_portfolios : []);
    const effectiveModules = Array.isArray(module_ids) ? module_ids : (Array.isArray(allowed_modules) ? allowed_modules : []);

    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      return errorResponse(res, 'VALIDATION_ERROR', 'A valid email address is required', 400);
    }
    if (cleanPassword.length < 8) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Password must be at least 8 characters long', 400);
    }
    if (!cleanFirst || !cleanLast) {
      return errorResponse(res, 'VALIDATION_ERROR', 'First name and last name are required', 400);
    }

    const allowedRoles = ['owner', 'manager', 'leasing_agent', 'assistant', 'maintenance', 'auditor', 'viewer', 'read_only'];
    if (!allowedRoles.includes(cleanRole)) {
      return errorResponse(res, 'VALIDATION_ERROR', `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`, 400);
    }

    if (!caller || !canAssignRole(caller.role, cleanRole)) {
      return errorResponse(res, 'FORBIDDEN', `Cannot assign role '${cleanRole}' exceeding caller privilege ceiling`, 403);
    }

    const existing = db.prepare(
      'SELECT id FROM users WHERE operator_id = ? AND email = ? AND deleted_at IS NULL'
    ).get(operatorId, cleanEmail);

    if (existing) {
      return errorResponse(res, 'CONFLICT', 'A user with this email address already exists in your organization', 409);
    }

    const now = Date.now();
    const newUserId = generateUUIDv7();
    const passwordHash = await hashPassword(cleanPassword);

    withTransaction((tx) => {
      tx.prepare(`
        INSERT INTO users (id, operator_id, email, password_hash, first_name, last_name, role, token_version, is_system_user, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
      `).run(newUserId, operatorId, cleanEmail, passwordHash, cleanFirst, cleanLast, cleanRole, now, now);

      if (effectivePortfolios.length > 0) {
        setUserPortfolioAccess(newUserId, operatorId, effectivePortfolios, tx);
      }
      if (effectiveModules.length > 0) {
        setUserModuleAccess(newUserId, operatorId, effectiveModules, tx);
      }
    }, db);

    const createdUser = {
      id: newUserId,
      operator_id: operatorId,
      email: cleanEmail,
      first_name: cleanFirst,
      last_name: cleanLast,
      role: cleanRole,
      is_system_user: 0,
      allowed_portfolios: getUserPortfolioAccess(newUserId, operatorId, db),
      allowed_modules: getUserModuleAccess(newUserId, operatorId, db),
      created_at: now,
      updated_at: now
    };

    successResponse(res, { user: createdUser }, 201);
  });

  // Get subuser details
  router.get('/api/v1/users/:id', (req, res) => {
    const operatorId = RequestContext.tryGet()?.operatorId || req.operatorId;
    const callerId = RequestContext.tryGet()?.userId || req.userId;
    if (!operatorId || !callerId) {
      return errorResponse(res, 'FORBIDDEN', 'Authentication required', 403);
    }

    const db = getDatabase();
    const caller = db.prepare(
      'SELECT role, is_system_user FROM users WHERE id = ? AND deleted_at IS NULL'
    ).get(callerId) as { role: string; is_system_user?: number } | undefined;

    if (!caller) {
      return errorResponse(res, 'FORBIDDEN', 'User inactive or not authorized', 403);
    }

    const overrides = loadOperatorRoleOverrides(operatorId, db);
    const hasAdminAccess = caller.is_system_user === 1 ||
      ['system_owner', 'system_manager', 'owner', 'manager'].includes(caller.role) ||
      hasPermission(caller.role, 'system:admin', overrides);

    if (!hasAdminAccess && callerId !== req.params.id) {
      return errorResponse(res, 'FORBIDDEN', 'Access denied to user profile', 403);
    }

    const user = db.prepare(`
      SELECT id, operator_id, email, first_name, last_name, role, is_system_user, created_at, updated_at
      FROM users
      WHERE id = ? AND operator_id = ? AND deleted_at IS NULL
    `).get(req.params.id!, operatorId) as any;

    if (!user) {
      return errorResponse(res, 'NOT_FOUND', 'User not found', 404);
    }

    successResponse(res, {
      user: {
        id: user.id,
        operator_id: user.operator_id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        is_system_user: user.is_system_user === 1 ? 1 : 0,
        allowed_portfolios: getUserPortfolioAccess(user.id, operatorId, db),
        allowed_modules: getUserModuleAccess(user.id, operatorId, db),
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });
  });

  // Update subuser
  router.put('/api/v1/users/:id', async (req, res) => {
    const operatorId = RequestContext.tryGet()?.operatorId || req.operatorId;
    const callerId = RequestContext.tryGet()?.userId || req.userId;
    if (!operatorId || !callerId) {
      return errorResponse(res, 'FORBIDDEN', 'Authentication required', 403);
    }

    const db = getDatabase();
    const caller = db.prepare(
      'SELECT role, is_system_user FROM users WHERE id = ? AND deleted_at IS NULL'
    ).get(callerId) as { role: string; is_system_user?: number } | undefined;

    const isSystemAdmin = caller?.is_system_user === 1 || caller?.role === 'system_owner' || caller?.role === 'system_manager';
    const isOperatorAdmin = caller?.role === 'owner' || caller?.role === 'manager';

    if (!isSystemAdmin && !isOperatorAdmin) {
      return errorResponse(res, 'FORBIDDEN', 'Only operator owners or managers can modify team members', 403);
    }

    const targetUser = db.prepare(
      'SELECT id, role FROM users WHERE id = ? AND operator_id = ? AND deleted_at IS NULL'
    ).get(req.params.id!, operatorId) as { id: string; role: string } | undefined;

    if (!targetUser) {
      return errorResponse(res, 'NOT_FOUND', 'User not found', 404);
    }

    // Callers below owner rank cannot modify users of equal or higher rank
    if (caller && caller.role !== 'owner' && caller.role !== 'system_owner' && caller.is_system_user !== 1) {
      if (!canAssignRole(caller.role, targetUser.role)) {
        return errorResponse(res, 'FORBIDDEN', `Cannot modify user with role '${targetUser.role}' exceeding caller privilege ceiling`, 403);
      }
    }

    const { first_name, last_name, role, password, portfolio_ids, allowed_portfolios, module_ids, allowed_modules } = req.body || {};
    let cleanRole: string | undefined;
    if (role !== undefined) {
      if (typeof role !== 'string') {
        return errorResponse(res, 'VALIDATION_ERROR', 'Role must be a string identifier', 400);
      }
      cleanRole = role.toLowerCase().trim();
      const allowedRoles = ['owner', 'manager', 'leasing_agent', 'assistant', 'maintenance', 'auditor', 'viewer', 'read_only'];
      if (!allowedRoles.includes(cleanRole)) {
        return errorResponse(res, 'VALIDATION_ERROR', `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`, 400);
      }
      if (caller && !canAssignRole(caller.role, cleanRole)) {
        return errorResponse(res, 'FORBIDDEN', `Cannot assign role '${cleanRole}' exceeding caller privilege ceiling`, 403);
      }
    }

    const now = Date.now();
    const effectivePortfolios = Array.isArray(portfolio_ids) ? portfolio_ids : (Array.isArray(allowed_portfolios) ? allowed_portfolios : undefined);
    const effectiveModules = Array.isArray(module_ids) ? module_ids : (Array.isArray(allowed_modules) ? allowed_modules : undefined);

    withTransaction((tx) => {
      if (first_name || last_name) {
        tx.prepare('UPDATE users SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), updated_at = ? WHERE id = ?')
          .run(first_name || null, last_name || null, now, targetUser.id);
      }
      if (cleanRole) {
        tx.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
          .run(cleanRole, now, targetUser.id);
      }
      if (effectivePortfolios !== undefined) {
        setUserPortfolioAccess(targetUser.id, operatorId, effectivePortfolios, tx);
      }
      if (effectiveModules !== undefined) {
        setUserModuleAccess(targetUser.id, operatorId, effectiveModules, tx);
      }
    }, db);

    if (password && typeof password === 'string' && password.length >= 8) {
      const hash = await hashPassword(password);
      db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?')
        .run(hash, now, targetUser.id);
    }

    const updated = db.prepare(`
      SELECT id, operator_id, email, first_name, last_name, role, is_system_user, created_at, updated_at
      FROM users WHERE id = ?
    `).get(targetUser.id) as any;

    successResponse(res, {
      user: {
        id: updated.id,
        operator_id: updated.operator_id,
        email: updated.email,
        first_name: updated.first_name,
        last_name: updated.last_name,
        role: updated.role,
        is_system_user: updated.is_system_user === 1 ? 1 : 0,
        allowed_portfolios: getUserPortfolioAccess(updated.id, operatorId, db),
        allowed_modules: getUserModuleAccess(updated.id, operatorId, db),
        created_at: updated.created_at,
        updated_at: updated.updated_at
      }
    });
  });

  // Delete subuser
  router.delete('/api/v1/users/:id', (req, res) => {
    const operatorId = RequestContext.tryGet()?.operatorId || req.operatorId;
    const callerId = RequestContext.tryGet()?.userId || req.userId;
    if (!operatorId || !callerId) {
      return errorResponse(res, 'FORBIDDEN', 'Authentication required', 403);
    }

    if (req.params.id === callerId) {
      return errorResponse(res, 'VALIDATION_ERROR', 'You cannot delete your own account', 400);
    }

    const db = getDatabase();
    const caller = db.prepare(
      'SELECT role, is_system_user FROM users WHERE id = ? AND deleted_at IS NULL'
    ).get(callerId) as { role: string; is_system_user?: number } | undefined;

    const isSystemAdmin = caller?.is_system_user === 1 || caller?.role === 'system_owner';
    const isOwner = caller?.role === 'owner';

    if (!isSystemAdmin && !isOwner) {
      return errorResponse(res, 'FORBIDDEN', 'Only operator owners or system owners can remove team members', 403);
    }

    const targetUser = db.prepare(
      'SELECT id, role FROM users WHERE id = ? AND operator_id = ? AND deleted_at IS NULL'
    ).get(req.params.id!, operatorId) as { id: string; role: string } | undefined;

    if (!targetUser) {
      return errorResponse(res, 'NOT_FOUND', 'User not found', 404);
    }

    // Check if target is sole owner
    if (targetUser.role === 'owner') {
      const ownerCountRow = db.prepare(
        "SELECT COUNT(*) as count FROM users WHERE operator_id = ? AND role = 'owner' AND deleted_at IS NULL"
      ).get(operatorId) as { count: number };
      if (Number(ownerCountRow?.count || 0) <= 1) {
        return errorResponse(res, 'CONFLICT', 'Cannot delete the only owner of this organization', 409);
      }
    }

    const now = Date.now();
    db.prepare('UPDATE users SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, targetUser.id);
    successResponse(res, { deleted: true });
  });

  // ==========================================
  // Platform Instance Owner & System Managers
  // ==========================================

  // List system managers ("minions of the owner")
  router.get('/api/v1/system/managers', (req, res) => {
    const callerId = RequestContext.tryGet()?.userId || req.userId;
    const db = getDatabase();
    const caller = callerId ? db.prepare('SELECT role, is_system_user FROM users WHERE id = ?').get(callerId) as any : null;
    const isOwner = caller?.is_system_user === 1 && (caller?.role === 'system_owner' || caller?.role === 'owner');

    if (!isOwner && callerId !== 'system') {
      return errorResponse(res, 'FORBIDDEN', 'Platform instance owner credentials required', 403);
    }

    const managers = db.prepare(`
      SELECT id, email, first_name, last_name, role, is_system_user, created_at, updated_at
      FROM users
      WHERE is_system_user = 1 AND deleted_at IS NULL
      ORDER BY created_at ASC
    `).all() as any[];

    successResponse(res, { managers });
  });

  // Provision a system manager minion
  router.post('/api/v1/system/managers', async (req, res) => {
    const callerId = RequestContext.tryGet()?.userId || req.userId;
    const db = getDatabase();
    const caller = callerId ? db.prepare('SELECT role, is_system_user FROM users WHERE id = ?').get(callerId) as any : null;
    const isOwner = caller?.is_system_user === 1 && (caller?.role === 'system_owner' || caller?.role === 'owner');

    if (!isOwner && callerId !== 'system') {
      return errorResponse(res, 'FORBIDDEN', 'Only the platform instance owner can appoint system managers', 403);
    }

    const { email, password, first_name, last_name } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanPassword = typeof password === 'string' ? password : '';
    const cleanFirst = typeof first_name === 'string' ? first_name.trim() : 'System';
    const cleanLast = typeof last_name === 'string' ? last_name.trim() : 'Manager';

    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      return errorResponse(res, 'VALIDATION_ERROR', 'A valid email address is required', 400);
    }
    if (cleanPassword.length < 8) {
      return errorResponse(res, 'VALIDATION_ERROR', 'Password must be at least 8 characters long', 400);
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL').get(cleanEmail);
    if (existing) {
      return errorResponse(res, 'CONFLICT', 'A user with this email address already exists', 409);
    }

    const primaryOperator = db.prepare('SELECT id FROM operators ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
    const opId = primaryOperator?.id || 'system';

    const now = Date.now();
    const newId = generateUUIDv7();
    const passwordHash = await hashPassword(cleanPassword);

    db.prepare(`
      INSERT INTO users (id, operator_id, email, password_hash, first_name, last_name, role, token_version, is_system_user, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'system_manager', 1, 1, ?, ?)
    `).run(newId, opId, cleanEmail, passwordHash, cleanFirst, cleanLast, now, now);

    successResponse(res, {
      manager: {
        id: newId,
        email: cleanEmail,
        first_name: cleanFirst,
        last_name: cleanLast,
        role: 'system_manager',
        is_system_user: 1,
        created_at: now
      }
    }, 201);
  });

  // Delete system manager minion
  router.delete('/api/v1/system/managers/:id', (req, res) => {
    const callerId = RequestContext.tryGet()?.userId || req.userId;
    const db = getDatabase();
    const caller = callerId ? db.prepare('SELECT role, is_system_user FROM users WHERE id = ?').get(callerId) as any : null;
    const isOwner = caller?.is_system_user === 1 && (caller?.role === 'system_owner' || caller?.role === 'owner');

    if (!isOwner && callerId !== 'system') {
      return errorResponse(res, 'FORBIDDEN', 'Only the platform instance owner can remove system managers', 403);
    }

    if (req.params.id === callerId) {
      return errorResponse(res, 'VALIDATION_ERROR', 'You cannot remove yourself as instance owner', 400);
    }

    const now = Date.now();
    const info = db.prepare('UPDATE users SET deleted_at = ?, updated_at = ? WHERE id = ? AND is_system_user = 1 AND deleted_at IS NULL')
      .run(now, now, req.params.id!);

    if (info.changes === 0) {
      return errorResponse(res, 'NOT_FOUND', 'System manager not found', 404);
    }

    successResponse(res, { deleted: true });
  });

  // List all operators (for platform owners and managers)
  router.get('/api/v1/system/operators', (req, res) => {
    const callerId = RequestContext.tryGet()?.userId || req.userId;
    const db = getDatabase();
    const caller = callerId ? db.prepare('SELECT role, is_system_user FROM users WHERE id = ?').get(callerId) as any : null;
    const isPlatformUser = caller?.is_system_user === 1 || caller?.role === 'system_owner' || caller?.role === 'system_manager';

    if (!isPlatformUser && callerId !== 'system') {
      return errorResponse(res, 'FORBIDDEN', 'Platform administrator credentials required', 403);
    }

    const operators = db.prepare(`
      SELECT o.id, o.name, o.subdomain, o.currency, o.storage_quota_bytes, o.created_at, o.updated_at,
             (SELECT COUNT(*) FROM units u WHERE u.operator_id = o.id AND u.deleted_at IS NULL) as unit_count,
             (SELECT COUNT(*) FROM users usr WHERE usr.operator_id = o.id AND usr.deleted_at IS NULL) as user_count
      FROM operators o
      WHERE o.deleted_at IS NULL
      ORDER BY o.created_at ASC
    `).all() as any[];

    successResponse(res, { operators });
  });

  // Update operator (name, quota, subdomain)
  router.put('/api/v1/system/operators/:id', (req, res) => {
    const callerId = RequestContext.tryGet()?.userId || req.userId;
    const db = getDatabase();
    const caller = callerId ? db.prepare('SELECT role, is_system_user FROM users WHERE id = ?').get(callerId) as any : null;
    const isPlatformUser = caller?.is_system_user === 1 || caller?.role === 'system_owner' || caller?.role === 'system_manager';

    if (!isPlatformUser && callerId !== 'system') {
      return errorResponse(res, 'FORBIDDEN', 'Platform administrator credentials required', 403);
    }

    const targetOp = db.prepare('SELECT * FROM operators WHERE id = ? AND deleted_at IS NULL').get(req.params.id!) as any;
    if (!targetOp) {
      return errorResponse(res, 'NOT_FOUND', 'Operator not found', 404);
    }

    const { name, storage_quota_bytes, storage_quota } = req.body || {};
    const now = Date.now();
    const newName = typeof name === 'string' && name.trim() ? name.trim() : targetOp.name;
    const rawQuota = storage_quota_bytes !== undefined ? storage_quota_bytes : storage_quota;
    const newQuota = rawQuota !== undefined && Number.isInteger(Number(rawQuota)) && Number(rawQuota) > 0
      ? Number(rawQuota)
      : targetOp.storage_quota_bytes;

    db.prepare('UPDATE operators SET name = ?, storage_quota_bytes = ?, updated_at = ? WHERE id = ?')
      .run(newName, newQuota, now, targetOp.id);

    const updated = db.prepare('SELECT * FROM operators WHERE id = ?').get(targetOp.id);
    successResponse(res, { operator: updated });
  });

  // Soft delete operator (strictly owner)
  router.delete('/api/v1/system/operators/:id', (req, res) => {
    const callerId = RequestContext.tryGet()?.userId || req.userId;
    const db = getDatabase();
    const caller = callerId ? db.prepare('SELECT role, is_system_user FROM users WHERE id = ?').get(callerId) as any : null;
    const isOwner = caller?.is_system_user === 1 && (caller?.role === 'system_owner' || caller?.role === 'owner');

    if (!isOwner && callerId !== 'system') {
      return errorResponse(res, 'FORBIDDEN', 'Only the platform instance owner can delete operators', 403);
    }

    const targetOp = db.prepare('SELECT * FROM operators WHERE id = ? AND deleted_at IS NULL').get(req.params.id!) as any;
    if (!targetOp) {
      return errorResponse(res, 'NOT_FOUND', 'Operator not found', 404);
    }

    const now = Date.now();
    withTransaction((tx) => {
      tx.prepare('UPDATE operators SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, targetOp.id);
      tx.prepare('UPDATE users SET deleted_at = ?, updated_at = ? WHERE operator_id = ?').run(now, now, targetOp.id);
    }, db);

    successResponse(res, { deleted: true });
  });

  return router;
}

/**
 * Start the loopback API server after validating runtime configuration.
 *
 * @param port TCP port for the API engine.
 * @param host Binding address, restricted to loopback by default.
 * @returns The HTTP server and configured router.
 */
export async function startServer(
  port: number = PORT,
  host: string = HOST
): Promise<{ server: HttpServer; router: Router }> {
  validateEnvironment(NODE_ENV, process.env['APP_SECRET']);

  const router = createRouter(port);

  // Load all functional modules dynamically
  await loadModules(router, eventBus);

  // Register core notification listeners on EventBus
  registerNotificationListeners(eventBus);

  activeBackupScheduler = null;
  backupSchedulerReadiness = 'not-mounted';

  // Initialize the scheduler only when the optional backup module is mounted.
  const backupModuleMounted = getLoadedModules().some((module) => module.manifest.id === 'backup');
  if (backupModuleMounted) {
    const configuredEnabled = process.env['BACKUP_SCHEDULE_ENABLED'];
    const backupsRequired = configuredEnabled === undefined || (
      configuredEnabled !== 'false' && configuredEnabled !== '0'
    );

    try {
      const schedulerMod = await import('../modules/backup/backend/scheduler.js');
      if (!schedulerMod.BackupScheduler) {
        throw new Error('Mounted backup module does not export BackupScheduler');
      }

      const scheduler = schedulerMod.BackupScheduler.getInstance();
      activeBackupScheduler = scheduler;
      if (scheduler.getStatus().enabled) {
        scheduler.start();
        backupSchedulerReadiness = 'running';
      } else {
        backupSchedulerReadiness = 'disabled';
      }
    } catch (err) {
      backupSchedulerReadiness = backupsRequired ? 'failed' : 'disabled';
      if (backupsRequired) {
        throw err;
      }
      process.stderr.write(
        `[BackupScheduler] Scheduler is disabled after initialization failed: ${String(err)}\n`
      );
    }
  }

  const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    router.handle(req, res);
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      process.stdout.write(`GarrisonOS API Engine listening at http://${host}:${port}\n`);
      resolve({ server, router });
    });
  });
}

// CLI Execution Entrypoint
const isDirectExecution = process.argv[1] && (
  process.argv[1].endsWith('server.ts') ||
  process.argv[1].endsWith('server.js') ||
  (import.meta.url && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
);

if (isDirectExecution) {
  startServer().catch((err) => {
    process.stderr.write(`Failed to start GarrisonOS server: ${String(err)}\n`);
    process.exit(1);
  });

  const cleanup = async () => {
    await activeBackupScheduler?.stop();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
