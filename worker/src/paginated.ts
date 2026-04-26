import type { KVNamespace } from '@cloudflare/workers-types';

export interface YearIndex { years: number[] }

export function yearOfISODate(iso: string): number {
  const y = Number(iso.slice(0, 4));
  return Number.isFinite(y) ? y : new Date().getFullYear();
}

export async function readAllYears<T>(
  kv: KVNamespace,
  prefix: string,
): Promise<T[]> {
  const indexRaw = await kv.get(`${prefix}:index`);
  if (!indexRaw) return [];
  const { years } = JSON.parse(indexRaw) as YearIndex;
  const shards = await Promise.all(
    years.map((y) => kv.get(`${prefix}:${y}`).then((raw) => (raw ? JSON.parse(raw) as T[] : []))),
  );
  return shards.flat();
}

export async function readYears<T>(
  kv: KVNamespace,
  prefix: string,
  years: number[],
): Promise<T[]> {
  const shards = await Promise.all(
    years.map((y) => kv.get(`${prefix}:${y}`).then((raw) => (raw ? JSON.parse(raw) as T[] : []))),
  );
  return shards.flat();
}

export async function writeAllYears<T>(
  kv: KVNamespace,
  prefix: string,
  items: T[],
  getYear: (item: T) => number,
): Promise<void> {
  const byYear = new Map<number, T[]>();
  for (const item of items) {
    const y = getYear(item);
    if (!Number.isFinite(y)) continue;
    const bucket = byYear.get(y);
    if (bucket) bucket.push(item);
    else byYear.set(y, [item]);
  }
  const prevIndexRaw = await kv.get(`${prefix}:index`);
  const prevYears: number[] = prevIndexRaw ? (JSON.parse(prevIndexRaw) as YearIndex).years : [];
  const newYears = [...byYear.keys()].sort((a, b) => a - b);
  const stale = prevYears.filter((y) => !byYear.has(y));
  if (byYear.size === 0) {
    await Promise.all([
      ...stale.map((y) => kv.delete(`${prefix}:${y}`)),
      kv.delete(`${prefix}:index`),
    ]);
    return;
  }
  await Promise.all([
    ...[...byYear.entries()].map(([y, arr]) => kv.put(`${prefix}:${y}`, JSON.stringify(arr))),
    ...stale.map((y) => kv.delete(`${prefix}:${y}`)),
    kv.put(`${prefix}:index`, JSON.stringify({ years: newYears })),
  ]);
}

export async function upsertInYear<T extends { id: string; date: string }>(
  kv: KVNamespace,
  prefix: string,
  item: T,
): Promise<void> {
  const y = yearOfISODate(item.date);
  const key = `${prefix}:${y}`;
  // 1. Make sure the year is in the index FIRST (creates an "optimistic" entry).
  //    If the shard write below fails, the index points at an empty location;
  //    readers treat missing shards as [].
  const indexRaw = await kv.get(`${prefix}:index`);
  const { years } = indexRaw ? (JSON.parse(indexRaw) as YearIndex) : { years: [] as number[] };
  if (!years.includes(y)) {
    years.push(y); years.sort((a, b) => a - b);
    await kv.put(`${prefix}:index`, JSON.stringify({ years }));
  }

  // 2. Now write the shard.
  const raw = await kv.get(key);
  const arr = raw ? (JSON.parse(raw) as T[]) : [];
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx >= 0) arr[idx] = item; else arr.push(item);
  await kv.put(key, JSON.stringify(arr));
}

export async function deleteFromAnyYear<T extends { id: string }>(
  kv: KVNamespace,
  prefix: string,
  id: string,
): Promise<boolean> {
  const indexRaw = await kv.get(`${prefix}:index`);
  if (!indexRaw) return false;
  const { years } = JSON.parse(indexRaw) as YearIndex;
  for (const y of years) {
    const key = `${prefix}:${y}`;
    const raw = await kv.get(key);
    if (!raw) continue;
    const arr = JSON.parse(raw) as T[];
    const next = arr.filter((x) => x.id !== id);
    if (next.length === arr.length) continue;
    if (next.length === 0) {
      await kv.delete(key);
      const remaining = years.filter((x) => x !== y);
      await kv.put(`${prefix}:index`, JSON.stringify({ years: remaining }));
    } else {
      await kv.put(key, JSON.stringify(next));
    }
    return true;
  }
  return false;
}

export async function updateInAnyYear<T extends { id: string; date: string }>(
  kv: KVNamespace,
  prefix: string,
  id: string,
  update: Partial<T>,
): Promise<T | null> {
  const indexRaw = await kv.get(`${prefix}:index`);
  if (!indexRaw) return null;
  const { years } = JSON.parse(indexRaw) as YearIndex;
  for (const y of years) {
    const key = `${prefix}:${y}`;
    const raw = await kv.get(key);
    if (!raw) continue;
    const arr = JSON.parse(raw) as T[];
    const idx = arr.findIndex((x) => x.id === id);
    if (idx < 0) continue;
    const merged = { ...arr[idx], ...update } as T;
    const newYear = yearOfISODate(merged.date);
    if (newYear === y) {
      arr[idx] = merged;
      await kv.put(key, JSON.stringify(arr));
    } else {
      // Write to new shard FIRST (update index if needed)
      await upsertInYear<T>(kv, prefix, merged);
      // Then remove from the old shard
      arr.splice(idx, 1);
      if (arr.length === 0) {
        await kv.delete(key);
        // Re-read the index to avoid clobbering the new-year entry written by upsertInYear above
        const currentIndexRaw = await kv.get(`${prefix}:index`);
        const current = currentIndexRaw ? (JSON.parse(currentIndexRaw) as YearIndex) : { years: [] as number[] };
        const filtered = current.years.filter((x) => x !== y);
        await kv.put(`${prefix}:index`, JSON.stringify({ years: filtered }));
      } else {
        await kv.put(key, JSON.stringify(arr));
      }
    }
    return merged;
  }
  return null;
}
