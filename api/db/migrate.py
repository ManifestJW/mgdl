#!/usr/bin/env python3
"""
Migration script to convert JSON demonlist data to SQLite database.
Run from the api/ directory: python3 db/migrate.py
"""

import json
import os
import sqlite3
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = SCRIPT_DIR / "demonlist.db"
SCHEMA_PATH = SCRIPT_DIR / "schema.sql"


def load_json(filepath):
    """Load a JSON file and return its contents."""
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def get_all_level_files(data_dir):
    """Get all level JSON files (excluding special files starting with _)."""
    level_files = []
    for filename in os.listdir(data_dir):
        if filename.endswith(".json") and not filename.startswith("_"):
            level_files.append(filename)
    return level_files


def create_database():
    """Create the database and initialize schema."""
    # Remove existing database if it exists
    if DB_PATH.exists():
        os.remove(DB_PATH)
        print(f"Removed existing database: {DB_PATH}")

    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")

    # Initialize schema
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        schema = f.read()
    conn.executescript(schema)
    print("Database schema created")

    return conn


def collect_users(level_data_list, editors_data):
    """Collect all unique users from levels and editors."""
    users = {}  # name -> link (if available)

    for level in level_data_list:
        # Add author
        if level.get("author"):
            users.setdefault(level["author"], None)

        # Add creators
        for creator in level.get("creators", []):
            users.setdefault(creator, None)

        # Add verifier
        if level.get("verifier"):
            users.setdefault(level["verifier"], None)

        # Add record holders
        for record in level.get("records", []):
            if record.get("user"):
                users.setdefault(record["user"], None)

    # Add editors
    for role_group in editors_data:
        for member in role_group.get("members", []):
            name = member.get("name")
            link = member.get("link")
            if name:
                users[name] = link

    return users


def migrate_users(conn, users):
    """Insert users into the database."""
    cursor = conn.cursor()
    for name, link in users.items():
        cursor.execute(
            "INSERT OR IGNORE INTO users (name, link) VALUES (?, ?)",
            (name, link),
        )
    conn.commit()
    print(f"Migrated {len(users)} users")


def migrate_levels(conn, list_data, level_data_map):
    """Insert levels into the database."""
    cursor = conn.cursor()

    # First, insert levels that are in the list (with position)
    for position, level_name in enumerate(list_data, start=1):
        level = level_data_map.get(level_name)
        if not level:
            print(f"  Warning: Level '{level_name}' not found in data files")
            continue

        cursor.execute(
            """INSERT INTO levels 
               (gd_id, name, author, verifier, verification, 
                percent_to_qualify, password, benchmark, list_position)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                level.get("id", 0),
                level.get("name", level_name),
                level.get("author", "Unknown"),
                level.get("verifier", "Unknown"),
                level.get("verification", ""),
                level.get("percentToQualify", 100),
                level.get("password", "Free to Copy"),
                1 if level.get("benchmark") else 0,
                position,
            ),
        )

    # Insert any levels not in the list (benchmark levels or unlisted)
    for level_name, level in level_data_map.items():
        if level_name not in list_data:
            cursor.execute(
                """INSERT INTO levels 
                   (gd_id, name, author, verifier, verification, 
                    percent_to_qualify, password, benchmark, list_position)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    level.get("id", 0),
                    level.get("name", level_name),
                    level.get("author", "Unknown"),
                    level.get("verifier", "Unknown"),
                    level.get("verification", ""),
                    level.get("percentToQualify", 100),
                    level.get("password", "Free to Copy"),
                    1 if level.get("benchmark") else 0,
                    None,  # No list position
                ),
            )

    conn.commit()
    print(f"Migrated {len(level_data_map)} levels")


def migrate_level_creators(conn, level_data_map):
    """Insert level creators into the database."""
    cursor = conn.cursor()
    count = 0

    for level_name, level in level_data_map.items():
        # Get the level's database ID
        cursor.execute("SELECT id FROM levels WHERE name = ?", (level_name,))
        row = cursor.fetchone()
        if not row:
            continue

        level_id = row[0]
        creators = level.get("creators", [])

        for creator in creators:
            cursor.execute(
                "INSERT OR IGNORE INTO level_creators (level_id, creator_name) VALUES (?, ?)",
                (level_id, creator),
            )
            count += 1

    conn.commit()
    print(f"Migrated {count} level creators")


def migrate_records(conn, level_data_map):
    """Insert records into the database."""
    cursor = conn.cursor()
    count = 0

    for level_name, level in level_data_map.items():
        # Get the level's database ID
        cursor.execute("SELECT id FROM levels WHERE name = ?", (level_name,))
        row = cursor.fetchone()
        if not row:
            continue

        level_id = row[0]
        records = level.get("records", [])

        for record in records:
            cursor.execute(
                """INSERT INTO records 
                   (level_id, user_name, percent, link, mobile, status)
                   VALUES (?, ?, ?, ?, ?, 'approved')""",
                (
                    level_id,
                    record.get("user", "Unknown"),
                    record.get("percent", 0),
                    record.get("link", ""),
                    1 if record.get("mobile") else 0,
                ),
            )
            count += 1

    conn.commit()
    print(f"Migrated {count} records")


