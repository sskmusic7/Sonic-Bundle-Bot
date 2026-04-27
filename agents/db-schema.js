/**
 * Shrine Pipeline — Database schema migration
 * Adds tables for the virtual arbitrage agent pipeline
 */

'use strict';

function migrateShrineTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sourced_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ebay_item_id TEXT UNIQUE,
      title TEXT NOT NULL,
      character TEXT,
      category TEXT,
      price REAL,
      shipping REAL DEFAULT 0,
      image_url TEXT,
      seller_username TEXT,
      seller_feedback INTEGER,
      available_qty INTEGER DEFAULT 1,
      condition TEXT,
      item_url TEXT,
      validation_status TEXT DEFAULT 'pending',
      validation_notes TEXT,
      sourced_at TEXT DEFAULT (datetime('now')),
      last_checked TEXT
    );

    CREATE TABLE IF NOT EXISTS shrine_bundles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bundle_name TEXT,
      target_character TEXT,
      total_cost REAL,
      list_price REAL,
      margin_pct REAL,
      hero_image_path TEXT,
      ebay_listing_id TEXT,
      ebay_sku TEXT,
      status TEXT DEFAULT 'assembling',
      created_at TEXT DEFAULT (datetime('now')),
      listed_at TEXT,
      sold_at TEXT
    );

    CREATE TABLE IF NOT EXISTS shrine_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bundle_id INTEGER REFERENCES shrine_bundles(id) ON DELETE CASCADE,
      sourced_item_id INTEGER REFERENCES sourced_items(id),
      role TEXT,
      locked_price REAL,
      status TEXT DEFAULT 'available'
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT DEFAULT 'running',
      items_processed INTEGER DEFAULT 0,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sourced_validation ON sourced_items(validation_status);
    CREATE INDEX IF NOT EXISTS idx_sourced_character ON sourced_items(character);
    CREATE INDEX IF NOT EXISTS idx_sourced_price ON sourced_items(price);
    CREATE INDEX IF NOT EXISTS idx_sourced_category ON sourced_items(category);
    CREATE INDEX IF NOT EXISTS idx_shrine_status ON shrine_bundles(status);
    CREATE INDEX IF NOT EXISTS idx_shrine_target ON shrine_bundles(target_character);
    CREATE INDEX IF NOT EXISTS idx_components_bundle ON shrine_components(bundle_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_name ON agent_runs(agent_name);
  `);
}

module.exports = { migrateShrineTables };
