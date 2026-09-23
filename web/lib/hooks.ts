import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface NavigationItem {
  label: string;
  route: string;
  icon?: string;
  order?: number;
  section?: string;
}

export interface DashboardCard {
  id?: string;
  title: string;
  value: string;
  subtitle?: string;
  order?: number;
}

export type DashboardCardCallback = (apiResponse: any) => DashboardCard | null;

interface RegisteredCard {
  path: string;
  callback: DashboardCardCallback;
}

export class HookRegistry {
  private static navigation: NavigationItem[] = [];
  private static dashboardCards: RegisteredCard[] = [];

  public static registerNavigation(item: NavigationItem): void {
    this.navigation.push(item);
  }

  public static getNavigation(): NavigationItem[] {
    return [...this.navigation].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  public static registerDashboardCard(apiPath: string, callback: DashboardCardCallback): void {
    this.dashboardCards.push({ path: apiPath, callback });
  }

  public static getDashboardCardRegistrations(): RegisteredCard[] {
    return [...this.dashboardCards];
  }

  public static async getDashboardCards(apiClient: {
    batch(paths: string[]): Promise<Record<string, any>>;
  }): Promise<DashboardCard[]> {
    const cards: DashboardCard[] = [];
    if (this.dashboardCards.length === 0) return cards;

    const paths = Array.from(new Set(this.dashboardCards.map((c) => c.path)));
    let responses: Record<string, any> = {};

    try {
      responses = await apiClient.batch(paths);
    } catch {
      return cards;
    }

    for (const item of this.dashboardCards) {
      try {
        const card = item.callback(responses[item.path]);
        if (card) {
          cards.push(card);
        }
      } catch {
        // Individual card errors are ignored to avoid bringing down dashboard
      }
    }

    return cards.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  public static async loadModuleHooks(baseDir: string = process.cwd()): Promise<void> {
    let root = path.resolve(baseDir);
    while (root !== path.dirname(root) && !fs.existsSync(path.join(root, 'package.json'))) {
      root = path.dirname(root);
    }
    const modulesDir = path.resolve(root, 'modules');
    if (!fs.existsSync(modulesDir)) return;

    this.navigation = [];
    this.dashboardCards = [];

    const entries = fs.readdirSync(modulesDir).sort();
    for (const mod of entries) {
      const modDir = path.join(modulesDir, mod);
      if (!fs.statSync(modDir).isDirectory()) continue;

      // Check for compiled hook in dist, or source hook in modules
      const distHook = path.resolve(root, 'dist', 'modules', mod, 'frontend', 'hooks.js');
      const srcHook = path.resolve(root, 'modules', mod, 'frontend', 'hooks.ts');

      const targetHook = fs.existsSync(distHook) ? distHook : fs.existsSync(srcHook) ? srcHook : null;
      if (targetHook) {
        try {
          const hookUrl = pathToFileURL(targetHook).href;
          await import(hookUrl);
        } catch (err) {
          process.stderr.write(`[HookRegistry] Failed to load frontend hook for module ${mod}: ${String(err)}\n`);
        }
      }
    }
  }
}
