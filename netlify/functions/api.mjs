// API Mini App + вебхук Telegram-бота. Все пути /api/*.
import { validate, AuthError } from '../lib/tgauth.mjs';
import { webhookSecret } from '../lib/crypto.mjs';
import { DnevnikError, looksLikeCookie } from '../lib/dnevnik.mjs';
import { getUser, newUser, saveUser, getDiary, deleteDiary } from '../lib/store.mjs';
import { link, linkCookie, syncUser, quarter, today } from '../lib/sync.mjs';
import { call, send, openKb, appUrl, START_TEXT } from '../lib/tg.mjs';

export const config = { path: '/api/*' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

async function auth(req) {
  let tgUser;
  try { tgUser = validate(req.headers.get('x-telegram-init-data') || '', process.env.BOT_TOKEN); }
  catch (e) { throw new HttpError(401, `Открой EduPlus из Telegram (${e.message}).`); }
  let u = await getUser(tgUser.id);
  if (!u) { u = newUser(tgUser.id, tgUser.first_name || tgUser.username); await saveUser(u); }
  return u;
}

function me(u) {
  return {
    linked: !!u.session, name: u.name, last_sync: u.lastSync ? u.lastSync / 1000 : null,
    sync_error: u.syncError, notify: u.notify, remembered: !!u.creds, quarter: quarter(), today: today(),
  };
}

const covered = (d, s, e) => (d.fetched || []).some(([a, b, t]) => a <= s && b >= e && Date.now() - t < 15 * 60 * 1000);

async function body(req) {
  try { return await req.json(); } catch { throw new HttpError(400, 'Пустой запрос.'); }
}

/* ---------- маршруты Mini App ---------- */
const routes = {
  'GET me': async (req, u) => me(u),

  'POST link': async (req, u) => {
    const b = await body(req);
    const login = String(b.login || '').trim(), password = String(b.password || '');
    if (!login || !password) throw new HttpError(400, 'Введи логин и пароль.');
    await link(u, login, password, b.remember !== false);
    return me(u);
  },

  'POST link-cookie': async (req, u) => {
    const b = await body(req);
    await linkCookie(u, String(b.cookie || ''));
    return me(u);
  },

  'POST unlink': async (req, u) => {
    Object.assign(u, { session: null, creds: null, lastSync: null, syncError: null, hw: {}, seen: [] });
    await saveUser(u); await deleteDiary(u.id);
    return { ok: true };
  },

  'POST notify': async (req, u) => { u.notify = !!(await body(req)).on; await saveUser(u); return { ok: true }; },

  'GET diary': async (req, u) => {
    const q = new URL(req.url).searchParams, start = q.get('start'), end = q.get('end');
    if (!isDate(start) || !isDate(end) || end < start) throw new HttpError(400, 'Неверный период.');
    if ((Date.parse(end) - Date.parse(start)) / 864e5 > 120) throw new HttpError(400, 'Период — не больше четырёх месяцев.');
    let d = await getDiary(u.id);
    if (u.session && !covered(d, start, end)) {
      try { await syncUser(u, start, end); d = await getDiary(u.id); }
      catch (e) { if (!(e instanceof DnevnikError)) console.error(e); }  // отдаём кэш, ошибка видна в me().sync_error
    }
    const days = [];
    for (const [date, lessons] of Object.entries(d.days)) {
      if (date < start || date > end) continue;
      days.push({ date, lessons: lessons.map(l => ({
        ...l,
        room: l.room || u.rooms[l.subject.id] || null,
        hw: l.hw ? { ...l.hw, done: l.hw.id in u.hw ? u.hw[l.hw.id] : l.hw.done } : null,
      })) });
    }
    days.sort((a, b) => a.date.localeCompare(b.date));
    return { days, events: u.events.filter(e => e.date >= start && e.date <= end), me: me(u) };
  },

  'POST refresh': async (req, u) => { await syncUser(u); return me(u); },

  'POST hw': async (req, u) => {
    const b = await body(req);
    if (!b.hw_id) throw new HttpError(400, 'Нет домашки.');
    u.hw[String(b.hw_id)] = !!b.done;
    await saveUser(u);
    return { ok: true };
  },

  'POST events': async (req, u) => {
    const b = await body(req);
    const title = String(b.title || '').trim().slice(0, 80);
    if (!title || !isDate(b.date)) throw new HttpError(400, 'Нужны название и дата.');
    const ev = { id: 'e' + Date.now().toString(36), date: b.date, time: /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : '',
                 title, type: ['me', 'study', 'sport', 'fun'].includes(b.type) ? b.type : 'me' };
    u.events.push(ev);
    if (u.events.length > 500) u.events = u.events.slice(-500);
    await saveUser(u);
    return ev;
  },

  'PUT rooms': async (req, u) => {
    const b = await body(req);
    const room = String(b.room || '').trim().slice(0, 20);
    if (room) u.rooms[String(b.subject_id)] = room; else delete u.rooms[String(b.subject_id)];
    await saveUser(u);
    return { ok: true };
  },
};

/* ---------- бот (вебхук) ---------- */
async function botUpdate(req) {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret()) return new Response('forbidden', { status: 403 });
  const upd = await req.json().catch(() => ({}));
  const m = upd.message;
  if (m?.text && m.chat?.type === 'private') {
    const cmd = m.text.split(/[\s@]/)[0];
    let u = await getUser(m.from.id);
    if (!u) { u = newUser(m.from.id, m.from.first_name); await saveUser(u); }
    if (looksLikeCookie(m.text)) {
      // ключ входа: сразу удаляем сообщение из чата, чтобы он там не лежал
      await call('deleteMessage', { chat_id: m.chat.id, message_id: m.message_id }).catch(() => {});
      try {
        await linkCookie(u, m.text);
        await send(m.chat.id, '✅ Дневник.ру подключён, сообщение с ключом удалено. Открывай:', openKb());
      } catch (e) {
        await send(m.chat.id, '❌ ' + (e instanceof DnevnikError ? e.message : 'Не удалось подключиться к Дневник.ру. Попробуй ещё раз.'));
      }
    }
    else if (cmd === '/start') await send(m.chat.id, START_TEXT, openKb());
    else if (cmd === '/notify') {
      u.notify = !u.notify; await saveUser(u);
      await send(m.chat.id, u.notify ? 'Уведомления включены.' : 'Уведомления выключены. Включить: /notify');
    } else await send(m.chat.id, 'Всё самое интересное — в приложении 👇', openKb());
  }
  return new Response('ok');
}

