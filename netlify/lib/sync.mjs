// Синхронизация пользователя с Дневник.ру.
import { enc, dec } from './crypto.mjs';
import * as dnevnik from './dnevnik.mjs';
import { diary as transform } from './transform.mjs';
import { getDiary, saveDiary, saveUser } from './store.mjs';

const TZ = 'Europe/Moscow';
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
export const hourNow = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()));
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** Примерные границы четвертей. Каникулы относим к следующей четверти. */
export function quarter(d = today()) {
  const y = +d.slice(5, 7) >= 9 ? +d.slice(0, 4) : +d.slice(0, 4) - 1;
  const q = [[`${y}-09-01`, `${y}-10-31`, '1 четверть'], [`${y}-11-01`, `${y}-12-31`, '2 четверть'],
             [`${y + 1}-01-01`, `${y + 1}-03-25`, '3 четверть'], [`${y + 1}-03-26`, `${y + 1}-08-31`, '4 четверть']];
  const f = q.find(([s, e]) => d >= s && d <= e) || q[0];
  return { start: f[0], end: f[1], name: f[2] };
}

export function defaultWindow() {
  const t = today(), q = quarter(t), wk = addDays(t, -7);
  return [q.start < wk ? q.start : wk, addDays(t, 28)];
}

/** Первый вход: логин, загрузка, старые оценки помечаются просмотренными (без уведомлений). */
export async function link(u, login, password, remember) {
  const s = await dnevnik.login(login, password);
  u.session = enc(s);
  u.creds = remember ? enc({ u: login, p: password }) : null;
  u.syncError = null;
  await syncUser(u, ...defaultWindow(), { first: true });
}

/** Подключение по ключу входа (строка Cookie). Пароль не нужен и не хранится. */
export async function linkCookie(u, cookie) {
  const s = await dnevnik.fromCookie(cookie);
  u.session = enc(s);
  u.creds = null;
  u.syncError = null;
  await syncUser(u, ...defaultWindow(), { first: true });
}

export const EXPIRED_MSG = 'Ключ входа в Дневник.ру устарел — обнови его в EduPlus.';

/** Скачивает период, сохраняет кэш, возвращает новые оценки. Профиль сохраняется внутри. */
export async function syncUser(u, start, end, { first = false } = {}) {
  let s = dec(u.session);
  if (!s) throw new dnevnik.DnevnikError('Дневник.ру не подключён.');
  if (!start) [start, end] = defaultWindow();

  let raw;
  try {
    raw = await dnevnik.fetchDiary(s, start, end);
  } catch (e) {
    if (e instanceof dnevnik.SessionExpired) {
      const c = dec(u.creds);
      if (!c) { u.syncError = EXPIRED_MSG; await saveUser(u); throw e; }
      s = await dnevnik.login(c.u, c.p);
      raw = await dnevnik.fetchDiary(s, start, end);
    } else {
      u.syncError = e instanceof dnevnik.DnevnikError ? e.message : 'Не удалось связаться с Дневник.ру.';
      await saveUser(u);
      throw e;
    }
  }

  const days = transform(raw);
  const d = await getDiary(u.id);
  // в загруженном периоде заменяем дни целиком (уроки могли удалить)
  for (const k of Object.keys(d.days)) if (k >= start && k <= end) delete d.days[k];
  Object.assign(d.days, days);
  d.fetched.push([start, end, Date.now()]);
  await saveDiary(u.id, d);

  const marks = Object.values(days).flat().flatMap(l => l.marks.map(m => ({ ...m, subject: l.subject.name })));
  const seen = new Set(u.seen);
  const fresh = marks.filter(m => !seen.has(m.id));
  u.seen.push(...fresh.map(m => m.id));
  u.session = enc(s);
  u.lastSync = Date.now();
  u.syncError = null;
  await saveUser(u);
  return first ? [] : fresh;
}
