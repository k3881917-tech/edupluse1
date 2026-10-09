// Хранилище Netlify Blobs: u/<tgId> — профиль и настройки, d/<tgId> — кэш дневника.
import { getStore } from '@netlify/blobs';

const s = () => getStore({ name: 'eduplus', consistency: 'strong' });

export async function getUser(id) {
  return (await s().get(`u/${id}`, { type: 'json' })) || null;
}

export function newUser(id, name) {
  return { id: Number(id), name: name || '', session: null, creds: null, lastSync: null, syncError: null,
           notify: true, hw: {}, events: [], rooms: {}, seen: [], remindedOn: null, created: Date.now() };
}

export async function saveUser(u) {
  if (u.seen.length > 3000) u.seen = u.seen.slice(-3000);
  await s().setJSON(`u/${u.id}`, u);
}

export async function getDiary(id) {
  return (await s().get(`d/${id}`, { type: 'json' })) || { days: {}, fetched: [] };
}

export async function saveDiary(id, d) {
  d.fetched = (d.fetched || []).slice(-20);
  await s().setJSON(`d/${id}`, d);
}

export async function deleteDiary(id) {
  await s().delete(`d/${id}`);
}

export async function listUserIds() {
  const { blobs } = await s().list({ prefix: 'u/' });
  return blobs.map(b => b.key.slice(2));
}