/* ---------- одноразовая настройка бота ---------- */
async function setup(req) {
  const key = new URL(req.url).searchParams.get('key');
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return json({ detail: 'Нужен ?key=ADMIN_KEY' }, 403);
  const hook = `${appUrl()}/api/tg`;
  const results = {
    webhook: await call('setWebhook', { url: hook, secret_token: webhookSecret(), allowed_updates: ['message'], drop_pending_updates: true }),
    menu: await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'EduPlus', web_app: { url: appUrl() } } }),
    commands: await call('setMyCommands', { commands: [{ command: 'start', description: 'Открыть EduPlus' }, { command: 'notify', description: 'Вкл/выкл уведомления' }] }),
  };
  return json({ app: appUrl(), hook, results });
}

export default async (req) => {
  const path = new URL(req.url).pathname.replace(/^\/api\/?/, '');
  try {
    if (path === 'tg' && req.method === 'POST') return await botUpdate(req);
    if (path === 'setup') return await setup(req);
    const [name, id] = path.split('/');
    if (req.method === 'DELETE' && name === 'events' && id) {
      const u = await auth(req);
      const n = u.events.length;
      u.events = u.events.filter(e => e.id !== id);
      if (u.events.length === n) throw new HttpError(404, 'Событие не найдено.');
      await saveUser(u);
      return json({ ok: true });
    }
    const handler = routes[`${req.method} ${name}`];
    if (!handler) throw new HttpError(404, 'Нет такого адреса.');
    const u = await auth(req);
    return json(await handler(req, u));
  } catch (e) {
    if (e instanceof HttpError) return json({ detail: e.message }, e.status);
    if (e instanceof DnevnikError) return json({ detail: e.message }, 400);
    console.error(e);
    return json({ detail: 'Что-то пошло не так на сервере. Попробуй ещё раз через минуту.' }, 500);
  }
};
