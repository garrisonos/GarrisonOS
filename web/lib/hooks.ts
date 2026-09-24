import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Navigation item registered by modular frontend extensions for sidebar display.
 */
export interface NavigationItem {
  /** User-facing display title. */
  label: string;
  /** Internal web route path. */
  route: string;
  /** Optional icon identifier mapped in sidebar icon map. */
  icon?: string;
  /** Sort order weight within the section (lower values sort first). */
  order?: number;
  /** Primary category section (e.g. Portfolio, Operations, Financials, System). */
  section?: string;
}

/**
 * Metric card displayed on the overview dashboard.
 */
export interface DashboardCard {
  /** Unique card identifier. */
  id?: string;
  /** Metric title or KPI label. */
  title: string;
  /** Formatted metric value string. */
  value: string;
  /** Contextual helper text or change indicator. */
  subtitle?: string;
  /** Sort order on the dashboard view. */
  order?: number;
}

/**
 * Callback function transforming API responses into a presentation DashboardCard.
 */
export type DashboardCardCallback = (apiResponse: any) => DashboardCard | null;

interface RegisteredCard {
  path: string;
  callback: DashboardCardCallback;
}

/**
 * In-memory registry enabling decoupled modules to register navigation links,
 * dashboard metric widgets, and UI hooks without core hardcoding.
 */
export class HookRegistry {
  private static navigation: NavigationItem[] = [];
  private static dashboardCards: RegisteredCard[] = [];

  /**
   * Register a new navigation item for the application sidebar.
   *
   * @param item - Navigation configuration item.
   */
  public static registerNavigation(item: NavigationItem): void {
    this.navigation.push(item);
  }

  /**
   * Retrieve all registered navigation items sorted by order weight.
   *
   * @returns Array of sorted NavigationItems.
   */
  public static getNavigation(): NavigationItem[] {
    return [...this.navigation].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  /**
   * Register a dynamic dashboard metric card backed by an API endpoint.
   *
   * @param apiPath - Relative API route to fetch data from.
   * @param callback - Transformer producing a DashboardCard or null from the API response.
   */
  public static registerDashboardCard(apiPath: string, callback: DashboardCardCallback): void {
    this.dashboardCards.push({ path: apiPath, callback });
  }

  /**
   * Get all registered card definitions.
   *
   * @returns Registered card configurations.
   */
  public static getDashboardCardRegistrations(): RegisteredCard[] {
    return [...this.dashboardCards];
  }

  /**
   * Fetches data for all registered cards in a single batch request and returns sorted cards.
   *
   * @param apiClient - Bound API client supporting batch requests.
   * @returns Array of evaluated and sorted DashboardCard items.
   */
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

  /**
   * Dynamically discovers and executes frontend hooks across all active modules.
   *
   * @param baseDir - Repository root or search directory.
   */
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
