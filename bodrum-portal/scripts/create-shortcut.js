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

const ip = process.argv[2] || lanIp();
const url = `http://${ip}:${PORT}`;
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
