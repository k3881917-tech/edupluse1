// Telegram Bot API: отправка сообщений и тексты уведомлений.
import { addDays, today } from './sync.mjs';

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export async function call(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return r.json();
}

export const appUrl = () => process.env.WEBAPP_URL || process.env.URL;
export const openKb = (text = 'Открыть EduPlus') => ({ inline_keyboard: [[{ text, web_app: { url: appUrl() } }]] });

export const send = (chatId, text, kb) =>
  call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(kb ? { reply_markup: kb } : {}) });

const MARK = { 5: '🟢 5', 4: '🟢 4', 3: '🟡 3', 2: '🔴 2' };

export function marksText(marks) {
  const head = marks.length === 1 ? 'Новая оценка' : `Новые оценки (${marks.length})`;
  return `<b>${head}</b>\n` + marks.slice(0, 15).map(m =>
    `${MARK[m.v] || esc(m.v)} — ${esc(m.subject)}${m.work ? ` <i>(${esc(m.work)})</i>` : ''}`).join('\n');
}

/** Текст напоминания о следующем учебном дне или null. */
export function homeworkText(u, days) {
  const t = today();
  for (let i = 1; i <= 7; i++) {
    const date = addDays(t, i), L = days[date];
    if (!L || !L.length) continue;
    const isDone = l => (l.hw.id in u.hw ? u.hw[l.hw.id] : l.hw.done);
    const todo = L.filter(l => l.hw && !l.canceled && !isDone(l));
    const tests = L.filter(l => l.important.length);
    if (!todo.length && !tests.length) return null;
    const when = i === 1 ? 'завтра' : date.split('-').reverse().slice(0, 2).join('.');
    let text = `<b>Домашка на ${when}</b>\n` + (todo.map(l => `□ <b>${esc(l.subject.name)}</b>: ${esc(l.hw.text.slice(0, 120))}`).join('\n') || 'Всё сделано 👍');
    if (tests.length) text += '\n\n⚠️ ' + tests.map(l => `${esc(l.important[0])} — ${esc(l.subject.name)}`).join(', ');
    return text;
  }
  return null;
}

export const START_TEXT =
  '<b>EduPlus</b> — расписание, домашка и оценки из Дневник.ру в одном месте.\n\n' +
  '• уроки на сегодня и завтра\n• отметки «сделал домашку»\n• калькулятор четвертной оценки\n' +
  '• календарь со своими событиями\n• уведомления о новых оценках\n\nНажми кнопку, чтобы начать:';
