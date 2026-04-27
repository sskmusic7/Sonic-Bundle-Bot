/**
 * Agent Runner — Orchestrator for the Shrine Pipeline
 * Manages all 6 agents: sourcer, validator, bundler, creative, lister, guardian
 * Each agent runs on its own interval, communicates via SQLite
 */

'use strict';

const { migrateShrineTables } = require('./db-schema');

class AgentRunner {
  constructor(db, bot, chatId) {
    this.db = db;
    this.bot = bot;
    this.chatId = chatId;
    this.agents = {};
    this.intervals = {};
    this.paused = {};
    this.running = {};

    // Run migration on startup
    migrateShrineTables(db);
  }

  /**
   * Register an agent module
   * Agent must export: { name, interval, run(db, notify) }
   */
  register(agent) {
    this.agents[agent.name] = agent;
    this.paused[agent.name] = false;
    this.running[agent.name] = false;
  }

  /**
   * Send a Telegram notification (used by agents)
   */
  notify(message, options = {}) {
    if (!this.bot || !this.chatId) return;
    return this.bot.sendMessage(this.chatId, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...options
    });
  }

  /**
   * Send a photo to Telegram
   */
  notifyPhoto(buffer, caption) {
    if (!this.bot || !this.chatId) return;
    return this.bot.sendPhoto(this.chatId, buffer, {
      caption,
      parse_mode: 'Markdown'
    });
  }

  /**
   * Log an agent run to the database
   */
  logRun(agentName, status, itemsProcessed, notes) {
    try {
      this.db.prepare(`
        INSERT INTO agent_runs (agent_name, finished_at, status, items_processed, notes)
        VALUES (?, datetime('now'), ?, ?, ?)
      `).run(agentName, status, itemsProcessed || 0, notes || null);
    } catch (err) {
      console.error(`Failed to log run for ${agentName}:`, err.message);
    }
  }

  /**
   * Run a single agent (with lock to prevent concurrent runs)
   */
  async runAgent(name) {
    const agent = this.agents[name];
    if (!agent) throw new Error(`Unknown agent: ${name}`);
    if (this.running[name]) return { skipped: true, reason: 'already running' };
    if (this.paused[name]) return { skipped: true, reason: 'paused' };

    this.running[name] = true;
    const startTime = Date.now();

    try {
      const result = await agent.run(this.db, {
        notify: (msg, opts) => this.notify(msg, opts),
        notifyPhoto: (buf, cap) => this.notifyPhoto(buf, cap)
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logRun(name, 'success', result?.processed || 0, `Completed in ${elapsed}s`);
      this.running[name] = false;
      return { success: true, ...result, elapsed };
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`Agent ${name} failed:`, err.message);
      this.logRun(name, 'error', 0, err.message);
      this.running[name] = false;
      return { success: false, error: err.message, elapsed };
    }
  }

  /**
   * Start all agents on their intervals
   */
  startAll() {
    const config = require('../config');
    const intervalConfig = config.shrine?.agentIntervals || {};

    // Agent order with stagger times (minutes)
    const agentOrder = [
      { name: 'sourcer', stagger: 0 },
      { name: 'guardian', stagger: 5 },
      { name: 'validator', stagger: 10 },
      { name: 'bundler', stagger: 20 },
      { name: 'creative', stagger: 30 },
      { name: 'lister', stagger: 40 }
    ];

    for (const { name, stagger } of agentOrder) {
      const agent = this.agents[name];
      if (!agent) continue;

      const interval = intervalConfig[name] || agent.interval || 3600000;
      this.paused[name] = false;

      const staggerMs = stagger * 60 * 1000;
      setTimeout(() => this.runAgent(name), 5000 + staggerMs);
      this.intervals[name] = setInterval(() => this.runAgent(name), interval);
      console.log(`Agent ${name}: every ${Math.round(interval/60000)}m, stagger: ${stagger}m`);
    }
  }

  /**
   * Stop all agent intervals
   */
  stopAll() {
    for (const [name, timer] of Object.entries(this.intervals)) {
      clearInterval(timer);
      this.paused[name] = true;
    }
    this.intervals = {};
  }

  /**
   * Pause a single agent
   */
  pause(name) {
    if (name) {
      this.paused[name] = true;
      if (this.intervals[name]) {
        clearInterval(this.intervals[name]);
        delete this.intervals[name];
      }
    } else {
      this.stopAll();
    }
  }

  /**
   * Resume a single agent (or all)
   */
  resume(name) {
    const config = require('../config');
    const intervalConfig = config.shrine?.agentIntervals || {};

    if (name) {
      const agent = this.agents[name];
      if (!agent) return false;
      this.paused[name] = false;
      const interval = intervalConfig[name] || agent.interval || 3600000;
      this.intervals[name] = setInterval(() => this.runAgent(name), interval);
      return true;
    } else {
      this.startAll();
      return true;
    }
  }

  /**
   * Get status of all agents
   */
  getStatus() {
    const statuses = {};

    for (const [name, agent] of Object.entries(this.agents)) {
      // Get last run from DB
      const lastRun = this.db.prepare(`
        SELECT * FROM agent_runs WHERE agent_name = ? ORDER BY id DESC LIMIT 1
      `).get(name);

      statuses[name] = {
        running: this.running[name] || false,
        paused: this.paused[name] || false,
        lastRun: lastRun ? {
          at: lastRun.finished_at || lastRun.started_at,
          status: lastRun.status,
          processed: lastRun.items_processed,
          notes: lastRun.notes
        } : null
      };
    }

    return statuses;
  }

  /**
   * Get pipeline counts (items flowing through each stage)
   */
  getPipelineCounts() {
    const counts = {};

    counts.sourced = this.db.prepare(
      "SELECT COUNT(*) as c FROM sourced_items WHERE validation_status = 'pending'"
    ).get().c;

    counts.validated = this.db.prepare(
      "SELECT COUNT(*) as c FROM sourced_items WHERE validation_status = 'valid'"
    ).get().c;

    counts.rejected = this.db.prepare(
      "SELECT COUNT(*) as c FROM sourced_items WHERE validation_status = 'rejected'"
    ).get().c;

    counts.assembling = this.db.prepare(
      "SELECT COUNT(*) as c FROM shrine_bundles WHERE status = 'assembling'"
    ).get().c;

    counts.ready = this.db.prepare(
      "SELECT COUNT(*) as c FROM shrine_bundles WHERE status = 'ready'"
    ).get().c;

    counts.active = this.db.prepare(
      "SELECT COUNT(*) as c FROM shrine_bundles WHERE status = 'active'"
    ).get().c;

    counts.broken = this.db.prepare(
      "SELECT COUNT(*) as c FROM shrine_bundles WHERE status = 'broken'"
    ).get().c;

    counts.sold = this.db.prepare(
      "SELECT COUNT(*) as c FROM shrine_bundles WHERE status = 'sold'"
    ).get().c;

    return counts;
  }
}

module.exports = { AgentRunner };
