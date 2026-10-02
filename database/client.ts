import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as fs from 'node:fs';

let globalDb: DatabaseSync | null = null;
let currentDbPath: string = '';

export interface DatabaseOptions {
  path?: string;
  inMemory?: boolean;
}

/**
 * Configure and initialize SQLite DatabaseSync instance with production pragmas.
 */
export function getDatabase(options: DatabaseOptions = {}): DatabaseSync {
  if (globalDb && options.inMemory === undefined && options.path === undefined) {
    return globalDb;
  }

  const dbPath = options.inMemory
    ? ':memory:'
    : options.path || process.env['SQLITE_PATH'] || './garrison.sqlite';

  if (globalDb && currentDbPath === dbPath) {
    return globalDb;
  }

  if (globalDb && currentDbPath !== dbPath) {
    closeDatabase();
  }

  if (dbPath !== ':memory:') {
    const fullPath = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    globalDb = new DatabaseSync(fullPath);
  } else {
    globalDb = new DatabaseSync(':memory:');
  }

  currentDbPath = dbPath;

  // Apply performance and safety pragmas
  globalDb.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  if (dbPath !== ':memory:') {
    globalDb.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `);
  }

  return globalDb;
}

/**
 * Close active database connection.
 */
export function closeDatabase(): void {
  if (globalDb) {
    try {
      globalDb.close();
    } catch {
      // Ignore close errors if already closed
    }
    globalDb = null;
    currentDbPath = '';
    transactionDepth = 0;
  }
}

let transactionDepth = 0;

/**
 * Execute operations within an atomic transaction.
 * Automatically commits on success and rolls back on exception.
 * Supports re-entrant/nested transactions via SQLite SAVEPOINT.
 */
export function withTransaction<T>(
  fn: (db: DatabaseSync) => T,
  dbInstance?: DatabaseSync
): T {
  const db = dbInstance || getDatabase();
  const isTopLevel = transactionDepth === 0;
  const savepointName = `sp_${transactionDepth}`;

  if (isTopLevel) {
    db.exec('BEGIN IMMEDIATE;');
  } else {
    db.exec(`SAVEPOINT ${savepointName};`);
  }
  transactionDepth++;

  try {
    const result = fn(db);
    transactionDepth--;
    if (isTopLevel) {
      db.exec('COMMIT;');
    } else {
      db.exec(`RELEASE SAVEPOINT ${savepointName};`);
    }
    return result;
  } catch (error) {
    transactionDepth--;
    try {
      if (isTopLevel) {
        db.exec('ROLLBACK;');
      } else {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
        db.exec(`RELEASE SAVEPOINT ${savepointName};`);
      }
    } catch {
      // Ignore rollback errors if already rolled back
    }
    throw error;
  }
}
