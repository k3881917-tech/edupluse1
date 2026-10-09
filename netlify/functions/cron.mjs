// Каждые 30 минут: синхронизация, уведомления о новых оценках, вечернее напоминание о домашке.
import { listUserIds, getUser, getDiary, saveUser } from '../lib/store.mjs';
import { syncUser, hourNow, today } from '../lib/sync.mjs';
import { SessionExpired } from '../lib/dnevnik.mjs';
import { send, openKb, marksText, homeworkText } from '../lib/tg.mjs';

export const config = { schedule: '*/30 * * * *' };

const REMIND_HOUR = Number(process.env.HW_REMINDER_HOUR || 19);

export default async () => {
  const h = hourNow();
  if (h < 7 || h >= 23) return;               // ночью не трогаем
  const deadline = Date.now() + 25_000;        // у плановой функции ~30 секунд

  const ids = await listUserIds();
  // начинаем с разных пользователей, чтобы при нехватке времени очередь сдвигалась
  const shift = Math.floor(Date.now() / 1800000) % Math.max(ids.length, 1);
  const order = [...ids.slice(shift), ...ids.slice(0, shift)];

  for (const id of order) {
    if (Date.now() > deadline) break;
    const u = await getUser(id);
    if (!u?.session) continue;
    const hadError = !!u.syncError;
    try {
      const fresh = await syncUser(u);
      if (fresh.length && u.notify) await send(u.id, marksText(fresh), openKb('Посмотреть'));
    } catch (e) {
      if (e instanceof SessionExpired && !hadError && u.notify) {
        await send(u.id, 'Сессия Дневник.ру истекла. Открой EduPlus и войди заново.', openKb());
      } else console.warn('sync', id, e.message);
    }
    try {
      const t = today();
      if (u.notify && h >= REMIND_HOUR && u.remindedOn !== t) {
        u.remindedOn = t;
        await saveUser(u);
        const text = homeworkText(u, (await getDiary(u.id)).days);
        if (text) await send(u.id, text, openKb('Отметить сделанное'));
      }
    } catch (e) { console.warn('remind', id, e.message); }
  }
};
