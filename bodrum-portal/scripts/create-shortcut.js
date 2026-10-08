#!/usr/bin/env node
/**
 * Ortak klasör / masaüstü için bağlantı kısayolları üretir.
 * Windows (.url) ve genel HTML yönlendirici oluşturur.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 3080;

function lanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'SUNUCU_IP';
}

// Prefer admin-configured host/port from DB when available
function configuredHostPort() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(__dirname, '..', 'data', 'portal.db');
    if (!require('fs').existsSync(dbPath)) return null;
    const db = new Database(dbPath, { readonly: true });
    const host = db.prepare("SELECT value FROM settings WHERE key = 'server_host'").get();
    const port = db.prepare("SELECT value FROM settings WHERE key = 'server_port'").get();
    db.close();
    if (host && host.value) {
      return { host: host.value, port: Number(port && port.value) || PORT };
    }
  } catch (_) {}
  return null;
}

const configured = configuredHostPort();
const ip = process.argv[2] || (configured && configured.host) || lanIp();
const effectivePort = (configured && !process.argv[2] && configured.port) || PORT;
const url = `http://${ip}:${effectivePort}`;
const outDir = path.join(__dirname, '..', 'kısayol');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const urlContent = `[InternetShortcut]
URL=${url}
IconIndex=0
`;

fs.writeFileSync(
  path.join(outDir, 'Bodrum Tarim Portali.url'),
  urlContent,
  'utf8'
);

const batContent = `@echo off
start "" "${url}"
`;

fs.writeFileSync(
  path.join(outDir, 'Bodrum Tarim Portali.bat'),
  batContent,
  'utf8'
);

const htmlContent = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="0;url=${url}" />
  <title>Bodrum İlçe Tarım Portalı</title>
</head>
<body>
  <p>Yönlendiriliyorsunuz… <a href="${url}">${url}</a></p>
</body>
</html>
`;

fs.writeFileSync(path.join(outDir, 'portal-ac.html'), htmlContent, 'utf8');

const readme = `Bodrum İlçe Tarım Müdürlüğü — Ortak Klasör Kısayolu
====================================================

1. Bu "kısayol" klasörünü sunucudaki ortak paylaşılan klasöre kopyalayın.
2. Kullanıcılar "Bodrum Tarim Portali.url" veya ".bat" dosyasına çift tıklayarak portala bağlanır.
3. Adres: ${url}

Kurulum (sunucu bilgisayarında):
  cd bodrum-portal
  npm install
  npm start

Varsayılan yönetici: admin / Admin123!
`;

fs.writeFileSync(path.join(outDir, 'KURULUM.txt'), readme, 'utf8');

console.log('Kısayollar oluşturuldu:', outDir);
console.log('Portal adresi:', url);
