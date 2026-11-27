import * as v from 'valibot';
import { defineHandler } from 'void';
import { describe, expect, it } from 'vite-plus/test';

it('ハンドラは素の戻り値を返し、偽のコンテキストで直接呼べる（ルートのテストの手本。Void 更新時の検知にもなる）', async () => {
  const POST = defineHandler(async (c) => {
    const body = await c.req.json<{ name: string }>();
    return { tenant: c.get('tenantId' as never), name: body.name, id: c.req.param('id') };
  });
  const vars: Record<string, unknown> = { tenantId: 'T1' };
  const fake = {
    get: (k: string) => vars[k],
    req: { json: async () => ({ name: 'A' }), param: (k: string) => ({ id: '42' })[k] },
  };

  const result = await (POST as unknown as (c: unknown) => Promise<unknown>)(fake);

  expect(result).toEqual({ tenant: 'T1', name: 'A', id: '42' });
});

it('実際のルートのモジュールを import できる', async () => {
  const mod = await import('../../routes/api/health');
  expect(typeof mod.GET).toBe('function');
});

describe('withValidator（Valibot）のハンドラ', () => {
  const POST = defineHandler.withValidator({
    body: v.object({ name: v.pipe(v.string(), v.minLength(1, '名前は必須です')) }),
  })((_c, { body }) => ({ upper: body.name.toUpperCase() }));
  const call = POST as unknown as (c: unknown) => Promise<Response>;
  const context = (body: unknown) => ({
    req: { json: async () => body, header: () => undefined, query: () => ({}), param: () => ({}) },
    get: () => undefined,
  });

  it('ハンドラ自身がリクエストを検証し、有効な入力なら 200 と JSON の Response を返す（第 2 引数は不要）', async () => {
    const res = await call(context({ name: 'a' }));

    expect([res.status, await res.json()]).toEqual([200, { upper: 'A' }]);
  });

  it('無効な入力なら 400 と、Valibot の日本語メッセージを返す', async () => {
    const res = await call(context({ name: '' }));

    expect([res.status, JSON.stringify(await res.json())]).toEqual([400, expect.stringContaining('名前は必須です')]);
  });
});
