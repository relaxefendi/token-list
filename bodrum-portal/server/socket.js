const db = require('./db');
const { sanitizeUser } = require('./auth');

/** @type {Map<number, { socketId: string, user: object }>} */
const onlineUsers = new Map();

/** @type {Map<string, Set<string>>} meetingRoomId -> socketIds */
const meetingRooms = new Map();

function getOnlineList() {
  return Array.from(onlineUsers.values()).map((e) => e.user);
}

function setupSocket(io, sessionMiddleware) {
  io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
  });

  io.on('connection', (socket) => {
    const session = socket.request.session;
    if (!session || !session.userId) {
      socket.disconnect(true);
      return;
    }

    const row = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(session.userId);
    if (!row) {
      socket.disconnect(true);
      return;
    }

    const user = sanitizeUser(row);
    onlineUsers.set(user.id, { socketId: socket.id, user });
    db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(user.id);

    io.emit('presence:update', { users: getOnlineList() });
    socket.emit('presence:update', { users: getOnlineList() });

    socket.join('chat:genel');

    // ── Chat ──────────────────────────────────────────
    socket.on('chat:join', (room) => {
      if (!user.canChat) return;
      const r = room || 'genel';
      socket.join(`chat:${r}`);
    });

    socket.on('chat:message', (payload) => {
      if (!user.canChat) return;
      const content = (payload && payload.content || '').trim();
      if (!content) return;
      const room = (payload && payload.room) || 'genel';
      const isImportant = user.isImportant ? 1 : 0;

      const result = db
        .prepare(
          'INSERT INTO messages (room, user_id, content, is_important) VALUES (?, ?, ?, ?)'
        )
        .run(room, user.id, content, isImportant);

      const message = {
        id: result.lastInsertRowid,
        room,
        content,
        userId: user.id,
        displayName: user.displayName,
        isImportant: !!isImportant,
        createdAt: new Date().toISOString(),
      };

      io.to(`chat:${room}`).emit('chat:message', message);
      if (isImportant) {
        io.emit('chat:important', message);
      }
    });

    // ── WebRTC signaling (meetings / screen share) ───
    socket.on('meet:join', ({ roomId }) => {
      if (!user.canMeet || !roomId) return;
      socket.join(`meet:${roomId}`);
      if (!meetingRooms.has(roomId)) meetingRooms.set(roomId, new Set());
      meetingRooms.get(roomId).add(socket.id);

      const peers = Array.from(meetingRooms.get(roomId)).filter((id) => id !== socket.id);
      socket.emit('meet:peers', {
        peers: peers.map((id) => {
          const entry = [...onlineUsers.values()].find((e) => e.socketId === id);
          return { socketId: id, user: entry ? entry.user : null };
        }),
      });

      socket.to(`meet:${roomId}`).emit('meet:peer-joined', {
        socketId: socket.id,
        user,
      });
    });

    socket.on('meet:leave', ({ roomId }) => {
      if (!roomId) return;
      socket.leave(`meet:${roomId}`);
      const set = meetingRooms.get(roomId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) meetingRooms.delete(roomId);
      }
      socket.to(`meet:${roomId}`).emit('meet:peer-left', { socketId: socket.id });
    });

    socket.on('meet:signal', ({ to, signal, roomId }) => {
      io.to(to).emit('meet:signal', {
        from: socket.id,
        signal,
        roomId,
        user,
      });
    });

    socket.on('meet:chat', ({ roomId, content }) => {
      if (!user.canMeet || !roomId || !content) return;
      io.to(`meet:${roomId}`).emit('meet:chat', {
        socketId: socket.id,
        displayName: user.displayName,
        content: String(content).trim(),
        createdAt: new Date().toISOString(),
        isImportant: user.isImportant,
      });
    });

    // One-to-one screen help
    socket.on('help:request', ({ targetUserId }) => {
      const target = onlineUsers.get(Number(targetUserId));
      if (!target) return;
      io.to(target.socketId).emit('help:incoming', {
        fromSocketId: socket.id,
        fromUser: user,
      });
    });

    socket.on('help:accept', ({ toSocketId }) => {
      io.to(toSocketId).emit('help:accepted', {
        fromSocketId: socket.id,
        fromUser: user,
      });
    });

    socket.on('help:signal', ({ to, signal }) => {
      io.to(to).emit('help:signal', { from: socket.id, signal, user });
    });

    socket.on('help:end', ({ to }) => {
      if (to) io.to(to).emit('help:ended', { from: socket.id });
    });

    socket.on('disconnect', () => {
      onlineUsers.delete(user.id);
      for (const [roomId, set] of meetingRooms.entries()) {
        if (set.has(socket.id)) {
          set.delete(socket.id);
          socket.to(`meet:${roomId}`).emit('meet:peer-left', { socketId: socket.id });
          if (set.size === 0) meetingRooms.delete(roomId);
        }
      }
      io.emit('presence:update', { users: getOnlineList() });
    });
  });
}

module.exports = { setupSocket, getOnlineList };
