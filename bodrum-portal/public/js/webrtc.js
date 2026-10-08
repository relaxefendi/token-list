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

/** Simple 1:1 help session */
class HelpSession {
  constructor() {
    this.pc = null;
    this.localStream = null;
    this.remoteSocketId = null;
    this.sendSignal = null;
    this.onRemoteStream = null;
  }

  setHandlers({ sendSignal, onRemoteStream }) {
    this.sendSignal = sendSignal;
    this.onRemoteStream = onRemoteStream;
  }

  async startAsCaller(remoteSocketId, shareScreen) {
    this.remoteSocketId = remoteSocketId;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this._wirePc();

    if (shareScreen) {
      this.localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } else {
      this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    }
    this.localStream.getTracks().forEach((t) => this.pc.addTrack(t, this.localStream));

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendSignal(remoteSocketId, { type: 'offer', sdp: this.pc.localDescription });
    return this.localStream;
  }

  async acceptIncoming(fromSocketId, shareScreen) {
    this.remoteSocketId = fromSocketId;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this._wirePc();

    if (shareScreen) {
      this.localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } else {
      this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    }
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
    } else if (signal.type === 'candidate') {
      try {
        await this.pc.addIceCandidate(signal.candidate);
      } catch (_) {}
    }
  }

  async shareScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender) await sender.replaceTrack(track);
    if (this.localStream) {
      const old = this.localStream.getVideoTracks()[0];
      if (old) {
        this.localStream.removeTrack(old);
        old.stop();
      }
      this.localStream.addTrack(track);
    }
    return stream;
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
  }
}

window.PeerMesh = PeerMesh;
window.HelpSession = HelpSession;
