/**
 * Automated Test Suite for GarrisonOS Multi-Edition Management & Module Licensing
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as crypto from 'node:crypto';
import {
  getRuntimeEdition,
  isCommunityEdition,
  isStandardEdition,
  isEnterpriseEdition,
  assertModuleLicensing,
  getEditionsManifest,
  LicenseViolationError,
  OFFICIAL_COMMUNITY_MODULES,
  signModuleManifest,
  verifyModuleManifestSignature,
  getCanonicalManifestPayload,
  assertPluginLicensing,
  signPluginManifest,
  verifyPluginManifestSignature,
  PluginManifest
} from '../core/edition.js';

describe('GarrisonOS Multi-Edition Subsystem', () => {
  const originalEnv = process.env.GARRISON_EDITION;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GARRISON_EDITION = originalEnv;
    } else {
      delete process.env.GARRISON_EDITION;
    }
  });

  describe('Runtime Edition Resolution', () => {
    it('defaults to standard edition when environment variable is unset', () => {
      delete process.env.GARRISON_EDITION;
      assert.strictEqual(getRuntimeEdition(), 'standard');
      assert.strictEqual(isStandardEdition(), true);
      assert.strictEqual(isCommunityEdition(), false);
      assert.strictEqual(isEnterpriseEdition(), false);
    });

    it('resolves community edition when GARRISON_EDITION=community', () => {
      process.env.GARRISON_EDITION = 'community';
      assert.strictEqual(getRuntimeEdition(), 'community');
      assert.strictEqual(isCommunityEdition(), true);
      assert.strictEqual(isStandardEdition(), false);
    });

    it('resolves enterprise edition when GARRISON_EDITION=enterprise', () => {
      process.env.GARRISON_EDITION = 'enterprise';
      assert.strictEqual(getRuntimeEdition(), 'enterprise');
      assert.strictEqual(isEnterpriseEdition(), true);
      assert.strictEqual(isStandardEdition(), false);
    });

    it('handles uppercase and trimmed values safely', () => {
      process.env.GARRISON_EDITION = '  COMMUNITY  ';
      assert.strictEqual(getRuntimeEdition(), 'community');
      assert.strictEqual(isCommunityEdition(), true);
    });

    it('falls back to standard on invalid edition name', () => {
      process.env.GARRISON_EDITION = 'unknown_edition';
      assert.strictEqual(getRuntimeEdition(), 'standard');
    });
  });

  describe('Editions Manifest Loading', () => {
    it('successfully loads and parses editions.json from the project root', () => {
      const manifest = getEditionsManifest();
      assert.ok(manifest, 'editions.json should be present');
      assert.ok(manifest.editions, 'manifest should have editions');
      assert.ok(manifest.editions.community, 'should define community edition');
      assert.ok(manifest.editions.standard, 'should define standard edition');
      assert.ok(manifest.editions.enterprise, 'should define enterprise edition');
      assert.strictEqual(manifest.editions.community.license, 'AGPL-3.0-or-later');
      assert.strictEqual(manifest.editions.standard.license, 'GarrisonOS-Fair-Code-1.0');
      assert.strictEqual(manifest.editions.standard.unitLimit, 50);
      assert.strictEqual(manifest.editions.standard.graceLimit, 60);
    });
  });

  describe('Module Licensing Assertion & Fail-Closed Guard', () => {
    it('permits community modules in Community Edition', () => {
      process.env.GARRISON_EDITION = 'community';
      const communityModule = {
        id: 'properties',
        name: 'Properties & Portfolios',
        edition: 'community',
        license: 'AGPL-3.0-or-later'
      };

      assert.doesNotThrow(() => {
        assertModuleLicensing(communityModule);
      });
    });

    it('strictly blocks commercial modules in Community Edition with LicenseViolationError', () => {
      process.env.GARRISON_EDITION = 'community';
      const commercialModule = {
        id: 'advanced_accounting',
        name: 'Enterprise Trust Compliance',
        edition: 'commercial',
        license: 'GarrisonOS-Fair-Code-1.0'
      };

      assert.throws(
        () => {
          assertModuleLicensing(commercialModule);
        },
        (err: any) => {
          assert.ok(err instanceof LicenseViolationError);
          assert.strictEqual(err.code, 'LICENSE_VIOLATION');
          assert.strictEqual(err.status, 403);
          assert.ok(err.message.includes('cannot be loaded in Community Edition'));
          return true;
        }
      );
    });

    it('strictly blocks standard edition modules in Community Edition', () => {
      process.env.GARRISON_EDITION = 'community';
      const standardModule = {
        id: 'standard_feature',
        name: 'Standard Feature Module',
        edition: 'standard',
        license: 'GarrisonOS-Fair-Code-1.0'
      };

      assert.throws(
        () => {
          assertModuleLicensing(standardModule);
        },
        (err: any) => {
          assert.ok(err instanceof LicenseViolationError);
          assert.strictEqual(err.code, 'LICENSE_VIOLATION');
          assert.strictEqual(err.status, 403);
          assert.ok(err.message.includes('cannot be loaded in Community Edition'));
          return true;
        }
      );
    });

    it('strictly blocks enterprise modules in Community Edition', () => {
      process.env.GARRISON_EDITION = 'community';
      const enterpriseModule = {
        id: 'bank_direct_ach',
        name: 'Direct ACH Sweeps',
        edition: 'enterprise',
        license: 'GarrisonOS-Enterprise-1.0'
      };

      assert.throws(
        () => {
          assertModuleLicensing(enterpriseModule);
        },
        (err: any) => {
          assert.ok(err instanceof LicenseViolationError);
          return true;
        }
      );
    });

    it('permits all module types in Standard and Enterprise Editions', () => {
      process.env.GARRISON_EDITION = 'standard';
      const commercialModule = {
        id: 'advanced_accounting',
        name: 'Enterprise Trust Compliance',
        edition: 'commercial',
        license: 'GarrisonOS-Fair-Code-1.0'
      };

      assert.doesNotThrow(() => {
        assertModuleLicensing(commercialModule);
      });

      process.env.GARRISON_EDITION = 'enterprise';
      assert.doesNotThrow(() => {
        assertModuleLicensing(commercialModule);
      });
    });
  });

  describe('Compiled Whitelist and Ed25519 Manifest Signature Verification', () => {
    // Generate an ephemeral Ed25519 keypair for cryptographic testing
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const testPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    it('contains all 8 official core community modules in the compiled whitelist', () => {
      assert.strictEqual(OFFICIAL_COMMUNITY_MODULES.size, 8);
      assert.ok(OFFICIAL_COMMUNITY_MODULES.has('properties'));
      assert.ok(OFFICIAL_COMMUNITY_MODULES.has('contacts'));
      assert.ok(OFFICIAL_COMMUNITY_MODULES.has('leases'));
      assert.ok(OFFICIAL_COMMUNITY_MODULES.has('attachments'));
      assert.ok(OFFICIAL_COMMUNITY_MODULES.has('accounting'));
      assert.ok(OFFICIAL_COMMUNITY_MODULES.has('maintenance'));
      assert.ok(OFFICIAL_COMMUNITY_MODULES.has('conversations'));
      assert.ok(OFFICIAL_COMMUNITY_MODULES.has('backup'));
    });

    it('permits whitelisted community modules to load in Community Edition without signatures', () => {
      process.env.GARRISON_EDITION = 'community';
      const whitelistedModule = {
        id: 'properties',
        name: 'Properties & Portfolios',
        edition: 'community',
        license: 'AGPL-3.0-or-later',
        version: '0.1.0'
      };

      assert.doesNotThrow(() => {
        assertModuleLicensing(whitelistedModule);
      });
    });

    it('strictly rejects unauthorized un-whitelisted modules claiming Community Edition without a signature', () => {
      process.env.GARRISON_EDITION = 'community';
      const unauthorizedModule = {
        id: 'unauthorized_module',
        name: 'Rogue Commercial Addon',
        edition: 'community',
        license: 'AGPL-3.0-or-later',
        version: '0.1.0'
      };

      assert.throws(
        () => {
          assertModuleLicensing(unauthorizedModule);
        },
        (err: any) => {
          assert.ok(err instanceof LicenseViolationError);
          assert.ok(err.message.includes('not an approved community module and lacks a valid vendor cryptographic signature'));
          return true;
        }
      );
    });

    it('allows an un-whitelisted community module if verified by a valid vendor Ed25519 signature', () => {
      process.env.GARRISON_EDITION = 'community';
      const externalCommunityModule = {
        id: 'certified_community_addon',
        name: 'Certified Community Addon',
        edition: 'community',
        license: 'AGPL-3.0-or-later',
        version: '1.0.0'
      };

      const signature = signModuleManifest(externalCommunityModule, privateKey);
      const signedModule = {
        ...externalCommunityModule,
        signature
      };

      assert.doesNotThrow(() => {
        assertModuleLicensing(signedModule, testPublicKeyPem);
      });
    });

    it('permits a signed commercial module in Standard Edition when signature is valid', () => {
      process.env.GARRISON_EDITION = 'standard';
      const commercialModule = {
        id: 'accounting_compliance',
        name: 'Enterprise Trust Compliance',
        edition: 'commercial',
        license: 'GarrisonOS-Fair-Code-1.0',
        version: '1.0.0'
      };

      const signature = signModuleManifest(commercialModule, privateKey);
      const signedModule = {
        ...commercialModule,
        signature
      };

      assert.doesNotThrow(() => {
        assertModuleLicensing(signedModule, testPublicKeyPem);
      });
    });

    it('detects tampering when someone alters edition from commercial to community with original signature', () => {
      process.env.GARRISON_EDITION = 'standard';
      const commercialModule = {
        id: 'accounting_compliance',
        name: 'Enterprise Trust Compliance',
        edition: 'commercial',
        license: 'GarrisonOS-Fair-Code-1.0',
        version: '1.0.0'
      };

      // Sign the official commercial manifest
      const signature = signModuleManifest(commercialModule, privateKey);

      // Attacker attempts to change "edition" to "community" while keeping the signature
      const tamperedModule = {
        ...commercialModule,
        edition: 'community',
        signature
      };

      assert.throws(
        () => {
          assertModuleLicensing(tamperedModule, testPublicKeyPem);
        },
        (err: any) => {
          assert.ok(err instanceof LicenseViolationError);
          assert.ok(err.message.includes('manifest signature is invalid or tampered'));
          return true;
        }
      );
    });

    it('detects tampering when someone alters the license string with original signature', () => {
      process.env.GARRISON_EDITION = 'standard';
      const commercialModule = {
        id: 'accounting_compliance',
        name: 'Enterprise Trust Compliance',
        edition: 'commercial',
        license: 'GarrisonOS-Fair-Code-1.0',
        version: '1.0.0'
      };

      const signature = signModuleManifest(commercialModule, privateKey);

      // Attacker alters license string
      const tamperedModule = {
        ...commercialModule,
        license: 'AGPL-3.0-or-later',
        signature
      };

      assert.throws(
        () => {
          assertModuleLicensing(tamperedModule, testPublicKeyPem);
        },
        (err: any) => {
          assert.ok(err instanceof LicenseViolationError);
          assert.ok(err.message.includes('manifest signature is invalid or tampered'));
          return true;
        }
      );
    });
  });

  describe('Plugin Licensing, Community Warnings & Enterprise Extensibility', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const testPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    it('permits unverified plugins in Community Edition WITH A BIG FAT WARNING banner', () => {
      process.env.GARRISON_EDITION = 'community';
      const unverifiedPlugin: PluginManifest = {
        id: 'plugin_zigbee_locks',
        name: 'Zigbee Smart Locks',
        version: '1.2.0',
        license: 'MIT'
      };

      const result = assertPluginLicensing(unverifiedPlugin, testPublicKeyPem);
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.verified, false);
      assert.ok(result.warning !== undefined);
      assert.ok(result.warning.includes('UNVERIFIED THIRD-PARTY PLUGIN DETECTED'));
      assert.ok(result.warning.includes('Zigbee Smart Locks'));
    });

    it('permits verified plugins in Community Edition without warning', () => {
      process.env.GARRISON_EDITION = 'community';
      const verifiedPlugin: PluginManifest = {
        id: 'plugin_certified_telephony',
        name: 'Certified Telephony Hub',
        version: '1.0.0',
        license: 'AGPL-3.0-or-later'
      };

      const signature = signPluginManifest(verifiedPlugin, privateKey);
      const signedPlugin: PluginManifest = {
        ...verifiedPlugin,
        signature
      };

      const result = assertPluginLicensing(signedPlugin, testPublicKeyPem);
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.warning, undefined);
    });

    it('strictly prohibits unverified plugins in Standard Edition (fails closed)', () => {
      process.env.GARRISON_EDITION = 'standard';
      const unverifiedPlugin: PluginManifest = {
        id: 'plugin_unverified_syndication',
        name: 'Unverified Syndication Scraper',
        version: '0.9.0',
        license: 'MIT'
      };

      assert.throws(
        () => {
          assertPluginLicensing(unverifiedPlugin, testPublicKeyPem);
        },
        (err: any) => {
          assert.ok(err instanceof LicenseViolationError);
          assert.ok(err.message.includes('Standard Edition requires all plugins to be cryptographically verified'));
          return true;
        }
      );
    });

    it('permits verified plugins in Standard Edition with valid vendor signature', () => {
      process.env.GARRISON_EDITION = 'standard';
      const commercialPlugin: PluginManifest = {
        id: 'plugin_zillow_syndication',
        name: 'Zillow Rental Network Syndication',
        version: '2.0.0',
        license: 'GarrisonOS-Fair-Code-1.0'
      };

      const signature = signPluginManifest(commercialPlugin, privateKey);
      const signedPlugin: PluginManifest = {
        ...commercialPlugin,
        signature
      };

      const result = assertPluginLicensing(signedPlugin, testPublicKeyPem);
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.verified, true);
    });

    it('permits custom in-house plugins in Enterprise Edition as a tailorable solution', () => {
      process.env.GARRISON_EDITION = 'enterprise';
      const customEnterprisePlugin: PluginManifest = {
        id: 'plugin_inhouse_sap_sync',
        name: 'Bespoke In-House SAP ERP Adapter',
        version: '1.0.0',
        license: 'Proprietary'
      };

      const result = assertPluginLicensing(customEnterprisePlugin, testPublicKeyPem);
      assert.strictEqual(result.allowed, true);
      assert.ok(result.warning && result.warning.includes('Loaded custom in-house plugin'));
    });

    it('permits custom in-house domain modules in Enterprise Edition aside from core', () => {
      process.env.GARRISON_EDITION = 'enterprise';
      const customEnterpriseModule = {
        id: 'bespoke_commercial_leases',
        name: 'Bespoke Commercial Lease Engine',
        version: '1.0.0',
        license: 'Proprietary-InHouse'
      };

      assert.doesNotThrow(() => {
        assertModuleLicensing(customEnterpriseModule, testPublicKeyPem);
      });
    });
  });
});


