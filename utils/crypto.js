// utils/crypto.js
const crypto = require('crypto');

const ALGO = 'aes-256-cbc';
const KEY = Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'utf8');
const IV = Buffer.from(process.env.DATA_ENCRYPTION_IV, 'utf8');

function encrypt(text) {
  if (!text) return null;
  const cipher = crypto.createCipheriv(ALGO, KEY, IV);
  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function decrypt(encrypted) {
  if (!encrypted) return null;
  const decipher = crypto.createDecipheriv(ALGO, KEY, IV);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
