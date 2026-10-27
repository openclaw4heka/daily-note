// Single-user storage: one JSON document per collection.
// Production uses Netlify Blobs; LOCAL_DATA_DIR switches to plain files for local dev/tests.
import { getStore } from '@netlify/blobs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const COLLECTIONS = ['entries', 'bets', 'adjustments', 'outcomes', 'reviews', 'settings'];

function backend() {
  const dir = process.env.LOCAL_DATA_DIR;
  if (dir) {
    return {
      async get(key) {
        try {
          return JSON.parse(await readFile(path.join(dir, `${key}.json`), 'utf8'));
        } catch {
          return null;
        }
      },
      async set(key, value) {
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, `${key}.json`), JSON.stringify(value));
      },
      async del(key) {
        await rm(path.join(dir, `${key}.json`), { force: true });
      },
    };
  }
  const store = getStore({ name: 'duizhang', consistency: 'strong' });
  return {
    get: (key) => store.get(key, { type: 'json' }),
    set: (key, value) => store.setJSON(key, value),
    del: (key) => store.delete(key),
  };
}

function defaults(name) {
  if (name === 'settings' || name === 'reviews') return {};
  return [];
}

export async function load(name) {
  if (!COLLECTIONS.includes(name)) throw new Error(`unknown collection ${name}`);
  return (await backend().get(name)) ?? defaults(name);
}

export async function save(name, value) {
  if (!COLLECTIONS.includes(name)) throw new Error(`unknown collection ${name}`);
  await backend().set(name, value);
}

export async function update(name, fn) {
  const value = await load(name);
  const result = await fn(value);
  await save(name, value);
  return result;
}

export async function exportAll() {
  const out = {};
  for (const name of COLLECTIONS) out[name] = await load(name);
  return out;
}

export async function wipe() {
  const b = backend();
  for (const name of COLLECTIONS) await b.del(name);
}
