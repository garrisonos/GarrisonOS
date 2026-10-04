#!/usr/bin/env node
/**
 * GarrisonOS Node & Hardware Identification Tool
 *
 * Inspects and outputs the local node's persistent Instance ID and Hardware Fingerprint.
 * Used by operators to request Enterprise Edition license keys or schedule zero-downtime
 * host hardware migrations.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function main() {
  let getOrCreateInstanceId, getHardwareFingerprint, getDatabase;
  try {
    const licenseModule = await import('../dist/core/license.js');
    const dbModule = await import('../dist/database/client.js');
    getOrCreateInstanceId = licenseModule.getOrCreateInstanceId;
    getHardwareFingerprint = licenseModule.getHardwareFingerprint;
    getDatabase = dbModule.getDatabase;
  } catch {
    console.error('Error: GarrisonOS build artifacts not found. Run `npm.cmd run build` first.');
    process.exit(1);
  }

  const db = getDatabase();
  const instanceId = getOrCreateInstanceId(db);
  const hardwareFingerprint = getHardwareFingerprint();
  const platform = `${process.platform} (${process.arch})`;
  const hostname = os.hostname();

  console.log('\n╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                   GarrisonOS Node & Hardware Identification                      ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║ Hostname:             ${hostname.padEnd(58)} ║`);
  console.log(`║ Platform:             ${platform.padEnd(58)} ║`);
  console.log(`║ Instance ID:          ${instanceId.padEnd(58)} ║`);
  console.log(`║ Hardware Fingerprint: ${hardwareFingerprint.padEnd(58)} ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Enterprise License Issuance & Server Migration Instructions:');
  console.log('-----------------------------------------------------------');
  console.log('1. Enterprise Edition licenses are cryptographically locked to this host machine.');
  console.log('2. To request an Enterprise License, submit your Instance ID and Hardware Fingerprint');
  console.log('   to: support@garrisonos.org (or licensing@garrisonos.org).');
  console.log('3. Migration Notice: If you plan to migrate to a new physical server or cloud VM,');
  console.log('   run this command on the target server in advance and request a migration key.');
  console.log('   The new key will be issued with full duration, and your old key will automatically');
  console.log('   expire 7 days later to allow seamless parallel testing and cutover.\n');
}

main().catch((err) => {
  console.error('Failed to resolve hardware fingerprint:', err);
  process.exit(1);
});
