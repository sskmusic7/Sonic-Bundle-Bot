const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');

class DatabaseManager {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  init() {
    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Open database connection
    this.db = new Database(this.dbPath);

    // Create tables
    this.createTables();

    logger.info(`Database initialized at ${this.dbPath}`);
  }

  createTables() {
    // Items table - tracks all found items
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        price REAL NOT NULL,
        platform TEXT NOT NULL,
        url TEXT,
        image TEXT,
        condition TEXT,
        shipping TEXT,
        search_term TEXT,
        timestamp TEXT NOT NULL,
        profitable BOOLEAN DEFAULT 0,
        buy_price REAL,
        suggested_price REAL,
        gross_profit REAL,
        fees REAL,
        net_profit REAL,
        margin REAL,
        UNIQUE(title, platform, price, timestamp)
      )
    `);

    // Bundles table - tracks bundle opportunities
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bundles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bundle_name TEXT NOT NULL,
        total_cost REAL NOT NULL,
        resale_value REAL NOT NULL,
        gross_profit REAL NOT NULL,
        fees REAL NOT NULL,
        net_profit REAL NOT NULL,
        net_margin TEXT NOT NULL,
        viable BOOLEAN DEFAULT 0,
        timestamp TEXT NOT NULL
      )
    `);

    // Bundle items table - tracks items in bundles
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bundle_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bundle_id INTEGER NOT NULL,
        item_title TEXT NOT NULL,
        item_price REAL NOT NULL,
        item_platform TEXT NOT NULL,
        item_url TEXT,
        FOREIGN KEY (bundle_id) REFERENCES bundles(id) ON DELETE CASCADE
      )
    `);

    // Purchases table - tracks executed purchases
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        purchase_price REAL NOT NULL,
        purchase_date TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        notes TEXT,
        FOREIGN KEY (item_id) REFERENCES items(id)
      )
    `);

    // Sales table - track completed sales
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_id INTEGER NOT NULL,
        sale_price REAL NOT NULL,
        sale_date TEXT NOT NULL,
        platform TEXT NOT NULL,
        fees REAL NOT NULL,
        net_profit REAL NOT NULL,
        margin REAL,
        notes TEXT,
        FOREIGN KEY (purchase_id) REFERENCES purchases(id)
      )
    `);

    // Stats table - track daily statistics
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        searches INTEGER DEFAULT 0,
        items_found INTEGER DEFAULT 0,
        profitable_deals INTEGER DEFAULT 0,
        total_potential_profit REAL DEFAULT 0,
        purchases INTEGER DEFAULT 0,
        sales INTEGER DEFAULT 0,
        actual_profit REAL DEFAULT 0
      )
    `);

    // Create indexes for better query performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_items_timestamp ON items(timestamp);
      CREATE INDEX IF NOT EXISTS idx_items_platform ON items(platform);
      CREATE INDEX IF NOT EXISTS idx_items_profitable ON items(profitable);
      CREATE INDEX IF NOT EXISTS idx_bundles_timestamp ON bundles(timestamp);
      CREATE INDEX IF NOT EXISTS idx_bundles_viable ON bundles(viable);
      CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);
      CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
    `);
  }

  async saveItem(item) {
    try {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO items (
          title, price, platform, url, image, condition, shipping,
          search_term, timestamp, profitable, buy_price, suggested_price,
          gross_profit, fees, net_profit, margin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        item.title,
        item.priceNumeric || item.price,
        item.platform,
        item.url,
        item.image,
        item.condition || null,
        item.shipping || null,
        item.searchTerm,
        item.timestamp || new Date().toISOString(),
        item.profitable ? 1 : 0,
        item.buyPrice,
        item.suggestedPrice,
        item.grossProfit,
        item.fees,
        item.netProfit,
        item.margin
      );

      logger.debug(`Saved item to database: ${item.title}`);
      return this.db.lastInsertRowid;
    } catch (error) {
      logger.error(`Error saving item to database: ${error.message}`);
      throw error;
    }
  }

  async saveBundle(bundle) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO bundles (
          bundle_name, total_cost, resale_value, gross_profit,
          fees, net_profit, net_margin, viable, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        bundle.bundleName,
        bundle.totalCost,
        bundle.resaleValue,
        bundle.grossProfit,
        bundle.fees.total,
        bundle.netProfit,
        bundle.netMargin,
        bundle.viable ? 1 : 0,
        new Date().toISOString()
      );

      const bundleId = result.lastInsertRowid;

      // Save bundle items
      const itemStmt = this.db.prepare(`
        INSERT INTO bundle_items (
          bundle_id, item_title, item_price, item_platform, item_url
        ) VALUES (?, ?, ?, ?, ?)
      `);

      for (const item of bundle.items) {
        itemStmt.run(
          bundleId,
          item.title,
          item.priceNumeric,
          item.platform,
          item.url
        );
      }

      logger.debug(`Saved bundle to database: ${bundle.bundleName}`);
      return bundleId;
    } catch (error) {
      logger.error(`Error saving bundle to database: ${error.message}`);
      throw error;
    }
  }

  async savePurchase(purchase) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO purchases (
          item_id, purchase_price, purchase_date, platform, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        purchase.itemId,
        purchase.purchasePrice,
        purchase.purchaseDate || new Date().toISOString(),
        purchase.platform,
        purchase.status || 'pending',
        purchase.notes || null
      );

      logger.info(`Recorded purchase: ${purchase.itemTitle}`);
      return result.lastInsertRowid;
    } catch (error) {
      logger.error(`Error saving purchase: ${error.message}`);
      throw error;
    }
  }

  async saveSale(sale) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO sales (
          purchase_id, sale_price, sale_date, platform, fees, net_profit, margin, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        sale.purchaseId,
        sale.salePrice,
        sale.saleDate || new Date().toISOString(),
        sale.platform,
        sale.fees,
        sale.netProfit,
        sale.margin,
        sale.notes || null
      );

      // Update purchase status
      const updateStmt = this.db.prepare(`
        UPDATE purchases SET status = 'sold' WHERE id = ?
      `);
      updateStmt.run(sale.purchaseId);

      logger.info(`Recorded sale for purchase ID ${sale.purchaseId}`);
      return result.lastInsertRowid;
    } catch (error) {
      logger.error(`Error saving sale: ${error.message}`);
      throw error;
    }
  }

  async updateStats(date, stats) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO stats (
          date, searches, items_found, profitable_deals,
          total_potential_profit, purchases, sales, actual_profit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          searches = searches + excluded.searches,
          items_found = items_found + excluded.items_found,
          profitable_deals = profitable_deals + excluded.profitable_deals,
          total_potential_profit = total_potential_profit + excluded.total_potential_profit,
          purchases = purchases + excluded.purchases,
          sales = sales + excluded.sales,
          actual_profit = actual_profit + excluded.actual_profit
      `);

      stmt.run(
        date,
        stats.searches || 0,
        stats.itemsFound || 0,
        stats.profitableDeals || 0,
        stats.totalPotentialProfit || 0,
        stats.purchases || 0,
        stats.sales || 0,
        stats.actualProfit || 0
      );

      logger.debug(`Updated stats for ${date}`);
    } catch (error) {
      logger.error(`Error updating stats: ${error.message}`);
      throw error;
    }
  }

  async getProfitableItems(limit = 50) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM items
        WHERE profitable = 1
        ORDER BY net_profit DESC
        LIMIT ?
      `);
      return stmt.all(limit);
    } catch (error) {
      logger.error(`Error getting profitable items: ${error.message}`);
      return [];
    }
  }

  async getViableBundles(limit = 20) {
    try {
      const stmt = this.db.prepare(`
        SELECT b.* FROM bundles b
        WHERE b.viable = 1
        ORDER BY b.net_profit DESC
        LIMIT ?
      `);
      return stmt.all(limit);
    } catch (error) {
      logger.error(`Error getting viable bundles: ${error.message}`);
      return [];
    }
  }

  async getDailyStats(days = 7) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM stats
        WHERE date >= date('now', '-' || ? || ' days')
        ORDER BY date DESC
      `);
      return stmt.all(days);
    } catch (error) {
      logger.error(`Error getting daily stats: ${error.message}`);
      return [];
    }
  }

  async getWeeklyReport() {
    try {
      const stmt = this.db.prepare(`
        SELECT
          SUM(searches) as total_searches,
          SUM(items_found) as total_items_found,
          SUM(profitable_deals) as total_profitable_deals,
          SUM(total_potential_profit) as total_potential_profit,
          SUM(purchases) as total_purchases,
          SUM(sales) as total_sales,
          SUM(actual_profit) as total_actual_profit
        FROM stats
        WHERE date >= date('now', '-7 days')
      `);
      return stmt.get();
    } catch (error) {
      logger.error(`Error getting weekly report: ${error.message}`);
      return null;
    }
  }

  async getPlatformBreakdown() {
    try {
      const stmt = this.db.prepare(`
        SELECT
          platform,
          COUNT(*) as item_count,
          SUM(profitable) as profitable_count,
          AVG(net_profit) as avg_profit
        FROM items
        GROUP BY platform
        ORDER BY item_count DESC
      `);
      return stmt.all();
    } catch (error) {
      logger.error(`Error getting platform breakdown: ${error.message}`);
      return [];
    }
  }

  async cleanOldData(days = 90) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoff = cutoffDate.toISOString();

      // Delete old items
      const deleteItems = this.db.prepare(`
        DELETE FROM items WHERE timestamp < ? AND NOT EXISTS (
          SELECT 1 FROM purchases WHERE purchases.item_id = items.id
        )
      `);
      const deletedItems = deleteItems.run(cutoff);

      // Delete old bundles
      const deleteBundles = this.db.prepare(`
        DELETE FROM bundles WHERE timestamp < ? AND NOT EXISTS (
          SELECT 1 FROM purchases, bundle_items
          WHERE purchases.item_id = bundle_items.id AND bundle_items.bundle_id = bundles.id
        )
      `);
      const deletedBundles = deleteBundles.run(cutoff);

      logger.info(`Cleaned ${deletedItems.changes} old items and ${deletedBundles.changes} old bundles`);
    } catch (error) {
      logger.error(`Error cleaning old data: ${error.message}`);
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      logger.info('Database connection closed');
    }
  }
}

// Initialize database with config path
const config = require('../config');
const database = new DatabaseManager(
  config.database.path || './data/sonic_tracker.db'
);

module.exports = { database };
