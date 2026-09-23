import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { runInOperatorContext, ensureOperator } from '../../../test/helpers.js';
import { BackupService } from '../backend/service.js';
import { closeDatabase, getDatabase } from '../../../database/client.js';
import { runMigrations } from '../../../database/migrator.js';
import { unpackTar } from '../backend/tar.js';

describe('Media Backup Integration & Full System Restore', () => {
  const testTenant = 'tenant-media-backup-test';
  const testBaseDir = path.resolve('./storage/test-media-storage');
  const testStorageDir = path.resolve('./storage/test-media-storage/attachments');
  const originalStoragePath = process.env['STORAGE_PATH'];
  const testSqlitePath = path.resolve('./storage/test-media-storage/db/test-db.sqlite');
  const originalSqlitePath = process.env['SQLITE_PATH'];

  before(() => {
    closeDatabase();
    if (fs.existsSync(testSqlitePath)) {
      try {
        fs.unlinkSync(testSqlitePath);
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    fs.mkdirSync(testStorageDir, { recursive: true });
    fs.mkdirSync(path.dirname(testSqlitePath), { recursive: true });
    process.env['STORAGE_PATH'] = testStorageDir;
    process.env['SQLITE_PATH'] = testSqlitePath;

    const db = getDatabase({ path: testSqlitePath });
    runMigrations(db);
    ensureOperator(testTenant, db);
    db.prepare('DELETE FROM users WHERE operator_id = ?').run(testTenant);
  });

  after(() => {
    closeDatabase();
    if (originalStoragePath !== undefined) {
      process.env['STORAGE_PATH'] = originalStoragePath;
    } else {
      delete process.env['STORAGE_PATH'];
    }

    if (originalSqlitePath !== undefined) {
      process.env['SQLITE_PATH'] = originalSqlitePath;
    } else {
      delete process.env['SQLITE_PATH'];
    }

    if (fs.existsSync(testBaseDir)) {
      try {
        fs.rmSync(testBaseDir, { recursive: true, force: true });
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  });

  it('creates full system backup bundling SQLite snapshot and physical attachments into .tar.gz', async () => {
    await runInOperatorContext(testTenant, async () => {
      // 1. Create dummy attachment files under STORAGE_PATH
      const attachmentsDir = path.join(testStorageDir, testTenant);
      fs.mkdirSync(attachmentsDir, { recursive: true });
      const photoPath = path.join(attachmentsDir, 'photo.jpg');
      const docPath = path.join(attachmentsDir, 'lease.pdf');

      fs.writeFileSync(photoPath, Buffer.from('photo-file-content-12345'));
      fs.writeFileSync(docPath, Buffer.from('pdf-document-content-67890'));

      // 2. Insert test user in database
      const db = getDatabase();
      const now = Date.now();
      db.prepare(`
        INSERT INTO users (id, operator_id, email, password_hash, first_name, last_name, role, created_at, updated_at)
        VALUES ('user-media-1', ?, 'media@test.com', 'hash', 'Media', 'Tester', 'manager', ?, ?)
        ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at
      `).run(testTenant, now, now);

      // 3. Create full database backup
      const backup = await BackupService.createFullDatabaseBackup();
      assert.ok(backup.id);
      assert.equal(backup.status, 'completed');
      assert.ok(backup.filename.endsWith('.tar.gz'));
      assert.ok(backup.file_size_bytes > 0);
      assert.ok(backup.checksum_sha256.length === 64);

      // Verify metadata records attachments count
      const meta = JSON.parse(backup.metadata_json || '{}');
      assert.equal(meta.includes_media, true);
      assert.equal(meta.attachments_count, 2);

      // 4. Verify integrity
      const verification = await BackupService.verifyBackupIntegrity(backup.id);
      assert.equal(verification.valid, true);

      // 5. Inspect archive contents using unpackTar
      const archivePath = BackupService.resolveSafeBackupPath(backup.relative_path);
      const compressedData = fs.readFileSync(archivePath);
      const tarData = zlib.gunzipSync(compressedData);
      const entries = unpackTar(tarData);

      const dbEntry = entries.find((e) => e.name === 'database.sqlite');
      assert.ok(dbEntry, 'Archive must contain database.sqlite');
      assert.ok(dbEntry.data.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')));

      const photoEntry = entries.find((e) => e.name === `attachments/${testTenant}/photo.jpg`);
      assert.ok(photoEntry, 'Archive must contain attachments photo entry');
      assert.equal(photoEntry.data.toString(), 'photo-file-content-12345');

      const docEntry = entries.find((e) => e.name === `attachments/${testTenant}/lease.pdf`);
      assert.ok(docEntry, 'Archive must contain attachments doc entry');
      assert.equal(docEntry.data.toString(), 'pdf-document-content-67890');
    });
  });

  it('restores full system database and physical media attachments from .tar.gz snapshot', async () => {
    await runInOperatorContext(testTenant, async () => {
      // 1. Create a backup
      const backup = await BackupService.createFullDatabaseBackup();
      const archivePath = BackupService.resolveSafeBackupPath(backup.relative_path);

      // 2. Wipe physical attachments and mutate database
      const attachmentsDir = path.join(testStorageDir, testTenant);
      if (fs.existsSync(attachmentsDir)) {
        fs.rmSync(attachmentsDir, { recursive: true, force: true });
      }
      assert.equal(fs.existsSync(path.join(attachmentsDir, 'photo.jpg')), false);

      const db = getDatabase();
      db.prepare("DELETE FROM users WHERE id = 'user-media-1'").run();

      // 3. Restore from full backup
      await BackupService.restoreFullDatabase(archivePath);

      // 4. Verify database restored
      const restoredDb = getDatabase();
      const restoredUser = restoredDb.prepare("SELECT * FROM users WHERE id = 'user-media-1'").get() as any;
      assert.ok(restoredUser);
      assert.equal(restoredUser.email, 'media@test.com');

      // 5. Verify physical media attachments restored
      const restoredPhotoPath = path.join(attachmentsDir, 'photo.jpg');
      assert.ok(fs.existsSync(restoredPhotoPath));
      assert.equal(fs.readFileSync(restoredPhotoPath).toString(), 'photo-file-content-12345');

      const restoredDocPath = path.join(attachmentsDir, 'lease.pdf');
      assert.ok(fs.existsSync(restoredDocPath));
      assert.equal(fs.readFileSync(restoredDocPath).toString(), 'pdf-document-content-67890');
    });
  });
});
