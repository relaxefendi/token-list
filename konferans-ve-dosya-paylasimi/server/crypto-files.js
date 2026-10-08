const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

const ENCRYPTED_DIR = path.join(__dirname, '..', 'dosyalar', 'encrypted');
const META_DIR = path.join(__dirname, '..', 'dosyalar', 'meta');

function ensureDirs() {
  [ENCRYPTED_DIR, META_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

ensureDirs();

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
}

function encryptBuffer(buffer, password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: salt + iv + authTag + ciphertext
  return Buffer.concat([salt, iv, authTag, encrypted]);
}

function decryptBuffer(encryptedBuffer, password) {
  const salt = encryptedBuffer.subarray(0, SALT_LENGTH);
  const iv = encryptedBuffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = encryptedBuffer.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = encryptedBuffer.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function saveEncryptedFile(storedName, buffer, password) {
  ensureDirs();
  const encrypted = encryptBuffer(buffer, password);
  const filePath = path.join(ENCRYPTED_DIR, storedName);
  fs.writeFileSync(filePath, encrypted);
  return filePath;
}

function readEncryptedFile(storedName, password) {
  const filePath = path.join(ENCRYPTED_DIR, storedName);
  if (!fs.existsSync(filePath)) {
    throw new Error('Dosya bulunamadı');
  }
  const encrypted = fs.readFileSync(filePath);
  return decryptBuffer(encrypted, password);
}

function encryptedExists(storedName) {
  return fs.existsSync(path.join(ENCRYPTED_DIR, storedName));
}

module.exports = {
  ENCRYPTED_DIR,
  META_DIR,
  saveEncryptedFile,
  readEncryptedFile,
  encryptedExists,
  encryptBuffer,
  decryptBuffer,
  ensureDirs,
};