def migrate_pack_tiers(conn, tiers_data):
    """Insert pack tiers into the database."""
    cursor = conn.cursor()

    for tier in tiers_data:
        cursor.execute(
            "INSERT INTO pack_tiers (name, color) VALUES (?, ?)",
            (tier.get("name", "Unknown"), tier.get("color", "")),
        )

    conn.commit()
    print(f"Migrated {len(tiers_data)} pack tiers")


def migrate_packs(conn, packs_data, level_data_map, tiers_data):
    """Insert packs and their levels into the database."""
    cursor = conn.cursor()
    pack_count = 0
    level_link_count = 0

    # Build tier name -> id mapping
    tier_map = {}
    for tier in tiers_data:
        cursor.execute("SELECT id FROM pack_tiers WHERE name = ?", (tier.get("name"),))
        row = cursor.fetchone()
        if row:
            for pack_name in tier.get("packs", []):
                tier_map[pack_name] = row[0]

    for pack in packs_data:
        pack_name = pack.get("name", "Unknown")
        tier_id = tier_map.get(pack_name)

        cursor.execute(
            "INSERT INTO packs (name, colour, tier_id) VALUES (?, ?, ?)",
            (pack_name, pack.get("colour", ""), tier_id),
        )
        pack_id = cursor.lastrowid
        pack_count += 1

        # Link pack to levels
        for level_name in pack.get("levels", []):
            cursor.execute("SELECT id FROM levels WHERE name = ?", (level_name,))
            level_row = cursor.fetchone()
            if level_row:
                cursor.execute(
                    "INSERT OR IGNORE INTO pack_levels (pack_id, level_id) VALUES (?, ?)",
                    (pack_id, level_row[0]),
                )
                level_link_count += 1

    conn.commit()
    print(f"Migrated {pack_count} packs with {level_link_count} level links")


def migrate_editors(conn, editors_data):
    """Insert editors into the database."""
    cursor = conn.cursor()
    count = 0

    for role_group in editors_data:
        role = role_group.get("role", "helper")
        for member in role_group.get("members", []):
            cursor.execute(
                "INSERT INTO editors (name, link, role) VALUES (?, ?, ?)",
                (member.get("name", "Unknown"), member.get("link", ""), role),
            )
            count += 1

    conn.commit()
    print(f"Migrated {count} editors")


def main():
    print("=" * 50)
    print("Demonlist JSON -> SQLite Migration")
    print("=" * 50)

    # Load list order
    print("\nLoading data files...")
    list_data = load_json(DATA_DIR / "_list.json")
    print(f"  _list.json: {len(list_data)} levels")

    # Load editors
    editors_data = load_json(DATA_DIR / "_editors.json")
    print(f"  _editors.json: {len(editors_data)} role groups")

    # Load packs
    packs_data = load_json(DATA_DIR / "_packlist.json")
    print(f"  _packlist.json: {len(packs_data)} packs")

    # Load pack tiers
    tiers_data = load_json(DATA_DIR / "_packtiers.json")
    print(f"  _packtiers.json: {len(tiers_data)} tiers")

    # Load all level files
    level_files = get_all_level_files(DATA_DIR)
    level_data_map = {}
    for filename in level_files:
        level_name = filename.replace(".json", "")
        try:
            level_data = load_json(DATA_DIR / filename)
            level_data_map[level_name] = level_data
        except Exception as e:
            print(f"  Warning: Failed to load {filename}: {e}")
    print(f"  Level files: {len(level_data_map)} levels loaded")

    # Create database
    print("\nCreating database...")
    conn = create_database()

    # Collect and migrate users
    print("\nMigrating users...")
    users = collect_users(list(level_data_map.values()), editors_data)
    migrate_users(conn, users)

    # Migrate levels
    print("\nMigrating levels...")
    migrate_levels(conn, list_data, level_data_map)

    # Migrate level creators
    print("\nMigrating level creators...")
    migrate_level_creators(conn, level_data_map)

    # Migrate records
    print("\nMigrating records...")
    migrate_records(conn, level_data_map)

    # Migrate pack tiers
    print("\nMigrating pack tiers...")
    migrate_pack_tiers(conn, tiers_data)

    # Migrate packs
    print("\nMigrating packs...")
    migrate_packs(conn, packs_data, level_data_map, tiers_data)

    # Migrate editors
    print("\nMigrating editors...")
    migrate_editors(conn, editors_data)

    # Close connection
    conn.close()

    print("\n" + "=" * 50)
    print("Migration completed successfully!")
    print(f"Database created at: {DB_PATH}")
    print("=" * 50)


if __name__ == "__main__":
    main()