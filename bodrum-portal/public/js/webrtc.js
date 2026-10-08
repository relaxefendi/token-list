/**
 * Lightweight WebRTC helpers for meetings and screen-help sessions.
 */
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

class PeerMesh {
  constructor({ onRemoteStream, onPeerLeft }) {
    this.peers = new Map(); // socketId -> RTCPeerConnection
    this.localStream = null;
    this.screenStream = null;
    this.onRemoteStream = onRemoteStream;
    this.onPeerLeft = onPeerLeft;
    this.sendSignal = null;
  }

  setSignalSender(fn) {
    this.sendSignal = fn;
  }

  async ensureMedia({ audio = true, video = true } = {}) {
    if (this.localStream) return this.localStream;
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio, video });
    return this.localStream;
  }

  async startScreenShare() {
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const screenTrack = this.screenStream.getVideoTracks()[0];
    for (const pc of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) await sender.replaceTrack(screenTrack);
    }
    screenTrack.onended = () => this.stopScreenShare();
    return this.screenStream;
  }

  async stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    if (this.localStream) {
      const cam = this.localStream.getVideoTracks()[0];
      for (const pc of this.peers.values()) {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender && cam) await sender.replaceTrack(cam);
      }
    }
  }

  toggleTrack(kind, enabled) {
    if (!this.localStream) return;
    this.localStream.getTracks().forEach((t) => {
      if (t.kind === kind) t.enabled = enabled;
    });
  }

  async createPeer(remoteSocketId, isInitiator) {
    if (this.peers.has(remoteSocketId)) return this.peers.get(remoteSocketId);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(remoteSocketId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => pc.addTrack(track, this.localStream));
    }

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      this.onRemoteStream(remoteSocketId, stream);
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.sendSignal) {
        this.sendSignal(remoteSocketId, { type: 'candidate', candidate: ev.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        this.closePeer(remoteSocketId);
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal(remoteSocketId, { type: 'offer', sdp: pc.localDescription });
    }

    return pc;
  }

  async handleSignal(from, signal) {
    let pc = this.peers.get(from);
    if (!pc && signal.type === 'offer') {
      pc = await this.createPeer(from, false);
    }
    if (!pc) return;

    if (signal.type === 'offer') {
      await pc.setRemoteDescription(signal.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal(from, { type: 'answer', sdp: pc.localDescription });
    } else if (signal.type === 'answer') {
      await pc.setRemoteDescription(signal.sdp);
    } else if (signal.type === 'candidate' && signal.candidate) {
      try {
        await pc.addIceCandidate(signal.candidate);
      } catch (_) {
        /* ignore late candidates */
      }
    }
  }

  closePeer(socketId) {
    const pc = this.peers.get(socketId);
    if (pc) {
      pc.close();
      this.peers.delete(socketId);
      if (this.onPeerLeft) this.onPeerLeft(socketId);
    }
  }

  destroy() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    this.stopScreenShare();
  }
}

/**
 * 1:1 call session — video / audio / screen
 * type: 'video' | 'audio' | 'screen'
 */
class CallSession {
  constructor() {
    this.pc = null;
    this.localStream = null;
    this.remoteSocketId = null;
    this.callId = null;
    this.type = 'video';
    this.sendSignal = null;
    this.onRemoteStream = null;
    this.micOn = true;
    this.camOn = true;
  }

  setHandlers({ sendSignal, onRemoteStream }) {
    this.sendSignal = sendSignal;
    this.onRemoteStream = onRemoteStream;
  }

