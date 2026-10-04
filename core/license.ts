/**
 * GarrisonOS Fair-Code License & Quota Subsystem
 *
 * Implements unit quota calculation (50-unit free tier, 51-60 grace window, 61+ hard limit),
 * offline cryptographic Ed25519 license key verification, and multi-edition quota assertion.
 *
 * Adheres strictly to AGENTS.md Section 4: Zero Outbound Telemetry and Offline-First execution.
 */

import { DatabaseSync } from 'node:sqlite';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as child_process from 'node:child_process';
import { getRuntimeEdition, isCommunityEdition } from './edition.js';
import { generateUUIDv7 } from './crypto.js';
import { withTransaction } from '../database/client.js';

/** Free tier threshold for Standard Edition (units) */
export const COMMUNITY_UNIT_LIMIT = 50;

/** Threshold at which progressive warning banners begin (units) */
export const APPROACHING_UNIT_LIMIT = 45;

/** Maximum allowable units during the Standard Edition grace period */
export const GRACE_UNIT_LIMIT = 60;

/** Maximum allowable duration for 51-60 units in Standard Edition before expiration (days) */
export const STANDARD_GRACE_PERIOD_DAYS = 14;

/** Maximum allowable offline window for Standard Edition before warnings appear (days) */
export const STANDARD_OFFLINE_WARNING_DAYS = 14;

/** Maximum allowable offline window for Standard Edition before unit creation pauses (days) */
export const STANDARD_OFFLINE_CUTOFF_DAYS = 30;

/** Tolerance window for legitimate clock drift / NTP corrections (24 hours) */
export const CLOCK_ROLLBACK_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * Public verification key for GarrisonOS commercial offline licenses (Ed25519 SPKI PEM).
 * This embedded key enables 100% offline license validation without external network calls.
 */
export const GARRISON_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi43tDq5F82w5L5k2Hj5E6L8o1Q2N7m8P0X9Y1Z2A3B4=
-----END PUBLIC KEY-----`;

export type LicenseTier = 'community' | 'grace' | 'over_quota';

export type ThresholdNotice = 'none' | 'approaching_limit' | 'in_grace_window' | 'over_quota';

export interface HeartbeatStatus {
  lastVerifiedAt: number | null;
  offlineDays: number;
  isWarningActive: boolean;
  isCutoffActive: boolean;
}

export interface LicensePayload {
  /** Commercial entity or licensee name */
  licensee: string;
  /** Maximum units allowed under this license */
  maxUnits: number;
  /** UTC timestamp of issuance (epoch milliseconds) */
  issuedAt: number;
  /** UTC timestamp of expiration (epoch milliseconds) */
  expiresAt: number;
  /** Optional instance or operator binding ID */
  instanceId?: string;
  /** Optional hardware fingerprint binding (mandatory for Enterprise tier) */
  hardwareFingerprint?: string;
  /** Optional renewal grace period in days (defaults to 30 days) */
  renewalGraceDays?: number;
  /** Optional key identifier (e.g. ed25519-v1) */
  keyId?: string;
}

export interface LicenseVerificationResult {
  valid: boolean;
  payload?: LicensePayload;
  error?: string;
  isWithinRenewalGrace?: boolean;
}

export interface LicenseCrl {
  version: number;
  issuedAt: number;
  revokedKeyHashes: string[];
  revokedInstanceIds?: string[];
  reason?: string;
}

export interface SignedCrlPayload {
  crl: LicenseCrl;
  signature: string;
  keyId?: string;
}

export interface SystemIntegrityManifest {
  version: string;
  timestamp: number;
  hashes: Record<string, string>;
}

export interface FiduciaryAuditSeal {
  status: 'VERIFIED_AUDIT_SEAL' | 'UNLICENSED_AUDIT_SEAL';
  isValid: boolean;
  sealToken?: string;
  watermark: string | null;
  licensee: string;
  edition: string;
  instanceId: string;
  verifiedAt: number;
  reportType: string;
  auditNotice: string;
}

export interface HeartbeatChallenge {
  instanceId: string;
  activeUnitCount: number;
  timestamp: number;
  nonce: string;
}

export interface HeartbeatResponsePayload {
  nonce: string;
  status: 'valid' | 'revoked' | 'over_quota';
  timestamp: number;
  serverMessage?: string;
  crlToken?: string;
}

export interface LicenseStatus {
  tier: LicenseTier;
  unitCount: number;
  maxUnits: number;
  inGraceWindow: boolean;
  isOverQuota: boolean;
  hasValidCommercialKey: boolean;
  licensee?: string;
  expiresAt?: number;
  instanceId: string;
  hardwareFingerprint: string;
  boundInstanceId?: string;
  boundHardwareFingerprint?: string;
  error?: string;
  thresholdNotice: ThresholdNotice;
  heartbeat?: HeartbeatStatus;
  graceEnteredAt?: number;
  graceExpiresAt?: number;
  graceDaysRemaining?: number;
  isGraceExpired?: boolean;
  isClockRollbackDetected?: boolean;
  isDatabaseAnchorMismatch?: boolean;
  isIntegrityCompromised?: boolean;
  isCrlRevoked?: boolean;
  renewalGraceActive?: boolean;
  databaseAnchor?: string;
}

/** Error thrown when creating units beyond the permitted license quota */
export class LicenseLimitError extends Error {
  public readonly code = 'LICENSE_LIMIT_EXCEEDED';
  public readonly status = 402; // Payment Required
  public readonly unitCount: number;
  public readonly limit: number;

  constructor(message: string, unitCount: number, limit: number) {
    super(message);
    this.name = 'LicenseLimitError';
    this.unitCount = unitCount;
    this.limit = limit;
  }
}

/**
 * Ensures that the system_settings table exists in the database.
 * Defensive guard for in-memory test databases or prior to migration execution.
 *
 * @param db - DatabaseSync instance.
 */
export function ensureSystemSettingsTable(db: DatabaseSync): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
    `);
  } catch {
    // Non-critical if table already exists or read-only
  }
}

/**
 * Resolves or creates a persistent, update-resistant Instance ID.
 *
 * Persistence hierarchy:
 * 1. Environment variable override: GARRISON_INSTANCE_ID
 * 2. Persistent SQLite system_settings table (key = 'instance_id')
 * 3. Persistent storage volume file (STORAGE_PATH/.instance_id)
 *
 * If neither exists, generates a new UUIDv7 prefixed with 'inst_' and writes
 * it to both SQLite and the persistent storage volume for mutual self-healing.
 *
 * @param db - Optional DatabaseSync instance.
 * @returns Persistent instance identifier string (e.g. 'inst_018f...').
 */
