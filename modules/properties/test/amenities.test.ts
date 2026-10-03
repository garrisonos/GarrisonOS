import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';
import { generateUUIDv7 } from '../../../core/crypto.js';
import { AmenitiesRepository } from '../backend/amenities.js';
import { generateMarketingFlyerPdf } from '../../../web/lib/pdf.js';

describe('Properties Module - Amenities & Marketing Syndication', () => {
  beforeEach(() => {
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('automatically seeds standard default amenities across 5 categories', () => {
    runInOperatorContext('amenities-test-op', () => {
      AmenitiesRepository.ensureDefaults();
      const all = AmenitiesRepository.listAmenities();

      assert.ok(all.length >= 25, `Expected at least 25 standard amenities, got ${all.length}`);
      const categories = new Set(all.map((a) => a.category));
      assert.ok(categories.has('community'), 'Missing community category');
      assert.ok(categories.has('unit'), 'Missing unit category');
      assert.ok(categories.has('accessibility'), 'Missing accessibility category');
      assert.ok(categories.has('pet'), 'Missing pet category');
      assert.ok(categories.has('eco'), 'Missing eco category');
    });
  });

  it('assigns amenities to property and supports custom amenity creation', () => {
    runInOperatorContext('amenities-test-op', () => {
      const db = getDatabase();
      const propId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'amenities-test-op', 'Solaris Heights', 'multi_family', '100 Sunset', 'Austin', 'TX', '78701', ?, ?)
      `).run(propId, now, now);

      // Create a custom amenity
      const custom = AmenitiesRepository.createAmenity('community', 'Rooftop Pickleball', '🏓', true);
      assert.equal(custom.name, 'Rooftop Pickleball');
      assert.equal(custom.is_custom, 1);

      // Assign amenities
      const pool = AmenitiesRepository.listAmenities('community').find((a) => a.name === 'Swimming Pool')!;
      AmenitiesRepository.setPropertyAmenities(propId, [pool.id, custom.id]);

      const propData = AmenitiesRepository.getPropertyAmenities(propId);
      assert.equal(propData.active.length, 2);
      assert.ok(propData.active.some((a) => a.name === 'Rooftop Pickleball'));
      assert.ok(propData.active.some((a) => a.name === 'Swimming Pool'));
    });
  });

  it('resolves unit amenities inheriting property amenities and allows overrides & exclusions', () => {
    runInOperatorContext('amenities-test-op', () => {
      const db = getDatabase();
      const propId = generateUUIDv7();
      const unitId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'amenities-test-op', 'Grand Plaza', 'multi_family', '500 Main', 'Austin', 'TX', '78701', ?, ?)
      `).run(propId, now, now);

      db.prepare(`
        INSERT INTO units (id, operator_id, property_id, unit_number, status, market_rent_cents, target_deposit_cents, created_at, updated_at)
        VALUES (?, 'amenities-test-op', ?, '101', 'vacant', 200000, 200000, ?, ?)
      `).run(unitId, propId, now, now);

      const pool = AmenitiesRepository.listAmenities('community').find((a) => a.name === 'Swimming Pool')!;
      const gym = AmenitiesRepository.listAmenities('community').find((a) => a.name === 'Fitness Center')!;
      const balcony = AmenitiesRepository.listAmenities('unit').find((a) => a.name.includes('Balcony'))!;

      // Set property amenities
      AmenitiesRepository.setPropertyAmenities(propId, [pool.id, gym.id]);

      // Initially unit inherits both
      let unitData = AmenitiesRepository.getUnitAmenities(unitId, propId);
      assert.equal(unitData.active.length, 2);
      assert.ok(unitData.active.every((a) => a.is_inherited));

      // Unit adds Balcony and excludes Fitness Center
      AmenitiesRepository.setUnitAmenities(unitId, {
        selectedIds: [balcony.id],
        excludedInheritedIds: [gym.id]
      });

      unitData = AmenitiesRepository.getUnitAmenities(unitId, propId);
      assert.equal(unitData.active.length, 2);
      // Pool is inherited, Balcony is unit-specific, Gym is excluded
      assert.ok(unitData.active.some((a) => a.name === 'Swimming Pool' && a.is_inherited));
      assert.ok(unitData.active.some((a) => a.name.includes('Balcony') && !a.is_inherited));
      assert.ok(!unitData.active.some((a) => a.name === 'Fitness Center'));
    });
  });

  it('manages marketing syndication settings and generates vector marketing flyer PDF', () => {
    runInOperatorContext('amenities-test-op', () => {
      const db = getDatabase();
      const propId = generateUUIDv7();
      const now = Date.now();

      db.prepare(`
        INSERT INTO properties (id, operator_id, name, property_type, address_line1, city, state, postal_code, created_at, updated_at)
        VALUES (?, 'amenities-test-op', 'The Skyline Residences', 'multi_family', '400 Congress Ave', 'Austin', 'TX', '78701', ?, ?)
      `).run(propId, now, now);

      const syndication = AmenitiesRepository.upsertMarketingSyndication({
        property_id: propId,
        headline: 'Modern Urban Living with Panoramic Views',
        description: 'Spectacular downtown luxury residence featuring world class finishes.',
        advertised_rent_cents: 285000,
        target_deposit_cents: 285000,
        channels: { website: true, zillow: true, apartments_com: true },
        status: 'active'
      });

      assert.equal(syndication.status, 'active');
      assert.equal(syndication.advertised_rent_cents, 285000);
      assert.equal(syndication.channels?.zillow, true);

      // Verify flyer PDF generation
      const pdfBuffer = generateMarketingFlyerPdf({
        property_name: 'The Skyline Residences',
        property_type: 'multi_family',
        address: '400 Congress Ave, Austin, TX 78701',
        headline: syndication.headline || undefined,
        description: syndication.description || undefined,
        market_rent_cents: syndication.advertised_rent_cents || 285000,
        target_deposit_cents: syndication.target_deposit_cents || 285000,
        bedrooms: 2,
        bathrooms: 2,
        square_feet: 1150,
        amenities: [
          { name: 'Swimming Pool', category: 'community' },
          { name: 'Fitness Center', category: 'community' },
          { name: 'In-Unit Washer/Dryer', category: 'unit' }
        ],
        contact_name: 'Sarah Jenkins (Leasing Director)',
        contact_email: 'leasing@skylineresidences.com',
        contact_phone: '(512) 555-0199'
      });

      assert.ok(Buffer.isBuffer(pdfBuffer));
      assert.ok(pdfBuffer.length > 500, 'Flyer PDF should be non-trivial size');
      assert.ok(pdfBuffer.toString('binary', 0, 8).startsWith('%PDF-1.4'), 'Must be valid PDF 1.4 header');
    });
  });
});
