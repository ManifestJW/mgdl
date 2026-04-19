-- Demonlist Database Schema

-- Users table (players who set records/verify levels)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    link TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Levels table
CREATE TABLE IF NOT EXISTS levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gd_id INTEGER NOT NULL,
    name TEXT NOT NULL UNIQUE,
    author TEXT NOT NULL,
    verifier TEXT NOT NULL,
    verification TEXT NOT NULL,
    percent_to_qualify INTEGER DEFAULT 100,
    password TEXT DEFAULT 'Free to Copy',
    benchmark BOOLEAN DEFAULT 0,
    list_position INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Level creators (many-to-many)
CREATE TABLE IF NOT EXISTS level_creators (
    level_id INTEGER NOT NULL,
    creator_name TEXT NOT NULL,
    FOREIGN KEY (level_id) REFERENCES levels(id) ON DELETE CASCADE,
    PRIMARY KEY (level_id, creator_name)
);

-- Records table
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    percent INTEGER NOT NULL,
    link TEXT NOT NULL,
    mobile BOOLEAN DEFAULT 0,
    status TEXT DEFAULT 'approved' CHECK(status IN ('pending', 'approved', 'rejected')),
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (level_id) REFERENCES levels(id) ON DELETE CASCADE
);

-- Pack tiers
CREATE TABLE IF NOT EXISTS pack_tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL
);

-- Packs table
CREATE TABLE IF NOT EXISTS packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    colour TEXT NOT NULL,
    tier_id INTEGER,
    FOREIGN KEY (tier_id) REFERENCES pack_tiers(id) ON DELETE SET NULL
);

-- Pack levels (many-to-many)
CREATE TABLE IF NOT EXISTS pack_levels (
    pack_id INTEGER NOT NULL,
    level_id INTEGER NOT NULL,
    FOREIGN KEY (pack_id) REFERENCES packs(id) ON DELETE CASCADE,
    FOREIGN KEY (level_id) REFERENCES levels(id) ON DELETE CASCADE,
    PRIMARY KEY (pack_id, level_id)
);

-- Editors table
CREATE TABLE IF NOT EXISTS editors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    link TEXT,
    role TEXT NOT NULL CHECK(role IN ('owner', 'coowner', 'admin', 'helper', 'dev', 'trial', 'patreon'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_levels_list_position ON levels(list_position);
CREATE INDEX IF NOT EXISTS idx_records_level_id ON records(level_id);
CREATE INDEX IF NOT EXISTS idx_records_user_name ON records(user_name);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
CREATE INDEX IF NOT EXISTS idx_levels_name ON levels(name);
CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);