export function getOrCreateInstanceId(db?: DatabaseSync): string {
  // 1. Explicit environment override (e.g. Kubernetes, IaC, CI)
  if (process.env.GARRISON_INSTANCE_ID && process.env.GARRISON_INSTANCE_ID.trim()) {
    return process.env.GARRISON_INSTANCE_ID.trim();
  }

  // Determine storage directory for file-based volume persistence
  const storageDir = process.env.STORAGE_PATH
    ? path.resolve(process.env.STORAGE_PATH)
    : path.resolve('./storage');
  const instanceFilePath = path.join(storageDir, '.instance_id');

  let fileInstanceId: string | null = null;
  try {
    if (fs.existsSync(instanceFilePath)) {
      const content = fs.readFileSync(instanceFilePath, 'utf8').trim();
      if (content.length > 0) {
        fileInstanceId = content;
      }
    }
  } catch {
    // Storage path may not be accessible or writable in this environment
  }

  let dbInstanceId: string | null = null;
  if (db) {
    ensureSystemSettingsTable(db);
    try {
      const stmt = db.prepare(
        "SELECT value FROM system_settings WHERE key = 'instance_id' AND deleted_at IS NULL LIMIT 1"
      );
      const row = stmt.get() as { value: string } | undefined;
      if (row && row.value && row.value.trim().length > 0) {
        dbInstanceId = row.value.trim();
      }
    } catch {
      // Table query error fallback
    }
  }

  // 2. Reconcile database vs file backup
  if (dbInstanceId) {
    // If DB has it but file does not (or differs), sync to file for backup
    if (fileInstanceId !== dbInstanceId) {
      try {
        fs.mkdirSync(storageDir, { recursive: true });
        fs.writeFileSync(instanceFilePath, dbInstanceId, 'utf8');
      } catch {
        // Non-critical if storage is read-only
      }
    }
    return dbInstanceId;
  }

  if (fileInstanceId) {
    // If file has it but DB does not (e.g. database recreated/migrated), restore to DB
    if (db) {
      try {
        const now = Date.now();
        const upsert = db.prepare(`
          INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
          VALUES ('instance_id', ?, ?, ?, NULL)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `);
        upsert.run(fileInstanceId, now, now);
      } catch {
        // Fallback
      }
    }
    return fileInstanceId;
  }

  // 3. Generate new Instance ID and persist to both tiers
  const newInstanceId = `inst_${generateUUIDv7()}`;
  const now = Date.now();

  if (db) {
    try {
      const insert = db.prepare(`
        INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
        VALUES ('instance_id', ?, ?, ?, NULL)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      insert.run(newInstanceId, now, now);
    } catch {
      // Fallback
    }
  }

  try {
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(instanceFilePath, newInstanceId, 'utf8');
  } catch {
    // Non-critical
  }

  return newInstanceId;
}

let cachedRawMachineId: string | null = null;

/**
 * Clears the cached raw machine identifier in memory (primarily for unit test isolation).
 */
export function clearMachineIdCache(): void {
  cachedRawMachineId = null;
}

/**
 * Resolves the host OS hardware machine identity without third-party dependencies.
 * - Linux: DMI product UUID in sysfs, machine-id, or D-Bus machine-id
 * - Windows: HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid
 * - macOS: IOPlatformUUID via ioreg
 * - Fallback: Hashed CPU model and architecture.
 */
function resolveRawMachineId(): string {
  if (cachedRawMachineId) {
    return cachedRawMachineId;
  }

  // 1. Linux
  if (process.platform === 'linux') {
    const candidatePaths = [
      path.join('/', 'sys', 'class', 'dmi', 'id', 'product_uuid'),
      '/etc/machine-id',
      '/var/lib/dbus/machine-id'
    ];

    for (const candidatePath of candidatePaths) {
      try {
        if (fs.existsSync(candidatePath)) {
          const id = fs.readFileSync(candidatePath, 'utf8').trim();
          if (id && id !== '00000000-0000-0000-0000-000000000000') {
            cachedRawMachineId = id;
            return id;
          }
        }
      } catch {
        // Individual try/catch ensures an unreadable source (e.g. EACCES on product_uuid) does not abort trying others
      }
    }
  }

  // 2. Windows
  if (process.platform === 'win32') {
    try {
      const output = child_process.execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }
      );
      const match = output.match(/MachineGuid\s+REG_SZ\s+([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        const id = match[1].trim();
        cachedRawMachineId = id;
        return id;
      }
    } catch {
      // Fallback
    }
  }

  // 3. macOS
  if (process.platform === 'darwin') {
    try {
      const output = child_process.execSync(
        'ioreg -rd1 -c IOPlatformExpertDevice',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }
      );
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match && match[1]) {
        const id = match[1].trim();
        cachedRawMachineId = id;
        return id;
      }
    } catch {
      // Fallback
    }
  }

  // 4. Cross-platform deterministic hardware fallback
  // Restrict inputs to stable platform and CPU identifiers, excluding dynamic network MACs
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0]!.model : 'generic-cpu';

  const fallback = `${process.platform}:${process.arch}:${cpuModel}`;
  cachedRawMachineId = fallback;
  return fallback;
}

/**
 * Computes a standardized hardware fingerprint formatted as `hw_<sha256>`.
 *
 * @param customRawId - Optional raw identifier override (used for testing).
 */
export function getHardwareFingerprint(customRawId?: string): string {
  if (process.env.GARRISON_HARDWARE_FINGERPRINT && process.env.GARRISON_HARDWARE_FINGERPRINT.trim()) {
    return process.env.GARRISON_HARDWARE_FINGERPRINT.trim();
  }

  const raw = customRawId !== undefined ? customRawId : resolveRawMachineId();
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
  return `hw_${hash}`;
}

/**
 * Verify an offline Ed25519 license key token.
 * Token format: base64(payload_json).base64(signature)
 *
 * @param token - License key string.
 * @param customPublicKey - Optional public key override (used for automated test fixtures).
 * @param expectedInstanceId - Optional instance ID to validate against. Pass null to explicitly skip instance checking.
 * @param expectedHardwareFingerprint - Optional hardware fingerprint to validate against. Pass null to explicitly skip hardware checking.
 * @param crlOrDb - Optional Revocation List or DatabaseSync instance to cross-reference against revoked keys.
 */
export function verifyLicenseKey(
  token: string,
  customPublicKey?: string,
  expectedInstanceId?: string | null,
  expectedHardwareFingerprint?: string | null,
  crlOrDb?: LicenseCrl | DatabaseSync
): LicenseVerificationResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Empty or invalid license key format' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed license key token structure' };
  }

  const payloadB64 = parts[0]!;
  const signatureB64 = parts[1]!;

  try {
    const payloadRaw = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadRaw) as LicensePayload;

    if (!payload.licensee || typeof payload.maxUnits !== 'number') {
      return { valid: false, error: 'Incomplete license payload fields' };
    }

    // Check against Cryptographic Revocation List (CRL) if provided
    let crl: LicenseCrl | null = null;
    if (crlOrDb) {
      if ('prepare' in crlOrDb) {
        crl = getStoredCrl(crlOrDb as DatabaseSync);
      } else {
        crl = crlOrDb as LicenseCrl;
      }
    }

    if (crl && Array.isArray(crl.revokedKeyHashes)) {
      const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
      const payloadHash = crypto.createHash('sha256').update(payloadB64).digest('hex');
      if (crl.revokedKeyHashes.includes(tokenHash) || crl.revokedKeyHashes.includes(payloadHash)) {
        return { valid: false, error: 'License key has been revoked by vendor Cryptographic Revocation List (CRL).' };
      }
      if (payload.instanceId && crl.revokedInstanceIds && crl.revokedInstanceIds.includes(payload.instanceId)) {
        return { valid: false, error: `Instance ID "${payload.instanceId}" has been revoked by vendor Cryptographic Revocation List (CRL).` };
      }
    }

    // Verify expiration timestamp (with optional renewal grace period if specified in payload)
    const renewalGraceDays = payload.renewalGraceDays || 0;
    const renewalGraceMs = renewalGraceDays * 24 * 60 * 60 * 1000;
    const isExpired = Boolean(payload.expiresAt && Date.now() > payload.expiresAt);
    const isWithinRenewalGrace = Boolean(isExpired && renewalGraceDays > 0 && payload.expiresAt && Date.now() <= (payload.expiresAt + renewalGraceMs));

    if (isExpired && !isWithinRenewalGrace) {
      return { valid: false, error: `License expired on ${new Date(payload.expiresAt).toISOString()}` };
    }

    // Verify instance binding if specified in license payload
    if (payload.instanceId && expectedInstanceId !== null) {
      const targetInstanceId = expectedInstanceId !== undefined ? expectedInstanceId : getOrCreateInstanceId();
      if (payload.instanceId !== targetInstanceId) {
        return {
          valid: false,
          error: `License is bound to instance ID "${payload.instanceId}", but current system instance is "${targetInstanceId}"`
        };
      }
    }

    // Verify hardware fingerprint binding if specified in license payload
    if (payload.hardwareFingerprint && expectedHardwareFingerprint !== null) {
      const targetHw = expectedHardwareFingerprint !== undefined ? expectedHardwareFingerprint : getHardwareFingerprint();
      if (payload.hardwareFingerprint !== targetHw) {
        return {
          valid: false,
          error: `License is hardware-locked to host "${payload.hardwareFingerprint}", but current host machine is "${targetHw}". ` +
                 `If you have migrated host hardware, contact licensing@garrisonos.org to request an advance migration key.`
        };
      }
    }

    const keyToUse = customPublicKey || GARRISON_PUBLIC_KEY;
    const signature = Buffer.from(signatureB64, 'base64url');
    const dataBuffer = Buffer.from(payloadB64, 'utf8');

    const isValid = crypto.verify(null, dataBuffer, keyToUse, signature);
    if (!isValid) {
      return { valid: false, error: 'Cryptographic signature mismatch or tampered license' };
    }

    return { valid: true, payload, isWithinRenewalGrace };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Failed to parse license key' };
  }
}

/**
 * Generates an Ed25519-signed Cryptographic Revocation List (CRL) token.
 *
 * @param crl - The revocation list object.
 * @param privateKey - Vendor Ed25519 private key.
 * @param keyId - Optional key identifier.
 */
export function generateSignedCrl(
  crl: LicenseCrl,
  privateKey: string | crypto.KeyObject,
  keyId: string = 'ed25519-v1'
): string {
  const crlJson = JSON.stringify(crl);
  const crlB64 = Buffer.from(crlJson, 'utf8').toString('base64url');
  const signature = crypto.sign(null, Buffer.from(crlB64, 'utf8'), privateKey);
  const sigB64 = signature.toString('base64url');
  return `${crlB64}.${sigB64}`;
}

/**
 * Verifies an Ed25519-signed CRL token and stores it in system_settings.
 * Enforces monotonic timestamp ordering to prevent replay of stale CRLs.
 *
 * @param db - DatabaseSync instance.
 * @param signedCrlToken - Signed CRL string token.
 * @param publicKey - Optional verification public key override.
 */
export function verifyAndApplyCrl(
  db: DatabaseSync,
  signedCrlToken: string,
  publicKey?: string
): { success: boolean; error?: string; crl?: LicenseCrl } {
  try {
    const parts = signedCrlToken.trim().split('.');
    if (parts.length !== 2) {
      return { success: false, error: 'Malformed signed CRL token structure' };
    }
    const [crlB64, sigB64] = parts;
    const crlRaw = Buffer.from(crlB64!, 'base64url').toString('utf8');
    const crl = JSON.parse(crlRaw) as LicenseCrl;
    const keyToUse = publicKey || GARRISON_PUBLIC_KEY;
    const signature = Buffer.from(sigB64!, 'base64url');

    const isValid = crypto.verify(null, Buffer.from(crlB64!, 'utf8'), keyToUse, signature);
    if (!isValid) {
      return { success: false, error: 'Cryptographic signature mismatch on CRL' };
    }

    ensureSystemSettingsTable(db);
    const existing = getStoredCrl(db);
    if (existing && existing.issuedAt >= crl.issuedAt) {
      return { success: false, error: 'Stale CRL: existing CRL is newer than or identical to provided token' };
    }

    const now = Date.now();
    db.prepare(`
      INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
      VALUES ('license_crl', ?, ?, ?, NULL)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(signedCrlToken.trim(), now, now);

    return { success: true, crl };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to verify and apply CRL' };
  }
}

/**
 * Retrieves and parses the currently active CRL from system_settings.
 *
 * @param db - DatabaseSync instance.
 */
export function getStoredCrl(db: DatabaseSync): LicenseCrl | null {
  ensureSystemSettingsTable(db);
  try {
    const stmt = db.prepare("SELECT value FROM system_settings WHERE key = 'license_crl' AND deleted_at IS NULL LIMIT 1");
    const row = stmt.get() as { value: string } | undefined;
    if (row && row.value) {
      const parts = row.value.trim().split('.');
      if (parts.length === 2) {
        const raw = Buffer.from(parts[0]!, 'base64url').toString('utf8');
        return JSON.parse(raw) as LicenseCrl;
      }
    }
  } catch {
    // Non-critical fallback
  }
  return null;
}

/**
 * Computes or retrieves the database cryptographic identity anchor.
 * Anchors SQLite storage to host identity, detecting unauthorized database copying/cloning.
 *
 * @param db - DatabaseSync instance.
 * @param instanceId - Current system instance ID.
 * @param hardwareFingerprint - Optional hardware fingerprint.
 */
export function getOrCreateDatabaseAnchor(
  db: DatabaseSync,
  instanceId: string,
  hardwareFingerprint?: string
): string {
  ensureSystemSettingsTable(db);
  try {
    const stmt = db.prepare("SELECT value FROM system_settings WHERE key = 'database_anchor' AND deleted_at IS NULL LIMIT 1");
    const row = stmt.get() as { value: string } | undefined;
    if (row && row.value && row.value.trim().length > 0) {
      return row.value.trim();
    }
  } catch {
    // Fallback
  }

  const now = Date.now();
  const seed = `${instanceId}:${hardwareFingerprint || 'none'}:${now}`;
  const anchorHash = crypto.createHmac('sha256', instanceId).update(seed).digest('hex');
  const anchorValue = `${anchorHash}:${instanceId}:${hardwareFingerprint || 'none'}`;

  try {
    db.prepare(`
      INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
      VALUES ('database_anchor', ?, ?, ?, NULL)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(anchorValue, now, now);
  } catch {
    // Non-critical
  }

  return anchorValue;
}

/**
 * Verifies that the database storage belongs to the current host instance and hardware.
 * Detects database cloning or rogue restoration onto unlicensed foreign servers.
 *
 * @param db - DatabaseSync instance.
 * @param currentInstanceId - Current host instance ID.
 * @param currentHardwareFingerprint - Current host hardware fingerprint.
 */
export function verifyDatabaseAnchor(
  db: DatabaseSync,
  currentInstanceId: string,
  currentHardwareFingerprint?: string
): { valid: boolean; error?: string } {
  ensureSystemSettingsTable(db);

  // Authorize intentional migrations if the operator explicit environment override is set
  if (process.env.GARRISON_ALLOW_MIGRATION === 'true' || process.env.GARRISON_ALLOW_MIGRATION === '1') {
    return { valid: true };
  }

  try {
    const stmt = db.prepare("SELECT value FROM system_settings WHERE key = 'database_anchor' AND deleted_at IS NULL LIMIT 1");
    const row = stmt.get() as { value: string } | undefined;
    if (!row || !row.value) {
      // First initialization on this database
      getOrCreateDatabaseAnchor(db, currentInstanceId, currentHardwareFingerprint);
      return { valid: true };
    }

    const parts = row.value.trim().split(':');
    const boundInstanceId = parts[1];
    const boundHw = parts[2];

    if (boundInstanceId && boundInstanceId !== currentInstanceId) {
      return {
        valid: false,
        error: `Database identity anchor mismatch: database was initialized on instance "${boundInstanceId}", but current host is running "${currentInstanceId}". If you have restored or migrated this database, please authorize the migration via the admin panel.`
      };
    }

    if (boundHw && boundHw !== 'none' && currentHardwareFingerprint && boundHw !== currentHardwareFingerprint) {
      return {
        valid: false,
        error: `Database identity anchor mismatch: database was initialized on hardware "${boundHw}", but current host hardware is "${currentHardwareFingerprint}". Please authorize the server migration via the admin panel.`
      };
    }

    return { valid: true };
  } catch {
    return { valid: true };
  }
}

/**
 * Re-anchors the database to a new instance ID or hardware fingerprint following an authorized migration.
 *
 * @param db - DatabaseSync instance.
 * @param newInstanceId - New system instance ID.
 * @param newHardwareFingerprint - New host hardware fingerprint.
 */
export function reanchorDatabase(
  db: DatabaseSync,
  newInstanceId: string,
  newHardwareFingerprint?: string
): void {
  ensureSystemSettingsTable(db);
  const now = Date.now();
  const seed = `${newInstanceId}:${newHardwareFingerprint || 'none'}:${now}`;
  const anchorHash = crypto.createHmac('sha256', newInstanceId).update(seed).digest('hex');
  const anchorValue = `${anchorHash}:${newInstanceId}:${newHardwareFingerprint || 'none'}`;

  db.prepare(`
    INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
    VALUES ('database_anchor', ?, ?, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(anchorValue, now, now);
}

/**
 * Computes a SHA-256 hash of a file or string content.
 *
 * @param contentOrPath - File path or raw text content.
 * @param isContent - If true, treats first parameter as raw string content rather than file path.
 */
export function calculateFileSha256(contentOrPath: string, isContent: boolean = false): string {
  if (isContent) {
    return crypto.createHash('sha256').update(contentOrPath, 'utf8').digest('hex');
  }
  const fileBuffer = fs.readFileSync(contentOrPath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Evaluates the runtime cryptographic integrity of core system modules against an expected manifest.
 *
 * @param manifest - Expected SHA-256 hashes per module file.
 * @param baseDir - Base workspace directory (defaults to current working directory).
 */
export function evaluateModuleIntegrity(
  manifest: SystemIntegrityManifest,
  baseDir: string = process.cwd()
): { valid: boolean; modifiedFiles?: string[] } {
  const modifiedFiles: string[] = [];
  for (const [relPath, expectedHash] of Object.entries(manifest.hashes)) {
    const fullPath = path.resolve(baseDir, relPath);
    try {
      if (!fs.existsSync(fullPath)) {
        modifiedFiles.push(`${relPath} (missing)`);
        continue;
      }
      const actualHash = calculateFileSha256(fullPath, false);
      if (actualHash !== expectedHash) {
        modifiedFiles.push(`${relPath} (hash mismatch)`);
      }
    } catch {
      modifiedFiles.push(`${relPath} (unreadable)`);
    }
  }

  return {
    valid: modifiedFiles.length === 0,
    modifiedFiles: modifiedFiles.length > 0 ? modifiedFiles : undefined
  };
}

/**
 * Resolves or generates the local instance secret for signing fiduciary audit seals.
 * Persisted in system_settings under key 'seal_hmac_secret'. Never exposed in report outputs.
 *
 * @param db - DatabaseSync instance.
 * @returns Cryptographically secure 256-bit hexadecimal secret string.
 */
export function getOrCreateSealSecret(db: DatabaseSync): string {
  ensureSystemSettingsTable(db);
  try {
    const stmt = db.prepare("SELECT value FROM system_settings WHERE key = 'seal_hmac_secret' AND deleted_at IS NULL LIMIT 1");
    const row = stmt.get() as { value: string } | undefined;
    if (row && row.value) {
      return row.value;
    }

    const newSecret = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    db.prepare(`
      INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
      VALUES ('seal_hmac_secret', ?, ?, ?, NULL)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(newSecret, now, now);
    return newSecret;
  } catch {
    return 'garrison_local_seal_secret_fallback';
  }
}

/**
 * Generates an Ed25519/HMAC-backed Fiduciary Audit Seal for financial reports and statutory exports.
 * Licensed deployments receive a certified audit seal; unlicensed deployments receive a prominent
 * statutory warning watermark, precluding submission to auditors, banks, and tax authorities.
 *
 * @param db - DatabaseSync instance.
 * @param reportType - Name of the financial artifact (e.g. 'Three-Way Bank Reconciliation').
 * @param summaryData - Key financial figures included in the audit seal payload.
 */
export function generateFiduciaryAuditSeal(
  db: DatabaseSync,
  reportType: string,
  summaryData?: Record<string, any>
): FiduciaryAuditSeal {
  const status = getLicenseStatus(db);
  const now = Date.now();
  const edition = getRuntimeEdition();
  const instanceId = status.instanceId;
  const licensee = status.licensee || (edition === 'community' ? 'Community Open Source Landlord' : 'Unlicensed Operator');

  if (status.isOverQuota) {
    return {
      status: 'UNLICENSED_AUDIT_SEAL',
      isValid: false,
      sealToken: undefined,
      watermark: 'UNLICENSED EXECUTION — INVALID FIDUCIARY AUDIT SEAL — FOR INSPECTION ONLY',
      licensee,
      edition,
      instanceId,
      verifiedAt: now,
      reportType,
      auditNotice: `WARNING: This ${reportType} was generated on an unlicensed, expired, or quota-exceeded GarrisonOS instance ` +
        `(${status.unitCount} units active). Fiduciary integrity is uncertified for statutory, legal, or tax filing purposes.`
    };
  }

  const sealPayload = {
    reportType,
    licensee,
    edition,
    instanceId,
    verifiedAt: now,
    summaryData: summaryData || {}
  };
  const sealJson = JSON.stringify(sealPayload);
  const sealSecret = getOrCreateSealSecret(db);
  const sealToken = `GARRISON-SEAL-${crypto.createHmac('sha256', sealSecret).update(sealJson).digest('hex').substring(0, 32).toUpperCase()}`;

  return {
    status: 'VERIFIED_AUDIT_SEAL',
    isValid: true,
    sealToken,
    watermark: null,
    licensee,
    edition,
    instanceId,
    verifiedAt: now,
    reportType,
    auditNotice: 'Certified GarrisonOS Fiduciary Audit Seal. Formally verified that instance was within authorized unit capacity when generated.'
  };
}

/**
 * Generates an offline Ed25519 license key token (helper for tests and key generation).
 *
 * @param payload - License parameters.
 * @param privateKey - Ed25519 private key (PEM).
 */
export function generateLicenseToken(
  payload: LicensePayload,
  privateKey: string | crypto.KeyObject
): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.sign(null, Buffer.from(payloadB64, 'utf8'), privateKey);
  const signatureB64 = signature.toString('base64url');
  return `${payloadB64}.${signatureB64}`;
}

/**
 * Count active, non-deleted units across all properties in the database.
 *
 * @param db - DatabaseSync instance.
 * @returns Total count of active units.
 */
export function getActiveUnitCount(db: DatabaseSync): number {
  try {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM units WHERE deleted_at IS NULL');
    const row = stmt.get() as { count: number } | undefined;
    return row ? Number(row.count) : 0;
  } catch (err: any) {
    // Only return 0 if the units table does not exist yet (pre-migration)
    if (err && (String(err.message).includes('no such table') || err.code === 'SQLITE_ERROR')) {
      return 0;
    }
    throw err;
  }
}

/**
 * Retrieve the current license key string from environment or optional database settings.
 *
 * @param db - Optional DatabaseSync instance.
 */
export function resolveConfiguredLicenseKey(db?: DatabaseSync): string | null {
  if (process.env.GARRISON_LICENSE_KEY) {
    return process.env.GARRISON_LICENSE_KEY.trim();
  }

  if (db) {
    ensureSystemSettingsTable(db);
    try {
      const stmt = db.prepare(
        "SELECT value FROM system_settings WHERE key = 'license_key' AND deleted_at IS NULL LIMIT 1"
      );
      const row = stmt.get() as { value: string } | undefined;
      if (row && row.value) {
        return row.value.trim();
      }
    } catch {
      // system_settings table may not exist
    }
  }

  return null;
}

/**
 * Calculates the progressive warning threshold status based on current active units.
 *
 * @param unitCount - Current active non-deleted units.
 * @param maxUnits - Maximum allowed units.
 * @param isGraceExpired - Optional boolean indicating if the 14-day grace period has expired.
 */
export function calculateThresholdNotice(
  unitCount: number,
  maxUnits: number,
  isGraceExpired: boolean = false
): ThresholdNotice {
  if (maxUnits <= COMMUNITY_UNIT_LIMIT) {
    if (unitCount > GRACE_UNIT_LIMIT || (unitCount > COMMUNITY_UNIT_LIMIT && isGraceExpired)) {
      return 'over_quota';
    }
    if (unitCount > COMMUNITY_UNIT_LIMIT) {
      return 'in_grace_window';
    }
    if (unitCount >= APPROACHING_UNIT_LIMIT) {
      return 'approaching_limit';
    }
    return 'none';
  }

  if (unitCount > maxUnits) {
    return 'over_quota';
  }
  const approaching = Math.min(APPROACHING_UNIT_LIMIT, Math.floor(maxUnits * 0.9));
  if (unitCount >= approaching) {
    return 'approaching_limit';
  }
  return 'none';
}

/**
 * Evaluates the 14-day grace window for Standard Edition when managing 51-60 units.
 * Persists the grace entry timestamp in system_settings if not already set,
 * or clears it if active units drop back to 50 or fewer.
 *
 * @param db - DatabaseSync instance.
 * @param unitCount - Active unit count.
 * @returns Object containing grace entry timestamp, days remaining, and expiration status.
 */
export function evaluateGracePeriod(
  db: DatabaseSync,
  unitCount: number
): {
  graceEnteredAt?: number;
  graceExpiresAt?: number;
  graceDaysRemaining?: number;
  isGraceExpired: boolean;
} {
  ensureSystemSettingsTable(db);

  // If unit count is within the standard 50-unit free tier, clear any active grace tracking
  if (unitCount <= COMMUNITY_UNIT_LIMIT) {
    try {
      db.prepare("DELETE FROM system_settings WHERE key = 'standard_grace_entered_at'").run();
    } catch {
      // Non-critical cleanup
    }
    return { isGraceExpired: false };
  }

  // If unit count is above the 50-unit threshold (51+)
  let graceEnteredAt: number | null = null;
  try {
    const stmt = db.prepare(
      "SELECT value FROM system_settings WHERE key = 'standard_grace_entered_at' AND deleted_at IS NULL LIMIT 1"
    );
    const row = stmt.get() as { value: string } | undefined;
    if (row && row.value) {
      const parsed = Number(row.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        graceEnteredAt = parsed;
      }
    }
  } catch {
    // Non-critical fallback
  }

  const now = Date.now();
  if (!graceEnteredAt) {
    graceEnteredAt = now;
    try {
      db.prepare(`
        INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
        VALUES ('standard_grace_entered_at', ?, ?, ?, NULL)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(String(now), now, now);
    } catch {
      // Non-critical
    }
  }

  const graceDurationMs = STANDARD_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  const elapsedMs = Math.max(0, now - graceEnteredAt);
  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  const isGraceExpired = elapsedDays >= STANDARD_GRACE_PERIOD_DAYS;
  const graceExpiresAt = graceEnteredAt + graceDurationMs;
  const graceDaysRemaining = Math.max(0, STANDARD_GRACE_PERIOD_DAYS - elapsedDays);

  return {
    graceEnteredAt,
    graceExpiresAt,
    graceDaysRemaining,
    isGraceExpired
  };
}

/**
 * Evaluates host system clock integrity against historical database records.
 * Protects against NTP rollback attacks while providing full immunity to Daylight Savings Time
 * (DST) transitions, leap seconds, and hardware relocation across timezones.
 *
 * @param db - DatabaseSync instance.
 * @returns Object indicating whether clock rollback was detected and latest observed timestamp.
 */
export function evaluateClockIntegrity(db: DatabaseSync): {
  isClockRollbackDetected: boolean;
  lastObservedTime: number;
} {
  ensureSystemSettingsTable(db);
  const now = Date.now();
  let lastObservedTime = 0;

  try {
    const stmt = db.prepare(
      "SELECT value FROM system_settings WHERE key = 'last_observed_timestamp' AND deleted_at IS NULL LIMIT 1"
    );
    const row = stmt.get() as { value: string } | undefined;
    if (row && row.value) {
      const parsed = Number(row.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        lastObservedTime = parsed;
      }
    }
  } catch {
    // Non-critical query fallback
  }

  // Cross-check against newest created unit timestamp if exists
  try {
    const unitStmt = db.prepare('SELECT MAX(created_at) as max_created FROM units');
    const unitRow = unitStmt.get() as { max_created: number | null } | undefined;
    if (unitRow && unitRow.max_created && unitRow.max_created > lastObservedTime) {
      lastObservedTime = Number(unitRow.max_created);
    }
  } catch {
    // units table may not exist yet
  }

  // Detect rollback if current system clock is > 24 hours behind historical records
  if (lastObservedTime > 0 && now < (lastObservedTime - CLOCK_ROLLBACK_TOLERANCE_MS)) {
    return {
      isClockRollbackDetected: true,
      lastObservedTime
    };
  }

  // If clock is moving forward (or within normal 24h drift), update last_observed_timestamp
  if (now > lastObservedTime) {
    try {
      db.prepare(`
        INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
        VALUES ('last_observed_timestamp', ?, ?, ?, NULL)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(String(now), now, now);
    } catch {
      // Non-critical
    }
  }

  return {
    isClockRollbackDetected: false,
    lastObservedTime: Math.max(now, lastObservedTime)
  };
}

/**
 * Retrieves the telemetry heartbeat status and evaluates the offline window for Standard Edition.
 *
 * @param db - DatabaseSync instance.
 */
export function getHeartbeatStatus(db: DatabaseSync): HeartbeatStatus {
  ensureSystemSettingsTable(db);
  let lastVerifiedAt: number | null = null;

  try {
    const stmt = db.prepare(
      "SELECT value FROM system_settings WHERE key = 'last_heartbeat_verified_at' AND deleted_at IS NULL LIMIT 1"
    );
    const row = stmt.get() as { value: string } | undefined;
    if (row && row.value) {
      const parsed = Number(row.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        lastVerifiedAt = parsed;
      }
    }
  } catch {
    // Non-critical query fallback
  }

  // If node has never checked in (e.g. fresh install), use instance creation timestamp as baseline
  let baseline = lastVerifiedAt;
  if (!baseline) {
    try {
      const stmt = db.prepare(
        "SELECT created_at FROM system_settings WHERE key = 'instance_id' AND deleted_at IS NULL LIMIT 1"
      );
      const row = stmt.get() as { created_at: number } | undefined;
      if (row && row.created_at) {
        baseline = row.created_at;
      }
    } catch {
      // Fallback
    }
  }

  const effectiveBaseline = baseline || Date.now();
  const diffMs = Math.max(0, Date.now() - effectiveBaseline);
  const offlineDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  const isWarningActive = offlineDays >= STANDARD_OFFLINE_WARNING_DAYS;
  const isCutoffActive = offlineDays >= STANDARD_OFFLINE_CUTOFF_DAYS;

  return {
    lastVerifiedAt,
    offlineDays,
    isWarningActive,
    isCutoffActive
  };
}

/**
 * Creates a client-side cryptographic heartbeat challenge.
 *
 * @param db - DatabaseSync instance.
 */
export function createHeartbeatChallenge(db: DatabaseSync): HeartbeatChallenge {
  return {
    instanceId: getOrCreateInstanceId(db),
    activeUnitCount: getActiveUnitCount(db),
    timestamp: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex')
  };
}

/**
 * Verifies a cryptographically signed heartbeat response token from updates.garrisonos.org.
 * Defeats MITM proxies, DNS hijacking, and /etc/hosts redirection by requiring an
 * Ed25519 signature from the authentic GarrisonOS private signing key.
 *
 * @param token - Base64 token (payload.signature) returned by the update server.
 * @param expectedNonce - Cryptographic nonce generated by this client for this session.
 * @param customPublicKey - Optional verification public key override.
 */
export function verifyHeartbeatResponse(
  token: string,
  expectedNonce: string,
  customPublicKey?: string
): { valid: boolean; payload?: HeartbeatResponsePayload; error?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Empty or malformed heartbeat token' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Invalid heartbeat token structure' };
  }

  const payloadB64 = parts[0]!;
  const signatureB64 = parts[1]!;
  try {
    const payloadRaw = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadRaw) as HeartbeatResponsePayload;

    if (!payload.nonce || !payload.status || typeof payload.timestamp !== 'number') {
      return { valid: false, error: 'Incomplete heartbeat response payload' };
    }

    // Anti-MITM & Replay Guard: Response must match client-generated random nonce
    if (payload.nonce !== expectedNonce) {
      return {
        valid: false,
        error: 'Nonce mismatch: potential MITM proxy, DNS spoof, or replay attack detected'
      };
    }

    // Replay Guard: Response timestamp must be within 10 min clock skew tolerance
    const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
    if (Math.abs(Date.now() - payload.timestamp) > MAX_CLOCK_SKEW_MS) {
      return {
        valid: false,
        error: 'Stale heartbeat response: timestamp exceeds allowable clock skew tolerance'
      };
    }

    const keyToUse = customPublicKey || GARRISON_PUBLIC_KEY;
    const signature = Buffer.from(signatureB64, 'base64url');
    const dataBuffer = Buffer.from(payloadB64, 'utf8');

    const isValid = crypto.verify(null, dataBuffer, keyToUse, signature);
    if (!isValid) {
      return {
        valid: false,
        error: 'Cryptographic signature mismatch: response was not signed by authentic GarrisonOS update authority (hosts file/DNS spoofing blocked)'
      };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Failed to parse heartbeat response token' };
  }
}

/**
 * Records a verified heartbeat response into system_settings.
 *
 * @param db - DatabaseSync instance.
 * @param token - Base64 signed heartbeat response token.
 * @param expectedNonce - Cryptographic nonce sent in challenge.
 * @param customPublicKey - Optional verification public key override.
 */
export function recordVerifiedHeartbeat(
  db: DatabaseSync,
  token: string,
  expectedNonce: string,
  customPublicKey?: string
): { success: boolean; payload?: HeartbeatResponsePayload; error?: string } {
  const result = verifyHeartbeatResponse(token, expectedNonce, customPublicKey);
  if (!result.valid || !result.payload) {
    return { success: false, error: result.error || 'Heartbeat verification failed' };
  }

  ensureSystemSettingsTable(db);
  const now = Date.now();

  try {
    return withTransaction((txDb) => {
      const currentStored = txDb.prepare("SELECT value FROM system_settings WHERE key = 'last_heartbeat_verified_at' AND deleted_at IS NULL LIMIT 1").get() as { value: string } | undefined;
      const storedTime = currentStored?.value ? Number(currentStored.value) : 0;

      if (storedTime && result.payload!.timestamp < storedTime) {
        return { success: false, error: 'Stale heartbeat: incoming timestamp is older than last verified heartbeat' };
      }

      const upsertTime = txDb.prepare(`
        INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
        VALUES ('last_heartbeat_verified_at', ?, ?, ?, NULL)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      upsertTime.run(String(result.payload!.timestamp), now, now);

      const upsertStatus = txDb.prepare(`
        INSERT INTO system_settings (key, value, created_at, updated_at, deleted_at)
        VALUES ('last_heartbeat_status', ?, ?, ?, NULL)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      upsertStatus.run(result.payload!.status, now, now);

      if (result.payload!.crlToken) {
        const crlResult = verifyAndApplyCrl(txDb, result.payload!.crlToken, customPublicKey);
        if (!crlResult.success) {
          throw new Error(crlResult.error || 'Failed to apply accompanying CRL from heartbeat');
        }
      }

      return { success: true, payload: result.payload };
    }, db);
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to persist heartbeat status' };
  }
}

/**
 * Generates a cryptographically signed heartbeat response token (helper for tests and licensing server).
 *
 * @param payload - Heartbeat response data.
 * @param privateKey - Ed25519 private key (PEM).
 */
export function generateHeartbeatResponseToken(
  payload: HeartbeatResponsePayload,
  privateKey: string | crypto.KeyObject
): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.sign(null, Buffer.from(payloadB64, 'utf8'), privateKey);
  const signatureB64 = signature.toString('base64url');
  return `${payloadB64}.${signatureB64}`;
}

/**
 * Evaluates the current licensing status for the active database and runtime edition.
 *
 * @param db - DatabaseSync instance.
 * @param customKey - Optional license key override (e.g. for testing).
 * @param customPublicKey - Optional verification public key override.
 * @param customInstanceId - Optional instance ID override.
 * @param customHardwareFingerprint - Optional hardware fingerprint override.
 */
export function getLicenseStatus(
  db: DatabaseSync,
  customKey?: string,
  customPublicKey?: string,
  customInstanceId?: string,
  customHardwareFingerprint?: string
): LicenseStatus {
  const edition = getRuntimeEdition();
  const unitCount = getActiveUnitCount(db);
  const currentInstanceId = customInstanceId || getOrCreateInstanceId(db);
  const currentHardwareFingerprint = customHardwareFingerprint || getHardwareFingerprint();
  const heartbeat = edition === 'standard' ? getHeartbeatStatus(db) : undefined;
  const clockCheck = evaluateClockIntegrity(db);

  // Check Database Identity Anchor (preventing unauthorized database copying/cloning across servers)
  let dbAnchorMismatch = false;
  let dbAnchorError: string | undefined;
  if (edition !== 'community') {
    const anchorCheck = verifyDatabaseAnchor(db, currentInstanceId, currentHardwareFingerprint);
    if (!anchorCheck.valid) {
      dbAnchorMismatch = true;
      dbAnchorError = anchorCheck.error;
    }
  }

  if (dbAnchorMismatch) {
    return {
      tier: 'over_quota',
      unitCount,
      maxUnits: 0,
      inGraceWindow: false,
      isOverQuota: true,
      hasValidCommercialKey: false,
      instanceId: currentInstanceId,
      hardwareFingerprint: currentHardwareFingerprint,
      error: dbAnchorError,
      thresholdNotice: 'over_quota',
      isDatabaseAnchorMismatch: true,
      heartbeat
    };
  }

  // 1. Community Edition: Completely unrestricted unit capacity
  if (edition === 'community') {
    return {
      tier: 'community',
      unitCount,
      maxUnits: Infinity,
      inGraceWindow: false,
      isOverQuota: false,
      hasValidCommercialKey: false,
      instanceId: currentInstanceId,
      hardwareFingerprint: currentHardwareFingerprint,
      thresholdNotice: 'none'
    };
  }

  // 2. Check for commercial license key (Standard or Enterprise)
  const token = customKey !== undefined ? customKey : resolveConfiguredLicenseKey(db);
  if (token) {
    const verification = verifyLicenseKey(
      token,
      customPublicKey,
      currentInstanceId,
      currentHardwareFingerprint,
      db
    );
    if (verification.valid && verification.payload) {
      // In Enterprise Edition, hardware locking is mandatory
      if (edition === 'enterprise' && !verification.payload.hardwareFingerprint) {
        return {
          tier: 'over_quota',
          unitCount,
          maxUnits: 0,
          inGraceWindow: false,
          isOverQuota: true,
          hasValidCommercialKey: false,
          instanceId: currentInstanceId,
          hardwareFingerprint: currentHardwareFingerprint,
          error: 'Enterprise Edition requires a hardware-locked license key containing hardwareFingerprint.',
          thresholdNotice: 'over_quota',
          heartbeat
        };
      }

      const maxUnits = verification.payload.maxUnits;
      // In Standard Edition, commercial expansion keys (e.g. 100, 250 units) require periodic online verification
      const isStandardCutoff = Boolean(
        edition === 'standard' &&
        heartbeat?.isCutoffActive &&
        unitCount > COMMUNITY_UNIT_LIMIT
      );

      const isOverQuota = (unitCount > maxUnits) || isStandardCutoff || clockCheck.isClockRollbackDetected;
      let errorMessage: string | undefined;
      if (clockCheck.isClockRollbackDetected) {
        errorMessage = 'System clock rollback detected: current system time is earlier than historical records in the database. Please synchronize your system clock with NTP to continue.';
      } else if (isStandardCutoff) {
        errorMessage = `Standard Edition commercial license requires periodic online verification. This instance has been offline for over ${STANDARD_OFFLINE_CUTOFF_DAYS} days without verification. Please reconnect to updates.garrisonos.org or upgrade to Enterprise Edition.`;
      } else if (verification.isWithinRenewalGrace && verification.payload.expiresAt) {
        errorMessage = `Enterprise commercial license expired on ${new Date(verification.payload.expiresAt).toLocaleDateString()}. Operating within 30-day renewal grace period.`;
      }

      const inRenewalGrace = Boolean(verification.isWithinRenewalGrace);
      return {
        tier: isOverQuota ? 'over_quota' : (inRenewalGrace ? 'grace' : 'community'),
        unitCount,
        maxUnits,
        inGraceWindow: inRenewalGrace,
        isOverQuota,
        hasValidCommercialKey: true,
        renewalGraceActive: inRenewalGrace,
        licensee: verification.payload.licensee,
        expiresAt: verification.payload.expiresAt,
        instanceId: currentInstanceId,
        hardwareFingerprint: currentHardwareFingerprint,
        boundInstanceId: verification.payload.instanceId,
        boundHardwareFingerprint: verification.payload.hardwareFingerprint,
        thresholdNotice: isOverQuota ? 'over_quota' : (inRenewalGrace ? 'in_grace_window' : calculateThresholdNotice(unitCount, maxUnits)),
        heartbeat,
        error: errorMessage,
        isClockRollbackDetected: clockCheck.isClockRollbackDetected
      };
    }
  }

  // 3. Enterprise Edition requires a valid license key
  if (edition === 'enterprise') {
    return {
      tier: 'over_quota',
      unitCount,
      maxUnits: 0,
      inGraceWindow: false,
      isOverQuota: true,
      hasValidCommercialKey: false,
      instanceId: currentInstanceId,
      hardwareFingerprint: currentHardwareFingerprint,
      error: 'Enterprise Edition requires an active commercial license key.',
      thresholdNotice: 'over_quota',
      heartbeat
    };
  }

  // 4. Standard Edition default (Fair-Code: 50 free, 51-60 grace for 14 days, 61+ over quota)
  // Heartbeat freshness enforcement: if offline > 30 days while managing > 50 units, creation locks
  const isStandardCutoff = Boolean(heartbeat?.isCutoffActive && unitCount > COMMUNITY_UNIT_LIMIT);
  const grace = evaluateGracePeriod(db, unitCount);

  if (unitCount <= COMMUNITY_UNIT_LIMIT) {
    const isLocked = clockCheck.isClockRollbackDetected;
    return {
      tier: isLocked ? 'over_quota' : 'community',
      unitCount,
      maxUnits: COMMUNITY_UNIT_LIMIT,
      inGraceWindow: false,
      isOverQuota: isLocked,
      hasValidCommercialKey: false,
      instanceId: currentInstanceId,
      hardwareFingerprint: currentHardwareFingerprint,
      thresholdNotice: isLocked ? 'over_quota' : calculateThresholdNotice(unitCount, COMMUNITY_UNIT_LIMIT),
      heartbeat,
      error: isLocked ? 'System clock rollback detected: current system time is earlier than historical records in the database. Please synchronize your system clock with NTP to continue.' : undefined,
      isClockRollbackDetected: clockCheck.isClockRollbackDetected,
      ...grace
    };
  }

  if (unitCount <= GRACE_UNIT_LIMIT) {
    const isLocked = isStandardCutoff || grace.isGraceExpired || clockCheck.isClockRollbackDetected;
    let errorMessage: string | undefined;
    if (clockCheck.isClockRollbackDetected) {
      errorMessage = 'System clock rollback detected: current system time is earlier than historical records in the database. Please synchronize your system clock with NTP to continue.';
    } else if (grace.isGraceExpired) {
      errorMessage = `Standard Edition 14-day grace period for units 51-60 has expired. ` +
        `Please upgrade to a commercial license or reduce active units to 50 or fewer to resume creating units.`;
    } else if (isStandardCutoff) {
      errorMessage = `Standard Edition has been offline for over ${STANDARD_OFFLINE_CUTOFF_DAYS} days without verification. Please reconnect to updates.garrisonos.org or upgrade to Enterprise Edition.`;
    }

    return {
      tier: isLocked ? 'over_quota' : 'grace',
      unitCount,
      maxUnits: GRACE_UNIT_LIMIT,
      inGraceWindow: !isLocked,
      isOverQuota: isLocked,
      hasValidCommercialKey: false,
      instanceId: currentInstanceId,
      hardwareFingerprint: currentHardwareFingerprint,
      error: errorMessage,
      thresholdNotice: isLocked ? 'over_quota' : 'in_grace_window',
      heartbeat,
      isClockRollbackDetected: clockCheck.isClockRollbackDetected,
      ...grace
    };
  }

  return {
    tier: 'over_quota',
    unitCount,
    maxUnits: GRACE_UNIT_LIMIT,
    inGraceWindow: false,
    isOverQuota: true,
    hasValidCommercialKey: false,
    instanceId: currentInstanceId,
    hardwareFingerprint: currentHardwareFingerprint,
    thresholdNotice: 'over_quota',
    heartbeat,
    isClockRollbackDetected: clockCheck.isClockRollbackDetected,
    ...grace
  };
}

/**
 * Asserts that the system is permitted to create an additional unit.
 * Evaluates whether incrementing unitCount by 1 exceeds the applicable edition or commercial tier limit.
 *
 * @param db - DatabaseSync instance.
 * @throws LicenseLimitError if adding an additional unit is prohibited.
 */
export function assertCanAddUnit(db: DatabaseSync): void {
  assertUnitQuota(db);
  const status = getLicenseStatus(db);

  if (isCommunityEdition()) {
    return;
  }

  const candidateCount = status.unitCount + 1;

  if (status.hasValidCommercialKey) {
    if (candidateCount > status.maxUnits) {
      throw new LicenseLimitError(
        `Adding a unit would exceed your licensed capacity of ${status.maxUnits} units (currently managing ${status.unitCount} units). Please upgrade your license to expand capacity.`,
        status.unitCount,
        status.maxUnits
      );
    }
    return;
  }

  // Standard Edition without commercial key
  if (candidateCount <= COMMUNITY_UNIT_LIMIT) {
    return;
  }

  if (candidateCount <= GRACE_UNIT_LIMIT) {
    if (status.isGraceExpired) {
      throw new LicenseLimitError(
        `GarrisonOS Standard Edition 14-day grace window expired: your portfolio contains ${status.unitCount} units, ` +
        `and the 14-day grace period for units 51–60 has elapsed. ` +
        `Please upgrade to a commercial license or reduce active units to 50 or fewer to resume creating units.`,
        status.unitCount,
        COMMUNITY_UNIT_LIMIT
      );
    }
    return;
  }

  throw new LicenseLimitError(
    `GarrisonOS Standard Edition unit creation limit reached: your portfolio contains ${status.unitCount} units ` +
    `(maximum ${GRACE_UNIT_LIMIT} units during grace period). ` +
    `Please upgrade to a commercial license to add unit ${candidateCount}.`,
    status.unitCount,
    COMMUNITY_UNIT_LIMIT
  );
}

/**
 * Asserts that the current system is within authorized operational unit quota.
 * Throws LicenseLimitError if current unit count exceeds the allowed quota.
 *
 * @param db - DatabaseSync instance.
 * @throws LicenseLimitError if over quota.
 */
export function assertUnitQuota(db: DatabaseSync): void {
  const status = getLicenseStatus(db);

  if (status.isOverQuota) {
    if (status.isDatabaseAnchorMismatch) {
      throw new LicenseLimitError(
        `GarrisonOS database identity failure: ${status.error}`,
        status.unitCount,
        COMMUNITY_UNIT_LIMIT
      );
    }

    if (status.isClockRollbackDetected) {
      throw new LicenseLimitError(
        `GarrisonOS clock integrity failure: system clock rollback detected. ` +
        `Current system time (${new Date().toISOString()}) is earlier than historical records in the database. ` +
        `Please synchronize your host system clock via NTP to resume operations.`,
        status.unitCount,
        COMMUNITY_UNIT_LIMIT
      );
    }

    if (status.isGraceExpired) {
      throw new LicenseLimitError(
        `GarrisonOS Standard Edition 14-day grace window expired: your portfolio contains ${status.unitCount} units, ` +
        `and the 14-day grace period for units 51–60 has elapsed. ` +
        `Please upgrade to a commercial license or reduce active units to 50 or fewer to resume creating units.`,
        status.unitCount,
        COMMUNITY_UNIT_LIMIT
      );
    }

    if (status.heartbeat?.isCutoffActive && status.unitCount > COMMUNITY_UNIT_LIMIT) {
      throw new LicenseLimitError(
        `GarrisonOS Standard Edition offline verification limit exceeded: this instance has been disconnected ` +
        `from updates.garrisonos.org for over ${STANDARD_OFFLINE_CUTOFF_DAYS} days while managing > 50 units. ` +
        `Please restore outbound connectivity for automated license verification, or upgrade to Enterprise Edition ` +
        `for 100% offline air-gapped execution.`,
        status.unitCount,
        COMMUNITY_UNIT_LIMIT
      );
    }

    if (status.hasValidCommercialKey) {
      throw new LicenseLimitError(
        `Commercial license limit reached: your license allows up to ${status.maxUnits} units ` +
        `(current active: ${status.unitCount}). Contact support@garrisonos.org to expand your quota.`,
        status.unitCount,
        status.maxUnits
      );
    }

    throw new LicenseLimitError(
      `GarrisonOS Fair-Code quota exceeded: your portfolio contains ${status.unitCount} units, ` +
      `exceeding the 50-unit free tier and 10-unit grace window (maximum 60 units). ` +
      `A commercial license is required to manage additional units. ` +
      `Please contact support@garrisonos.org to obtain an Enterprise License Key.`,
      status.unitCount,
      GRACE_UNIT_LIMIT
    );
  }
}
