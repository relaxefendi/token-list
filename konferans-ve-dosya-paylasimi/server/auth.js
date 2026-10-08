const bcrypt = require('bcryptjs');
const db = require('./db');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Oturum gerekli' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Kullanıcı bulunamadı' });
  }
  req.user = sanitizeUser(user);
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Yönetici yetkisi gerekli' });
    }
    next();
  });
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    isImportant: !!user.is_important,
    canEditFiles: !!user.can_edit_files,
    canChat: !!user.can_chat,
    canMeet: !!user.can_meet,
    canFiles: !!user.can_files,
    canAnnounce: !!user.can_announce,
  };
}

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(user.id);
  return sanitizeUser(user);
}

function createUser(data) {
  const hash = bcrypt.hashSync(data.password, 10);
  const result = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, is_important, can_edit_files, can_chat, can_meet, can_files, can_announce)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.username,
    data.displayName,
    hash,
    data.role || 'user',
    data.isImportant ? 1 : 0,
    data.canEditFiles !== false ? 1 : 0,
    data.canChat !== false ? 1 : 0,
    data.canMeet !== false ? 1 : 0,
    data.canFiles !== false ? 1 : 0,
    data.canAnnounce ? 1 : 0
  );
  return result.lastInsertRowid;
}

function updateUser(id, data) {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return false;

  let passwordHash = existing.password_hash;
  if (data.password) {
    passwordHash = bcrypt.hashSync(data.password, 10);
  }

  db.prepare(`
    UPDATE users SET
      display_name = ?,
      password_hash = ?,
      role = ?,
      is_important = ?,
      can_edit_files = ?,
      can_chat = ?,
      can_meet = ?,
      can_files = ?,
      can_announce = ?,
      active = ?
    WHERE id = ?
  `).run(
    data.displayName ?? existing.display_name,
    passwordHash,
    data.role ?? existing.role,
    data.isImportant !== undefined ? (data.isImportant ? 1 : 0) : existing.is_important,
    data.canEditFiles !== undefined ? (data.canEditFiles ? 1 : 0) : existing.can_edit_files,
    data.canChat !== undefined ? (data.canChat ? 1 : 0) : existing.can_chat,
    data.canMeet !== undefined ? (data.canMeet ? 1 : 0) : existing.can_meet,
    data.canFiles !== undefined ? (data.canFiles ? 1 : 0) : existing.can_files,
    data.canAnnounce !== undefined ? (data.canAnnounce ? 1 : 0) : existing.can_announce,
    data.active !== undefined ? (data.active ? 1 : 0) : existing.active,
    id
  );
  return true;
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

module.exports = {
  requireAuth,
  requireAdmin,
  sanitizeUser,
  login,
  createUser,
  updateUser,
  getSetting,
  setSetting,
};
