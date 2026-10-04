import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Router } from '../api/router.js';
import { EventBus } from './events.js';
import { runMigrations } from '../database/migrator.js';
import { getApplicationVersion } from './version.js';
import { assertModuleLicensing } from './edition.js';

export interface ModuleNavigationItem {
  label: string;
  route: string;
  icon?: string;
  order?: number;
  section?: string;
}

export interface ModuleManifest {
  id: string;
  name: string;
  edition?: 'community' | 'commercial' | 'enterprise';
  license?: string;
  version: string;
  description: string;
  navigation?: ModuleNavigationItem[];
  slots?: string[];
  dependencies?: string[];
  signature?: string;
}

export interface LoadedModule {
  manifest: ModuleManifest;
  moduleDir: string;
}

const loadedModulesRegistry: LoadedModule[] = [];

export async function loadModules(
  router: Router,
  eventBus: EventBus,
  baseDir: string = process.cwd()
): Promise<LoadedModule[]> {
  const modulesDir = path.resolve(baseDir, 'modules');
  if (!fs.existsSync(modulesDir)) {
    return [];
  }

  // 1. Run migrations first so schema exists before routes/events start
  runMigrations(undefined, baseDir);

  const entries = fs.readdirSync(modulesDir).sort();
  loadedModulesRegistry.length = 0;

  for (const entry of entries) {
    const modDir = path.join(modulesDir, entry);
    if (!fs.statSync(modDir).isDirectory()) continue;

    const manifestPath = path.join(modDir, 'module.json');
    if (!fs.existsSync(manifestPath)) continue;

    const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw) as ModuleManifest;
    manifest.version = manifest.version || '0.1.0';

    // Enforce edition-level licensing protection (DMCA TPM guard)
    assertModuleLicensing(manifest);

    // 2. Load backend routes if present
    const distModDir = path.resolve(baseDir, 'dist/modules', entry, 'backend');
    const srcModDir = path.resolve(baseDir, 'modules', entry, 'backend');

    // Check compiled js first, fallback to ts if ts-node/esm
    let routesPath = path.join(distModDir, 'routes.js');
    if (!fs.existsSync(routesPath)) {
      routesPath = path.join(srcModDir, 'routes.ts');
    }

    if (fs.existsSync(routesPath)) {
      try {
        const routesUrl = pathToFileURL(routesPath).href;
        const routesModule = await import(routesUrl);
        if (typeof routesModule.registerRoutes === 'function') {
          routesModule.registerRoutes(router);
        }
      } catch (err) {
        process.stderr.write(`[ModuleLoader] Failed loading routes for ${manifest.id}: ${String(err)}\n`);
      }
    }

    // 3. Load backend event subscribers if present
    let eventsPath = path.join(distModDir, 'events.js');
    if (!fs.existsSync(eventsPath)) {
      eventsPath = path.join(srcModDir, 'events.ts');
    }

    if (fs.existsSync(eventsPath)) {
      try {
        const eventsUrl = pathToFileURL(eventsPath).href;
        const eventsModule = await import(eventsUrl);
        if (typeof eventsModule.registerSubscribers === 'function') {
          eventsModule.registerSubscribers(eventBus);
        }
      } catch (err) {
        process.stderr.write(`[ModuleLoader] Failed loading events for ${manifest.id}: ${String(err)}\n`);
      }
    }

    loadedModulesRegistry.push({
      manifest: { ...manifest, version: getApplicationVersion() },
      moduleDir: modDir
    });
  }

  return loadedModulesRegistry;
}

export function getLoadedModules(): LoadedModule[] {
  return [...loadedModulesRegistry];
}
