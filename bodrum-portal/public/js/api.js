const API = {
  async request(path, options = {}) {
    const opts = {
      credentials: 'include',
      headers: {},
      ...options,
    };
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(`/api${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `İstek başarısız (${res.status})`);
    }
    return data;
  },

  login(username, password) {
    return this.request('/auth/login', { method: 'POST', body: { username, password } });
  },
  logout() {
    return this.request('/auth/logout', { method: 'POST', body: {} });
  },
  me() {
    return this.request('/auth/me');
  },
  ticker() {
    return this.request('/ticker');
  },
  announcements() {
    return this.request('/announcements');
  },
  createAnnouncement(title, body) {
    return this.request('/announcements', { method: 'POST', body: { title, body } });
  },
  messages(room = 'genel') {
    return this.request(`/messages/${encodeURIComponent(room)}`);
  },
  files() {
    return this.request('/files');
  },
  uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    return this.request('/files', { method: 'POST', body: fd });
  },
  updateFile(id, file) {
    const fd = new FormData();
    fd.append('file', file);
    return this.request(`/files/${id}`, { method: 'PUT', body: fd });
  },
  fileAudit(id) {
    return this.request(`/files/${id}/audit`);
  },
  meetings() {
    return this.request('/meetings');
  },
  createMeeting(title) {
    return this.request('/meetings', { method: 'POST', body: { title } });
  },
  endMeeting(id) {
    return this.request(`/meetings/${id}/end`, { method: 'POST', body: {} });
  },
  adminUsers() {
    return this.request('/admin/users');
  },
  createUser(data) {
    return this.request('/admin/users', { method: 'POST', body: data });
  },
  updateUser(id, data) {
    return this.request(`/admin/users/${id}`, { method: 'PUT', body: data });
  },
  adminTicker() {
    return this.request('/admin/ticker');
  },
  addTicker(text) {
    return this.request('/admin/ticker', { method: 'POST', body: { text } });
  },
  updateTicker(id, data) {
    return this.request(`/admin/ticker/${id}`, { method: 'PUT', body: data });
  },
  deleteTicker(id) {
    return this.request(`/admin/ticker/${id}`, { method: 'DELETE' });
  },
  unlockFiles(password) {
    return this.request('/admin/files/unlock', { method: 'POST', body: { password } });
  },
  changeEncPassword(currentPassword, newPassword) {
    return this.request('/admin/settings/encryption-password', {
      method: 'PUT',
      body: { currentPassword, newPassword },
    });
  },
  adminSettings() {
    return this.request('/admin/settings');
  },
  saveSettings(data) {
    return this.request('/admin/settings', { method: 'PUT', body: data });
  },
  regenerateShortcut() {
    return this.request('/admin/settings/regenerate-shortcut', { method: 'POST', body: {} });
  },
};
