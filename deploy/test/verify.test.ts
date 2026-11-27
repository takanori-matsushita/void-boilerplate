import { describe, expect, it, vi } from 'vite-plus/test';
import { ConfigError } from '../scripts/config.mts';
import { verifyDeployment } from '../scripts/verify.mts';
import { fakeCloudflare, good } from './fake-cloudflare.ts';

const health = (role: string | null) => new Response(JSON.stringify({ ok: true, role }), { status: 200 });
const sleep = async () => undefined;

describe('verifyDeployment', () => {
  it('一時的な 404（error code: 1042）はリトライして成功する', async () => {
    const { cf } = fakeCloudflare([good('club-admin-dev-hyperdrive')]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('error code: 1042', { status: 404 }))
      .mockResolvedValueOnce(new Response('error code: 1042', { status: 404 }))
      .mockResolvedValueOnce(health('app_user'));
    const r = await verifyDeployment(cf, 'dev', 'admin', { fetchImpl, sleep });
    expect(r.role).toBe('app_user');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://club-admin-dev.acct.workers.dev/api/health');
  });

  it('管理用ロールで動いていれば失敗する（RLS バイパスの検知）', async () => {
    const { cf } = fakeCloudflare([good('club-admin-dev-hyperdrive')]);
    await expect(
      verifyDeployment(cf, 'dev', 'admin', { fetchImpl: async () => health('neondb_owner'), sleep }),
    ).rejects.toThrow('app_user');
  });

  it('Hyperdrive のキャッシュが有効なら、ヘルスチェック前に失敗する', async () => {
    const { cf } = fakeCloudflare([{ ...good('club-admin-dev-hyperdrive'), caching: { disabled: false } }]);
    const fetchImpl = vi.fn();
    await expect(verifyDeployment(cf, 'dev', 'admin', { fetchImpl, sleep })).rejects.toThrow('キャッシュ');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('リトライを使い切ったら失敗する', async () => {
    const { cf } = fakeCloudflare([good('club-liff-stg-hyperdrive')]);
    await expect(
      verifyDeployment(cf, 'stg', 'liff', {
        fetchImpl: async () => new Response('x', { status: 502 }),
        retries: 3,
        sleep,
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});