  async _getMedia(type) {
    if (type === 'screen') {
      return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    }
    if (type === 'audio') {
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    return navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  }

  async startAsCaller(remoteSocketId, type = 'video') {
    this.remoteSocketId = remoteSocketId;
    this.type = type;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this._wirePc();
    this.localStream = await this._getMedia(type);
    this.localStream.getTracks().forEach((t) => this.pc.addTrack(t, this.localStream));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignal(remoteSocketId, { type: 'offer', sdp: this.pc.localDescription });
    return this.localStream;
  }

  async prepareAsCallee(fromSocketId, type = 'video') {
    this.remoteSocketId = fromSocketId;
    this.type = type;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this._wirePc();
    this.localStream = await this._getMedia(type === 'screen' ? 'video' : type);
    this.localStream.getTracks().forEach((t) => this.pc.addTrack(t, this.localStream));
    return this.localStream;
  }

  _wirePc() {
    this.pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      if (this.onRemoteStream) this.onRemoteStream(stream);
    };
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate && this.sendSignal && this.remoteSocketId) {
        this.sendSignal(this.remoteSocketId, { type: 'candidate', candidate: ev.candidate });
      }
    };
  }

  async handleSignal(signal) {
    if (!this.pc) return;
    if (signal.type === 'offer') {
      await this.pc.setRemoteDescription(signal.sdp);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendSignal(this.remoteSocketId, { type: 'answer', sdp: this.pc.localDescription });
    } else if (signal.type === 'answer') {
      await this.pc.setRemoteDescription(signal.sdp);
    } else if (signal.type === 'candidate' && signal.candidate) {
      try {
        await this.pc.addIceCandidate(signal.candidate);
      } catch (_) {}
    }
  }

  toggleTrack(kind, enabled) {
    if (!this.localStream) return;
    this.localStream.getTracks().forEach((t) => {
      if (t.kind === kind) t.enabled = enabled;
    });
  }

  async shareScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender) await sender.replaceTrack(track);
    else this.pc.addTrack(track, stream);
    if (this.localStream) {
      const old = this.localStream.getVideoTracks()[0];
      if (old) {
        this.localStream.removeTrack(old);
        old.stop();
      }
      this.localStream.addTrack(track);
    } else {
      this.localStream = stream;
    }
    track.onended = () => {};
    return this.localStream;
  }

  end() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    this.remoteSocketId = null;
    this.callId = null;
  }
}

/** Chunked file transfer over socket (base64) */
async function sendFileOverSocket({ socket, event, to, callId, file, onProgress }) {
  const CHUNK = 48 * 1024;
  const buffer = await file.arrayBuffer();
  const total = Math.ceil(buffer.byteLength / CHUNK) || 1;
  const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (let i = 0; i < total; i++) {
    const slice = buffer.slice(i * CHUNK, (i + 1) * CHUNK);
    const bytes = new Uint8Array(slice);
    let binary = '';
    for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
    socket.emit(event, {
      to,
      callId,
      transferId,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      index: i,
      total,
      data: btoa(binary),
    });
    if (onProgress) onProgress(i + 1, total);
    await new Promise((r) => setTimeout(r, 0));
  }
  return transferId;
}

function createFileReceiver(onComplete) {
  const transfers = new Map();
  return function handleChunk(payload) {
    const id = payload.transferId;
    if (!transfers.has(id)) {
      transfers.set(id, {
        name: payload.name,
        mimeType: payload.mimeType,
        size: payload.size,
        total: payload.total,
        chunks: [],
        fromUser: payload.fromUser,
      });
    }
    const t = transfers.get(id);
    t.chunks[payload.index] = payload.data;
    const received = t.chunks.filter(Boolean).length;
    if (received >= t.total) {
      const binary = t.chunks.map((c) => atob(c)).join('');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: t.mimeType });
      const url = URL.createObjectURL(blob);
      transfers.delete(id);
      onComplete({ name: t.name, size: t.size, url, fromUser: t.fromUser });
    }
    return { received, total: t.total, name: t.name };
  };
}

/** Ringtone via Web Audio API */
class Ringtone {
  constructor() {
    this.ctx = null;
    this.timer = null;
    this.playing = false;
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    const beep = () => {
      if (!this.playing || !this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);
      osc.stop(this.ctx.currentTime + 0.4);
      setTimeout(() => {
        if (!this.playing || !this.ctx) return;
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.value = 660;
        gain2.gain.value = 0.08;
        osc2.connect(gain2);
        gain2.connect(this.ctx.destination);
        osc2.start();
        gain2.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);
        osc2.stop(this.ctx.currentTime + 0.4);
      }, 400);
    };
    beep();
    this.timer = setInterval(beep, 1800);
  }

  stop() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

window.PeerMesh = PeerMesh;
window.CallSession = CallSession;
window.HelpSession = CallSession; // alias
window.sendFileOverSocket = sendFileOverSocket;
window.createFileReceiver = createFileReceiver;
window.Ringtone = Ringtone;
