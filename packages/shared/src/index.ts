import * as v from 'valibot';

/** 環境名。デプロイ・Worker 名・Neon ブランチの切替に使う */
export const ENVIRONMENTS = ['dev', 'stg', 'prod'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export const environmentSchema = v.picklist(ENVIRONMENTS);

/** UUID（v7 を含む任意のバージョン）。tenant_id などの検証に使う。採番は DB（`uuidv7()`）が行う */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidSchema = v.pipe(v.string(), v.regex(UUID_PATTERN, 'UUID 形式ではありません'));
export const tenantIdSchema = v.pipe(uuidSchema, v.brand('TenantId'));
export type TenantId = v.InferOutput<typeof tenantIdSchema>;
export * from './permissions.ts';
