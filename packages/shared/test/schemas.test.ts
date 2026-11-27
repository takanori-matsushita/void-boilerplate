import * as v from 'valibot';
import { describe, expect, it } from 'vite-plus/test';
import { ENVIRONMENTS, environmentSchema, tenantIdSchema, uuidSchema } from '../src/index.ts';

const UUID_V7 = '01890a5d-ac96-774b-bcce-b302099a8057';

describe('environmentSchema', () => {
  it('dev / stg / prod だけを受け付ける', () => {
    for (const env of ENVIRONMENTS) expect(v.safeParse(environmentSchema, env).success).toBe(true);

    expect(v.safeParse(environmentSchema, 'production').success).toBe(false);
    expect(v.safeParse(environmentSchema, undefined).success).toBe(false);
  });
});

describe('uuidSchema / tenantIdSchema', () => {
  it('UUID（v7 を含む）を受け付け、そうでないものを日本語のメッセージで拒否する', () => {
    expect(v.safeParse(uuidSchema, UUID_V7).success).toBe(true);

    const result = v.safeParse(uuidSchema, "x'; drop table notes; --");

    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe('UUID 形式ではありません');
  });

  it('tenantIdSchema は、検証済みの値をテナント ID として返す（文字列以外は拒否）', () => {
    const ok = v.safeParse(tenantIdSchema, UUID_V7);

    expect(ok.success).toBe(true);
    expect(ok.output).toBe(UUID_V7);
    expect(v.safeParse(tenantIdSchema, 123).success).toBe(false);
  });
});
