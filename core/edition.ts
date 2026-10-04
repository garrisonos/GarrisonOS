/**
 * GarrisonOS Multi-Edition Management & Extension Licensing Guards
 *
 * Implements edition resolution (community, standard, enterprise),
 * fail-closed module/plugin license enforcement across runtime targets,
 * compiled community module whitelisting, Ed25519 cryptographic
 * manifest signature verification, and unverified plugin warning policies.
 */

import fs from 'node:fs';
import path from 'node:path';
import * as crypto from 'node:crypto';

/** Supported GarrisonOS editions */
export type GarrisonEdition = 'community' | 'standard' | 'enterprise';

/**
 * Public verification key for GarrisonOS vendor cryptographic signatures (Ed25519 SPKI PEM).
 * Enables offline verification of signed module manifests and commercial packages.
 */
export const GARRISON_VENDOR_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi43tDq5F82w5L5k2Hj5E6L8o1Q2N7m8P0X9Y1Z2A3B4=
-----END PUBLIC KEY-----`;

/**
 * Authoritative compiled whitelist of approved core modules included in GarrisonOS Community Edition.
 * Any module claiming "community" edition without being in this set MUST provide a
 * valid vendor Ed25519 signature to be loaded.
 */
export const OFFICIAL_COMMUNITY_MODULES = new Set<string>([
  'properties',
  'contacts',
  'leases',
  'attachments',
  'accounting',
  'maintenance',
  'conversations',
  'backup'
]);

/** Custom error thrown when an unlicensed or cross-edition module execution is detected */
export class LicenseViolationError extends Error {
  public readonly code = 'LICENSE_VIOLATION';
  public readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = 'LicenseViolationError';
  }
}

/** Plugin manifest contract for third-party and custom extensions */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  signature?: string;
  entry?: string;
  permissions?: string[];
}

/** Result of plugin licensing and verification evaluation */
export interface PluginLicensingResult {
  allowed: boolean;
  verified: boolean;
  warning?: string;
}

/**
 * Resolves the currently active GarrisonOS runtime edition from the environment.
 * Default is 'standard' (the official Fair-Code distribution).
 *
 * @returns 'community' | 'standard' | 'enterprise'
 */
export function getRuntimeEdition(): GarrisonEdition {
  const envVal = (process.env.GARRISON_EDITION || '').trim().toLowerCase();
  if (envVal === 'community' || envVal === 'standard' || envVal === 'enterprise') {
    return envVal as GarrisonEdition;
  }
  return 'standard';
}

/**
 * Checks whether the current runtime is running in Community Edition mode.
 */
export function isCommunityEdition(): boolean {
  return getRuntimeEdition() === 'community';
}

/**
 * Checks whether the current runtime is running in Standard Edition mode.
 */
export function isStandardEdition(): boolean {
  return getRuntimeEdition() === 'standard';
}

/**
 * Checks whether the current runtime is running in Enterprise Edition mode.
 */
export function isEnterpriseEdition(): boolean {
  return getRuntimeEdition() === 'enterprise';
}

/**
 * Computes the deterministic canonical representation of a module manifest for signing and verification.
 *
 * @param manifest - Module manifest data.
 * @returns Canonical payload string.
 */
export function getCanonicalManifestPayload(manifest: {
  id: string;
  edition?: string;
  license?: string;
  version?: string;
}): string {
  const id = (manifest.id || '').trim().toLowerCase();
  const edition = (manifest.edition || 'community').trim().toLowerCase();
  const license = (manifest.license || '').trim();
  const version = (manifest.version || '0.1.0').trim();
  return `garrisonos:module:${id}:${edition}:${license}:${version}`;
}

/**
 * Generates an Ed25519 digital signature over a canonical module manifest.
 *
 * @param manifest - Module manifest data.
 * @param privateKey - Vendor Ed25519 private key (PEM or KeyObject).
 * @returns Base64URL-encoded digital signature string.
 */
export function signModuleManifest(
  manifest: {
    id: string;
    edition?: string;
    license?: string;
    version?: string;
  },
  privateKey: string | crypto.KeyObject
): string {
  const canonical = getCanonicalManifestPayload(manifest);
  const dataBuffer = Buffer.from(canonical, 'utf8');
  const signature = crypto.sign(null, dataBuffer, privateKey);
  return signature.toString('base64url');
}

/**
 * Cryptographically verifies the Ed25519 digital signature of a module manifest.
 *
 * @param manifest - Module manifest including signature.
 * @param customPublicKey - Optional public key override for testing.
 * @returns True if the signature is valid; false otherwise.
 */
export function verifyModuleManifestSignature(
  manifest: {
    id: string;
    edition?: string;
    license?: string;
    version?: string;
    signature?: string;
  },
  customPublicKey?: string
): boolean {
  if (!manifest.signature || typeof manifest.signature !== 'string') {
    return false;
  }

  try {
    const canonical = getCanonicalManifestPayload(manifest);
    const dataBuffer = Buffer.from(canonical, 'utf8');
    const signature = Buffer.from(manifest.signature.trim(), 'base64url');
    const keyToUse = customPublicKey || GARRISON_VENDOR_PUBLIC_KEY;

    return crypto.verify(null, dataBuffer, keyToUse, signature);
  } catch {
    return false;
  }
}

/**
 * Computes the deterministic canonical representation of a plugin manifest for signing and verification.
 *
 * @param plugin - Plugin manifest data.
 * @returns Canonical payload string.
 */
export function getCanonicalPluginPayload(plugin: {
  id: string;
  version?: string;
  license?: string;
}): string {
  const id = (plugin.id || '').trim().toLowerCase();
  const version = (plugin.version || '1.0.0').trim();
  const license = (plugin.license || '').trim();
  return `garrisonos:plugin:${id}:${version}:${license}`;
}

/**
 * Generates an Ed25519 digital signature over a canonical plugin manifest.
 *
 * @param plugin - Plugin manifest data.
 * @param privateKey - Vendor Ed25519 private key (PEM or KeyObject).
 * @returns Base64URL-encoded digital signature string.
 */
export function signPluginManifest(
  plugin: {
    id: string;
    version?: string;
    license?: string;
  },
  privateKey: string | crypto.KeyObject
): string {
  const canonical = getCanonicalPluginPayload(plugin);
  const dataBuffer = Buffer.from(canonical, 'utf8');
  const signature = crypto.sign(null, dataBuffer, privateKey);
  return signature.toString('base64url');
}

/**
 * Cryptographically verifies the Ed25519 digital signature of a plugin manifest.
 *
 * @param plugin - Plugin manifest including signature.
 * @param customPublicKey - Optional public key override for testing.
 * @returns True if the signature is valid; false otherwise.
 */
export function verifyPluginManifestSignature(
  plugin: {
    id: string;
    version?: string;
    license?: string;
    signature?: string;
  },
  customPublicKey?: string
): boolean {
  if (!plugin.signature || typeof plugin.signature !== 'string') {
    return false;
  }

  try {
    const canonical = getCanonicalPluginPayload(plugin);
    const dataBuffer = Buffer.from(canonical, 'utf8');
    const signature = Buffer.from(plugin.signature.trim(), 'base64url');
    const keyToUse = customPublicKey || GARRISON_VENDOR_PUBLIC_KEY;

    return crypto.verify(null, dataBuffer, keyToUse, signature);
  } catch {
    return false;
  }
}

/**
 * Asserts that a module manifest is legally permitted to execute in the current runtime edition.
 * Enforces fail-closed protection against cross-edition backporting into Community Edition,
 * verifies compiled whitelist membership, and checks Ed25519 manifest integrity.
 *
 * @param manifest - Module manifest being evaluated.
 * @param customPublicKey - Optional public key override (for testing).
 * @throws LicenseViolationError if a commercial/enterprise module is run in Community Edition,
 *         or if the manifest has been tampered with or lacks required vendor verification.
 */
export function assertModuleLicensing(
  manifest: {
    id: string;
    name: string;
    edition?: string;
    license?: string;
    version?: string;
    signature?: string;
  },
  customPublicKey?: string
): void {
  const currentEdition = getRuntimeEdition();
  const declaredEdition = (manifest.edition || 'community').toLowerCase();

  // 1. If a signature is present on the manifest, verify its cryptographic integrity unconditionally
  if (manifest.signature) {
    const isValid = verifyModuleManifestSignature(manifest, customPublicKey);
    if (!isValid) {
      throw new LicenseViolationError(
        `[GARRISONOS SECURITY] Module "${manifest.name}" (${manifest.id}) manifest signature is invalid or tampered. ` +
        `The declared edition "${manifest.edition}" or license "${manifest.license}" does not match vendor signature.`
      );
    }
  }

  // 2. Enterprise Edition: Supports custom modules aside from the core as a tailorable solution
  if (currentEdition === 'enterprise') {
    return;
  }

  // 3. Community Edition: Strict whitelist and signature verification
  if (currentEdition === 'community') {
    const isCommercial =
      declaredEdition === 'commercial' ||
      declaredEdition === 'enterprise' ||
      (manifest.license && manifest.license.includes('Fair-Code'));

    if (isCommercial) {
      throw new LicenseViolationError(
        `[GARRISONOS LICENSE VIOLATION] Module "${manifest.name}" (${manifest.id}) ` +
        `is licensed under the GarrisonOS Fair-Code License and cannot be loaded in Community Edition. ` +
        `To run this module, switch to GarrisonOS Standard or Enterprise Edition, or contact support@garrisonos.org.`
      );
    }

    // Community edition integrity check:
    // If the module claims to be "community", it MUST be in the official compiled community whitelist,
    // OR have a cryptographically valid vendor signature certifying it.
    const isWhitelisted = OFFICIAL_COMMUNITY_MODULES.has(manifest.id);
    if (!isWhitelisted) {
      const hasValidSig = verifyModuleManifestSignature(manifest, customPublicKey);
      if (!hasValidSig) {
        throw new LicenseViolationError(
          `[GARRISONOS SECURITY] Module "${manifest.name}" (${manifest.id}) is not an approved ` +
          `community module and lacks a valid vendor cryptographic signature. ` +
          `Tampered or unverified community modules cannot be loaded in Community Edition.`
        );
      }
    }
  }
}

/**
 * Asserts plugin licensing and extension integrity across editions.
 *
 * Rules:
 * - Community Edition: Allows unverified plugins WITH A BIG FAT WARNING banner.
 * - Standard Edition: Strictly requires all plugins to be cryptographically verified.
 * - Enterprise Edition: Tailorable solution supporting custom verified and unverified plugins.
 *
 * @param manifest - Plugin manifest being evaluated.
 * @param customPublicKey - Optional public key override (for testing).
 * @returns PluginLicensingResult detailing whether the plugin is allowed, verified, and any warning message.
 * @throws LicenseViolationError if an unverified plugin is run in Standard Edition.
 */
export function assertPluginLicensing(
  manifest: PluginManifest,
  customPublicKey?: string
): PluginLicensingResult {
  const currentEdition = getRuntimeEdition();
  const isVerified = verifyPluginManifestSignature(manifest, customPublicKey);

  // 1. Enterprise Edition: Tailorable solution — supports all custom plugins
  if (currentEdition === 'enterprise') {
    return {
      allowed: true,
      verified: isVerified,
      warning: isVerified ? undefined : `[Enterprise] Loaded custom in-house plugin: ${manifest.id}`
    };
  }

  // 2. Standard Edition: STRICT verification required for EVERYTHING
  if (currentEdition === 'standard') {
    if (!isVerified) {
      throw new LicenseViolationError(
        `[GARRISONOS STANDARD LICENSE ENFORCEMENT] Plugin "${manifest.name}" (${manifest.id}) ` +
        `cannot be loaded because Standard Edition requires all plugins to be cryptographically verified ` +
        `by GarrisonOS. To run unverified or community plugins, switch to GarrisonOS Community Edition. ` +
        `To deploy custom in-house enterprise plugins, upgrade to GarrisonOS Enterprise Edition.`
      );
    }
    return { allowed: true, verified: true };
  }

  // 3. Community Edition: Allows unverified plugins WITH A BIG FAT WARNING
  if (isVerified) {
    return { allowed: true, verified: true };
  }

  const bigFatWarning =
    `\n*******************************************************************************\n` +
    `⚠️  [GARRISONOS COMMUNITY WARNING: UNVERIFIED THIRD-PARTY PLUGIN DETECTED]  ⚠️\n` +
    `Plugin: "${manifest.name}" (ID: ${manifest.id}, Version: ${manifest.version || '1.0.0'})\n` +
    `Status: UNVERIFIED (Missing or invalid vendor cryptographic signature)\n\n` +
    `Running unverified plugins may compromise data integrity, introduce financial\n` +
    `calculation errors, or cause operational instability. GarrisonOS does not certify\n` +
    `the safety, security, or compliance of third-party extensions in Community Edition.\n` +
    `PROCEED WITH CAUTION.\n` +
    `*******************************************************************************\n`;

  process.stderr.write(bigFatWarning);

  return {
    allowed: true,
    verified: false,
    warning: bigFatWarning
  };
}

/**
 * Safely loads and parses the root editions.json manifest.
 *
 * @param baseDir - Root directory of the repository (defaults to process.cwd()).
 * @returns Parsed editions manifest object, or null if unreadable.
 */
export function getEditionsManifest(baseDir: string = process.cwd()): any | null {
  try {
    const manifestPath = path.resolve(baseDir, 'editions.json');
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
