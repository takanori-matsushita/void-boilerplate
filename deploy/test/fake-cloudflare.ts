import type { Cloudflare, HyperdriveConfig } from '../scripts/cloudflare.mts';

/** Cloudflare クライアントの最小の偽物（メモリ上の Hyperdrive 一覧） */
export function fakeCloudflare(initial: HyperdriveConfig[] = []) {
  const configs = [...initial];
  const calls: string[] = [];
  const cf = {
    accountId: 'acc',
    async findHyperdrive(name: string) {
      calls.push(`find:${name}`);
      return configs.find((c) => c.name === name);
    },
    async createHyperdrive(name: string, origin: { user: string }) {
      calls.push(`create:${name}`);
      const created: HyperdriveConfig = { id: `id-${configs.length + 1}`, name, origin, caching: { disabled: true } };
      configs.push(created);
      return created;
    },
    async disableHyperdriveCaching(id: string) {
      calls.push(`disable-caching:${id}`);
      const c = configs.find((x) => x.id === id)!;
      c.caching = { disabled: true };
      return c;
    },
    async workersSubdomain() {
      return 'acct';
    },
  } as unknown as Cloudflare;
  return { cf, calls, configs };
}

export const good = (name: string): HyperdriveConfig => ({
  id: `id-${name}`,
  name,
  origin: { user: 'app_user' },
  caching: { disabled: true },
});
