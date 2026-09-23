-- Operator Branding & Appearance Settings
CREATE TABLE IF NOT EXISTS operator_branding (
    operator_id TEXT PRIMARY KEY REFERENCES operators(id),
    brand_name TEXT NOT NULL DEFAULT 'GarrisonOS',
    logo_url TEXT,
    favicon_url TEXT,
    tagline TEXT,
    theme_preset TEXT NOT NULL DEFAULT 'classic_blue' CHECK (theme_preset IN ('classic_blue', 'metropolitan_slate', 'emerald_asset', 'warm_estate', 'executive_indigo', 'custom')),
    primary_color TEXT NOT NULL DEFAULT '#1d4ed8',
    primary_hover TEXT NOT NULL DEFAULT '#1e40af',
    accent_color TEXT NOT NULL DEFAULT '#3b82f6',
    default_dark_mode INTEGER NOT NULL DEFAULT 0 CHECK (default_dark_mode IN (0, 1)),
    updated_at INTEGER NOT NULL
);
