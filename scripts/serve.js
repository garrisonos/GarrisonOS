import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from .env if present (zero external deps)
function loadEnv() {
  const envPath = path.join(rootDir, '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

// Parse command-line arguments
const argv = process.argv.slice(2);
let webPort = parseInt(process.env['WEB_PORT'] || '8080', 10);
let webHost = process.env['WEB_HOST'] || 'localhost';
let apiPort = parseInt(process.env['PORT'] || '3000', 10);
let apiHost = process.env['HOST'] || '127.0.0.1';
let isDev = false;

let edition = (process.env['GARRISON_EDITION'] || 'standard').toLowerCase();

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--help' || arg === '-h') {
    process.stdout.write(`
GarrisonOS Process Supervisor & Server Runner

Usage:
  node scripts/serve.js [options]
  npm start -- [options]

Options:
  --edition <EDITION>     Target edition (community, standard, enterprise) (default: standard or GARRISON_EDITION)
  --port, -p <PORT>       Web presentation port (default: 8080 or WEB_PORT)
  --host <HOST>           Web presentation host (default: localhost or WEB_HOST)
  --api-port <PORT>       API Engine loopback port (default: 3000 or PORT)
  --api-host <HOST>       API Engine loopback host (default: 127.0.0.1 or HOST)
  --dev                   Run API engine with --watch for auto-reloading
  --help, -h              Display this help message

Examples:
  node scripts/serve.js --port 8080
  node scripts/serve.js --edition community
  node scripts/serve.js -p 8085
  npm start -- --port=3080
\n`);
    process.exit(0);
  } else if (arg === '--dev') {
    isDev = true;
  } else if (arg === '--edition') {
    const next = argv[++i];
    if (next) edition = next.toLowerCase();
  } else if (arg.startsWith('--edition=')) {
    edition = arg.split('=')[1].toLowerCase();
  } else if (arg === '-p' || arg === '--port') {
    const next = argv[++i];
    if (next) webPort = parseInt(next, 10);
  } else if (arg.startsWith('--port=')) {
    webPort = parseInt(arg.split('=')[1], 10);
  } else if (arg === '--host') {
    const next = argv[++i];
    if (next) webHost = next;
  } else if (arg.startsWith('--host=')) {
    webHost = arg.split('=')[1];
  } else if (arg === '--api-port') {
    const next = argv[++i];
    if (next) apiPort = parseInt(next, 10);
  } else if (arg.startsWith('--api-port=')) {
    apiPort = parseInt(arg.split('=')[1], 10);
  }
}

if (!['community', 'standard', 'enterprise'].includes(edition)) {
  process.stderr.write(`❌ Error: Invalid edition "${edition}". Permitted editions: community, standard, enterprise\n`);
  process.exit(1);
}
process.env['GARRISON_EDITION'] = edition;

// Helper to check if a port is available
function checkPortAvailable(port, host) {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(true);
      }
    });
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

