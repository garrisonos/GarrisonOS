import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../database/client.js';

export type ThemePresetKey =
  | 'classic_blue'
  | 'metropolitan_slate'
  | 'emerald_asset'
  | 'warm_estate'
  | 'executive_indigo'
  | 'custom';

export interface ThemePreset {
  id: ThemePresetKey;
  name: string;
  description: string;
  primary: string;
  primaryHover: string;
  accent: string;
}

export const THEME_PRESETS: Readonly<Record<ThemePresetKey, ThemePreset>> = Object.freeze({
  classic_blue: {
    id: 'classic_blue',
    name: 'Classic White & Blue',
    description: 'Clean institutional real estate and fiduciary trust accounting (Default)',
    primary: '#1d4ed8',
    primaryHover: '#1e40af',
    accent: '#3b82f6'
  },
  metropolitan_slate: {
    id: 'metropolitan_slate',
    name: 'Metropolitan Slate',
    description: 'Modern cool fintech slate surfaces with energetic cobalt accents',
    primary: '#334155',
    primaryHover: '#1e293b',
    accent: '#0ea5e9'
  },
  emerald_asset: {
    id: 'emerald_asset',
    name: 'Emerald Asset Management',
    description: 'Sophisticated deep emerald and mint accents for private wealth portfolios',
    primary: '#065f46',
    primaryHover: '#047857',
    accent: '#10b981'
  },
  warm_estate: {
    id: 'warm_estate',
    name: 'Warm Estate Terracotta',
    description: 'Rich terracotta, bronze, and stone tones for luxury residential estates',
    primary: '#9a3412',
    primaryHover: '#c2410c',
    accent: '#f59e0b'
  },
  executive_indigo: {
    id: 'executive_indigo',
    name: 'Executive Indigo',
    description: 'Deep royal indigo and vibrant violet highlights for high-density assets',
    primary: '#4338ca',
    primaryHover: '#3730a3',
    accent: '#6366f1'
  },
  custom: {
    id: 'custom',
    name: 'Custom Brand Palette',
    description: 'Tailored hex values chosen via interactive color picker',
    primary: '#1d4ed8',
    primaryHover: '#1e40af',
    accent: '#3b82f6'
  }
});

export interface OperatorBranding {
  operator_id: string;
  brand_name: string;
  logo_url?: string | null;
  favicon_url?: string | null;
  tagline?: string | null;
  theme_preset: ThemePresetKey;
  primary_color: string;
  primary_hover: string;
  accent_color: string;
  default_dark_mode: number;
  updated_at: number;
}

export interface UpdateBrandingInput {
  brand_name?: string;
  logo_url?: string | null;
  favicon_url?: string | null;
  tagline?: string | null;
  theme_preset?: ThemePresetKey;
  primary_color?: string;
  primary_hover?: string;
  accent_color?: string;
  default_dark_mode?: boolean | number;
}

/**
 * Service managing operator visual branding, custom logos, company identity,
 * theme palettes, and global dark mode preferences.
 */
export class BrandingService {
  /**
   * Retrieve active branding settings for an operator with graceful fallbacks.
   *
   * @param operatorId - Active operator UUID.
   * @param dbInstance - Optional SQLite database override.
   * @returns OperatorBranding entity.
   */
  public static getBranding(operatorId: string, dbInstance?: DatabaseSync): OperatorBranding {
    const db = dbInstance || getDatabase();
    try {
      const row = db.prepare(`
        SELECT * FROM operator_branding WHERE operator_id = ?
      `).get(operatorId) as any;

      if (row) {
        return {
          operator_id: row.operator_id,
          brand_name: row.brand_name || 'GarrisonOS',
          logo_url: row.logo_url,
          favicon_url: row.favicon_url,
          tagline: row.tagline,
          theme_preset: row.theme_preset || 'classic_blue',
          primary_color: row.primary_color || '#1d4ed8',
          primary_hover: row.primary_hover || '#1e40af',
          accent_color: row.accent_color || '#3b82f6',
          default_dark_mode: Number(row.default_dark_mode || 0),
          updated_at: Number(row.updated_at || Date.now())
        };
      }
    } catch {
      // Graceful fallback if table is not yet migrated
    }

    // Default institutional branding
    return {
      operator_id: operatorId,
      brand_name: 'GarrisonOS',
      logo_url: null,
      favicon_url: null,
      tagline: 'Property & Asset Management',
      theme_preset: 'classic_blue',
      primary_color: '#1d4ed8',
      primary_hover: '#1e40af',
      accent_color: '#3b82f6',
      default_dark_mode: 0,
      updated_at: Date.now()
    };
  }

