// Перевод ответа Дневник.ру (/api/v2/marks/diary) в формат EduPlus.

const pad = n => String(n).padStart(2, '0');
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// "date" у Дневник.ру — полночь локальной даты, записанная как UTC
export const dayKey = ts => new Date(Number(ts) * 1000).toISOString().slice(0, 10);

function hm(h, m) {
  if (h === undefined || h === null || h === '' || m === undefined || m === null || m === '') return null;
  return `${pad(Number(h))}:${pad(Number(m))}`;
}
function timeFromTs(ts, offsetMin) {
  if (!ts) return null;
  const d = new Date(Number(ts) * 1000 + offsetMin * 60000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function lesson(raw, dayDate, offset) {
  const h = raw.hours || {};
  const subj = raw.subject || {};
  const hwRaw = raw.homework;
  const hw = hwRaw && clean(hwRaw.text)
    ? { id: String(hwRaw.id), text: clean(hwRaw.text), done: !!hwRaw.isCompleted, files: (hwRaw.attachments || []).length }
    : null;
  const marks = [];
  for (const w of raw.workMarks || []) {
    for (const m of w.marks || []) {
      marks.push({ id: String(m.id), v: clean(m.value), work: clean(w.workName), date: dayDate, created: (m.createdDate || '').slice(0, 19) || null });
    }
  }
  const important = (raw.importantWorks || [])
    .map(w => clean(typeof w === 'string' ? w : (w.name || w.workName || w.type)))
    .filter(Boolean);
  return {
    id: String(raw.id),
    n: raw.number ?? null,
    subject: { id: String(subj.id || subj.name || '?'), name: clean(subj.name) || 'Урок' },
    from: hm(h.startHour, h.startMinute) || timeFromTs(raw.startTime, offset),
    to: hm(h.endHour, h.endMinute) || timeFromTs(raw.endTime, offset),
    room: clean(raw.place) || null,
    theme: clean(raw.theme) || null,
    canceled: !!raw.isCanceled,
    hw,
    marks,
    important,
    absent: raw.logEntry?.lessonLogEntryValue || null,
  };
}

/** Ответ API → { 'YYYY-MM-DD': [lessons] } */
export function diary(raw) {
  const out = {};
  for (const d of raw.days || []) {
    const date = dayKey(d.date);
    const offset = Number(d.utcOffset ?? 180);
    out[date] = (d.lessons || [])
      .filter(l => !l.isEmpty)
      .map(l => lesson(l, date, offset))
      .sort((a, b) => (a.n ?? 99) - (b.n ?? 99) || String(a.from).localeCompare(String(b.from)));
  }
  return out;
}

export function numeric(v) {
  const n = parseInt(String(v).replace(/[+-]$/, ''), 10);
  return n >= 1 && n <= 5 && /^\d[+-]?$/.test(String(v).trim()) ? n : null;
}
