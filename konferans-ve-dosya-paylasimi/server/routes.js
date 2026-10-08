const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db = require('./db');
const {
  requireAuth,
  requireAdmin,
  login,
  createUser,
  updateUser,
  sanitizeUser,
  getSetting,
  setSetting,
} = require('./auth');
const { saveEncryptedFile, readEncryptedFile } = require('./crypto-files');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ── Auth ──────────────────────────────────────────────
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
  }
  const user = login(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre' });
  }
  req.session.userId = user.id;
  res.json({ user });
});

router.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/auth/me', requireAuth, (req, res) => {
  const serverHost = getSetting('server_host') || '';
  const serverPort = getSetting('server_port') || String(Number(process.env.PORT) || 3080);
  const portalUrl = serverHost
    ? `http://${serverHost}:${serverPort}`
    : null;
  res.json({
    user: req.user,
    orgName: getSetting('org_name'),
    serverHost,
    serverPort,
    portalUrl,
  });
});

// ── Users (admin) ─────────────────────────────────────
router.get('/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY display_name').all();
  res.json({
    users: users.map((u) => ({
      ...sanitizeUser(u),
      active: !!u.active,
      createdAt: u.created_at,
      lastSeen: u.last_seen,
    })),
  });
});

router.post('/admin/users', requireAdmin, (req, res) => {
  try {
    const id = createUser(req.body);
    res.json({ id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'Bu kullanıcı adı zaten var' });
    }
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/users/:id', requireAdmin, (req, res) => {
  const ok = updateUser(Number(req.params.id), req.body);
  if (!ok) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  res.json({ ok: true });
});

// ── Ticker ────────────────────────────────────────────
router.get('/ticker', requireAuth, (req, res) => {
  const items = db
    .prepare('SELECT id, text FROM ticker_items WHERE active = 1 ORDER BY sort_order, id')
    .all();
  res.json({ items });
});

router.get('/admin/ticker', requireAdmin, (req, res) => {
  const items = db.prepare('SELECT * FROM ticker_items ORDER BY sort_order, id').all();
  res.json({ items });
});

router.post('/admin/ticker', requireAdmin, (req, res) => {
  const { text, active = true, sortOrder = 0 } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Metin gerekli' });
  const result = db
    .prepare('INSERT INTO ticker_items (text, active, sort_order) VALUES (?, ?, ?)')
    .run(text, active ? 1 : 0, sortOrder);
  res.json({ id: result.lastInsertRowid });
});

router.put('/admin/ticker/:id', requireAdmin, (req, res) => {
  const { text, active, sortOrder } = req.body || {};
  const existing = db.prepare('SELECT * FROM ticker_items WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Kayıt bulunamadı' });
  db.prepare(
    'UPDATE ticker_items SET text = ?, active = ?, sort_order = ? WHERE id = ?'
  ).run(
    text ?? existing.text,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    sortOrder !== undefined ? sortOrder : existing.sort_order,
    existing.id
  );
  res.json({ ok: true });
});

router.delete('/admin/ticker/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM ticker_items WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ── Announcements ─────────────────────────────────────
router.get('/announcements', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, u.display_name as author_name
       FROM announcements a JOIN users u ON u.id = a.author_id
       ORDER BY a.created_at DESC LIMIT 50`
    )
    .all();
  res.json({
    announcements: rows.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      authorName: a.author_name,
      createdAt: a.created_at,
    })),
  });
});

router.post('/announcements', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && !req.user.canAnnounce) {
    return res.status(403).json({ error: 'Duyuru yetkisi yok' });
  }
  const { title, body } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'Başlık ve içerik gerekli' });
  const result = db
    .prepare('INSERT INTO announcements (title, body, author_id) VALUES (?, ?, ?)')
    .run(title, body, req.user.id);
  res.json({ id: result.lastInsertRowid });
});

router.delete('/announcements/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ── Messages / Chat history ───────────────────────────
router.get('/messages/:room', requireAuth, (req, res) => {
  if (!req.user.canChat) return res.status(403).json({ error: 'Sohbet yetkisi yok' });
  const room = req.params.room || 'genel';
  const rows = db
    .prepare(
      `SELECT m.*, u.display_name, u.is_important as user_important
       FROM messages m JOIN users u ON u.id = m.user_id
       WHERE m.room = ?
       ORDER BY m.created_at DESC LIMIT 100`
    )
    .all(room);
  res.json({
    messages: rows.reverse().map((m) => ({
      id: m.id,
      room: m.room,
      content: m.content,
      userId: m.user_id,
      displayName: m.display_name,
      isImportant: !!m.is_important,
      createdAt: m.created_at,
    })),
  });
});

// ── Files ─────────────────────────────────────────────
router.get('/files', requireAuth, (req, res) => {
  if (!req.user.canFiles) return res.status(403).json({ error: 'Dosya erişim yetkisi yok' });
  const rows = db
    .prepare(
      `SELECT f.*, u.display_name as uploader_name, u2.display_name as updater_name
       FROM files f
       JOIN users u ON u.id = f.uploaded_by
       LEFT JOIN users u2 ON u2.id = f.updated_by
       WHERE f.deleted = 0
       ORDER BY f.created_at DESC`
    )
    .all();
  res.json({
    files: rows.map((f) => ({
      id: f.id,
      name: f.original_name,
      mimeType: f.mime_type,
      size: f.size,
      version: f.version,
      uploadedBy: f.uploader_name,
      updatedBy: f.updater_name,
      createdAt: f.created_at,
      updatedAt: f.updated_at,
    })),
    canEdit: req.user.canEditFiles,
  });
});

router.post('/files', requireAuth, upload.single('file'), (req, res) => {
  if (!req.user.canFiles) return res.status(403).json({ error: 'Dosya erişim yetkisi yok' });
  if (!req.file) return res.status(400).json({ error: 'Dosya gerekli' });

  const password = getSetting('file_encryption_password');
  const storedName = `${uuidv4()}.enc`;
  saveEncryptedFile(storedName, req.file.buffer, password);

  const result = db
    .prepare(
      `INSERT INTO files (original_name, stored_name, mime_type, size, uploaded_by)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      req.file.originalname,
      storedName,
      req.file.mimetype,
      req.file.size,
      req.user.id
    );

  db.prepare(
    'INSERT INTO file_audit (file_id, user_id, action, detail) VALUES (?, ?, ?, ?)'
  ).run(result.lastInsertRowid, req.user.id, 'upload', req.file.originalname);

  res.json({ id: result.lastInsertRowid });
});

