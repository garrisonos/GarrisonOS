import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createTestDb, runInOperatorContext } from '../../../test/helpers.js';
import { PropertiesRepository } from '../backend/repository.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';

describe('Properties Module - Amenities Catalog, Junctions & Syndication Profiles', () => {
  before(() => {
    getDatabase({ inMemory: true });
    createTestDb();
  });

  after(() => {
    closeDatabase();
  });

  it('manages amenities catalog CRUD and prevents duplicate names per operator', () => {
    runInOperatorContext('op-amenities-1', () => {
      // 1. Create amenities across categories
      const pool = PropertiesRepository.createAmenity({
        name: 'Resort Swimming Pool',
        category: 'community',
        description: 'Heated Olympic size pool with cabanas'
      });
      assert.ok(pool.id);
      assert.equal(pool.name, 'Resort Swimming Pool');
      assert.equal(pool.category, 'community');

      const balcony = PropertiesRepository.createAmenity({
        name: 'Private Balcony',
        category: 'unit',
        description: 'Spacious balcony with courtyard view'
      });
      assert.ok(balcony.id);
      assert.equal(balcony.category, 'unit');

      const ramp = PropertiesRepository.createAmenity({
        name: 'Wheelchair Ramp',
        category: 'accessibility'
      });
      assert.ok(ramp.id);

      const dogPark = PropertiesRepository.createAmenity({
        name: 'Enclosed Dog Run',
        category: 'pet',
        description: 'Fenced dog park with agility equipment'
      });
      assert.ok(dogPark.id);

      const solar = PropertiesRepository.createAmenity({
        name: 'Rooftop Solar Array',
        category: 'eco',
        description: 'Community solar energy integration'
      });
      assert.ok(solar.id);

      // 2. Reject invalid category
      assert.throws(() => {
        PropertiesRepository.createAmenity({
          name: 'Invalid Item',
          category: 'invalid_category' as any
        });
      }, /Invalid category/);

      // 3. Prevent duplicate amenity name within same operator
      assert.throws(() => {
        PropertiesRepository.createAmenity({
          name: 'Resort Swimming Pool',
          category: 'community'
        });
      }, (err: any) => {
        assert.equal(err.code, 'CONFLICT');
        return true;
      });

      // 4. List amenities with category filtering
      const communityAmenities = PropertiesRepository.listAmenities({ category: 'community' });
      assert.equal(communityAmenities.length, 1);
      assert.equal(communityAmenities[0]!.name, 'Resort Swimming Pool');

      const petAmenities = PropertiesRepository.listAmenities({ category: 'pet' });
      assert.equal(petAmenities.length, 1);
      assert.equal(petAmenities[0]!.name, 'Enclosed Dog Run');

      // 5. Update amenity
      const updatedPool = PropertiesRepository.updateAmenity(pool.id, {
        name: 'Olympic Resort Swimming Pool',
        description: 'Updated heated pool description'
      });
      assert.ok(updatedPool);
      assert.equal(updatedPool?.name, 'Olympic Resort Swimming Pool');
      assert.equal(updatedPool?.description, 'Updated heated pool description');

      // 6. Delete amenity
      const deleted = PropertiesRepository.deleteAmenity(solar.id);
      assert.equal(deleted, true);
      const afterDelete = PropertiesRepository.getAmenityById(solar.id);
      assert.equal(afterDelete, null);
    });
  });

  it('enforces multi-operator isolation for amenities with same name', () => {
    runInOperatorContext('op-amenities-1', () => {
      const a1 = PropertiesRepository.createAmenity({
        name: 'Shared Gym',
        category: 'community'
      });
      assert.ok(a1.id);
    });

    runInOperatorContext('op-amenities-2', () => {
      // Allowed for different operator without conflict
      const a2 = PropertiesRepository.createAmenity({
        name: 'Shared Gym',
        category: 'community'
      });
      assert.ok(a2.id);

      const list = PropertiesRepository.listAmenities();
      assert.equal(list.length, 1);
      assert.equal(list[0]!.id, a2.id);
    });
  });

  it('manages property amenities junction', () => {
    runInOperatorContext('op-amenities-junction', () => {
      const prop = PropertiesRepository.createProperty({
        name: 'Highland Park Lofts',
        property_type: 'multi_family',
        address_line1: '500 Highland Ave',
        city: 'Atlanta',
        state: 'GA',
        postal_code: '30306'
      });

      const a1 = PropertiesRepository.createAmenity({ name: 'Clubhouse', category: 'community' });
      const a2 = PropertiesRepository.createAmenity({ name: 'EV Charging', category: 'eco' });
      const a3 = PropertiesRepository.createAmenity({ name: 'Pet Spa', category: 'pet' });

      // Associate a1 and a2
      const setRes = PropertiesRepository.setPropertyAmenities(prop.id, [a1.id, a2.id]);
      assert.equal(setRes.length, 2);

      const fetched = PropertiesRepository.getPropertyAmenities(prop.id);
      assert.equal(fetched.length, 2);
      const names = fetched.map((a) => a.name).sort();
      assert.deepEqual(names, ['Clubhouse', 'EV Charging']);

      // Overwrite with a3
      const updatedJunction = PropertiesRepository.setPropertyAmenities(prop.id, [a3.id]);
      assert.equal(updatedJunction.length, 1);
      assert.equal(updatedJunction[0]!.name, 'Pet Spa');

      // Clear all
      const cleared = PropertiesRepository.setPropertyAmenities(prop.id, []);
      assert.equal(cleared.length, 0);
      assert.equal(PropertiesRepository.getPropertyAmenities(prop.id).length, 0);
    });
  });

  it('manages unit amenities junction', () => {
    runInOperatorContext('op-amenities-junction', () => {
      const prop = PropertiesRepository.createProperty({
        name: 'Oakwood Apartments',
        property_type: 'multi_family',
        address_line1: '123 Oak St',
        city: 'Austin',
        state: 'TX',
        postal_code: '78701'
      });

      const unit = PropertiesRepository.createUnit({
        property_id: prop.id,
        unit_number: '101',
        market_rent_cents: 180000
      });

      const u1 = PropertiesRepository.createAmenity({ name: 'In-Unit Washer/Dryer', category: 'unit' });
      const u2 = PropertiesRepository.createAmenity({ name: 'Stainless Appliances', category: 'unit' });

      const setRes = PropertiesRepository.setUnitAmenities(unit.id, [u1.id, u2.id]);
      assert.equal(setRes.length, 2);

      const fetched = PropertiesRepository.getUnitAmenities(unit.id);
      assert.equal(fetched.length, 2);
      const names = fetched.map((a) => a.name).sort();
      assert.deepEqual(names, ['In-Unit Washer/Dryer', 'Stainless Appliances']);
    });
  });

  it('persists and retrieves syndication profiles on properties and units', () => {
    runInOperatorContext('op-syndication', () => {
      // 1. Create property with syndication fields
      const prop = PropertiesRepository.createProperty({
        name: 'Skyline Luxury Towers',
        property_type: 'multi_family',
        address_line1: '1000 Skyline Dr',
        city: 'Seattle',
        state: 'WA',
        postal_code: '98101',
        published_for_rent: 1,
        posting_title: 'Downtown Seattle Luxury Apartments',
        marketing_description: 'Modern high-rise with breathtaking Puget Sound views.',
        pet_policy: 'Dogs and cats welcome up to 50 lbs with deposit.',
        specials: 'One month free rent on 13-month lease.'
      });

      assert.equal(prop.published_for_rent, 1);
      assert.equal(prop.posting_title, 'Downtown Seattle Luxury Apartments');
      assert.equal(prop.marketing_description, 'Modern high-rise with breathtaking Puget Sound views.');
      assert.equal(prop.pet_policy, 'Dogs and cats welcome up to 50 lbs with deposit.');
      assert.equal(prop.specials, 'One month free rent on 13-month lease.');

      // 2. Update syndication fields
      const updatedProp = PropertiesRepository.updateProperty(prop.id, {
        published_for_rent: 0,
        specials: 'Limited time $500 look and lease concession.'
      });
      assert.equal(updatedProp?.published_for_rent, 0);
      assert.equal(updatedProp?.specials, 'Limited time $500 look and lease concession.');
      assert.equal(updatedProp?.posting_title, 'Downtown Seattle Luxury Apartments');

      // 3. Create unit with syndication fields
      const unit = PropertiesRepository.createUnit({
        property_id: prop.id,
        unit_number: 'Penthouse 1',
        market_rent_cents: 450000,
        published_for_rent: 1,
        posting_title: 'Top-Floor Penthouse with Private Terrace',
        marketing_description: 'Expansive 2-bedroom penthouse with floor-to-ceiling glass.',
        pet_policy: 'Pets negotiable.',
        specials: 'Reserved garage parking included.'
      });

      assert.equal(unit.published_for_rent, 1);
      assert.equal(unit.posting_title, 'Top-Floor Penthouse with Private Terrace');
      assert.equal(unit.marketing_description, 'Expansive 2-bedroom penthouse with floor-to-ceiling glass.');
      assert.equal(unit.specials, 'Reserved garage parking included.');

      // 4. Update unit syndication fields
      const updatedUnit = PropertiesRepository.updateUnit(unit.id, {
        published_for_rent: 0,
        specials: null
      });
      assert.equal(updatedUnit?.published_for_rent, 0);
      assert.equal(updatedUnit?.specials, null);
    });
  });

  it('filters amenities by temporal intervals and sorts with order_by', () => {
    runInOperatorContext('op-temporal-amenities', () => {
      const a = PropertiesRepository.createAmenity({ name: 'Alpha Room', category: 'community' });
      const b = PropertiesRepository.createAmenity({ name: 'Beta Lounge', category: 'community' });
      const c = PropertiesRepository.createAmenity({ name: 'Gamma Terrace', category: 'community' });

      // Sort ascending
      const asc = PropertiesRepository.listAmenities({ orderBy: 'name ASC' });
      assert.deepEqual(asc.map((x) => x.name), ['Alpha Room', 'Beta Lounge', 'Gamma Terrace']);

      // Sort descending
      const desc = PropertiesRepository.listAmenities({ orderBy: 'name DESC' });
      assert.deepEqual(desc.map((x) => x.name), ['Gamma Terrace', 'Beta Lounge', 'Alpha Room']);

      // Temporal filtering
      const filtered = PropertiesRepository.listAmenities({
        temporal: { created_at_start: a.created_at - 1000, created_at_end: c.created_at + 1000 }
      });
      assert.equal(filtered.length, 3);
    });
  });
});
