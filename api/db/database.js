import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'demonlist.db');

let db = null;

export function getDatabase() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
    }
    return db;
}

export function initializeDatabase() {
    const database = getDatabase();
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    database.exec(schema);
    console.log('Database initialized successfully');
    return database;
}

export function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

// Helper to convert row objects for API responses
export function serializeRow(row) {
    if (!row) return null;
    const result = { ...row };
    // Convert SQLite integers to booleans
    if ('benchmark' in result) result.benchmark = Boolean(result.benchmark);
    if ('mobile' in result) result.mobile = Boolean(result.mobile);
    return result;
}

export function serializeRows(rows) {
    return rows.map(serializeRow);
}