// Helper to poll for backend health check
function waitForHealth(url, timeoutMs = 15000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    function ping() {
      const req = http.get(url, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', () => {
        retry();
      });
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    }

    function retry() {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for backend health check at ${url}`));
      } else {
        setTimeout(ping, 150);
      }
    }

    ping();
  });
}

async function main() {
  process.stdout.write('========================================\n');
  process.stdout.write('  Starting GarrisonOS Full Stack Server \n');
  process.stdout.write('========================================\n\n');

  // Verify dist/ exists or run build
  const distServer = path.join(rootDir, 'dist', 'api', 'server.js');
  if (!existsSync(distServer)) {
    process.stdout.write('[setup] Build artifact not found. Running setup...\n');
    const { execSync } = await import('node:child_process');
    const isWindows = process.platform === 'win32';
    execSync(`${isWindows ? 'npm.cmd' : 'npm'} run build`, { cwd: rootDir, stdio: 'inherit' });
  }

  // Check Web Port Availability
  const isWebPortFree = await checkPortAvailable(webPort, webHost);
  if (!isWebPortFree) {
    process.stderr.write(`❌ Error: Port ${webPort} is already in use.\n`);
    process.stderr.write(`   You can specify an alternative port using:\n`);
    process.stderr.write(`     node scripts/serve.js --port=${webPort + 1}\n`);
    process.stderr.write(`     npm start -- --port=${webPort + 1}\n\n`);
    process.exit(1);
  }

  // Check API Port Availability
  const isApiPortFree = await checkPortAvailable(apiPort, apiHost);
  if (!isApiPortFree) {
    process.stderr.write(`❌ Error: API Engine port ${apiPort} is already in use.\n`);
    process.stderr.write(`   Specify a different API port with: --api-port=${apiPort + 1}\n\n`);
    process.exit(1);
  }

  const runningProcesses = [];

  function terminateAll() {
    process.stdout.write('\n[shutdown] Stopping GarrisonOS processes...\n');
    for (const proc of runningProcesses) {
      if (proc && !proc.killed) {
        try {
          if (process.platform === 'win32' && proc.pid) {
            // On Windows, use process kill
            proc.kill();
          } else {
            proc.kill('SIGTERM');
          }
        } catch {
          // ignore shutdown errors
        }
      }
    }
  }

  process.on('SIGINT', () => {
    terminateAll();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    terminateAll();
    process.exit(0);
  });

  // 1. Spawn Node.js API Engine
  process.stdout.write(`[engine] Launching Node.js API Engine on http://${apiHost}:${apiPort}...\n`);
  const nodeArgs = isDev
    ? ['--watch', path.join('dist', 'api', 'server.js')]
    : [path.join('dist', 'api', 'server.js')];

  const engineEnv = {
    ...process.env,
    PORT: String(apiPort),
    HOST: apiHost,
    GARRISON_EDITION: edition
  };

  const engineProc = spawn(process.execPath, nodeArgs, {
    cwd: rootDir,
    env: engineEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  runningProcesses.push(engineProc);

  engineProc.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      for (const line of text.split(/\r?\n/)) {
        process.stdout.write(`[engine] ${line}\n`);
      }
    }
  });

  engineProc.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      for (const line of text.split(/\r?\n/)) {
        process.stderr.write(`[engine] ${line}\n`);
      }
    }
  });

  engineProc.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`[engine] API Engine exited unexpectedly with code ${code}\n`);
      terminateAll();
      process.exit(code);
    }
  });

  // 2. Wait for API Health
  try {
    await waitForHealth(`http://${apiHost}:${apiPort}/health`, 12000);
    process.stdout.write(`[engine] ✔ Health check passed on http://${apiHost}:${apiPort}/health\n`);
  } catch (err) {
    process.stderr.write(`[engine] ❌ ${err.message}\n`);
    terminateAll();
    process.exit(1);
  }

  // 3. Spawn TypeScript Web Presentation Server
  process.stdout.write(`[frontend] Launching TypeScript Presentation Layer on http://${webHost}:${webPort}...\n`);

  const webEnv = {
    ...process.env,
    API_URL: `http://${apiHost}:${apiPort}`,
    WEB_PORT: String(webPort),
    WEB_HOST: webHost,
    PORT: String(apiPort),
    GARRISON_EDITION: edition
  };

  const webProc = spawn(process.execPath, [path.join('dist', 'web', 'server.js')], {
    cwd: rootDir,
    env: webEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  runningProcesses.push(webProc);

  webProc.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      for (const line of text.split(/\r?\n/)) {
        process.stdout.write(`[frontend] ${line}\n`);
      }
    }
  });

  webProc.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      for (const line of text.split(/\r?\n/)) {
        process.stderr.write(`[frontend] ${line}\n`);
      }
    }
  });

  webProc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`[frontend] Web server exited with code ${code}\n`);
      terminateAll();
      process.exit(code);
    }
  });

  const editionDisplay = edition.charAt(0).toUpperCase() + edition.slice(1);
  process.stdout.write('\n======================================================\n');
  process.stdout.write(`  ✨ GarrisonOS (${editionDisplay} Edition) is online!\n`);
  process.stdout.write(`  Web Application: http://${webHost}:${webPort}\n`);
  process.stdout.write(`  Backend Engine:  http://${apiHost}:${apiPort}\n`);
  process.stdout.write('======================================================\n');
  process.stdout.write('Press Ctrl+C to stop all services.\n\n');
}

main().catch((err) => {
  process.stderr.write(`Server runner failed: ${err.message}\n`);
  process.exit(1);
});

