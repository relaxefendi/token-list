const db = require('./db');
const { sanitizeUser } = require('./auth');

/** @type {Map<number, { socketId: string, user: object }>} */
const onlineUsers = new Map();

/** @type {Map<string, Set<string>>} meetingRoomId -> socketIds */
const meetingRooms = new Map();

/** Active 1:1 calls: callId -> { fromUserId, toUserId, fromSocketId, toSocketId, type, status } */
const activeCalls = new Map();

function getOnlineList() {
  return Array.from(onlineUsers.values()).map((e) => e.user);
}

function findUserBySocket(socketId) {
  for (const entry of onlineUsers.values()) {
    if (entry.socketId === socketId) return entry;
  }
  return null;
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

    // ── WebRTC signaling (meetings) ───────────────────
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

    // Meeting file share (via server relay metadata; content via datachannel or upload)
    socket.on('meet:file-meta', ({ roomId, name, size, mimeType }) => {
      if (!roomId || !name) return;
      socket.to(`meet:${roomId}`).emit('meet:file-meta', {
        fromSocketId: socket.id,
        displayName: user.displayName,
        name,
        size,
        mimeType,
      });
    });

    // ── 1:1 Calls (video / audio / screen) with ring ──
    socket.on('call:invite', ({ targetUserId, type }) => {
      if (!user.canMeet) return;
      const callType = ['video', 'audio', 'screen'].includes(type) ? type : 'video';
      const target = onlineUsers.get(Number(targetUserId));
      if (!target) {
        socket.emit('call:failed', { reason: 'Kullanıcı çevrimdışı' });
        return;
      }
      if (target.user.id === user.id) return;

      // Busy check
      for (const c of activeCalls.values()) {
        if (
          c.status === 'ringing' ||
          c.status === 'active'
        ) {
          if (
            c.fromUserId === user.id ||
            c.toUserId === user.id ||
            c.fromUserId === target.user.id ||
            c.toUserId === target.user.id
          ) {
            socket.emit('call:failed', { reason: 'Hat meşgul' });
            return;
          }
        }
      }

      const callId = `${Date.now()}-${user.id}-${target.user.id}`;
      activeCalls.set(callId, {
        callId,
        fromUserId: user.id,
        toUserId: target.user.id,
        fromSocketId: socket.id,
        toSocketId: target.socketId,
        type: callType,
        status: 'ringing',
      });

      io.to(target.socketId).emit('call:incoming', {
        callId,
        type: callType,
        fromSocketId: socket.id,
        fromUser: user,
      });

      socket.emit('call:ringing', {
        callId,
        type: callType,
        toSocketId: target.socketId,
        toUser: target.user,
      });
    });

    socket.on('call:accept', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call || call.toUserId !== user.id) return;
      call.status = 'active';
      call.toSocketId = socket.id;
      io.to(call.fromSocketId).emit('call:accepted', {
        callId,
        type: call.type,
        fromSocketId: socket.id,
        fromUser: user,
      });
      socket.emit('call:accepted-ack', {
        callId,
        type: call.type,
        peerSocketId: call.fromSocketId,
        peerUser: sanitizeUser(
          db.prepare('SELECT * FROM users WHERE id = ?').get(call.fromUserId)
        ),
      });
    });

    socket.on('call:reject', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      if (call.toUserId !== user.id && call.fromUserId !== user.id) return;
      io.to(call.fromSocketId).emit('call:rejected', {
        callId,
        byUser: user,
      });
      io.to(call.toSocketId).emit('call:rejected', {
        callId,
        byUser: user,
      });
      activeCalls.delete(callId);
    });

    socket.on('call:cancel', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call || call.fromUserId !== user.id) return;
      io.to(call.toSocketId).emit('call:cancelled', {
        callId,
        byUser: user,
      });
      activeCalls.delete(callId);
    });

    socket.on('call:signal', ({ callId, to, signal }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      io.to(to).emit('call:signal', {
        callId,
        from: socket.id,
        signal,
        user,
      });
    });

    socket.on('call:end', ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      const other =
        call.fromSocketId === socket.id ? call.toSocketId : call.fromSocketId;
      if (other) io.to(other).emit('call:ended', { callId, byUser: user });
      activeCalls.delete(callId);
    });

    // Call / meeting file transfer via socket relay (chunked base64) — reliable on LAN
    socket.on('call:file-chunk', (payload) => {
      if (!payload || !payload.to || !payload.callId) return;
      const callId = String(payload.callId);
      const isMeet = callId.startsWith('meet-');
      if (!isMeet) {
        const call = activeCalls.get(callId);
        if (!call || call.status !== 'active') return;
      } else {
        const roomId = callId.slice(5);
        const set = meetingRooms.get(roomId);
        if (!set || !set.has(socket.id) || !set.has(payload.to)) return;
      }
      io.to(payload.to).emit('call:file-chunk', {
        ...payload,
        fromSocketId: socket.id,
        fromUser: user,
      });
    });

    // Legacy screen-help aliases (map to call type screen)
    socket.on('help:request', ({ targetUserId }) => {
      const target = onlineUsers.get(Number(targetUserId));
      if (!target || !user.canMeet) return;
      for (const c of activeCalls.values()) {
        if (
          (c.status === 'ringing' || c.status === 'active') &&
          (c.fromUserId === user.id ||
            c.toUserId === user.id ||
            c.fromUserId === target.user.id ||
            c.toUserId === target.user.id)
        ) {
          socket.emit('call:failed', { reason: 'Hat meşgul' });
          return;
        }
      }
      const callId = `${Date.now()}-${user.id}-${target.user.id}`;
      activeCalls.set(callId, {
        callId,
        fromUserId: user.id,
        toUserId: target.user.id,
        fromSocketId: socket.id,
        toSocketId: target.socketId,
        type: 'screen',
        status: 'ringing',
      });
      io.to(target.socketId).emit('call:incoming', {
        callId,
        type: 'screen',
        fromSocketId: socket.id,
        fromUser: user,
      });
      socket.emit('call:ringing', {
        callId,
        type: 'screen',
        toSocketId: target.socketId,
        toUser: target.user,
      });
    });

    socket.on('disconnect', () => {
      onlineUsers.delete(user.id);

      for (const [callId, call] of [...activeCalls.entries()]) {
        if (call.fromUserId === user.id || call.toUserId === user.id) {
          const other =
            call.fromSocketId === socket.id ? call.toSocketId : call.fromSocketId;
          if (other) {
            io.to(other).emit('call:ended', { callId, byUser: user, reason: 'disconnect' });
            io.to(other).emit('call:cancelled', { callId, byUser: user });
          }
          activeCalls.delete(callId);
        }
      }

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
