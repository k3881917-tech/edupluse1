// Шифрование сессии и пароля (AES-256-GCM, ключ из SECRET_KEY).
import crypto from 'node:crypto';

function key() {
  const s = process.env.SECRET_KEY;
  if (!s || s.length < 16) throw new Error('SECRET_KEY не задан (нужна строка от 16 символов)');
  return crypto.createHash('sha256').update(s).digest();
}

export function enc(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

export function dec(token) {
  if (!token) return null;
  try {
    const b = Buffer.from(token, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

/** Секрет для вебхука Telegram — выводится из SECRET_KEY, отдельно хранить не нужно. */
export const webhookSecret = () => crypto.createHash('sha256').update('tg:' + process.env.SECRET_KEY).digest('hex').slice(0, 48);
