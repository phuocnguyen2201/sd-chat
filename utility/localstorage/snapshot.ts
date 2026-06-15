import * as SQLite from 'expo-sqlite';
import { SQLiteRunResult } from 'expo-sqlite';

export const snapshotDB = SQLite.openDatabaseSync(process.env.EXPO_PUBLIC_SQLITE || 'snapshot');

export const createSnapshotTable = async () => {
    try {

      await snapshotDB.execAsync(
        `CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL UNIQUE,
            snapshot_data TEXT NOT NULL,
            last_message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
        );
        await snapshotDB.execAsync(
            `CREATE TABLE IF NOT EXISTS snapshot_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                display_name TEXT NOT NULL
            )`
        );
    } catch (error) {
        console.error('Error creating snapshot tables:', error);
    }
};
export const SnapShot = {

    async saveMessageSnapshot(conversation_id: string, snapshot_data: string, last_message: string): Promise<SQLiteRunResult> {
        return snapshotDB.runAsync(
            `INSERT INTO snapshots (conversation_id, snapshot_data, last_message) VALUES (?, ?, ?)`,
            [conversation_id, snapshot_data, last_message]
        );
    },
    async deleteSnapshotByConversationId(conversation_id: string): Promise<SQLiteRunResult> {
        return snapshotDB.runAsync(
            `DELETE FROM snapshots WHERE conversation_id = ?`,
            [conversation_id]
        );
    },

    async saveUsers(user_id: string, display_name: string): Promise<SQLiteRunResult> {
        return snapshotDB.runAsync(
            `INSERT INTO snapshot_users (user_id, display_name) VALUES (?, ?)`,
            [user_id, display_name]
        );
    },
    async getSnapshotsByConversationId(conversation_id: string): Promise<SQLiteRunResult> {
        return snapshotDB.runAsync(
            `SELECT * FROM snapshots WHERE conversation_id = ? ORDER BY created_at DESC`,
            [conversation_id]
        );
    },

    async getUsers(): Promise<any[]> {
        return await snapshotDB.getAllAsync(
            `SELECT * FROM snapshot_users`
        );
    },
    
    async getMessagesSnapshot(): Promise<any[]> {
        return await snapshotDB.getAllAsync(
            `SELECT * FROM snapshots ORDER BY created_at DESC`
        );
    },

    async addUser(user_id: string, display_name: string): Promise<SQLiteRunResult> {
        return snapshotDB.runAsync(
            `INSERT INTO snapshot_users (user_id, display_name) VALUES (?, ?)`,
            [user_id, display_name]
        );
    },
}