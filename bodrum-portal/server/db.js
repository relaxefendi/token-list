const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'portal.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_important INTEGER NOT NULL DEFAULT 0,
      can_edit_files INTEGER NOT NULL DEFAULT 1,
      can_chat INTEGER NOT NULL DEFAULT 1,
      can_meet INTEGER NOT NULL DEFAULT 1,
      can_files INTEGER NOT NULL DEFAULT 1,
      can_announce INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (author_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ticker_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room TEXT NOT NULL DEFAULT 'genel',
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_important INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      uploaded_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      updated_by INTEGER,
      version INTEGER NOT NULL DEFAULT 1,
      deleted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (uploaded_by) REFERENCES users(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS file_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (file_id) REFERENCES files(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      room_id TEXT UNIQUE NOT NULL,
      created_by INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!admin) {
    const hash = bcrypt.hashSync('Admin123!', 10);
    db.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, is_important, can_edit_files, can_chat, can_meet, can_files, can_announce)
      VALUES (?, ?, ?, 'admin', 1, 1, 1, 1, 1, 1)
    `).run('admin', 'Sistem Yöneticisi', hash);
  }

  const tickerCount = db.prepare('SELECT COUNT(*) as c FROM ticker_items').get().c;
  if (tickerCount === 0) {
    const insert = db.prepare('INSERT INTO ticker_items (text, active, sort_order) VALUES (?, 1, ?)');
    insert.run('Bodrum İlçe Tarım Müdürlüğü kurum portalına hoş geldiniz.', 0);
    insert.run('Dosya silme kapalıdır. Değişiklikler denetim kaydına alınır.', 1);
    insert.run('Destek için Bilgi İşlem ile iletişime geçiniz.', 2);
  }

  const encKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('file_encryption_password');
  if (!encKey) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'file_encryption_password',
      'BodrumTarim2024!'
    );
  }

  const org = db.prepare('SELECT value FROM settings WHERE key = ?').get('org_name');
  if (!org) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'org_name',
      'Bodrum İlçe Tarım Müdürlüğü'
    );
  }

  const host = db.prepare('SELECT value FROM settings WHERE key = ?').get('server_host');
  if (!host) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('server_host', '');
  }
  const port = db.prepare('SELECT value FROM settings WHERE key = ?').get('server_port');
  if (!port) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'server_port',
      String(Number(process.env.PORT) || 3080)
    );
  }
}

initSchema();

module.exports = db;
