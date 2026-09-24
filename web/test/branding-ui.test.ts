import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { BrandingService, THEME_PRESETS } from '../../core/branding.js';
import { renderLayout } from '../templates/layout.js';
import { renderHeader } from '../templates/header.js';
import { renderSidebar } from '../templates/sidebar.js';
import { renderConversationsWidget } from '../templates/conversations.js';
import { renderLeaseARSubsystem } from '../templates/lease-ar.js';
import { html } from '../lib/html.js';

describe('Modern UI, Branding & Presentation Engine Suite', () => {
  let db: DatabaseSync;
  const operatorId = 'operator-test-branding';

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS operator_branding (
        operator_id TEXT PRIMARY KEY,
        brand_name TEXT NOT NULL DEFAULT 'GarrisonOS',
        logo_url TEXT,
        favicon_url TEXT,
        tagline TEXT,
        theme_preset TEXT NOT NULL DEFAULT 'classic_blue',
        primary_color TEXT NOT NULL DEFAULT '#1d4ed8',
        primary_hover TEXT NOT NULL DEFAULT '#1e40af',
        accent_color TEXT NOT NULL DEFAULT '#3b82f6',
        default_dark_mode INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `);
  });

  it('BrandingService returns default institutional branding when no row exists', () => {
    const branding = BrandingService.getBranding(operatorId, db);
    assert.equal(branding.operator_id, operatorId);
    assert.equal(branding.brand_name, 'GarrisonOS');
    assert.equal(branding.theme_preset, 'classic_blue');
    assert.equal(branding.primary_color, '#1d4ed8');
    assert.equal(branding.default_dark_mode, 0);
  });

  it('BrandingService updates branding identity and theme preset colors', () => {
    const updated = BrandingService.updateBranding(operatorId, {
      brand_name: 'Apex Wealth & Trust',
      tagline: 'Premier Fiduciary Real Estate',
      theme_preset: 'emerald_asset',
      logo_url: 'https://apex.test/logo.svg',
      default_dark_mode: 1
    }, db);

    assert.equal(updated.brand_name, 'Apex Wealth & Trust');
    assert.equal(updated.theme_preset, 'emerald_asset');
    assert.equal(updated.primary_color, THEME_PRESETS.emerald_asset.primary);
    assert.equal(updated.logo_url, 'https://apex.test/logo.svg');
    assert.equal(updated.default_dark_mode, 1);

    // Verify persistence
    const reloaded = BrandingService.getBranding(operatorId, db);
    assert.equal(reloaded.brand_name, 'Apex Wealth & Trust');
  });

  it('BrandingService generates valid dynamic CSS variables block', () => {
    const branding = BrandingService.getBranding(operatorId, db);
    const css = BrandingService.renderBrandingCss(branding);
    assert.match(css, /:root/);
    assert.match(css, /--primary: #1d4ed8;/);
    assert.match(css, /--accent: #3b82f6;/);
  });

  it('BrandingService rejects invalid hex colors during update', () => {
    assert.throws(() => {
      BrandingService.updateBranding(operatorId, {
        primary_color: 'red; } </style><script>alert(1)</script>'
      }, db);
    }, /Branding colors must be valid six-digit hex values/);

    assert.throws(() => {
      BrandingService.updateBranding(operatorId, {
        primary_hover: '#zzz123'
      }, db);
    }, /Branding colors must be valid six-digit hex values/);
  });

  it('renderBrandingCss sanitizes non-hex values with safe fallbacks preventing injection', () => {
    const maliciousBranding = {
      operator_id: operatorId,
      brand_name: 'Malicious Ops',
      theme_preset: 'custom' as const,
      primary_color: 'red; } </style><script>',
      primary_hover: 'blue; }',
      accent_color: 'rgba(0,0,0,0)',
      default_dark_mode: 0,
      updated_at: Date.now()
    };
    const css = BrandingService.renderBrandingCss(maliciousBranding);
    assert.ok(!css.includes('script'));
    assert.match(css, /--primary: #1d4ed8;/);
    assert.match(css, /--primary-hover: #1e40af;/);
    assert.match(css, /--accent: #3b82f6;/);
  });

  it('renderLayout injects branding CSS, title, anti-FOUC script, and theme tokens', () => {
    const branding = BrandingService.getBranding(operatorId, db);
    branding.brand_name = 'Beacon Peak Capital';
    branding.favicon_url = 'https://beacon.test/favicon.png';

    const output = renderLayout({
      title: 'Portfolio Overview',
      content: html`<p>Active test body</p>`,
      user: null,
      operatorId,
      branding,
      navItems: [],
      currentPath: '/dashboard'
    });

    assert.match(output, /Beacon Peak Capital/);
    assert.match(output, /<title>Portfolio Overview – Beacon Peak Capital<\/title>/);
    assert.match(output, /<link rel="icon" href="https:\/\/beacon\.test\/favicon\.png">/);
    assert.match(output, /localStorage\.getItem\('garrison_theme'\)/);
    assert.match(output, /--primary:/);
    assert.match(output, /Active test body/);
  });

  it('renderLayout injects default favicon links and og-image when custom favicon is not configured', () => {
    const output = renderLayout({
      title: 'Portfolio Overview',
      content: html`<p>Active test body</p>`,
      user: null,
      operatorId,
      navItems: [],
      currentPath: '/dashboard'
    });

    assert.match(output, /<link rel="icon" type="image\/x-icon" href="\/public\/favicon\.ico">/);
    assert.match(output, /<link rel="icon" type="image\/png" sizes="32x32" href="\/public\/favicon-32x32\.png">/);
    assert.match(output, /<link rel="apple-touch-icon" sizes="180x180" href="\/public\/apple-touch-icon\.png">/);
    assert.match(output, /<meta property="og:image" content="\/public\/og-image\.png">/);
  });

  it('renderHeader renders brand badge, operator id, and theme toggle button', () => {
    const headerHtml = renderHeader(null, operatorId, 'Highland Asset Management').value;
    assert.match(headerHtml, /Highland Asset Management/);
    assert.match(headerHtml, /class="brand-badge"/);
    assert.match(headerHtml, /class="theme-toggle-btn"/);
  });

  it('renderSidebar renders logo image when provided or fallback monogram and categorized sections', () => {
    const navItems = [
      { label: 'Properties', route: '/properties', icon: 'building' },
      { label: 'Leases', route: '/leases', icon: 'file-text' },
      { label: 'Financial Ledger', route: '/accounting', icon: 'dollar-sign' }
    ];

    const sidebarHtml = renderSidebar(navItems, '/properties', {
      brand_name: 'Metro Residences',
      logo_url: 'https://metro.test/logo.svg'
    }).value;

    assert.match(sidebarHtml, /<img src="https:\/\/metro\.test\/logo\.svg"/);
    assert.match(sidebarHtml, /Metro Residences/);
    assert.match(sidebarHtml, /Portfolio/);
    assert.match(sidebarHtml, /Operations/);
    assert.match(sidebarHtml, /Financials/);
  });

  it('renderConversationsWidget displays thread list, private notes tag, and reply form', () => {
    const convWidget = renderConversationsWidget({
      entityType: 'lease',
      entityId: 'lease-test-1',
      currentUserRole: 'manager',
      conversations: [
        {
          id: 'conv-1',
          operator_id: operatorId,
          entity_type: 'lease',
          entity_id: 'lease-test-1',
          subject: 'Late Payment Follow-up',
          is_private: 1,
          created_at: Date.now() - 3600000,
          updated_at: Date.now(),
          messages: [
            {
              id: 'msg-1',
              operator_id: operatorId,
              conversation_id: 'conv-1',
              author_name: 'Jane Property Manager',
              author_role: 'manager',
              body: 'Tenant called to request a 3-day extension.',
              created_at: Date.now() - 3600000
            }
          ]
        }
      ]
    }).value;

    assert.match(convWidget, /Late Payment Follow-up/);
    assert.match(convWidget, /Private Note \(Staff Only\)/);
    assert.match(convWidget, /Tenant called to request a 3-day extension\./);
    assert.match(convWidget, /Jane Property Manager/);
    assert.match(convWidget, /Write a reply\.\.\./);
  });

  it('renderLeaseARSubsystem renders recurring charges, late fee delinquency, and credits', () => {
    const arHtml = renderLeaseARSubsystem({
      leaseId: 'lease-ar-1',
      csrfToken: 'test-csrf-token',
      depositHeldCents: 150000,
      recurringCharges: [
        {
          id: 'rec-1',
          operator_id: operatorId,
          lease_id: 'lease-ar-1',
          charge_category: 'parking_fee',
          amount_cents: 7500,
          gl_account_id: 'gl-acc-1',
          billing_frequency: 'monthly',
          billing_day: 1,
          description: 'Reserved Stall #22',
          created_at: Date.now()
        }
      ],
      credits: [
        {
          id: 'cred-1',
          operator_id: operatorId,
          lease_id: 'lease-ar-1',
          credit_type: 'promotional_concession',
          amount_cents: 25000,
          gl_account_id: 'gl-acc-2',
          reason: 'Holiday Move-In Special',
          effective_date: Date.now(),
          created_at: Date.now()
        }
      ],
      refunds: [],
      lateFeeInfo: {
        isDelinquent: true,
        unpaidBalanceCents: 120000,
        proposedLateFeeCents: 5000,
        daysOverdue: 8,
        policySummary: 'Policy: flat_fee ($50.00 after 5 grace days)'
      },
      contacts: [
        { id: 'c-1', first_name: 'Alex', last_name: 'Mercer' }
      ]
    }).value;

    assert.match(arHtml, /Reserved Stall #22/);
    assert.match(arHtml, /\$75\.00/);
    assert.match(arHtml, /Holiday Move-In Special/);
    assert.match(arHtml, /-\$250\.00/);
    assert.match(arHtml, /Late Fee Delinquency Engine/);
    assert.match(arHtml, /\$50\.00/);
  });
});
