/**
 * Automated Test Suite for GarrisonOS Fair-Code License & Quota Subsystem
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  COMMUNITY_UNIT_LIMIT,
  APPROACHING_UNIT_LIMIT,
  GRACE_UNIT_LIMIT,
  STANDARD_GRACE_PERIOD_DAYS,
  STANDARD_OFFLINE_WARNING_DAYS,
  STANDARD_OFFLINE_CUTOFF_DAYS,
  CLOCK_ROLLBACK_TOLERANCE_MS,
  evaluateGracePeriod,
  getActiveUnitCount,
  getLicenseStatus,
  assertUnitQuota,
  verifyLicenseKey,
  generateLicenseToken,
  getOrCreateInstanceId,
  getHardwareFingerprint,
  ensureSystemSettingsTable,
  calculateThresholdNotice,
  getHeartbeatStatus,
  createHeartbeatChallenge,
  verifyHeartbeatResponse,
  recordVerifiedHeartbeat,
  generateHeartbeatResponseToken,
  evaluateClockIntegrity,
  generateSignedCrl,
  verifyAndApplyCrl,
  getStoredCrl,
  getOrCreateDatabaseAnchor,
  verifyDatabaseAnchor,
  reanchorDatabase,
  calculateFileSha256,
  evaluateModuleIntegrity,
  generateFiduciaryAuditSeal,
  LicenseLimitError,
  LicensePayload,
  LicenseCrl,
  SystemIntegrityManifest
} from '../core/license.js';
import { generateUUIDv7 } from '../core/crypto.js';
import { PropertiesRepository } from '../modules/properties/backend/repository.js';
import { LeasesRepository } from '../modules/leases/backend/repository.js';
import { generateMonthlyRentCharges } from '../modules/accounting/backend/billing.js';
import { AccountingRepository } from '../modules/accounting/backend/repository.js';
import { createTestDb, runInOperatorContext } from './helpers.js';
import { getDatabase, closeDatabase } from '../database/client.js';

describe('GarrisonOS License & Quota Subsystem', () => {
  let db: DatabaseSync;
  const originalEnv = process.env.GARRISON_EDITION;
  const originalKey = process.env.GARRISON_LICENSE_KEY;
  const originalInst = process.env.GARRISON_INSTANCE_ID;
  const originalStorage = process.env.STORAGE_PATH;
  const originalHw = process.env.GARRISON_HARDWARE_FINGERPRINT;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS units (
        id TEXT PRIMARY KEY,
        operator_id TEXT NOT NULL,
        unit_number TEXT NOT NULL,
        deleted_at INTEGER
      );
    `);
  });

  afterEach(() => {
    db.close();
    if (originalEnv !== undefined) {
      process.env.GARRISON_EDITION = originalEnv;
    } else {
      delete process.env.GARRISON_EDITION;
    }

    if (originalKey !== undefined) {
      process.env.GARRISON_LICENSE_KEY = originalKey;
    } else {
      delete process.env.GARRISON_LICENSE_KEY;
    }

    if (originalInst !== undefined) {
      process.env.GARRISON_INSTANCE_ID = originalInst;
    } else {
      delete process.env.GARRISON_INSTANCE_ID;
    }

    if (originalStorage !== undefined) {
      process.env.STORAGE_PATH = originalStorage;
    } else {
      delete process.env.STORAGE_PATH;
    }

    if (originalHw !== undefined) {
      process.env.GARRISON_HARDWARE_FINGERPRINT = originalHw;
    } else {
      delete process.env.GARRISON_HARDWARE_FINGERPRINT;
    }
  });

  function insertUnits(count: number, deleted: boolean = false) {
    const stmt = db.prepare(
      'INSERT INTO units (id, operator_id, unit_number, deleted_at) VALUES (?, ?, ?, ?)'
    );
    for (let i = 1; i <= count; i++) {
      stmt.run(generateUUIDv7(), 'op-1', `Unit ${i}`, deleted ? Date.now() : null);
    }
  }

  describe('Active Unit Counting', () => {
    it('returns 0 when no units exist', () => {
      assert.strictEqual(getActiveUnitCount(db), 0);
    });

    it('accurately counts active units while excluding soft-deleted units', () => {
      insertUnits(15, false); // 15 active
      insertUnits(5, true);   // 5 deleted
      assert.strictEqual(getActiveUnitCount(db), 15);
    });
  });

  describe('Standard Edition Quota Tiers (50 Soft / 60 Hard)', () => {
    beforeEach(() => {
      process.env.GARRISON_EDITION = 'standard';
      delete process.env.GARRISON_LICENSE_KEY;
    });

    it('evaluates to community tier when unit count <= 50', () => {
      insertUnits(45);
      const status = getLicenseStatus(db);

      assert.strictEqual(status.tier, 'community');
      assert.strictEqual(status.unitCount, 45);
      assert.strictEqual(status.maxUnits, COMMUNITY_UNIT_LIMIT);
      assert.strictEqual(status.inGraceWindow, false);
      assert.strictEqual(status.isOverQuota, false);
      assert.doesNotThrow(() => assertUnitQuota(db));
    });

    it('evaluates exactly 50 units as within the community tier', () => {
      insertUnits(50);
      const status = getLicenseStatus(db);

      assert.strictEqual(status.tier, 'community');
      assert.strictEqual(status.inGraceWindow, false);
      assert.strictEqual(status.isOverQuota, false);
      assert.doesNotThrow(() => assertUnitQuota(db));
    });

    it('evaluates to grace tier when unit count is between 51 and 60', () => {
      insertUnits(55);
      const status = getLicenseStatus(db);

      assert.strictEqual(status.tier, 'grace');
      assert.strictEqual(status.unitCount, 55);
      assert.strictEqual(status.maxUnits, GRACE_UNIT_LIMIT);
      assert.strictEqual(status.inGraceWindow, true);
      assert.strictEqual(status.isOverQuota, false);
      assert.strictEqual(status.isGraceExpired, false);
      assert.strictEqual(status.graceDaysRemaining, 14);
      // Grace period allows unit creation without throwing
      assert.doesNotThrow(() => assertUnitQuota(db));
    });

    it('expires grace period and fails closed after 14 days have elapsed for 51-60 units', () => {
      insertUnits(55);
      const initialStatus = getLicenseStatus(db);
      assert.strictEqual(initialStatus.inGraceWindow, true);
      assert.strictEqual(initialStatus.isGraceExpired, false);

      // Simulate grace window entered 15 days ago
      const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
      db.prepare("UPDATE system_settings SET value = ? WHERE key = 'standard_grace_entered_at'").run(String(fifteenDaysAgo));

      const expiredStatus = getLicenseStatus(db);
      assert.strictEqual(expiredStatus.tier, 'over_quota');
      assert.strictEqual(expiredStatus.inGraceWindow, false);
      assert.strictEqual(expiredStatus.isOverQuota, true);
      assert.strictEqual(expiredStatus.isGraceExpired, true);
      assert.strictEqual(expiredStatus.graceDaysRemaining, 0);
      assert.strictEqual(expiredStatus.thresholdNotice, 'over_quota');
      assert.ok(expiredStatus.error?.includes('14-day grace period for units 51-60 has expired'));

      // Unit creation is locked once the 14-day grace period expires
      assert.throws(
        () => assertUnitQuota(db),
        (err: any) => {
          assert.ok(err instanceof LicenseLimitError);
          assert.strictEqual(err.code, 'LICENSE_LIMIT_EXCEEDED');
          assert.strictEqual(err.status, 402);
          assert.strictEqual(err.unitCount, 55);
          assert.strictEqual(err.limit, COMMUNITY_UNIT_LIMIT);
          assert.ok(err.message.includes('14-day grace window expired'));
          return true;
        }
      );
    });

    it('resets grace tracking when active units drop back to 50 or fewer', () => {
      insertUnits(55);
      const graceStatus = getLicenseStatus(db);
      assert.strictEqual(graceStatus.inGraceWindow, true);

      // Soft-delete 10 units so unit count drops to 45
      db.prepare('UPDATE units SET deleted_at = ? WHERE id IN (SELECT id FROM units LIMIT 10)').run(Date.now());
      assert.strictEqual(getActiveUnitCount(db), 45);

      const resetStatus = getLicenseStatus(db);
      assert.strictEqual(resetStatus.tier, 'community');
      assert.strictEqual(resetStatus.inGraceWindow, false);
      assert.strictEqual(resetStatus.isOverQuota, false);
      assert.strictEqual(resetStatus.isGraceExpired, false);

      // Verify database record in system_settings was cleared
      const row = db.prepare("SELECT value FROM system_settings WHERE key = 'standard_grace_entered_at'").get();
      assert.strictEqual(row, undefined);
    });

    it('evaluates to over_quota and throws LicenseLimitError when unit count > 60', () => {
      insertUnits(61);
      const status = getLicenseStatus(db);

      assert.strictEqual(status.tier, 'over_quota');
      assert.strictEqual(status.unitCount, 61);
      assert.strictEqual(status.inGraceWindow, false);
      assert.strictEqual(status.isOverQuota, true);

      assert.throws(
        () => assertUnitQuota(db),
        (err: any) => {
          assert.ok(err instanceof LicenseLimitError);
          assert.strictEqual(err.code, 'LICENSE_LIMIT_EXCEEDED');
          assert.strictEqual(err.status, 402);
          assert.strictEqual(err.unitCount, 61);
          assert.strictEqual(err.limit, GRACE_UNIT_LIMIT);
          assert.ok(err.message.includes('Fair-Code quota exceeded'));
          return true;
        }
      );
    });
  });

  describe('Community Edition (Unrestricted)', () => {
    it('allows unlimited units without grace or quota restrictions', () => {
      process.env.GARRISON_EDITION = 'community';
      insertUnits(150);

      const status = getLicenseStatus(db);
      assert.strictEqual(status.tier, 'community');
      assert.strictEqual(status.unitCount, 150);
      assert.strictEqual(status.maxUnits, Infinity);
      assert.strictEqual(status.inGraceWindow, false);
      assert.strictEqual(status.isOverQuota, false);
      assert.doesNotThrow(() => assertUnitQuota(db));
    });
  });

  describe('Ed25519 Cryptographic License Key Verification', () => {
    // Generate test Ed25519 keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    it('successfully generates and verifies a valid offline license key', () => {
      const payload: LicensePayload = {
        licensee: 'Acme Commercial Properties LLC',
        maxUnits: 250,
        issuedAt: Date.now() - 10000,
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 // 1 year out
      };

      const token = generateLicenseToken(payload, privateKey);
      const result = verifyLicenseKey(token, publicKey);

      assert.strictEqual(result.valid, true);
      assert.ok(result.payload);
      assert.strictEqual(result.payload?.licensee, 'Acme Commercial Properties LLC');
      assert.strictEqual(result.payload?.maxUnits, 250);
    });

    it('rejects tampered or forged license tokens', () => {
      const payload: LicensePayload = {
        licensee: 'Hacker Holdings',
        maxUnits: 1000,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 100000
      };

      const validToken = generateLicenseToken(payload, privateKey);
      const [payloadB64, sigB64] = validToken.split('.');

      // Tamper with payload (modify licensee in base64)
      const tamperedPayloadB64 = Buffer.from(
        JSON.stringify({ ...payload, maxUnits: 999999 }),
        'utf8'
      ).toString('base64url');

      const tamperedToken = `${tamperedPayloadB64}.${sigB64}`;
      const result = verifyLicenseKey(tamperedToken, publicKey);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('mismatch') || result.error?.includes('tampered'));
    });

    it('rejects expired commercial license tokens', () => {
      const expiredPayload: LicensePayload = {
        licensee: 'Expired Realty',
        maxUnits: 500,
        issuedAt: Date.now() - 1000000,
        expiresAt: Date.now() - 5000 // Expired 5 seconds ago
      };

      const expiredToken = generateLicenseToken(expiredPayload, privateKey);
      const result = verifyLicenseKey(expiredToken, publicKey);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('License expired'));
    });

    it('unlocks 61+ units in Standard Edition when a valid key is provided', () => {
      process.env.GARRISON_EDITION = 'standard';
      insertUnits(85);

      const payload: LicensePayload = {
        licensee: 'Enterprise Landlord',
        maxUnits: 200,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 10000000
      };

      const token = generateLicenseToken(payload, privateKey);
      const status = getLicenseStatus(db, token, publicKey);

      assert.strictEqual(status.tier, 'community');
      assert.strictEqual(status.unitCount, 85);
      assert.strictEqual(status.maxUnits, 200);
      assert.strictEqual(status.isOverQuota, false);
      assert.strictEqual(status.hasValidCommercialKey, true);
      assert.strictEqual(status.licensee, 'Enterprise Landlord');
    });
  });

  describe('Persistent Instance Identity & Mutual Self-Healing', () => {
    let tempStorage: string;

    beforeEach(() => {
      tempStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'garrison-inst-test-'));
      process.env.STORAGE_PATH = tempStorage;
      delete process.env.GARRISON_INSTANCE_ID;
    });

    afterEach(() => {
      try {
        fs.rmSync(tempStorage, { recursive: true, force: true });
      } catch {
        // cleanup
      }
    });

    it('generates a new inst_ prefixed UUIDv7 and persists to both SQLite and STORAGE_PATH', () => {
      const instanceId = getOrCreateInstanceId(db);

      assert.ok(instanceId.startsWith('inst_'));
      assert.strictEqual(instanceId.length > 10, true);

      // Verify stored in SQLite system_settings
      const stmt = db.prepare("SELECT value FROM system_settings WHERE key = 'instance_id'");
      const row = stmt.get() as { value: string };
      assert.strictEqual(row.value, instanceId);

      // Verify stored in STORAGE_PATH/.instance_id
      const filePath = path.join(tempStorage, '.instance_id');
      assert.strictEqual(fs.existsSync(filePath), true);
      assert.strictEqual(fs.readFileSync(filePath, 'utf8').trim(), instanceId);
    });

    it('remains stable and does not change across repeated calls', () => {
      const firstId = getOrCreateInstanceId(db);
      const secondId = getOrCreateInstanceId(db);
      assert.strictEqual(firstId, secondId);
    });

    it('self-heals: restores instance ID from storage file if SQLite database was reset or wiped', () => {
      // 1. Initial generation
      const originalId = getOrCreateInstanceId(db);

      // 2. Simulate fresh database (e.g. Docker container replaced with fresh volume or migration rerun)
      const freshDb = new DatabaseSync(':memory:');
      const restoredId = getOrCreateInstanceId(freshDb);

      assert.strictEqual(restoredId, originalId);

      // Check that it wrote the restored ID into freshDb's system_settings
      const stmt = freshDb.prepare("SELECT value FROM system_settings WHERE key = 'instance_id'");
      const row = stmt.get() as { value: string };
      assert.strictEqual(row.value, originalId);
      freshDb.close();
    });

    it('self-heals: restores storage file if file was deleted but database persisted', () => {
      const originalId = getOrCreateInstanceId(db);
      const filePath = path.join(tempStorage, '.instance_id');

      // Delete storage file
      fs.unlinkSync(filePath);
      assert.strictEqual(fs.existsSync(filePath), false);

      // Call again with database
      const id = getOrCreateInstanceId(db);
      assert.strictEqual(id, originalId);

      // File is restored
      assert.strictEqual(fs.existsSync(filePath), true);
      assert.strictEqual(fs.readFileSync(filePath, 'utf8').trim(), originalId);
    });

    it('respects authoritative GARRISON_INSTANCE_ID environment variable override', () => {
      process.env.GARRISON_INSTANCE_ID = 'inst_custom_iac_cluster_99';
      const id = getOrCreateInstanceId(db);
      assert.strictEqual(id, 'inst_custom_iac_cluster_99');
    });
  });

  describe('Cryptographic Instance ID Binding & Anti-Reuse Enforcement', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    it('validates a license key bound to matching instance ID', () => {
      const targetInstanceId = 'inst_valid_target_node_1';
      const payload: LicensePayload = {
        licensee: 'Single-Node Operator LLC',
        maxUnits: 500,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 1000000,
        instanceId: targetInstanceId
      };

      const token = generateLicenseToken(payload, privateKey);
      const result = verifyLicenseKey(token, publicKey, targetInstanceId);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.payload?.instanceId, targetInstanceId);
    });

    it('strictly rejects a license key if used on a different instance ID (preventing key re-use)', () => {
      const legitimateInstanceId = 'inst_paying_customer_node';
      const piratedInstanceId = 'inst_different_operator_node';

      const payload: LicensePayload = {
        licensee: 'Paying Customer Properties',
        maxUnits: 500,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 1000000,
        instanceId: legitimateInstanceId
      };

      const token = generateLicenseToken(payload, privateKey);

      // Operator B tries to use Paying Customer's key on their own instance
      const result = verifyLicenseKey(token, publicKey, piratedInstanceId);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('License is bound to instance ID'));
      assert.ok(result.error?.includes(legitimateInstanceId));
      assert.ok(result.error?.includes(piratedInstanceId));
    });

    it('fails closed in getLicenseStatus when instance ID does not match bound key', () => {
      process.env.GARRISON_EDITION = 'standard';
      insertUnits(75);

      const targetInstance = 'inst_node_alpha';
      const attackerInstance = 'inst_node_beta';

      const payload: LicensePayload = {
        licensee: 'Alpha Corp',
        maxUnits: 200,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 1000000,
        instanceId: targetInstance
      };

      const token = generateLicenseToken(payload, privateKey);

      // getLicenseStatus with attackerInstance
      const status = getLicenseStatus(db, token, publicKey, attackerInstance);

      // Since key verification failed due to instance mismatch, key is not accepted!
      assert.strictEqual(status.hasValidCommercialKey, false);
      assert.strictEqual(status.isOverQuota, true);
      assert.strictEqual(status.tier, 'over_quota');
      assert.throws(() => assertUnitQuota(db), LicenseLimitError);
    });

    it('allows floating keys (no instanceId in payload) to validate on any instance', () => {
      const payload: LicensePayload = {
        licensee: 'Floating Enterprise Corp',
        maxUnits: 1000,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 1000000
        // instanceId intentionally omitted
      };

      const token = generateLicenseToken(payload, privateKey);

      const result1 = verifyLicenseKey(token, publicKey, 'inst_node_1');
      const result2 = verifyLicenseKey(token, publicKey, 'inst_node_2');

      assert.strictEqual(result1.valid, true);
      assert.strictEqual(result2.valid, true);
    });
  });

  describe('Enterprise Edition Hardware Locking & Server Migration Enforcement', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    it('generates a valid hw_ prefixed hardware fingerprint', () => {
      const hw = getHardwareFingerprint();
      assert.ok(hw.startsWith('hw_'));
      assert.strictEqual(hw.length > 5, true);
    });

    it('respects authoritative GARRISON_HARDWARE_FINGERPRINT environment variable override', () => {
      process.env.GARRISON_HARDWARE_FINGERPRINT = 'hw_custom_server_blade_01';
      const hw = getHardwareFingerprint();
      assert.strictEqual(hw, 'hw_custom_server_blade_01');
    });

    it('validates a license key when bound hardware fingerprint matches the host', () => {
      const hostHw = 'hw_target_bare_metal_rack';
      const payload: LicensePayload = {
        licensee: 'Enterprise Air-Gapped Holdings',
        maxUnits: 2500,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 10000000,
        instanceId: 'inst_enterprise_node',
        hardwareFingerprint: hostHw
      };

      const token = generateLicenseToken(payload, privateKey);
      const result = verifyLicenseKey(token, publicKey, 'inst_enterprise_node', hostHw);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.payload?.hardwareFingerprint, hostHw);
    });

    it('strictly rejects a license key if host hardware fingerprint does not match (preventing VM cloning)', () => {
      const hostA = 'hw_original_dell_poweredge';
      const hostB = 'hw_cloned_vm_or_different_server';

      const payload: LicensePayload = {
        licensee: 'Enterprise Air-Gapped Holdings',
        maxUnits: 2500,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 10000000,
        instanceId: 'inst_enterprise_node',
        hardwareFingerprint: hostA
      };

      const token = generateLicenseToken(payload, privateKey);

      // Attempting to run Host A's key on Host B
      const result = verifyLicenseKey(token, publicKey, 'inst_enterprise_node', hostB);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('License is hardware-locked to host'));
      assert.ok(result.error?.includes(hostA));
      assert.ok(result.error?.includes(hostB));
      assert.ok(result.error?.includes('licensing@garrisonos.org'));
    });

    it('enforces mandatory hardware locking in Enterprise Edition', () => {
      process.env.GARRISON_EDITION = 'enterprise';
      insertUnits(100);

      // Payload missing hardwareFingerprint
      const unlockedPayload: LicensePayload = {
        licensee: 'Enterprise Client',
        maxUnits: 500,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 1000000,
        instanceId: 'inst_enterprise_node'
      };

      const token = generateLicenseToken(unlockedPayload, privateKey);
      const status = getLicenseStatus(db, token, publicKey, 'inst_enterprise_node', 'hw_any_host');

      // Enterprise requires hardware-locked keys
      assert.strictEqual(status.hasValidCommercialKey, false);
      assert.strictEqual(status.isOverQuota, true);
      assert.strictEqual(status.tier, 'over_quota');
      assert.ok(status.error?.includes('requires a hardware-locked license key'));
    });

    it('supports 1-week migration overlap policy: new key is active on Host B while old key expires 7 days later', () => {
      const hostA = 'hw_old_datacenter_node';
      const hostB = 'hw_new_cloud_vm';
      const now = Date.now();
      const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

      // Old key re-issued/updated with 7-day expiration from migration issuance date
      const oldKeyPayload: LicensePayload = {
        licensee: 'Migrating Enterprise Corp',
        maxUnits: 1500,
        issuedAt: now,
        expiresAt: now + ONE_WEEK_MS,
        instanceId: 'inst_old_node',
        hardwareFingerprint: hostA
      };

      // New key issued for Host B with full 1-year duration
      const newKeyPayload: LicensePayload = {
        licensee: 'Migrating Enterprise Corp',
        maxUnits: 1500,
        issuedAt: now,
        expiresAt: now + 365 * 24 * 60 * 60 * 1000,
        instanceId: 'inst_new_node',
        hardwareFingerprint: hostB
      };

      const oldToken = generateLicenseToken(oldKeyPayload, privateKey);
      const newToken = generateLicenseToken(newKeyPayload, privateKey);

      // During migration window: both keys are valid on their respective hosts
      const checkOldDuring = verifyLicenseKey(oldToken, publicKey, 'inst_old_node', hostA);
      const checkNewDuring = verifyLicenseKey(newToken, publicKey, 'inst_new_node', hostB);
      assert.strictEqual(checkOldDuring.valid, true);
      assert.strictEqual(checkNewDuring.valid, true);

      // Expired token simulating after the 1-week migration window
      const expiredOldToken = generateLicenseToken({ ...oldKeyPayload, expiresAt: now - 1000 }, privateKey);
      const checkOldAfter = verifyLicenseKey(expiredOldToken, publicKey, 'inst_old_node', hostA);
      assert.strictEqual(checkOldAfter.valid, false);
      assert.ok(checkOldAfter.error?.includes('License expired'));
    });
  });

  describe('Progressive Quota Warning Thresholds', () => {
    it('accurately evaluates progressive thresholds for Community and Standard tiers', () => {
      assert.strictEqual(calculateThresholdNotice(30, COMMUNITY_UNIT_LIMIT), 'none');
      assert.strictEqual(calculateThresholdNotice(44, COMMUNITY_UNIT_LIMIT), 'none');
      assert.strictEqual(calculateThresholdNotice(45, COMMUNITY_UNIT_LIMIT), 'approaching_limit');
      assert.strictEqual(calculateThresholdNotice(50, COMMUNITY_UNIT_LIMIT), 'approaching_limit');
      assert.strictEqual(calculateThresholdNotice(51, COMMUNITY_UNIT_LIMIT), 'in_grace_window');
      assert.strictEqual(calculateThresholdNotice(60, COMMUNITY_UNIT_LIMIT), 'in_grace_window');
      assert.strictEqual(calculateThresholdNotice(61, COMMUNITY_UNIT_LIMIT), 'over_quota');
    });

    it('attaches thresholdNotice to getLicenseStatus across tiers', () => {
      process.env.GARRISON_EDITION = 'standard';

      insertUnits(46);
      const status46 = getLicenseStatus(db);
      assert.strictEqual(status46.thresholdNotice, 'approaching_limit');

      insertUnits(8); // now 54 units
      const status54 = getLicenseStatus(db);
      assert.strictEqual(status54.thresholdNotice, 'in_grace_window');

      insertUnits(10); // now 64 units
      const status64 = getLicenseStatus(db);
      assert.strictEqual(status64.thresholdNotice, 'over_quota');
    });
  });

  describe('Standard Edition Heartbeat & Anti-MITM / Hosts File Spoofing Defense', () => {
    // Generate authentic Garrison keypair for test verification
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // Generate rogue attacker keypair to simulate MITM proxy or fake local server
    const rogueKeypair = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    it('generates a cryptographically randomized challenge nonce', () => {
      const challenge1 = createHeartbeatChallenge(db);
      const challenge2 = createHeartbeatChallenge(db);

      assert.ok(challenge1.nonce);
      assert.ok(challenge2.nonce);
      assert.notStrictEqual(challenge1.nonce, challenge2.nonce);
      assert.strictEqual(challenge1.nonce.length, 32);
    });

    it('successfully validates authentic Ed25519 signed heartbeat response', () => {
      const challenge = createHeartbeatChallenge(db);
      const responseToken = generateHeartbeatResponseToken(
        {
          nonce: challenge.nonce,
          status: 'valid',
          timestamp: challenge.timestamp
        },
        privateKey
      );

      const result = verifyHeartbeatResponse(responseToken, challenge.nonce, publicKey);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.payload?.status, 'valid');
      assert.strictEqual(result.payload?.nonce, challenge.nonce);
    });

    it('strictly defeats MITM / /etc/hosts redirection by rejecting fake responses signed with rogue keys', () => {
      const challenge = createHeartbeatChallenge(db);

      // Rogue server on 127.0.0.1 signs a fake response with attacker private key
      const fakeToken = generateHeartbeatResponseToken(
        {
          nonce: challenge.nonce,
          status: 'valid',
          timestamp: challenge.timestamp
        },
        rogueKeypair.privateKey
      );

      const result = verifyHeartbeatResponse(fakeToken, challenge.nonce, publicKey);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('signature mismatch'));
      assert.ok(result.error?.includes('hosts file/DNS spoofing blocked'));
    });

    it('defeats replay attacks: rejects responses where client nonce does not match', () => {
      const challenge = createHeartbeatChallenge(db);

      // Attacker intercepts and replays yesterday's response with stale nonce
      const replayedToken = generateHeartbeatResponseToken(
        {
          nonce: 'stale-replayed-nonce-123',
          status: 'valid',
          timestamp: challenge.timestamp
        },
        privateKey
      );

      const result = verifyHeartbeatResponse(replayedToken, challenge.nonce, publicKey);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Nonce mismatch'));
      assert.ok(result.error?.includes('replay attack detected'));
    });

    it('defeats stale timestamp replay attacks outside clock skew tolerance', () => {
      const challenge = createHeartbeatChallenge(db);
      const staleTimestamp = Date.now() - 30 * 60 * 1000; // 30 minutes in the past

      const staleToken = generateHeartbeatResponseToken(
        {
          nonce: challenge.nonce,
          status: 'valid',
          timestamp: staleTimestamp
        },
        privateKey
      );

      const result = verifyHeartbeatResponse(staleToken, challenge.nonce, publicKey);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Stale heartbeat response'));
    });

    it('persists verified heartbeat in system_settings and resets offline days counter', () => {
      const challenge = createHeartbeatChallenge(db);
      const token = generateHeartbeatResponseToken(
        {
          nonce: challenge.nonce,
          status: 'valid',
          timestamp: challenge.timestamp
        },
        privateKey
      );

      const recordResult = recordVerifiedHeartbeat(db, token, challenge.nonce, publicKey);
      assert.strictEqual(recordResult.success, true);

      const heartbeat = getHeartbeatStatus(db);
      assert.strictEqual(heartbeat.lastVerifiedAt, challenge.timestamp);
      assert.strictEqual(heartbeat.offlineDays, 0);
      assert.strictEqual(heartbeat.isWarningActive, false);
      assert.strictEqual(heartbeat.isCutoffActive, false);
    });

    it('triggers warning after 14 days and fails closed after 30 days offline for Standard Edition > 50 units', () => {
      process.env.GARRISON_EDITION = 'standard';
      insertUnits(55); // Operating in grace window

      // Simulate a node that has been offline for 32 days
      const thirtyTwoDaysAgo = Date.now() - 32 * 24 * 60 * 60 * 1000;
      ensureSystemSettingsTable(db);
      db.prepare(`
        INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
        VALUES ('last_heartbeat_verified_at', ?, ?, ?, NULL)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(thirtyTwoDaysAgo), Date.now(), Date.now());

      const status = getLicenseStatus(db);
      assert.strictEqual(status.heartbeat?.isWarningActive, true);
      assert.strictEqual(status.heartbeat?.isCutoffActive, true);
      assert.strictEqual(status.isOverQuota, true);
      assert.ok(status.error?.includes('offline for over 30 days'));

      // Unit creation is locked due to 30-day cutoff
      assert.throws(() => assertUnitQuota(db), LicenseLimitError);

      // Reconnect and receive valid heartbeat: cutoff clears immediately!
      const challenge = createHeartbeatChallenge(db);
      const validToken = generateHeartbeatResponseToken(
        {
          nonce: challenge.nonce,
          status: 'valid',
          timestamp: challenge.timestamp
        },
        privateKey
      );
      recordVerifiedHeartbeat(db, validToken, challenge.nonce, publicKey);

      const refreshedStatus = getLicenseStatus(db);
      assert.strictEqual(refreshedStatus.heartbeat?.isCutoffActive, false);
      assert.strictEqual(refreshedStatus.isOverQuota, false);
      assert.doesNotThrow(() => assertUnitQuota(db));
    });
  });

  describe('Clock Tampering Protection & DST-Immune Monotonic Guard', () => {
    it('detects clock rollback when system clock is manipulated > 24 hours into the past', () => {
      process.env.GARRISON_EDITION = 'standard';
      insertUnits(10);
      ensureSystemSettingsTable(db);

      // Simulate a future timestamp recorded previously (e.g. 48 hours ahead of now)
      const futureTimestamp = Date.now() + 48 * 60 * 60 * 1000;
      db.prepare(`
        INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
        VALUES ('last_observed_timestamp', ?, ?, ?, NULL)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(futureTimestamp), Date.now(), Date.now());

      const clockCheck = evaluateClockIntegrity(db);
      assert.strictEqual(clockCheck.isClockRollbackDetected, true);

      const status = getLicenseStatus(db);
      assert.strictEqual(status.isClockRollbackDetected, true);
      assert.strictEqual(status.isOverQuota, true);
      assert.ok(status.error?.includes('clock rollback detected'));

      assert.throws(() => assertUnitQuota(db), (err: any) => {
        return err instanceof LicenseLimitError && err.message.includes('clock integrity failure');
      });
    });

    it('provides 100% immunity to Daylight Savings Time and timezone relocations within 24 hours', () => {
      process.env.GARRISON_EDITION = 'standard';
      insertUnits(10);
      ensureSystemSettingsTable(db);

      // Simulate a small clock skew (e.g. 2 hours ahead due to DST transition or timezone change)
      const skewTimestamp = Date.now() + 2 * 60 * 60 * 1000;
      db.prepare(`
        INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
        VALUES ('last_observed_timestamp', ?, ?, ?, NULL)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(skewTimestamp), Date.now(), Date.now());

      const clockCheck = evaluateClockIntegrity(db);
      assert.strictEqual(clockCheck.isClockRollbackDetected, false);

      const status = getLicenseStatus(db);
      assert.strictEqual(status.isClockRollbackDetected, false);
      assert.strictEqual(status.isOverQuota, false);
      assert.doesNotThrow(() => assertUnitQuota(db));
    });

    it('advances last_observed_timestamp monotonically as real time progresses', () => {
      ensureSystemSettingsTable(db);
      const beforeTime = Date.now();
      evaluateClockIntegrity(db);

      const stmt = db.prepare("SELECT value FROM system_settings WHERE key = 'last_observed_timestamp'");
      const row = stmt.get() as { value: string } | undefined;
      assert.ok(row && Number(row.value) >= beforeTime);
    });
  });

  describe('Standard Edition Commercial Expansion Keys & Online Heartbeat Cutoff', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    it('allows expanding Standard Edition unit quota beyond 50 units with a commercial key while online', () => {
      process.env.GARRISON_EDITION = 'standard';
      insertUnits(150);

      const instanceId = getOrCreateInstanceId(db);
      const payload: LicensePayload = {
        licensee: 'Mid-Market Portfolio Manager LLC',
        maxUnits: 250,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        instanceId
      };

      const token = generateLicenseToken(payload, privateKey);
      const status = getLicenseStatus(db, token, publicKey, instanceId);

      assert.strictEqual(status.hasValidCommercialKey, true);
      assert.strictEqual(status.maxUnits, 250);
      assert.strictEqual(status.unitCount, 150);
      assert.strictEqual(status.isOverQuota, false);
    });

    it('enforces 30-day offline cutoff on Standard Edition expansion keys (requiring periodic heartbeat)', () => {
      process.env.GARRISON_EDITION = 'standard';
      insertUnits(150);

      const instanceId = getOrCreateInstanceId(db);
      const payload: LicensePayload = {
        licensee: 'Mid-Market Portfolio Manager LLC',
        maxUnits: 250,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        instanceId
      };

      const token = generateLicenseToken(payload, privateKey);

      // Simulate being offline for 35 days (> 30 days cutoff)
      const thirtyFiveDaysAgo = Date.now() - 35 * 24 * 60 * 60 * 1000;
      ensureSystemSettingsTable(db);
      db.prepare(`
        INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
        VALUES ('last_heartbeat_verified_at', ?, ?, ?, NULL)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(thirtyFiveDaysAgo), Date.now(), Date.now());

      const status = getLicenseStatus(db, token, publicKey, instanceId);

      assert.strictEqual(status.hasValidCommercialKey, true);
      assert.strictEqual(status.heartbeat?.isCutoffActive, true);
      assert.strictEqual(status.isOverQuota, true);
      assert.ok(status.error?.includes('offline for over 30 days'));
    });
  });
});

describe('Redundant Multi-Chokepoint Module Enforcement', () => {
  let originalEdition: string | undefined;

  beforeEach(() => {
    originalEdition = process.env.GARRISON_EDITION;
    process.env.GARRISON_EDITION = 'standard';
    delete process.env.GARRISON_LICENSE_KEY;
  });

  afterEach(() => {
    closeDatabase();
    if (originalEdition !== undefined) {
      process.env.GARRISON_EDITION = originalEdition;
    } else {
      delete process.env.GARRISON_EDITION;
    }
  });

  it('blocks lease activation and automated recurring rent runs when portfolio exceeds license quota', () => {
    createTestDb();

    runInOperatorContext('op-redundancy-test', () => {
      // 1. Create a property
      const prop = PropertiesRepository.createProperty({
        name: 'Redundancy Test Complex',
        property_type: 'multi_family',
        address_line1: '100 Main St',
        city: 'Denver',
        state: 'CO',
        postal_code: '80202'
      });

      // 2. Insert 65 units directly via SQL to simulate an existing or imported over-quota state
      const db = getDatabase();
      const units: Array<{ id: string }> = [];
      const now = Date.now();
      for (let i = 1; i <= 65; i++) {
        const uId = generateUUIDv7();
        db.prepare(`
          INSERT INTO units (id, operator_id, property_id, unit_number, status, market_rent_cents, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'vacant', ?, ?, ?)
        `).run(uId, 'op-redundancy-test', prop.id, `A-${i}`, 120000, now, now);
        units.push({ id: uId });
      }

      // 3. Draft lease creation is permitted
      const draftLease = LeasesRepository.createLease({
        unit_id: units[0]!.id,
        status: 'draft',
        start_date: Date.UTC(2026, 0, 1),
        end_date: Date.UTC(2026, 11, 31),
        rent_amount_cents: 120000
      });
      assert.strictEqual(draftLease.status, 'draft');

      // 4. Activating draft lease fails closed at lease repository level
      assert.throws(() => {
        LeasesRepository.updateLease(draftLease.id, { status: 'active' });
      }, LicenseLimitError);

      // 5. Creating an active lease directly fails closed at lease repository level
      assert.throws(() => {
        LeasesRepository.createLease({
          unit_id: units[1]!.id,
          status: 'active',
          start_date: Date.UTC(2026, 0, 1),
          end_date: Date.UTC(2026, 11, 31),
          rent_amount_cents: 120000
        });
      }, LicenseLimitError);

      // 6. Automated monthly rent billing run fails closed at billing engine level
      assert.throws(() => {
        generateMonthlyRentCharges('2026-10');
      }, LicenseLimitError);
    });
  });
});

describe('Cryptographic Revocation List (CRL) & Heartbeat Distribution', () => {
  let db: DatabaseSync;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    ensureSystemSettingsTable(db);
  });

  afterEach(() => {
    db.close();
  });

  it('generates, cryptographically signs, and applies a CRL token', () => {
    const revokedKeyToken = 'sample_revoked_license_token_123';
    const tokenHash = crypto.createHash('sha256').update(revokedKeyToken).digest('hex');

    const crl: LicenseCrl = {
      version: 1,
      issuedAt: Date.now(),
      revokedKeyHashes: [tokenHash],
      revokedInstanceIds: ['inst_compromised_box']
    };

    const signedCrl = generateSignedCrl(crl, privateKey);
    const applyResult = verifyAndApplyCrl(db, signedCrl, publicKey);

    assert.strictEqual(applyResult.success, true);
    assert.strictEqual(applyResult.crl?.version, 1);

    const stored = getStoredCrl(db);
    assert.ok(stored);
    assert.strictEqual(stored.version, 1);
    assert.ok(stored.revokedKeyHashes.includes(tokenHash));
  });

  it('strictly rejects revoked license keys against the applied CRL', () => {
    const payload: LicensePayload = {
      licensee: 'Revoked Customer Corp',
      maxUnits: 500,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 10000000,
      instanceId: 'inst_node_1'
    };

    const token = generateLicenseToken(payload, privateKey);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Key is initially valid
    const preCheck = verifyLicenseKey(token, publicKey, 'inst_node_1');
    assert.strictEqual(preCheck.valid, true);

    // Apply CRL revoking this specific token hash
    const crl: LicenseCrl = {
      version: 2,
      issuedAt: Date.now(),
      revokedKeyHashes: [tokenHash]
    };
    verifyAndApplyCrl(db, generateSignedCrl(crl, privateKey), publicKey);

    // Now verification fails closed
    const postCheck = verifyLicenseKey(token, publicKey, 'inst_node_1', null, db);
    assert.strictEqual(postCheck.valid, false);
    assert.ok(postCheck.error?.includes('revoked by vendor Cryptographic Revocation List'));
  });

  it('defeats stale CRL rollback attacks (older issuedAt rejected)', () => {
    const now = Date.now();
    const crl1: LicenseCrl = { version: 1, issuedAt: now + 5000, revokedKeyHashes: ['hash_alpha'] };
    const crl2: LicenseCrl = { version: 2, issuedAt: now + 1000, revokedKeyHashes: ['hash_beta'] }; // Older timestamp

    verifyAndApplyCrl(db, generateSignedCrl(crl1, privateKey), publicKey);

    // Attacker tries to replay older crl2
    const replayResult = verifyAndApplyCrl(db, generateSignedCrl(crl2, privateKey), publicKey);
    assert.strictEqual(replayResult.success, false);
    assert.ok(replayResult.error?.includes('Stale CRL'));
  });

  it('automatically ingests CRL bundle distributed via daily heartbeat response', () => {
    const tokenToRevoke = 'heartbeat_revoked_key';
    const tokenHash = crypto.createHash('sha256').update(tokenToRevoke).digest('hex');
    const crl: LicenseCrl = {
      version: 5,
      issuedAt: Date.now(),
      revokedKeyHashes: [tokenHash]
    };
    const signedCrl = generateSignedCrl(crl, privateKey);

    const challenge = createHeartbeatChallenge(db);
    const heartbeatToken = generateHeartbeatResponseToken(
      {
        nonce: challenge.nonce,
        status: 'valid',
        timestamp: challenge.timestamp,
        crlToken: signedCrl
      },
      privateKey
    );

    const recordResult = recordVerifiedHeartbeat(db, heartbeatToken, challenge.nonce, publicKey);
    assert.strictEqual(recordResult.success, true);

    // CRL was applied automatically
    const stored = getStoredCrl(db);
    assert.ok(stored);
    assert.strictEqual(stored.version, 5);
    assert.ok(stored.revokedKeyHashes.includes(tokenHash));
  });
});

describe('Database Cryptographic Identity Anchor & Anti-Cloning Guard', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    ensureSystemSettingsTable(db);
    delete process.env.GARRISON_ALLOW_MIGRATION;
  });

  afterEach(() => {
    db.close();
    delete process.env.GARRISON_ALLOW_MIGRATION;
  });

  it('initializes and verifies database anchor on the same host instance', () => {
    const instanceA = 'inst_original_datacenter_node';
    const hwA = 'hw_chassis_alpha';

    const anchor = getOrCreateDatabaseAnchor(db, instanceA, hwA);
    assert.ok(anchor.includes(instanceA));

    const check = verifyDatabaseAnchor(db, instanceA, hwA);
    assert.strictEqual(check.valid, true);
  });

  it('detects database cloning when restored onto a foreign instance without authorization', () => {
    const instanceOriginal = 'inst_legitimate_customer';
    const instanceForeign = 'inst_rogue_cloned_box';
    const hwOriginal = 'hw_chassis_alpha';

    // Database created on instanceOriginal
    getOrCreateDatabaseAnchor(db, instanceOriginal, hwOriginal);

    // Foreign server boots with this cloned database
    const check = verifyDatabaseAnchor(db, instanceForeign, hwOriginal);
    assert.strictEqual(check.valid, false);
    assert.ok(check.error?.includes('Database identity anchor mismatch'));
  });

  it('clears database anchor mismatch when migration is authorized or re-anchored', () => {
    const instanceOriginal = 'inst_old_server';
    const instanceNew = 'inst_new_server';
    const hwNew = 'hw_new_cloud_node';

    getOrCreateDatabaseAnchor(db, instanceOriginal);

    // 1. Authorize via explicit environment variable override
    process.env.GARRISON_ALLOW_MIGRATION = '1';
    assert.strictEqual(verifyDatabaseAnchor(db, instanceNew, hwNew).valid, true);
    delete process.env.GARRISON_ALLOW_MIGRATION;

    // 2. Re-anchor database to complete migration workflow
    reanchorDatabase(db, instanceNew, hwNew);
    assert.strictEqual(verifyDatabaseAnchor(db, instanceNew, hwNew).valid, true);
  });
});

describe('Enterprise Rolling Annual Lease & 30-Day Renewal Grace', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  it('allows operations within 30-day renewal grace period when renewalGraceDays is specified', () => {
    const now = Date.now();
    const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000;

    const payload: LicensePayload = {
      licensee: 'Rolling Enterprise Client LLC',
      maxUnits: 1000,
      issuedAt: now - 365 * 24 * 60 * 60 * 1000,
      expiresAt: fiveDaysAgo, // Expired 5 days ago
      renewalGraceDays: 30,
      instanceId: 'inst_rolling_node'
    };

    const token = generateLicenseToken(payload, privateKey);
    const result = verifyLicenseKey(token, publicKey, 'inst_rolling_node');

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.isWithinRenewalGrace, true);
  });

  it('strictly locks down when the 30-day renewal grace period has expired', () => {
    const now = Date.now();
    const thirtyFiveDaysAgo = now - 35 * 24 * 60 * 60 * 1000;

    const payload: LicensePayload = {
      licensee: 'Expired Enterprise Client LLC',
      maxUnits: 1000,
      issuedAt: now - 400 * 24 * 60 * 60 * 1000,
      expiresAt: thirtyFiveDaysAgo, // Expired 35 days ago (past 30-day grace)
      renewalGraceDays: 30,
      instanceId: 'inst_expired_node'
    };

    const token = generateLicenseToken(payload, privateKey);
    const result = verifyLicenseKey(token, publicKey, 'inst_expired_node');

    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('License expired'));
  });
});

describe('Runtime Module Self-Integrity Verification', () => {
  it('accurately computes SHA-256 hash of content and files', () => {
    const hash = calculateFileSha256('GarrisonOS Core Integrity Standard', true);
    assert.strictEqual(typeof hash, 'string');
    assert.strictEqual(hash.length, 64);
  });

  it('validates authentic files against an integrity manifest and flags tampered files', () => {
    const contentA = 'export const VERSION = "0.2.0";';
    const contentB = 'export function secureOperation() { return true; }';
    const hashA = calculateFileSha256(contentA, true);
    const hashB = calculateFileSha256(contentB, true);

    const manifest: SystemIntegrityManifest = {
      version: '0.2.0',
      timestamp: Date.now(),
      hashes: {
        'package.json': calculateFileSha256(path.resolve(process.cwd(), 'package.json'), false)
      }
    };

    const cleanResult = evaluateModuleIntegrity(manifest);
    assert.strictEqual(cleanResult.valid, true);

    // Tampered manifest test
    const tamperedManifest: SystemIntegrityManifest = {
      version: '0.2.0',
      timestamp: Date.now(),
      hashes: {
        'package.json': '0000000000000000000000000000000000000000000000000000000000000000'
      }
    };
    const tamperedResult = evaluateModuleIntegrity(tamperedManifest);
    assert.strictEqual(tamperedResult.valid, false);
    assert.ok(tamperedResult.modifiedFiles && tamperedResult.modifiedFiles.length > 0);
  });
});

describe('Fiduciary Watermarking & Statutory Audit Seals', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.GARRISON_EDITION;
    delete process.env.GARRISON_LICENSE_KEY;
  });

  afterEach(() => {
    closeDatabase();
    if (originalEnv !== undefined) {
      process.env.GARRISON_EDITION = originalEnv;
    } else {
      delete process.env.GARRISON_EDITION;
    }
  });

  it('generates certified audit seal on valid licensed deployment', () => {
    process.env.GARRISON_EDITION = 'community';
    const db = createTestDb();

    runInOperatorContext('op-seal-test', () => {
      const seal = generateFiduciaryAuditSeal(db, 'Three-Way Bank Reconciliation', {
        glTrustCashCents: 100000,
        isBalanced: true
      });

      assert.strictEqual(seal.status, 'VERIFIED_AUDIT_SEAL');
      assert.strictEqual(seal.isValid, true);
      assert.strictEqual(seal.watermark, null);
      assert.ok(seal.sealToken?.startsWith('GARRISON-SEAL-'));
      assert.ok(seal.auditNotice.includes('Certified GarrisonOS Fiduciary Audit Seal'));
    });
  });

  it('generates prominent statutory warning watermark on unlicensed / over-quota deployment', () => {
    process.env.GARRISON_EDITION = 'standard';
    const db = createTestDb();

    runInOperatorContext('op-seal-test-unlicensed', () => {
      const prop = PropertiesRepository.createProperty({
        name: 'Seal Test Prop',
        property_type: 'single_family',
        address_line1: '100 Watermark Way',
        city: 'Miami',
        state: 'FL',
        postal_code: '33101'
      });

      // Insert 65 units (over quota in Standard Edition without key)
      const now = Date.now();
      for (let i = 1; i <= 65; i++) {
        db.prepare(`
          INSERT INTO units (id, operator_id, property_id, unit_number, status, market_rent_cents, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'vacant', 100000, ?, ?)
        `).run(generateUUIDv7(), 'op-seal-test-unlicensed', prop.id, `U-${i}`, now, now);
      }

      const seal = generateFiduciaryAuditSeal(db, 'IRS Form 1099-NEC Report');
      assert.strictEqual(seal.status, 'UNLICENSED_AUDIT_SEAL');
      assert.strictEqual(seal.isValid, false);
      assert.strictEqual(
        seal.watermark,
        'UNLICENSED EXECUTION — INVALID FIDUCIARY AUDIT SEAL — FOR INSPECTION ONLY'
      );
      assert.ok(seal.auditNotice.includes('WARNING: This IRS Form 1099-NEC Report was generated on an unlicensed'));

      // Check that AccountingRepository reports include fiduciary_seal
      const threeWay = AccountingRepository.getThreeWayReconciliation();
      assert.ok(threeWay.fiduciary_seal);
      assert.strictEqual(threeWay.fiduciary_seal.status, 'UNLICENSED_AUDIT_SEAL');
      assert.strictEqual(
        threeWay.fiduciary_seal.watermark,
        'UNLICENSED EXECUTION — INVALID FIDUCIARY AUDIT SEAL — FOR INSPECTION ONLY'
      );

      const vendor1099 = AccountingRepository.getVendor1099Report(2026);
      assert.ok(vendor1099.fiduciary_seal);
      assert.strictEqual(vendor1099.fiduciary_seal.status, 'UNLICENSED_AUDIT_SEAL');
    });
  });
});


