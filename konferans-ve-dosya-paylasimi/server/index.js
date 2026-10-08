const path = require('path');
const os = require('os');
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const routes = require('./routes');
const { setupSocket } = require('./socket');
const { ensureDirs } = require('./crypto-files');

ensureDirs();

const PORT = Number(process.env.PORT) || 3080;
const app = express();
const server = http.createServer(app);

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'bodrum-tarim-portal-lan-secret-degistirin',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 12 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
  },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

app.use('/api', routes);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const io = new Server(server, {
  cors: { origin: true, credentials: true },
});
setupSocket(io, sessionMiddleware);

function lanAddresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
}

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  Bodrum İlçe Tarım Müdürlüğü — Kurum Portalı');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Yerel:    http://localhost:${PORT}`);
  addrs.forEach((a) => console.log(`  Ağ:       http://${a}:${PORT}`));
  console.log('');
  console.log('  Varsayılan yönetici: admin / Admin123!');
  console.log('  Dosya şifresi:       BodrumTarim2024!');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
});