router.get('/files/:id/download', requireAuth, (req, res) => {
  if (!req.user.canFiles) return res.status(403).json({ error: 'Dosya erişim yetkisi yok' });
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND deleted = 0').get(Number(req.params.id));
  if (!file) return res.status(404).json({ error: 'Dosya bulunamadı' });

  try {
    const password = getSetting('file_encryption_password');
    const buffer = readEncryptedFile(file.stored_name, password);
    db.prepare(
      'INSERT INTO file_audit (file_id, user_id, action, detail) VALUES (?, ?, ?, ?)'
    ).run(file.id, req.user.id, 'download', file.original_name);

    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`
    );
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'Dosya okunamadı: ' + e.message });
  }
});

router.put('/files/:id', requireAuth, upload.single('file'), (req, res) => {
  if (!req.user.canFiles) return res.status(403).json({ error: 'Dosya erişim yetkisi yok' });
  if (!req.user.canEditFiles) return res.status(403).json({ error: 'Dosya düzenleme yetkisi yok' });
  if (!req.file) return res.status(400).json({ error: 'Dosya gerekli' });

  const file = db.prepare('SELECT * FROM files WHERE id = ? AND deleted = 0').get(Number(req.params.id));
  if (!file) return res.status(404).json({ error: 'Dosya bulunamadı' });

  const password = getSetting('file_encryption_password');
  // Overwrite encrypted content with new version (same stored name)
  saveEncryptedFile(file.stored_name, req.file.buffer, password);

  db.prepare(
    `UPDATE files SET size = ?, mime_type = ?, version = version + 1,
     updated_at = datetime('now'), updated_by = ?, original_name = ?
     WHERE id = ?`
  ).run(
    req.file.size,
    req.file.mimetype,
    req.user.id,
    req.file.originalname || file.original_name,
    file.id
  );

  db.prepare(
    'INSERT INTO file_audit (file_id, user_id, action, detail) VALUES (?, ?, ?, ?)'
  ).run(
    file.id,
    req.user.id,
    'update',
    `v${file.version + 1}: ${req.file.originalname || file.original_name}`
  );

  res.json({ ok: true, version: file.version + 1 });
});

// Soft-delete blocked for normal users — only admin can mark deleted (files never physically removed from encrypted store by users)
router.delete('/files/:id', requireAuth, (req, res) => {
  return res.status(403).json({
    error: 'Dosyalar silinemez. Silme işlemi kurum politikası gereği kapalıdır.',
  });
});

router.get('/files/:id/audit', requireAuth, (req, res) => {
  if (!req.user.canFiles) return res.status(403).json({ error: 'Dosya erişim yetkisi yok' });
  const rows = db
    .prepare(
      `SELECT a.*, u.display_name
       FROM file_audit a JOIN users u ON u.id = a.user_id
       WHERE a.file_id = ?
       ORDER BY a.created_at DESC`
    )
    .all(Number(req.params.id));
  res.json({
    audit: rows.map((a) => ({
      id: a.id,
      action: a.action,
      detail: a.detail,
      displayName: a.display_name,
      createdAt: a.created_at,
    })),
  });
});

// Admin: unlock encrypted files with master password (raw decrypt access log)
router.post('/admin/files/unlock', requireAdmin, (req, res) => {
  const { password } = req.body || {};
  const master = getSetting('file_encryption_password');
  if (password !== master) {
    return res.status(401).json({ error: 'Yanlış yönetim şifresi' });
  }
  req.session.filesUnlocked = true;
  res.json({ ok: true });
});

router.put('/admin/settings/encryption-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (currentPassword !== getSetting('file_encryption_password')) {
    return res.status(401).json({ error: 'Mevcut şifre yanlış' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Yeni şifre en az 8 karakter olmalı' });
  }
  // Note: changing password without re-encrypting existing files would break them.
  // For this version we only update the setting for NEW files after a planned migration.
  // Safer approach: require unlock and re-encrypt all — done below.
  const files = db.prepare('SELECT * FROM files WHERE deleted = 0').all();
  try {
    const { readEncryptedFile: readEnc, saveEncryptedFile: saveEnc } = require('./crypto-files');
    for (const f of files) {
      const buf = readEnc(f.stored_name, currentPassword);
      saveEnc(f.stored_name, buf, newPassword);
    }
    setSetting('file_encryption_password', newPassword);
    res.json({ ok: true, reencrypted: files.length });
  } catch (e) {
    res.status(500).json({ error: 'Yeniden şifreleme başarısız: ' + e.message });
  }
});

router.get('/admin/settings', requireAdmin, (req, res) => {
  const serverHost = getSetting('server_host') || '';
  const serverPort = getSetting('server_port') || String(Number(process.env.PORT) || 3080);
  res.json({
    orgName: getSetting('org_name'),
    serverHost,
    serverPort,
    portalUrl: serverHost ? `http://${serverHost}:${serverPort}` : '',
    hasEncryptionPassword: !!getSetting('file_encryption_password'),
  });
});

