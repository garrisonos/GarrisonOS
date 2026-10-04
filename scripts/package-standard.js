/**
 * GarrisonOS Standard Edition Release Packaging Script
 *
 * Assembles the official Fair-Code Standard Edition distribution:
 * - Includes both Community and Standard modules.
 * - Installs LICENSE.FAIRCODE as the root LICENSE file.
 * - Enforces the 50-unit free tier, 14-day grace window, and heartbeat verification.
 * - Tailors package.json to declare Fair-Code license terms and standard defaults.
 * - Generates a release manifest and README.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const isHelp = args.includes('--help') || args.includes('-h');
const skipBuild = args.includes('--skip-build');
const isArchive = args.includes('--archive');

let customOutDir = '';
for (const arg of args) {
  if (arg.startsWith('--out-dir=')) {
    customOutDir = arg.split('=')[1];
  }
}

if (isHelp) {
  process.stdout.write(`
GarrisonOS Standard Edition Packager (Fair-Code v1.0)

Usage:
  node scripts/package-standard.js [options]

Options:
  --out-dir=<path>    Custom destination output directory (default: dist-releases/standard)
  --skip-build        Skip running TypeScript compilation in the packaged directory
  --archive           Produce a .tar.gz archive of the packaged release
  --help, -h          Display this help message
\n`);
  process.exit(0);
}

const targetDir = customOutDir
  ? path.resolve(rootDir, customOutDir)
  : path.resolve(rootDir, 'dist-releases', 'standard');

const resolvedTarget = path.resolve(targetDir);
const resolvedRoot = path.resolve(rootDir);
if (resolvedTarget === resolvedRoot) {
  process.stderr.write('❌ Error: Target output directory cannot be the repository root!\n');
  process.exit(1);
}

process.stdout.write('====================================================\n');
process.stdout.write('  GarrisonOS Standard Edition Packager (Fair-Code)  \n');
process.stdout.write('====================================================\n\n');

// 1. Load Root Package & Editions Manifest
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const editionsManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'editions.json'), 'utf8'));
const standardSpec = editionsManifest.editions?.standard;

if (!standardSpec) {
  process.stderr.write('❌ Error: Standard edition specification not found in editions.json\n');
  process.exit(1);
}

process.stdout.write(`[1/5] Preparing output directory: ${targetDir}\n`);
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

// 2. Discover and Package Modules for Standard Edition
process.stdout.write('[2/5] Packaging modules for Standard Edition...\n');
const modulesSrcDir = path.join(rootDir, 'modules');
const modulesDestDir = path.join(targetDir, 'modules');
fs.mkdirSync(modulesDestDir, { recursive: true });

const candidateModules = fs.readdirSync(modulesSrcDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);

const includedModules = [];

for (const modName of candidateModules) {
  const manifestPath = path.join(modulesSrcDir, modName, 'module.json');
  if (!fs.existsSync(manifestPath)) {
    continue;
  }

  try {
    const modManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    // Standard edition includes community and standard/fair-code modules (excludes purely enterprise-only modules if marked)
    if (modManifest.edition !== 'enterprise') {
      fs.cpSync(path.join(modulesSrcDir, modName), path.join(modulesDestDir, modName), { recursive: true });
      includedModules.push(modName);
      process.stdout.write(`  ✔ Included module: ${modName} (${modManifest.edition || 'standard'})\n`);
    } else {
      process.stdout.write(`  ⊘ Excluded enterprise-only module: ${modName}\n`);
    }
  } catch (err) {
    process.stderr.write(`  ⚠ Warning: Unable to parse ${manifestPath}: ${err.message}\n`);
  }
}

// 3. Copy Framework Core & Static Assets
process.stdout.write('[3/5] Copying core framework, API, database, and presentation layers...\n');
const coreDirsToCopy = ['api', 'core', 'database', 'web', 'scripts'];
for (const dir of coreDirsToCopy) {
  const src = path.join(rootDir, dir);
  const dest = path.join(targetDir, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
  }
}

// Copy essential root files
const rootFiles = ['tsconfig.json', '.gitignore', 'editions.json'];
for (const file of rootFiles) {
  const src = path.join(rootDir, file);
  const dest = path.join(targetDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

// 4. Install Fair-Code License & Tailor package.json
process.stdout.write('[4/5] Installing GarrisonOS Fair-Code License & tailoring package.json...\n');
const fairCodeSrc = path.join(rootDir, 'LICENSE.FAIRCODE');
const licenseDest = path.join(targetDir, 'LICENSE');
if (fs.existsSync(fairCodeSrc)) {
  fs.copyFileSync(fairCodeSrc, licenseDest);
  process.stdout.write('  ✔ Installed LICENSE.FAIRCODE as root LICENSE\n');
} else {
  process.stderr.write('  ❌ Warning: LICENSE.FAIRCODE not found in repository root!\n');
}

// Construct tailored Standard package.json
const standardPkg = {
  ...rootPkg,
  name: 'garrison-os',
  description: 'GarrisonOS Standard Edition — Official Fair-Code property management platform',
  license: 'SEE LICENSE IN LICENSE',
  garrisonEdition: 'standard',
  scripts: {
    ...rootPkg.scripts,
    start: 'node scripts/serve.js --edition=standard',
    dev: 'node scripts/serve.js --edition=standard --dev'
  }
};
fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(standardPkg, null, 2), 'utf8');

// Generate Standard Release Manifest
const releaseNotes = `# GarrisonOS Standard Edition (v${rootPkg.version || '0.2.1-alpha'})

**Governing License**: GarrisonOS Fair-Code License v1.0 ([LICENSE](file:///LICENSE))

## Included Modules
${includedModules.map(m => `- \`${m}\``).join('\n')}

## Standard Edition Terms & Features
1. **Free for up to 50 Units**: Production use is free of charge for portfolios of up to 50 rentable units.
2. **14-Day Grace Window (51–60 Units)**: Temporary grace period for growing portfolios.
3. **Automated Heartbeat**: Daily update and telemetry verification ping (30-day offline grace window).
4. **Anti-SaaS Covenant**: Multi-tenant commercial hosting and resale prohibited without commercial agreement.
5. **Anti-Aggregation Covenant**: Prohibits deploying multiple instances to artificially bypass unit quotas.
6. **Expansion Options**: Commercial expansion keys available for 100, 250+ units without migrating to Enterprise.

## Quick Start
\`\`\`bash
npm run setup
npm start
\`\`\`
`;
fs.writeFileSync(path.join(targetDir, 'STANDARD_RELEASE.md'), releaseNotes, 'utf8');

// 5. Verification & Optional Compilation / Archive
process.stdout.write('[5/5] Verifying packaged distribution...\n');
if (!skipBuild) {
  try {
    process.stdout.write('  Compiling TypeScript in standard release directory...\n');
    const tscCmd = process.platform === 'win32' ? 'npx.cmd tsc' : 'npx tsc';
    execSync(tscCmd, { cwd: targetDir, stdio: 'inherit' });
    process.stdout.write('  ✔ TypeScript compilation passed with 0 errors.\n');
  } catch (err) {
    process.stderr.write(`  ❌ Compilation failed: ${err.message}\n`);
    process.exit(1);
  }
} else {
  process.stdout.write('  ⊘ Skipped TypeScript compilation (--skip-build)\n');
}

if (isArchive) {
  try {
    const archiveName = `garrisonos-standard-v${rootPkg.version || '0.2.1-alpha'}.tar.gz`;
    const archivePath = path.resolve(rootDir, 'dist-releases', archiveName);
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    process.stdout.write(`  Packaging release tarball: ${archivePath}...\n`);
    execFileSync('tar', ['-czf', archivePath, '-C', path.dirname(targetDir), path.basename(targetDir)], { stdio: 'inherit' });
    process.stdout.write(`  ✔ Archive created: ${archiveName}\n`);
  } catch (err) {
    process.stderr.write(`  ❌ Error: Could not create tarball archive: ${err.message}\n`);
    process.exit(1);
  }
}

process.stdout.write('\n✔ Standard Edition packaging completed successfully!\n');
process.stdout.write(`  Target directory: ${targetDir}\n`);
process.stdout.write(`  Governing license: GarrisonOS Fair-Code v1.0 (${includedModules.length} modules packaged)\n\n`);
