import { describe, expect, it } from 'vite-plus/test';
import { ConfigError } from '../scripts/config.mts';
import { checkHyperdrive, ensureHyperdrive } from '../scripts/hyperdrive.mts';
import { fakeCloudflare, good } from './fake-cloudflare.ts';

const APP_URL = 'postgresql://app_user:pw@h.example.com/club';

describe('ensureHyperdrive', () => {
  it('なければ、キャッシュ無効・アプリ用ロールで作成する', async () => {
    const { cf, calls, configs } = fakeCloudflare();
    const r = await ensureHyperdrive(cf, 'club-admin-dev-hyperdrive', APP_URL);
    expect(r.action).toBe('created');
    expect(configs[0]?.caching).toEqual({ disabled: true });
    expect(configs[0]?.origin.user).toBe('app_user');
    expect(calls).toContain('create:club-admin-dev-hyperdrive');
  });

  it('管理用ロールの URL では作成しない（RLS バイパスの防止）', async () => {
    const { cf, calls } = fakeCloudflare();
    await expect(ensureHyperdrive(cf, 'n', 'postgresql://neondb_owner:pw@h/db')).rejects.toThrow(ConfigError);
    expect(calls.some((c) => c.startsWith('create'))).toBe(false);
  });

  it('キャッシュが有効な既存設定は無効化する', async () => {
    const { cf, calls } = fakeCloudflare([{ ...good('n'), caching: { disabled: false } }]);
    expect((await ensureHyperdrive(cf, 'n', APP_URL)).action).toBe('caching-disabled');
    expect(calls).toContain('disable-caching:id-n');
  });

  it('正しい既存設定は何もしない（べき等）', async () => {
    const { cf, calls } = fakeCloudflare([good('n')]);
    expect((await ensureHyperdrive(cf, 'n', APP_URL)).action).toBe('unchanged');
    expect(calls).toEqual(['find:n']);
  });

  it('既存設定が管理用ロールなら拒否する', async () => {
    const { cf } = fakeCloudflare([{ ...good('n'), origin: { user: 'neondb_owner' } }]);
    await expect(ensureHyperdrive(cf, 'n', APP_URL)).rejects.toThrow('作り直');
  });
});

describe('checkHyperdrive', () => {
  it('なし・管理用ロール・キャッシュ有効をすべて拒否する', async () => {
    await expect(checkHyperdrive(fakeCloudflare().cf, 'n')).rejects.toThrow('provision');
    await expect(checkHyperdrive(fakeCloudflare([{ ...good('n'), origin: { user: 'x' } }]).cf, 'n')).rejects.toThrow(
      '接続ロール',
    );
    await expect(
      checkHyperdrive(fakeCloudflare([{ ...good('n'), caching: { disabled: false } }]).cf, 'n'),
    ).rejects.toThrow('キャッシュ');
  });
  it('正しければ設定を返す', async () => {
    await expect(checkHyperdrive(fakeCloudflare([good('n')]).cf, 'n')).resolves.toMatchObject({ name: 'n' });
  });
});
