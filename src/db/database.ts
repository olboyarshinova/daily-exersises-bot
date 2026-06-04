import sqlite3 from 'sqlite3';

sqlite3.verbose();

export const db = new sqlite3.Database('my-database.db');

export async function initializeDatabase(): Promise<void> {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId INTEGER UNIQUE,
      username TEXT,
      firstName TEXT,
      lastName TEXT,
      notificationTime TEXT DEFAULT '08:00',
      isActive BOOLEAN DEFAULT 1
    )
  `);

  await addColumnIfMissing(
    'users',
    'isActive',
    'ALTER TABLE users ADD COLUMN isActive BOOLEAN DEFAULT 1',
  );

  await run('UPDATE users SET isActive = 1 WHERE isActive IS NULL');

  await run(`
    CREATE TABLE IF NOT EXISTS sent_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chatId INTEGER,
      date TEXT,
      UNIQUE(chatId, date) ON CONFLICT REPLACE
    )
  `);
}

export function get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row as T | undefined);
      }
    });
  });
}

export function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve((rows ?? []) as T[]);
      }
    });
  });
}

export function run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ changes: this.changes });
      }
    });
  });
}

export function closeDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function addColumnIfMissing(table: string, column: string, sql: string): Promise<void> {
  const columns = await all<{ name: string }>(`PRAGMA table_info(${table})`);

  if (!columns.some((item) => item.name === column)) {
    await run(sql);
  }
}
