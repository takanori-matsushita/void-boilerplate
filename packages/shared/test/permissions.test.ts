import fc from 'fast-check';
import * as v from 'valibot';
import { describe, expect, it } from 'vite-plus/test';
import { PERMISSION_CATALOG, PERMISSIONS, STANDARD_ROLE_KEYS, STANDARD_ROLES, permissionSchema } from '../src/index.ts';

describe('権限カタログ', () => {
  it('「リソース:操作」の形で、重複なく列挙される', () => {
    expect(PERMISSIONS.length).toBeGreaterThan(0);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    expect(PERMISSIONS.every((p) => /^[a-z_]+:[a-z_]+$/.test(p))).toBe(true);
  });

  it('設計（docs/design/permissions.md）のリソースと操作を、すべて含む', () => {
    expect(PERMISSION_CATALOG).toEqual({
      member: ['view', 'view_pii', 'create', 'update', 'change_status'],
      invoice: ['view', 'create', 'record_payment', 'void', 'refund'],
      payment_account: ['view', 'manage'],
      message: ['view', 'send', 'reply'],
      schedule: ['view', 'manage', 'attendance'],
      event: ['view', 'manage'],
      master: ['view', 'manage'],
      staff: ['view', 'manage'],
    });
  });

  it('permissionSchema は、カタログにある権限だけを受け付ける', () => {
    expect(v.safeParse(permissionSchema, 'invoice:void').success).toBe(true);
    expect(v.safeParse(permissionSchema, 'invoice:delete').success).toBe(false);
    expect(v.safeParse(permissionSchema, 'unknown:view').success).toBe(false);
    expect(v.safeParse(permissionSchema, 123).success).toBe(false);
  });
});

describe('標準ロール', () => {
  it('運営者・事務・コーチの 3 つだけ', () => {
    expect(STANDARD_ROLE_KEYS).toEqual(['admin', 'office', 'coach']);
  });

  it('運営者は、すべての権限を持つ', () => {
    expect([...STANDARD_ROLES.admin].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('事務は、請求の取消・返金までできるが、入金先の変更とメンバー管理はできない', () => {
    const office = new Set<string>(STANDARD_ROLES.office);

    expect(office.has('invoice:void')).toBe(true);
    expect(office.has('invoice:refund')).toBe(true);
    expect(office.has('payment_account:view')).toBe(true);
    expect(office.has('payment_account:manage')).toBe(false);
    expect(office.has('staff:manage')).toBe(false);
    expect(office.has('master:manage')).toBe(false);
  });

  it('コーチは、個人情報・配信・日程・出欠を扱えるが、請求・入金先・イベント・メンバー管理は扱えない', () => {
    const coach = new Set<string>(STANDARD_ROLES.coach);

    for (const p of [
      'member:view',
      'member:view_pii',
      'message:send',
      'message:reply',
      'schedule:manage',
      'schedule:attendance',
      'master:view',
    ]) {
      expect(coach.has(p), p).toBe(true);
    }
    for (const p of [
      'member:update',
      'invoice:view',
      'payment_account:view',
      'event:manage',
      'master:manage',
      'staff:view',
    ]) {
      expect(coach.has(p), p).toBe(false);
    }
  });

  it('権限の強さは コーチ ⊆ 事務 ⊆ 運営者（下位の権限が、上位に無いことはない）', () => {
    const coach = new Set<string>(STANDARD_ROLES.coach);
    const office = new Set<string>(STANDARD_ROLES.office);

    expect([...coach].every((p) => office.has(p))).toBe(true);
    expect([...office].every((p) => (STANDARD_ROLES.admin as readonly string[]).includes(p))).toBe(true);
  });

  it('どの標準ロールも、カタログにない権限を含まない', () => {
    fc.assert(
      fc.property(fc.constantFrom(...STANDARD_ROLE_KEYS), (role) =>
        STANDARD_ROLES[role].every((p) => v.is(permissionSchema, p)),
      ),
    );
  });
});
