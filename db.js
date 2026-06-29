const Database = require('better-sqlite3')
const path = require('path')

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.db')
const db = new Database(dbPath)

db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT DEFAULT 'match',
    league TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    bet_type TEXT NOT NULL,
    condition_type TEXT NOT NULL,
    condition_value REAL NOT NULL,
    player_name TEXT,
    team_side TEXT,
    match_api_id INTEGER,
    status TEXT DEFAULT 'active',
    notified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS match_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_api_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_detail TEXT,
    team TEXT,
    minute INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

// Migração: adicionar colunas se não existirem
try { db.exec('ALTER TABLE bets ADD COLUMN category TEXT DEFAULT "match"') } catch {}
try { db.exec('ALTER TABLE bets ADD COLUMN player_name TEXT') } catch {}
try { db.exec('ALTER TABLE bets ADD COLUMN team_side TEXT') } catch {}

module.exports = db
