import * as SQLite from 'expo-sqlite';
import { SQLiteRunResult } from 'expo-sqlite';

/*
  One cache database per account (security #26). Several accounts can be
  remembered on one device now, and a shared file showed the previous
  account's chats after a switch. SessionProvider points this at the
  signed-in account (setSnapshotUser) before any screen reads it.

  The old shared file is deleted the first time a per-account one opens: it's
  only a cache, Chat rebuilds it, and its rows can't be told apart by account.
*/
const LEGACY_DB_NAME = process.env.EXPO_PUBLIC_SQLITE || 'snapshot';

let currentUserId: string | null = null;
let currentDb: SQLite.SQLiteDatabase | null = null;
let legacyRemoved = false;

function dbNameFor(userId: string): string {
  return `${LEGACY_DB_NAME}_${userId.replace(/[^A-Za-z0-9-]/g, '')}`;
}

function ensureTables(db: SQLite.SQLiteDatabase): void {
  db.execSync(
    `CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL UNIQUE,
        snapshot_data TEXT NOT NULL,
        last_message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  );
  db.execSync(
    `CREATE TABLE IF NOT EXISTS snapshot_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        display_name TEXT NOT NULL
    )`
  );
}

/** Called by SessionProvider whenever the signed-in account changes. */
export function setSnapshotUser(userId: string | null): void {
  if (userId === currentUserId) return;
  try {
    currentDb?.closeSync();
  } catch {
    // Already closed.
  }
  currentDb = null;
  currentUserId = userId;
}

function db(): SQLite.SQLiteDatabase {
  if (!currentUserId) {
    throw new Error('No signed-in account for the message cache');
  }
  if (!currentDb) {
    currentDb = SQLite.openDatabaseSync(dbNameFor(currentUserId));
    ensureTables(currentDb);
    if (!legacyRemoved) {
      legacyRemoved = true;
      try {
        SQLite.deleteDatabaseSync(LEGACY_DB_NAME);
      } catch {
        // Not there (fresh install, or already removed).
      }
    }
  }
  return currentDb;
}

/** Delete an account's cache file (account deletion). */
export function deleteSnapshotDatabase(userId: string): void {
  if (!userId) return;
  if (userId === currentUserId) setSnapshotUser(null);
  try {
    SQLite.deleteDatabaseSync(dbNameFor(userId));
  } catch {
    // Never opened on this device.
  }
}

/** Kept for callers; the tables are created when the account's file opens. */
export const createSnapshotTable = async () => {
  try {
    db();
  } catch (error) {
    console.warn('Message cache not ready:', error);
  }
};
export const SnapShot = {

    async saveMessageSnapshot(conversation_id: string, snapshot_data: string, last_message: string): Promise<SQLiteRunResult> {
        return db().runAsync(
            `INSERT INTO snapshots (conversation_id, snapshot_data, last_message) VALUES (?, ?, ?)`,
            [conversation_id, snapshot_data, last_message]
        );
    },
    async deleteSnapshotByConversationId(conversation_id: string): Promise<SQLiteRunResult> {
        return db().runAsync(
            `DELETE FROM snapshots WHERE conversation_id = ?`,
            [conversation_id]
        );
    },

    async saveUsers(user_id: string, display_name: string): Promise<SQLiteRunResult> {
        return db().runAsync(
            `INSERT INTO snapshot_users (user_id, display_name) VALUES (?, ?)`,
            [user_id, display_name]
        );
    },
    async getSnapshotsByConversationId(conversation_id: string): Promise<SQLiteRunResult> {
        return db().runAsync(
            `SELECT * FROM snapshots WHERE conversation_id = ? ORDER BY created_at DESC`,
            [conversation_id]
        );
    },

    async getUsers(): Promise<any[]> {
        return await db().getAllAsync(
            `SELECT * FROM snapshot_users`
        );
    },
    
    async getMessagesSnapshot(): Promise<any[]> {
        return await db().getAllAsync(
            `SELECT * FROM snapshots ORDER BY created_at DESC`
        );
    },

    async addUser(user_id: string, display_name: string): Promise<SQLiteRunResult> {
        return db().runAsync(
            `INSERT INTO snapshot_users (user_id, display_name) VALUES (?, ?)`,
            [user_id, display_name]
        );
    },
}