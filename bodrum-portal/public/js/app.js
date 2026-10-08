(() => {
  const state = {
    user: null,
    socket: null,
    importantMessages: [],
    currentMeeting: null,
    mesh: null,
    help: null,
    pendingHelp: null,
    micOn: true,
    camOn: true,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, 3500);
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleString('tr-TR');
    } catch {
      return iso;
    }
  }

  // ── Auth / boot ─────────────────────────────────────
  async function boot() {
    try {
      const data = await API.me();
      await enterApp(data.user, data.orgName);
    } catch {
      $('#login-screen').hidden = false;
      $('#app').hidden = true;
    }
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    try {
      const { user } = await API.login(
        $('#login-username').value.trim(),
        $('#login-password').value
      );
      const me = await API.me();
      await enterApp(user, me.orgName);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    leaveMeeting();
    if (state.socket) state.socket.disconnect();
    await API.logout();
    location.reload();
  });

  async function enterApp(user, orgName) {
    state.user = user;
    $('#login-screen').hidden = true;
    $('#app').hidden = false;
    $('#org-name').textContent = orgName || 'Bodrum İlçe Tarım Müdürlüğü';
    $('#current-user-name').textContent = user.displayName;
    $('#home-greeting').textContent = `Hoş geldiniz, ${user.displayName}`;

    if (user.role === 'admin') {
      $('#tab-admin').hidden = false;
    }
    if (user.canAnnounce || user.role === 'admin') {
      $('#announce-form').hidden = false;
    }

    connectSocket();
    await Promise.all([
      loadTicker(),
      loadAnnouncements(),
      loadChat(),
      loadFiles(),
      loadMeetings(),
    ]);
    if (user.role === 'admin') await loadAdmin();
  }

  // ── Tabs ────────────────────────────────────────────
  $('#main-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    $$('.tab').forEach((t) => t.classList.toggle('active', t === btn));
    $$('.panel').forEach((p) => p.classList.remove('active'));
    $(`#panel-${btn.dataset.tab}`).classList.add('active');
  });

  // ── Socket ──────────────────────────────────────────
  function connectSocket() {
    state.socket = io({ withCredentials: true });

    state.socket.on('presence:update', ({ users }) => {
      renderOnline(users || []);
    });

    state.socket.on('chat:message', (msg) => {
      appendChatMessage(msg);
      if (msg.isImportant) pushImportant(msg);
    });

    state.socket.on('chat:important', (msg) => {
      pushImportant(msg);
      toast(`Önemli mesaj: ${msg.displayName}`);
    });

    state.socket.on('meet:peers', async ({ peers }) => {
      for (const p of peers) {
        await ensureMeetPeer(p.socketId, p.user, true);
      }
    });

    state.socket.on('meet:peer-joined', async ({ socketId, user }) => {
      await ensureMeetPeer(socketId, user, false);
    });

    state.socket.on('meet:peer-left', ({ socketId }) => {
      if (state.mesh) state.mesh.closePeer(socketId);
      const tile = document.getElementById(`tile-${socketId}`);
      if (tile) tile.remove();
    });

    state.socket.on('meet:signal', async ({ from, signal }) => {
      if (state.mesh) await state.mesh.handleSignal(from, signal);
    });

    state.socket.on('meet:chat', (msg) => {
      const box = $('#meet-chat-messages');
      const div = document.createElement('div');
      div.innerHTML = `<strong>${escapeHtml(msg.displayName)}</strong>: ${escapeHtml(msg.content)}`;
      if (msg.isImportant) {
        div.prepend(Object.assign(document.createElement('span'), { className: 'red-dot', style: 'display:inline-block;margin-right:6px;vertical-align:middle' }));
      }
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    });

    state.socket.on('help:incoming', ({ fromSocketId, fromUser }) => {
      state.pendingHelp = { fromSocketId, fromUser };
      $('#help-prompt-text').textContent = `${fromUser.displayName} ekran yardımı istiyor.`;
      $('#help-prompt').hidden = false;
    });

    state.socket.on('help:accepted', async ({ fromSocketId }) => {
      await startHelpAsCaller(fromSocketId);
    });

    state.socket.on('help:signal', async ({ from, signal }) => {
      if (state.help) await state.help.handleSignal(signal);
    });

    state.socket.on('help:ended', () => {
      endHelpUi();
      toast('Ekran yardımı sonlandı');
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Online list / help request ──────────────────────
  function renderOnline(users) {
    const list = $('#online-list');
    list.innerHTML = '';
    users.forEach((u) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot"></span><span>${escapeHtml(u.displayName)}</span>`;
      if (u.isImportant) {
        li.insertAdjacentHTML('beforeend', ' <span class="red-dot" title="Önemli kullanıcı" style="margin-left:auto"></span>');
      }
      if (u.id !== state.user.id) {
        li.title = 'Ekran yardımı iste';
        li.addEventListener('click', () => {
          state.socket.emit('help:request', { targetUserId: u.id });
          toast(`${u.displayName} kullanıcısına yardım isteği gönderildi`);
        });
      }
      list.appendChild(li);
    });
  }

  $('#btn-help-accept').addEventListener('click', async () => {
    $('#help-prompt').hidden = true;
    if (!state.pendingHelp) return;
    const { fromSocketId, fromUser } = state.pendingHelp;
    state.socket.emit('help:accept', { toSocketId: fromSocketId });
    await startHelpAsAnswerer(fromSocketId, fromUser);
  });

  $('#btn-help-decline').addEventListener('click', () => {
    $('#help-prompt').hidden = true;
    state.pendingHelp = null;
  });

  async function startHelpAsCaller(remoteSocketId) {
    state.help = new HelpSession();
    state.help.setHandlers({
      sendSignal: (to, signal) => state.socket.emit('help:signal', { to, signal }),
      onRemoteStream: (stream) => {
        $('#help-remote-video').srcObject = stream;
      },
    });
    const local = await state.help.startAsCaller(remoteSocketId, true);
    $('#help-local-video').srcObject = local;
    $('#help-title').textContent = 'Ekran Yardımı (paylaşıyorsunuz)';
    $('#help-overlay').hidden = false;
  }

  async function startHelpAsAnswerer(fromSocketId, fromUser) {
    state.help = new HelpSession();
    state.help.setHandlers({
      sendSignal: (to, signal) => state.socket.emit('help:signal', { to, signal }),
      onRemoteStream: (stream) => {
        $('#help-remote-video').srcObject = stream;
      },
    });
    const local = await state.help.acceptIncoming(fromSocketId, false);
    $('#help-local-video').srcObject = local;
    $('#help-title').textContent = `Ekran Yardımı — ${fromUser.displayName}`;
    $('#help-overlay').hidden = false;
  }

  $('#btn-help-share').addEventListener('click', async () => {
    if (!state.help) return;
    try {
      const stream = await state.help.shareScreen();
      $('#help-local-video').srcObject = stream;
    } catch (e) {
      toast(e.message || 'Ekran paylaşılamadı');
    }
  });

  $('#btn-help-end').addEventListener('click', () => {
    if (state.help && state.help.remoteSocketId) {
      state.socket.emit('help:end', { to: state.help.remoteSocketId });
    }
    endHelpUi();
  });

  function endHelpUi() {
    if (state.help) state.help.end();
    state.help = null;
    state.pendingHelp = null;
    $('#help-remote-video').srcObject = null;
    $('#help-local-video').srcObject = null;
    $('#help-overlay').hidden = true;
  }

  // ── Ticker ──────────────────────────────────────────
  async function loadTicker() {
    const { items } = await API.ticker();
    const track = $('#ticker-track');
    if (!items.length) {
      track.innerHTML = '<span>Bodrum İlçe Tarım Müdürlüğü kurum portalı</span>';
      return;
    }
    const html = items.map((i) => `<span>${escapeHtml(i.text)}</span>`).join('');
    track.innerHTML = html + html;
  }

  // ── Important feed ──────────────────────────────────
  function pushImportant(msg) {
    state.importantMessages.unshift(msg);
    state.importantMessages = state.importantMessages.slice(0, 20);
    renderImportant();
  }

  function renderImportant() {
    const ul = $('#important-feed');
    ul.innerHTML = state.importantMessages
      .map(
        (m) => `<li>
          <span class="red-dot" title="Önemli"></span>
          <div>
            <strong>${escapeHtml(m.displayName)}</strong>
            <div>${escapeHtml(m.content)}</div>
            <div class="announce-meta">${formatTime(m.createdAt)}</div>
          </div>
        </li>`
      )
      .join('');
  }

  // ── Chat ────────────────────────────────────────────
  async function loadChat() {
    if (!state.user.canChat) {
      $('#chat-messages').innerHTML = '<p class="hint">Sohbet yetkiniz yok.</p>';
      return;
    }
    const { messages } = await API.messages('genel');
    $('#chat-messages').innerHTML = '';
    messages.forEach(appendChatMessage);
    messages.filter((m) => m.isImportant).forEach(pushImportant);
  }

  function appendChatMessage(msg) {
    const box = $('#chat-messages');
    const div = document.createElement('div');
    div.className = 'msg' + (msg.userId === state.user.id ? ' mine' : '') + (msg.isImportant ? ' important' : '');
    div.innerHTML = `
      <div class="msg-meta">
        ${msg.isImportant ? '<span class="red-dot"></span>' : ''}
        <strong>${escapeHtml(msg.displayName)}</strong>
        <span>${formatTime(msg.createdAt)}</span>
      </div>
      <div>${escapeHtml(msg.content)}</div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const content = input.value.trim();
    if (!content) return;
    state.socket.emit('chat:message', { room: 'genel', content });
    input.value = '';
  });

  // ── Announcements ───────────────────────────────────
  async function loadAnnouncements() {
    const { announcements } = await API.announcements();
    const render = (el) => {
      el.innerHTML = announcements
        .map(
          (a) => `<li>
            <h3>${escapeHtml(a.title)}</h3>
            <p>${escapeHtml(a.body)}</p>
            <div class="announce-meta">${escapeHtml(a.authorName)} · ${formatTime(a.createdAt)}</div>
          </li>`
        )
        .join('') || '<li class="hint">Henüz duyuru yok.</li>';
    };
    render($('#announce-list'));
    render($('#home-announcements'));
  }

  $('#announce-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await API.createAnnouncement($('#announce-title').value.trim(), $('#announce-body').value.trim());
      $('#announce-title').value = '';
      $('#announce-body').value = '';
      await loadAnnouncements();
      toast('Duyuru yayınlandı');
    } catch (ex) {
      toast(ex.message);
    }
  });

  // ── Files ───────────────────────────────────────────
  async function loadFiles() {
    if (!state.user.canFiles) {
      $('#files-tbody').innerHTML = '<tr><td colspan="6">Dosya erişim yetkiniz yok.</td></tr>';
      return;
    }
    const { files, canEdit } = await API.files();
    $('#files-edit-hint').textContent = canEdit
      ? 'Dosyaları güncelleyebilirsiniz; silme kapalıdır.'
      : 'Dosyaları görüntüleyip indirebilirsiniz; düzenleme yetkiniz yok.';

    const tbody = $('#files-tbody');
    tbody.innerHTML = files
      .map((f) => {
        const actions = [
          `<a class="btn btn-sm" href="/api/files/${f.id}/download" target="_blank">İndir</a>`,
          `<button type="button" class="btn btn-sm" data-audit="${f.id}">Kayıt</button>`,
        ];
        if (canEdit) {
          actions.push(
            `<label class="btn btn-sm">Güncelle<input type="file" hidden data-update="${f.id}" /></label>`
          );
        }
        return `<tr>
          <td>${escapeHtml(f.name)}</td>
          <td>${formatBytes(f.size)}</td>
          <td>v${f.version}</td>
          <td>${escapeHtml(f.uploadedBy)}</td>
          <td>${f.updatedBy ? `${escapeHtml(f.updatedBy)} · ${formatTime(f.updatedAt)}` : '—'}</td>
          <td style="display:flex;gap:0.35rem;flex-wrap:wrap">${actions.join('')}</td>
        </tr>`;
      })
      .join('') || '<tr><td colspan="6">Henüz dosya yok.</td></tr>';
  }

  $('#files-tbody').addEventListener('change', async (e) => {
    const input = e.target.closest('input[data-update]');
    if (!input || !input.files[0]) return;
    try {
      await API.updateFile(input.dataset.update, input.files[0]);
      toast('Dosya güncellendi');
      await loadFiles();
    } catch (ex) {
      toast(ex.message);
    }
  });

  $('#files-tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-audit]');
    if (!btn) return;
    const { audit } = await API.fileAudit(btn.dataset.audit);
    const box = $('#file-audit');
    box.hidden = false;
    $('#file-audit-list').innerHTML = audit
      .map(
        (a) =>
          `<li><strong>${escapeHtml(a.displayName)}</strong> — ${escapeHtml(a.action)}: ${escapeHtml(a.detail || '')} (${formatTime(a.createdAt)})</li>`
      )
      .join('') || '<li>Kayıt yok</li>';
  });

  $('#file-upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('#file-input').files[0];
    if (!file) return;
    try {
      await API.uploadFile(file);
      $('#file-input').value = '';
      toast('Dosya yüklendi (şifreli saklandı)');
      await loadFiles();
    } catch (ex) {
      toast(ex.message);
    }
  });

  // ── Meetings ────────────────────────────────────────
  async function loadMeetings() {
    if (!state.user.canMeet) return;
    const { meetings } = await API.meetings();
    $('#meet-list').innerHTML = meetings
      .map(
        (m) => `<li>
          <span><strong>${escapeHtml(m.title)}</strong> · ${escapeHtml(m.creatorName)}</span>
          <button type="button" class="btn btn-sm btn-primary" data-join="${m.roomId}" data-title="${escapeHtml(m.title)}">Katıl</button>
        </li>`
      )
      .join('') || '<li class="hint">Aktif toplantı yok.</li>';
  }

  $('#meet-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-join]');
    if (!btn) return;
    await joinMeeting(btn.dataset.join, btn.dataset.title);
  });

  $('#meet-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const title = $('#meet-title').value.trim();
      const { roomId } = await API.createMeeting(title);
      $('#meet-title').value = '';
      await loadMeetings();
      await joinMeeting(roomId, title);
    } catch (ex) {
      toast(ex.message);
    }
  });

  async function joinMeeting(roomId, title) {
    leaveMeeting(false);
    state.currentMeeting = roomId;
    $('#meet-room').hidden = false;
    $('#meet-room-title').textContent = title || roomId;
    $('#video-grid').innerHTML = '';
    $('#meet-chat-messages').innerHTML = '';

    state.mesh = new PeerMesh({
      onRemoteStream: (socketId, stream) => addVideoTile(socketId, stream, socketId),
      onPeerLeft: (socketId) => {
        const tile = document.getElementById(`tile-${socketId}`);
        if (tile) tile.remove();
      },
    });
    state.mesh.setSignalSender((to, signal) => {
      state.socket.emit('meet:signal', { to, signal, roomId });
    });

    try {
      const local = await state.mesh.ensureMedia({ audio: true, video: true });
      addVideoTile('local', local, 'Siz');
    } catch (ex) {
      toast('Kamera/mikrofon açılamadı: ' + ex.message);
    }

    state.socket.emit('meet:join', { roomId });
  }

  async function ensureMeetPeer(socketId, user, isInitiator) {
    if (!state.mesh) return;
    await state.mesh.createPeer(socketId, isInitiator);
    // tile will be created on ontrack
    const existing = document.getElementById(`tile-${socketId}`);
    if (!existing) {
      const placeholder = document.createElement('div');
      placeholder.className = 'video-tile';
      placeholder.id = `tile-${socketId}`;
      placeholder.innerHTML = `<span>${escapeHtml((user && user.displayName) || socketId)}</span>`;
      $('#video-grid').appendChild(placeholder);
    }
  }

  function addVideoTile(id, stream, label) {
    let tile = document.getElementById(`tile-${id}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'video-tile';
      tile.id = `tile-${id}`;
      $('#video-grid').appendChild(tile);
    }
    let video = tile.querySelector('video');
    if (!video) {
      video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      if (id === 'local') video.muted = true;
      tile.appendChild(video);
      const span = document.createElement('span');
      span.textContent = label;
      tile.appendChild(span);
    }
    video.srcObject = stream;
  }

  function leaveMeeting(emit = true) {
    if (state.currentMeeting && emit && state.socket) {
      state.socket.emit('meet:leave', { roomId: state.currentMeeting });
    }
    if (state.mesh) {
      state.mesh.destroy();
      state.mesh = null;
    }
    state.currentMeeting = null;
    $('#meet-room').hidden = true;
    $('#video-grid').innerHTML = '';
  }

  $('#btn-leave-meet').addEventListener('click', () => leaveMeeting());

  $('#btn-toggle-mic').addEventListener('click', () => {
    state.micOn = !state.micOn;
    if (state.mesh) state.mesh.toggleTrack('audio', state.micOn);
    $('#btn-toggle-mic').textContent = state.micOn ? 'Mikrofon' : 'Mikrofon Kapalı';
  });

  $('#btn-toggle-cam').addEventListener('click', () => {
    state.camOn = !state.camOn;
    if (state.mesh) state.mesh.toggleTrack('video', state.camOn);
    $('#btn-toggle-cam').textContent = state.camOn ? 'Kamera' : 'Kamera Kapalı';
  });

  $('#btn-share-screen').addEventListener('click', async () => {
    if (!state.mesh) return;
    try {
      await state.mesh.startScreenShare();
      toast('Ekran paylaşımı başladı');
    } catch (ex) {
      toast(ex.message || 'Paylaşım iptal');
    }
  });

  $('#meet-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#meet-chat-input');
    const content = input.value.trim();
    if (!content || !state.currentMeeting) return;
    state.socket.emit('meet:chat', { roomId: state.currentMeeting, content });
    input.value = '';
  });

  // ── Admin ───────────────────────────────────────────
  async function loadAdmin() {
    const [{ users }, { items }] = await Promise.all([API.adminUsers(), API.adminTicker()]);
    renderAdminUsers(users);
    renderAdminTicker(items);
  }

  function renderAdminUsers(users) {
    $('#admin-users-tbody').innerHTML = users
      .map((u) => {
        const perms = [
          u.isImportant ? 'Önemli' : null,
          u.canEditFiles ? 'Düzenle' : null,
          u.canChat ? 'Sohbet' : null,
          u.canMeet ? 'Toplantı' : null,
          u.canFiles ? 'Dosya' : null,
          u.canAnnounce ? 'Duyuru' : null,
          u.role === 'admin' ? 'Admin' : null,
          !u.active ? 'Pasif' : null,
        ]
          .filter(Boolean)
          .join(', ');
        return `<tr>
          <td>${escapeHtml(u.displayName)}<br><small>${escapeHtml(u.username)}</small></td>
          <td>${escapeHtml(perms)}</td>
          <td>
            <button type="button" class="btn btn-sm" data-toggle-important="${u.id}" data-val="${u.isImportant ? 0 : 1}">
              ${u.isImportant ? 'Önemliliği kaldır' : 'Önemli yap'}
            </button>
            <button type="button" class="btn btn-sm" data-toggle-edit="${u.id}" data-val="${u.canEditFiles ? 0 : 1}">
              ${u.canEditFiles ? 'Düzenlemeyi kapat' : 'Düzenleme aç'}
            </button>
          </td>
        </tr>`;
      })
      .join('');
  }

  $('#admin-users-tbody').addEventListener('click', async (e) => {
    const imp = e.target.closest('[data-toggle-important]');
    const edit = e.target.closest('[data-toggle-edit]');
    try {
      if (imp) {
        await API.updateUser(imp.dataset.toggleImportant, {
          isImportant: imp.dataset.val === '1',
        });
        toast('Güncellendi');
        await loadAdmin();
      }
      if (edit) {
        await API.updateUser(edit.dataset.toggleEdit, {
          canEditFiles: edit.dataset.val === '1',
        });
        toast('Güncellendi');
        await loadAdmin();
      }
    } catch (ex) {
      toast(ex.message);
    }
  });

  $('#user-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await API.createUser({
        username: $('#new-username').value.trim(),
        displayName: $('#new-displayname').value.trim(),
        password: $('#new-password').value,
        isImportant: $('#new-important').checked,
        canEditFiles: $('#new-edit-files').checked,
        canChat: $('#new-chat').checked,
        canMeet: $('#new-meet').checked,
        canFiles: $('#new-files').checked,
        canAnnounce: $('#new-announce').checked,
      });
      e.target.reset();
      $('#new-edit-files').checked = true;
      $('#new-chat').checked = true;
      $('#new-meet').checked = true;
      $('#new-files').checked = true;
      toast('Kullanıcı eklendi');
      await loadAdmin();
    } catch (ex) {
      toast(ex.message);
    }
  });

  function renderAdminTicker(items) {
    $('#admin-ticker-list').innerHTML = items
      .map(
        (i) => `<li>
          <span>${i.active ? '' : '<em>[pasif] </em>'}${escapeHtml(i.text)}</span>
          <span>
            <button type="button" class="btn btn-sm" data-ticker-toggle="${i.id}" data-active="${i.active ? 0 : 1}">
              ${i.active ? 'Pasifleştir' : 'Aktifleştir'}
            </button>
            <button type="button" class="btn btn-sm btn-danger" data-ticker-del="${i.id}">Sil</button>
          </span>
        </li>`
      )
      .join('');
  }

  $('#ticker-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await API.addTicker($('#ticker-text').value.trim());
      $('#ticker-text').value = '';
      await loadAdmin();
      await loadTicker();
      toast('Kayan yazı eklendi');
    } catch (ex) {
      toast(ex.message);
    }
  });

  $('#admin-ticker-list').addEventListener('click', async (e) => {
    const tog = e.target.closest('[data-ticker-toggle]');
    const del = e.target.closest('[data-ticker-del]');
    try {
      if (tog) {
        await API.updateTicker(tog.dataset.tickerToggle, { active: tog.dataset.active === '1' });
        await loadAdmin();
        await loadTicker();
      }
      if (del) {
        await API.deleteTicker(del.dataset.tickerDel);
        await loadAdmin();
        await loadTicker();
      }
    } catch (ex) {
      toast(ex.message);
    }
  });

  $('#enc-unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await API.unlockFiles($('#enc-unlock').value);
      $('#enc-status').textContent = 'Doğrulama başarılı. Şifreli depo erişimi onaylandı.';
      toast('Dosya şifresi doğrulandı');
    } catch (ex) {
      $('#enc-status').textContent = ex.message;
      toast(ex.message);
    }
  });

  $('#enc-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await API.changeEncPassword($('#enc-current').value, $('#enc-new').value);
      $('#enc-status').textContent = `${r.reencrypted} dosya yeniden şifrelendi.`;
      e.target.reset();
      toast('Şifreleme anahtarı güncellendi');
    } catch (ex) {
      toast(ex.message);
    }
  });

  boot();
})();
