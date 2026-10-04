/**
 * GarrisonOS Community Edition Release Packaging Script
 *
 * Assembles a clean, standalone Community Edition distribution under GNU AGPLv3:
 * - Scans modules and includes ONLY modules marked as "community" / "AGPL-3.0-or-later".
 * - Filters out any commercial, enterprise, or Fair-Code modules.
 * - Installs LICENSE.AGPL as the root LICENSE file.
 * - Tailors package.json to declare AGPL-3.0-or-later and community defaults.
 * - Generates a release manifest and README.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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
GarrisonOS Community Edition Packager (GNU AGPLv3)

Usage:
  node scripts/package-community.js [options]

Options:
  --out-dir=<path>    Custom destination output directory (default: dist-releases/community)
  --skip-build        Skip running TypeScript compilation in the packaged directory
  --archive           Produce a .tar.gz archive of the packaged release
  --help, -h          Display this help message
\n`);
  process.exit(0);
}

const targetDir = customOutDir
  ? path.resolve(rootDir, customOutDir)
  : path.resolve(rootDir, 'dist-releases', 'community');

process.stdout.write('====================================================\n');
process.stdout.write('  GarrisonOS Community Edition Packager (AGPLv3)   \n');
process.stdout.write('====================================================\n\n');

// 1. Load Root Package & Editions Manifest
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const editionsManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'editions.json'), 'utf8'));
const communitySpec = editionsManifest.editions?.community;

if (!communitySpec) {
  process.stderr.write('❌ Error: Community edition specification not found in editions.json\n');
  process.exit(1);
}

process.stdout.write(`[1/5] Preparing output directory: ${targetDir}\n`);
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

// 2. Discover and Filter Community Modules
process.stdout.write('[2/5] Evaluating and filtering modules for Community Edition...\n');
const modulesSrcDir = path.join(rootDir, 'modules');
const modulesDestDir = path.join(targetDir, 'modules');
fs.mkdirSync(modulesDestDir, { recursive: true });

const candidateModules = fs.readdirSync(modulesSrcDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);

const includedModules = [];
const excludedModules = [];

for (const modName of candidateModules) {
  const manifestPath = path.join(modulesSrcDir, modName, 'module.json');
  if (!fs.existsSync(manifestPath)) {
    continue;
  }

  try {
    const modManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const isCommunity =
      modManifest.edition === 'community' ||
      modManifest.license === 'AGPL-3.0-or-later' ||
      (communitySpec.modules && communitySpec.modules.includes(modName));

    const isCommercialOrFairCode =
      modManifest.edition === 'commercial' ||
      modManifest.edition === 'enterprise' ||
      (modManifest.license && modManifest.license.includes('Fair-Code'));

    if (isCommunity && !isCommercialOrFairCode) {
      fs.cpSync(path.join(modulesSrcDir, modName), path.join(modulesDestDir, modName), { recursive: true });
      includedModules.push(modName);
      process.stdout.write(`  ✔ Included community module: ${modName}\n`);
    } else {
      excludedModules.push(modName);
      process.stdout.write(`  ⊘ Excluded commercial/fair-code module: ${modName}\n`);
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
const rootFiles = ['tsconfig.json', '.gitignore'];
for (const file of rootFiles) {
  const src = path.join(rootDir, file);
  const dest = path.join(targetDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

// 4. Install AGPLv3 License & Tailor package.json
process.stdout.write('[4/5] Installing GNU AGPLv3 license & tailoring package.json...\n');
const agplSrc = path.join(rootDir, 'LICENSE.AGPL');
const agplDest = path.join(targetDir, 'LICENSE');
if (fs.existsSync(agplSrc)) {
  fs.copyFileSync(agplSrc, agplDest);
  process.stdout.write('  ✔ Installed LICENSE.AGPL as root LICENSE\n');
} else {
  process.stderr.write('  ❌ Warning: LICENSE.AGPL not found in repository root!\n');
}

// Construct tailored Community package.json
const communityPkg = {
  ...rootPkg,
  name: 'garrison-os-community',
  description: 'GarrisonOS Community Edition — 100% Free and Open Source (GNU AGPLv3) property management platform',
  license: 'AGPL-3.0-or-later',
  garrisonEdition: 'community',
  scripts: {
    ...rootPkg.scripts,
    start: 'node scripts/serve.js --edition=community',
    dev: 'node scripts/serve.js --edition=community --dev'
  }
};
fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(communityPkg, null, 2), 'utf8');

// Generate Community Release Manifest
const releaseNotes = `# GarrisonOS Community Edition (v${rootPkg.version || '0.2.0'})

**Governing License**: GNU Affero General Public License v3.0 ([LICENSE](file:///LICENSE))

## Included Open-Source Modules
${includedModules.map(m => `- \`${m}\``).join('\n')}

## Community Edition Guarantees
1. **100% Free & Open Source**: Full freedom to inspect, run, modify, and redistribute under the GNU AGPLv3.
2. **Zero Telemetry**: No mandatory outbound network calls or phone-home heartbeats.
3. **Unrestricted Scale**: Manage unlimited units and properties without quota restrictions.
4. **Zero External Runtime Dependencies**: Executes natively on standard Node.js libraries.

## Quick Start
\`\`\`bash
npm run setup
npm start
\`\`\`
`;
fs.writeFileSync(path.join(targetDir, 'COMMUNITY_RELEASE.md'), releaseNotes, 'utf8');

// 5. Verification & Optional Compilation / Archive
process.stdout.write('[5/5] Verifying packaged distribution...\n');
if (!skipBuild) {
  try {
    process.stdout.write('  Compiling TypeScript in community release directory...\n');
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
    const archiveName = `garrisonos-community-v${rootPkg.version || '0.2.0'}.tar.gz`;
    const archivePath = path.resolve(rootDir, 'dist-releases', archiveName);
    process.stdout.write(`  Packaging release tarball: ${archivePath}...\n`);
    execSync(`tar -czf "${archivePath}" -C "${path.dirname(targetDir)}" "${path.basename(targetDir)}"`, { stdio: 'inherit' });
    process.stdout.write(`  ✔ Archive created: ${archiveName}\n`);
  } catch (err) {
    process.stderr.write(`  ⚠ Warning: Could not create tarball archive: ${err.message}\n`);
  }
}

process.stdout.write('\n✔ Community Edition packaging completed successfully!\n');
process.stdout.write(`  Target directory: ${targetDir}\n`);
process.stdout.write(`  Governing license: GNU AGPLv3 (${includedModules.length} modules packaged)\n\n`);
