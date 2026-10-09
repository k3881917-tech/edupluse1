// Клиент Дневник.ру на обычных HTTP-запросах (без браузера).
// Вход: POST формы login.dnevnik.ru → куки → внутренний API /api/v2/marks/diary.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const LOGIN_URL = 'https://login.dnevnik.ru/login';
const DIARY_API = 'https://dnevnik.ru/api/v2/marks/diary';

export class DnevnikError extends Error {}
export class SessionExpired extends DnevnikError {}

/* ---------- простая банка кук для *.dnevnik.ru ---------- */
export class Jar {
  constructor(list = []) { this.list = list; }           // [{name, value, domain, hostOnly, expires}]
  toJSON() { return this.list; }

  store(url, res) {
    const host = new URL(url).hostname;
    const raw = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') || '').split(/,(?=\s*[^;,=\s]+=[^;,]*)/);
    for (const line of raw) {
      if (!line) continue;
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const c = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: host, hostOnly: true, expires: null };
      for (const a of attrs) {
        const [k, ...v] = a.split('=');
        const key = k.trim().toLowerCase(), val = v.join('=').trim();
        if (key === 'domain' && val) { c.domain = val.replace(/^\./, '').toLowerCase(); c.hostOnly = false; }
        if (key === 'max-age') c.expires = Date.now() + Number(val) * 1000;
        if (key === 'expires' && c.expires === null) { const t = Date.parse(val); if (!isNaN(t)) c.expires = t; }
      }
      this.list = this.list.filter(x => !(x.name === c.name && x.domain === c.domain));
      if (c.expires === null || c.expires > Date.now()) this.list.push(c);
    }
  }

  header(url) {
    const host = new URL(url).hostname;
    const now = Date.now();
    return this.list
      .filter(c => (c.expires === null || c.expires > now) &&
        (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith('.' + c.domain)))
      .map(c => `${c.name}=${c.value}`).join('; ');
  }
}

/** fetch с куками и ручными редиректами (чтобы собрать куки со всех доменов). */
async function request(jar, url, opts = {}, hops = 0) {
  const headers = {
    'User-Agent': UA,
    'Accept-Language': 'ru-RU,ru;q=0.9',
    Accept: opts.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...(opts.headers || {}),
  };
  const cookie = jar.header(url);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { method: opts.method || 'GET', body: opts.body, headers, redirect: 'manual', signal: AbortSignal.timeout(opts.timeout || 8000) });
  jar.store(url, res);
  if ([301, 302, 303, 307, 308].includes(res.status) && hops < 10) {
    const next = new URL(res.headers.get('location'), url).toString();
    const keep = res.status === 307 || res.status === 308;
    return request(jar, next, keep ? opts : { accept: opts.accept, timeout: opts.timeout }, hops + 1);
  }
  return { res, url };
}

const isLoginPage = (url, html) => /login\.dnevnik\.ru/.test(url) || /name="password"/.test(html || '');

function findIds(html) {
  const p = html.match(/"personId"\s*:\s*"?(\d{6,})/) || html.match(/childPersonId=(\d{6,})/);
  const s = html.match(/"schoolId"\s*:\s*"?(\d{6,})/) || html.match(/[?&]school=(\d{6,})/);
  return p && s ? { personId: p[1], schoolId: s[1] } : null;
}

/** Вход логином и паролем. Возвращает сессию { jar, personId, schoolId }. */
export async function login(username, password) {
  const jar = new Jar();
  await request(jar, LOGIN_URL);  // получаем стартовые куки

  const form = new URLSearchParams({
    exceededAttempts: 'False', ReturnUrl: '', FingerprintId: '',
    login: username, password, 'Captcha.Input': '', 'Captcha.Id': '',
  });
  const { res, url } = await request(jar, LOGIN_URL, {
    method: 'POST', body: form.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://login.dnevnik.ru', Referer: LOGIN_URL },
  });
  const html = await res.text();

  if (isLoginPage(url, html)) {
    if (/exceededAttempts"\s+type="hidden"\s+value="True"|name="exceededAttempts"[^>]*value="True"|Captcha\.Id"[^>]*value="[^"]+"/i.test(html)) {
      throw new DnevnikError('Дневник.ру просит ввести капчу после нескольких попыток. Войди один раз на dnevnik.ru вручную и попробуй снова через 10–15 минут.');
    }
    throw new DnevnikError('Неверный логин или пароль Дневник.ру.');
  }

  const marks = await request(jar, 'https://dnevnik.ru/marks');
  const page = await marks.res.text();
  if (isLoginPage(marks.url, page)) throw new DnevnikError('Дневник.ру не пустил после входа. Попробуй ещё раз.');
  const ids = findIds(page) || findIds(html);
  if (!ids) throw new DnevnikError('Вход прошёл, но не удалось найти ученика и школу. Это аккаунт родителя? Пока поддерживаются только аккаунты учеников.');
  return { jar: jar.toJSON(), ...ids };
}

const ts = date => Math.floor(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 1000);

/** Сырые данные дневника за период [start, end] (строки YYYY-MM-DD). */
export async function fetchDiary(session, start, end) {
  const jar = new Jar(session.jar);
  const url = `${DIARY_API}?personId=${session.personId}&schoolId=${session.schoolId}&startDate=${ts(start)}&finishDate=${ts(end)}&timestamp=${Date.now()}`;
  const { res, url: final } = await request(jar, url, { accept: 'application/json, text/plain, */*', headers: { Referer: 'https://dnevnik.ru/marks' } });
  const type = res.headers.get('content-type') || '';
  if (res.status === 401 || res.status === 403 || /login\.dnevnik\.ru/.test(final) || !type.includes('json')) {
    throw new SessionExpired('Сессия Дневник.ру истекла.');
  }
  if (!res.ok) throw new DnevnikError(`Дневник.ру ответил ошибкой ${res.status}.`);
  const data = await res.json();
  session.jar = jar.toJSON();  // куки могли обновиться
  return data;
}
