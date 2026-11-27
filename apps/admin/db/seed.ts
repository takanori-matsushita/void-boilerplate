import { defineSeed } from 'void/seed';

// `make seed`（= void db seed）が、DB をリセット → マイグレーション → このファイルを実行する。
// 開発用のサンプル（テナントの分離を、手で確かめられるよう 2 つ）。実在の個人情報は使わない。
// 管理用ロール（RLS をバイパス）で動くので、tenant_id は明示する。
export default defineSeed<typeof import('./schema')>(async ({ db, schema }) => {
  const [a, b] = await db
    .insert(schema.tenant)
    .values([{ name: 'サンプル陸上クラブ A' }, { name: 'サンプル陸上クラブ B' }])
    .returning({ id: schema.tenant.id });

  await db.insert(schema.site).values([
    { tenantId: a!.id, name: '中央競技場' },
    { tenantId: a!.id, name: '市民体育館' },
    { tenantId: b!.id, name: '中央競技場' },
  ]);
});
