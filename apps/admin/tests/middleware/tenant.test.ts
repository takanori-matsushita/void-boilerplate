import { describe, expect, it, vi } from 'vite-plus/test';

// Void のバインディング（void/db）だけを差し替える。トランザクション自体の検証は、packages/db の結合テスト（実 Postgres）
vi.mock('void/db', () => ({ db: { transaction: () => Promise.reject(new Error('呼ばれないはず')) } }));

const { default: middleware } = await import('../../middleware/tenant');

type Fake = { req: { path: string }; json: (body: unknown, status: number) => { body: unknown; status: number } };
const fakeContext = (path: string): Fake => ({
  req: { path },
  json: (body, status) => ({ body, status }),
});
const run = (path: string, next: () => Promise<unknown>) =>
  (middleware as unknown as (c: Fake, next: () => Promise<unknown>) => Promise<unknown>)(fakeContext(path), next);

describe('テナントミドルウェア', () => {
  it('対象外のパス（ヘルスチェックなど）は、何もせず、次へ進む', async () => {
    const next = vi.fn(async () => 'next の結果');

    const result = await run('/api/health', next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(result).toBe('next の結果');
  });

  it('対象のパスで、組織（セッション）が決まらなければ、次へ進まず 401 を返す（認証はフェーズ 3）', async () => {
    const next = vi.fn(async () => 'next の結果');

    const result = await run('/api/members', next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toEqual({ body: { error: 'unauthorized' }, status: 401 });
  });
});
