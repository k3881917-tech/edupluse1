// Проверка подписи Telegram WebApp initData.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
import crypto from 'node:crypto';

export class AuthError extends Error {}

export function validate(initData, botToken, maxAge = 24 * 3600) {
  if (!initData) throw new AuthError('нет initData');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new AuthError('нет подписи');
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(check).digest('hex');
  if (expected.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) {
    throw new AuthError('неверная подпись');
  }
  if (maxAge && Date.now() / 1000 - Number(params.get('auth_date') || 0) > maxAge) throw new AuthError('initData устарела');
  const user = JSON.parse(params.get('user') || '{}');
  if (!user.id) throw new AuthError('нет пользователя');
  return user;
}