  /**
   * Save or update branding and theme configurations for an operator.
   *
   * @param operatorId - Active operator UUID.
   * @param input - Candidate branding modifications.
   * @param dbInstance - Optional SQLite database override.
   * @returns Updated OperatorBranding record.
   */
  public static updateBranding(
    operatorId: string,
    input: UpdateBrandingInput,
    dbInstance?: DatabaseSync
  ): OperatorBranding {
    const db = dbInstance || getDatabase();
    const current = BrandingService.getBranding(operatorId, db);
    const now = Date.now();

    let preset = input.theme_preset || current.theme_preset;
    let primary = input.primary_color || current.primary_color;
    let hover = input.primary_hover || current.primary_hover;
    let accent = input.accent_color || current.accent_color;

    // If preset changed to a standard preset, apply preset default colors unless custom was explicitly chosen
    if (input.theme_preset && input.theme_preset !== 'custom' && THEME_PRESETS[input.theme_preset]) {
      const p = THEME_PRESETS[input.theme_preset];
      primary = p.primary;
      hover = p.primaryHover;
      accent = p.accent;
    } else if (input.primary_color && input.primary_color !== current.primary_color) {
      preset = 'custom';
      // Automatically calculate a slightly darker hover shade if not provided
      if (!input.primary_hover) {
        hover = input.primary_color;
      }
    }

    const brandName = input.brand_name !== undefined ? input.brand_name.trim() || 'GarrisonOS' : current.brand_name;
    const logoUrl = input.logo_url !== undefined ? (input.logo_url?.trim() || null) : current.logo_url;
    const faviconUrl = input.favicon_url !== undefined ? (input.favicon_url?.trim() || null) : current.favicon_url;
    const tagline = input.tagline !== undefined ? (input.tagline?.trim() || null) : current.tagline;
    const defaultDarkMode = input.default_dark_mode !== undefined ? (input.default_dark_mode ? 1 : 0) : current.default_dark_mode;

    db.prepare(`
      INSERT INTO operator_branding (
        operator_id, brand_name, logo_url, favicon_url, tagline,
        theme_preset, primary_color, primary_hover, accent_color,
        default_dark_mode, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(operator_id) DO UPDATE SET
        brand_name = excluded.brand_name,
        logo_url = excluded.logo_url,
        favicon_url = excluded.favicon_url,
        tagline = excluded.tagline,
        theme_preset = excluded.theme_preset,
        primary_color = excluded.primary_color,
        primary_hover = excluded.primary_hover,
        accent_color = excluded.accent_color,
        default_dark_mode = excluded.default_dark_mode,
        updated_at = excluded.updated_at
    `).run(
      operatorId,
      brandName,
      logoUrl ?? null,
      faviconUrl ?? null,
      tagline ?? null,
      preset,
      primary,
      hover,
      accent,
      defaultDarkMode,
      now
    );

    return BrandingService.getBranding(operatorId, db);
  }

  /**
   * Generate dynamic CSS variables tag matching operator branding.
   *
   * @param branding - Operator branding configuration.
   * @returns Safe inline <style> block string.
   */
  public static renderBrandingCss(branding: OperatorBranding): string {
    return `<style id="garrison-branding-vars">
      :root {
        --primary: ${branding.primary_color};
        --primary-hover: ${branding.primary_hover};
        --primary-light: ${branding.primary_color}1a;
        --primary-glow: ${branding.primary_color}33;
        --accent: ${branding.accent_color};
      }
    </style>`;
  }
}
