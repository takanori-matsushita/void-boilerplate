import { describe, expect, it, vi } from 'vite-plus/test';
import { applyTenant, assertTenantId, withTenant, type SqlExecutor } from '../src/index.ts';
import { tenantTableRlsSql } from '../src/rls.ts';

const T = '11111111-1111-4111-8111-111111111111';

function fake() {
  const calls: string[] = [];
  const spy = vi.fn(async (text: string, _values?: unknown[]) => {
    calls.push(text);
  });
  const executor: SqlExecutor = { query: (text, values) => spy(text, values) };
  return { ...executor, calls, spy };
}

describe('tenant', () => {
  it('UUID 以外のテナント ID を拒否する', () => {
    expect(() => assertTenantId("x'; drop table notes; --")).toThrow(TypeError);
    expect(() => assertTenantId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toThrow(TypeError);
    expect(assertTenantId(T)).toBe(T);
  });

  it('applyTenant は set_config をパラメータ化して実行する（トランザクションローカル）', async () => {
    const ex = fake();
    await applyTenant(ex, T);
    expect(ex.calls).toEqual(["select set_config('app.tenant_id', $1, true)"]);
    expect(ex.spy).toHaveBeenCalledWith(expect.any(String), [T]);
  });

  it('withTenant は begin → set → 処理 → commit の順に実行する', async () => {
    const ex = fake();
    const result = await withTenant(ex, T, async () => 'done');
    expect(result).toBe('done');
    expect(ex.calls[0]).toBe('begin');
    expect(ex.calls[1]).toContain('set_config');
    expect(ex.calls.at(-1)).toBe('commit');
  });

  it('withTenant は例外で rollback し、例外を再送出する', async () => {
    const ex = fake();
    await expect(
      withTenant(ex, T, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(ex.calls.at(-1)).toBe('rollback');
    expect(ex.calls).not.toContain('commit');
  });
});

describe('tenantTableRlsSql', () => {
  it('RLS 有効化・ポリシー・権限付与を生成する', () => {
    const sql = tenantTableRlsSql('notes');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain("current_setting('app.tenant_id')::uuid");
    expect(sql).toContain('WITH CHECK');
    expect(sql).toContain('TO "app_user"');
    expect(sql.split('--> statement-breakpoint').length).toBe(3);
  });

  it('不正な識別子を拒否する', () => {
    expect(() => tenantTableRlsSql('notes; drop table x')).toThrow(TypeError);
    expect(() => tenantTableRlsSql('notes', { appRole: 'a"b' })).toThrow(TypeError);
  });
});