router.put('/admin/settings', requireAdmin, (req, res) => {
  if (req.body.orgName) setSetting('org_name', req.body.orgName);
  if (req.body.serverHost !== undefined) {
    const host = String(req.body.serverHost || '').trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    setSetting('server_host', host);
  }
  if (req.body.serverPort !== undefined) {
    const p = Number(req.body.serverPort);
    if (!Number.isFinite(p) || p < 1 || p > 65535) {
      return res.status(400).json({ error: 'Geçersiz port (1–65535)' });
    }
    setSetting('server_port', String(p));
  }
  const serverHost = getSetting('server_host') || '';
  const serverPort = getSetting('server_port') || '3080';
  res.json({
    ok: true,
    portalUrl: serverHost ? `http://${serverHost}:${serverPort}` : '',
  });
});

router.post('/admin/settings/regenerate-shortcut', requireAdmin, (req, res) => {
  const { spawnSync } = require('child_process');
  const host = getSetting('server_host');
  if (!host) {
    return res.status(400).json({ error: 'Önce sunucu IP adresini kaydedin' });
  }
  const script = path.join(__dirname, '..', 'scripts', 'create-shortcut.js');
  const result = spawnSync(process.execPath, [script, host], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return res.status(500).json({
      error: 'Kısayol üretilemedi',
      detail: result.stderr || result.stdout,
    });
  }
  const port = getSetting('server_port') || '3080';
  res.json({
    ok: true,
    portalUrl: `http://${host}:${port}`,
    shortcutDir: 'kısayol/',
    output: result.stdout,
  });
});

// ── Meetings ──────────────────────────────────────────
router.get('/meetings', requireAuth, (req, res) => {
  if (!req.user.canMeet) return res.status(403).json({ error: 'Toplantı yetkisi yok' });
  const rows = db
    .prepare(
      `SELECT m.*, u.display_name as creator_name
       FROM meetings m JOIN users u ON u.id = m.created_by
       WHERE m.active = 1 ORDER BY m.created_at DESC`
    )
    .all();
  res.json({
    meetings: rows.map((m) => ({
      id: m.id,
      title: m.title,
      roomId: m.room_id,
      creatorName: m.creator_name,
      createdAt: m.created_at,
    })),
  });
});

router.post('/meetings', requireAuth, (req, res) => {
  if (!req.user.canMeet) return res.status(403).json({ error: 'Toplantı yetkisi yok' });
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Başlık gerekli' });
  const roomId = uuidv4().slice(0, 8);
  const result = db
    .prepare('INSERT INTO meetings (title, room_id, created_by) VALUES (?, ?, ?)')
    .run(title, roomId, req.user.id);
  res.json({ id: result.lastInsertRowid, roomId });
});

router.post('/meetings/:id/end', requireAuth, (req, res) => {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(Number(req.params.id));
  if (!meeting) return res.status(404).json({ error: 'Toplantı bulunamadı' });
  if (req.user.role !== 'admin' && meeting.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Yetki yok' });
  }
  db.prepare('UPDATE meetings SET active = 0 WHERE id = ?').run(meeting.id);
  res.json({ ok: true });
});

module.exports = router;
