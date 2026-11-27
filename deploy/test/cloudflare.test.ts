import { describe, expect, it } from 'vite-plus/test';
import { Cloudflare, CloudflareError, type FetchLike } from '../scripts/cloudflare.mts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Cloudflare クライアント', () => {
  it('認証ヘッダを付け、結果を返す', async () => {
    let seen: { url: string; auth: string | null } | undefined;
    const fetchImpl: FetchLike = async (url, init) => {
      seen = { url, auth: new Headers(init?.headers).get('authorization') };
      return json({ success: true, result: [{ id: '1', name: 'n', origin: {}, caching: null }] });
    };
    const cf = new Cloudflare('TOKEN', 'ACC', fetchImpl);
    expect(await cf.listHyperdrive()).toHaveLength(1);
    expect(seen?.url).toBe('https://api.cloudflare.com/client/v4/accounts/ACC/hyperdrive/configs');
    expect(seen?.auth).toBe('Bearer TOKEN');
  });

  it('API エラー時、理由を示しトークンを含めない', async () => {
    const cf = new Cloudflare('SECRETTOKEN', 'ACC', async () =>
      json({ success: false, errors: [{ message: 'denied' }] }, 403),
    );
    const error = await cf.listHyperdrive().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudflareError);
    expect(String((error as Error).message)).toContain('denied');
    expect(String((error as Error).message)).not.toContain('SECRETTOKEN');
  });

  it('同名の Hyperdrive が複数あれば拒否する', async () => {
    const dup = { id: '1', name: 'n', origin: {}, caching: null };
    const cf = new Cloudflare('t', 'a', async () => json({ success: true, result: [dup, { ...dup, id: '2' }] }));
    await expect(cf.findHyperdrive('n')).rejects.toThrow('複数');
  });
});
