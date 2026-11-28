import { describe, expect, it } from 'vite-plus/test';
import { isTenantScopedPath } from '../../src/tenant-paths';

describe('isTenantScopedPath（テナントのトランザクションを張る対象のパス）', () => {
  it('管理 API（/api/ 配下）は、テナントのトランザクションの対象', () => {
    for (const path of ['/api/members', '/api/members/123', '/api/invoices/void', '/api/staff']) {
      expect(isTenantScopedPath(path), path).toBe(true);
    }
  });

  it('認証・Webhook・ヘルスチェックは、対象外（テナントが決まる前、またはテナントの外から呼ばれる）', () => {
    for (const path of [
      '/api/auth/sign-in/email',
      '/api/auth/organization/set-active',
      '/api/stripe/webhook',
      '/webhook/line/0190abc',
      '/api/health',
    ]) {
      expect(isTenantScopedPath(path), path).toBe(false);
    }
  });

  it('/api/ 配下でないパス（画面・静的ファイル）は、対象外', () => {
    for (const path of ['/', '/members', '/assets/app.js']) expect(isTenantScopedPath(path), path).toBe(false);
  });

  it('除外は、前方一致の抜け道にならない（/api/health-check や /api/authors は対象）', () => {
    for (const path of ['/api/health-check', '/api/authors', '/api/stripe/webhook-admin', '/api/healthz']) {
      expect(isTenantScopedPath(path), path).toBe(true);
    }
  });
});
