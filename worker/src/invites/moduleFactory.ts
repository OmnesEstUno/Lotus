import type { KVNamespace } from '@cloudflare/workers-types';
import {
  InviteCommon,
  encodeToken,
  decodeAndVerifyToken,
  readInviteRecord,
  markUsed,
  hmacSign,
  getDomainKeyCached,
  b64urlEncodeStr,
} from './primitives';

export type { InviteCommon };

export type InviteListItem = {
  id: string;
  expiresAt: number;
  createdAt: number;
  usedBy: string | null;
  token: string;
};

export interface InviteModule<TRecord extends InviteCommon, TCreateOpts, TListOpts> {
  create(kv: KVNamespace, jwtSecret: string, opts: TCreateOpts): Promise<{ id: string; token: string; expiresAt: number }>;
  verify(kv: KVNamespace, token: string, jwtSecret: string): Promise<{ ok: true; id: string; record: TRecord } | { ok: false; reason: string }>;
  markUsed(kv: KVNamespace, id: string, username: string): Promise<boolean>;
  list(kv: KVNamespace, jwtSecret: string, opts: TListOpts): Promise<InviteListItem[]>;
  delete(kv: KVNamespace, id: string): Promise<void>;
}

export function makeInviteModule<
  TRecord extends InviteCommon,
  TCreateOpts = undefined,
  TListOpts = undefined,
>(config: {
  kvPrefix: string;
  purpose: string;
  ttlSeconds: number;
  buildExtraFields: (opts: TCreateOpts) => Omit<TRecord, keyof InviteCommon>;
  filterListed?: (record: TRecord, opts: TListOpts) => boolean;
}): InviteModule<TRecord, TCreateOpts, TListOpts> {
  const key = (id: string) => `${config.kvPrefix}${id}`;

  return {
    async create(kv, jwtSecret, opts) {
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + config.ttlSeconds;
      const extra = config.buildExtraFields(opts);
      const record = { expiresAt, createdAt: now, usedBy: null, ...extra } as TRecord;
      await kv.put(key(id), JSON.stringify(record), { expirationTtl: config.ttlSeconds });
      const token = await encodeToken(id, jwtSecret, config.purpose);
      return { id, token, expiresAt };
    },

    async verify(kv, token, jwtSecret) {
      const dec = await decodeAndVerifyToken(token, jwtSecret, config.purpose);
      if (!dec.ok) return dec;
      const read = await readInviteRecord<TRecord>(kv, key(dec.id));
      if (!read.ok) return read;
      return { ok: true, id: dec.id, record: read.record };
    },

    async markUsed(kv, id, username) {
      return markUsed<TRecord>(kv, key(id), username);
    },

    async list(kv, jwtSecret, opts) {
      const listed = await kv.list({ prefix: config.kvPrefix });
      const domainKey = await getDomainKeyCached(jwtSecret, config.purpose);
      const reads = await Promise.all(listed.keys.map(async (k) => {
        const raw = await kv.get(k.name);
        if (!raw) return null;
        const r = JSON.parse(raw) as TRecord;
        if (config.filterListed && !config.filterListed(r, opts)) return null;
        const id = k.name.slice(config.kvPrefix.length);
        const sig = await hmacSign(id, domainKey);
        const token = b64urlEncodeStr(`${id}:${sig}`);
        return { id, expiresAt: r.expiresAt, createdAt: r.createdAt, usedBy: r.usedBy, token };
      }));
      return reads.filter((x): x is InviteListItem => x !== null);
    },

    async delete(kv, id) {
      await kv.delete(key(id));
    },
  };
}
