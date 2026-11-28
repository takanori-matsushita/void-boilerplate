import { STANDARD_ROLES, type Permission } from '@club/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vite-plus/test';
import { authorize, canDefineRole, leavesAtLeastOneAdmin, siteScope, type AuthContext } from '../src/index.ts';

const SITE_A = 'site-a';
const SITE_B = 'site-b';

const ctx = (permissions: readonly Permission[], sites: AuthContext['sites']): AuthContext => ({
  permissions: new Set(permissions),
  sites,
});
const admin = ctx(STANDARD_ROLES.admin, 'all');
const coachOfA = ctx(STANDARD_ROLES.coach, new Set([SITE_A]));

describe('authorize（機能の権限 → 拠点の範囲の順に判断する）', () => {
  it('権限があり、拠点の指定がなければ ok', () => {
    expect(authorize(admin, 'invoice:void')).toBe('ok');
  });

  it('機能の権限がないときは forbidden（403）', () => {
    expect(authorize(coachOfA, 'invoice:view')).toBe('forbidden');
    expect(authorize(coachOfA, 'invoice:view', { siteId: SITE_A })).toBe('forbidden');
  });

  it('担当拠点のリソースは ok、範囲外の拠点のリソースは not_found（404。存在を漏らさない）', () => {
    expect(authorize(coachOfA, 'member:view', { siteId: SITE_A })).toBe('ok');
    expect(authorize(coachOfA, 'member:view', { siteId: SITE_B })).toBe('not_found');
  });

  it('全拠点のメンバーは、どの拠点でも ok', () => {
    expect(authorize(admin, 'member:view', { siteId: SITE_B })).toBe('ok');
  });

  it('拠点を 1 つも持たないメンバーは、何も見えない（安全側）', () => {
    const none = ctx(STANDARD_ROLES.coach, new Set());

    expect(authorize(none, 'member:view', { siteId: SITE_A })).toBe('not_found');
  });

  it('権限がなく、かつ範囲外のときは、forbidden を優先する（機能の権限を先に判断）', () => {
    expect(authorize(coachOfA, 'invoice:view', { siteId: SITE_B })).toBe('forbidden');
  });
});

describe('siteScope（クエリの絞り込みの条件）', () => {
  it('全拠点なら絞り込まない', () => {
    expect(siteScope(admin)).toEqual({ all: true });
  });

  it('絞り込んだメンバーは、拠点の一覧を返す（0 件なら空＝何も見えない）', () => {
    expect(siteScope(coachOfA)).toEqual({ all: false, siteIds: [SITE_A] });
    expect(siteScope(ctx(STANDARD_ROLES.coach, new Set()))).toEqual({ all: false, siteIds: [] });
  });
});

describe('canDefineRole（権限の昇格を防ぐ）', () => {
  it('ロールの管理（staff:manage）を持たない人は、ロールを作れない', () => {
    expect(canDefineRole(ctx(STANDARD_ROLES.office, 'all'), ['member:view'])).toEqual({
      ok: false,
      reason: 'missing_staff_manage',
    });
  });

  it('運営者は、カタログの範囲で、任意のロールを作れる', () => {
    expect(canDefineRole(admin, ['invoice:void', 'event:manage'])).toEqual({ ok: true });
  });

  it('自分が持たない権限を含むロールは作れない（自分の範囲まで）', () => {
    const limitedAdmin = ctx(['staff:manage', 'member:view'], 'all');

    expect(canDefineRole(limitedAdmin, ['member:view'])).toEqual({ ok: true });
    expect(canDefineRole(limitedAdmin, ['member:view', 'invoice:refund'])).toEqual({
      ok: false,
      reason: 'exceeds_actor',
    });
  });

  it('性質: 作れるロールの権限は、必ず作る人の権限の部分集合', () => {
    const permission = fc.constantFrom(...STANDARD_ROLES.admin);
    fc.assert(
      fc.property(fc.uniqueArray(permission), fc.uniqueArray(permission), (actorPerms, rolePerms) => {
        const actor = ctx(actorPerms, 'all');

        const result = canDefineRole(actor, rolePerms);

        if (result.ok) expect(rolePerms.every((p) => actor.permissions.has(p))).toBe(true);
      }),
    );
  });
});

describe('leavesAtLeastOneAdmin（最後の運営者を、削除・降格できない）', () => {
  const members = [
    { id: 'u1', role: 'admin' },
    { id: 'u2', role: 'admin' },
    { id: 'u3', role: 'coach' },
  ];

  it('運営者が 2 人いれば、1 人を削除・降格できる', () => {
    expect(leavesAtLeastOneAdmin(members, { type: 'remove', id: 'u1' })).toBe(true);
    expect(leavesAtLeastOneAdmin(members, { type: 'set_role', id: 'u1', role: 'office' })).toBe(true);
  });

  it('最後の運営者は、削除も降格もできない', () => {
    const solo = [
      { id: 'u1', role: 'admin' },
      { id: 'u3', role: 'coach' },
    ];

    expect(leavesAtLeastOneAdmin(solo, { type: 'remove', id: 'u1' })).toBe(false);
    expect(leavesAtLeastOneAdmin(solo, { type: 'set_role', id: 'u1', role: 'coach' })).toBe(false);
  });

  it('運営者以外の変更は、いつでもできる。運営者のままの変更も同じ', () => {
    const solo = [
      { id: 'u1', role: 'admin' },
      { id: 'u3', role: 'coach' },
    ];

    expect(leavesAtLeastOneAdmin(solo, { type: 'remove', id: 'u3' })).toBe(true);
    expect(leavesAtLeastOneAdmin(solo, { type: 'set_role', id: 'u1', role: 'admin' })).toBe(true);
  });

  it('運営者がいない状態から、運営者を 1 人も増やさない変更は、ok とは言わない（不変条件）', () => {
    expect(leavesAtLeastOneAdmin([{ id: 'u3', role: 'coach' }], { type: 'remove', id: 'u3' })).toBe(false);
  });
});
