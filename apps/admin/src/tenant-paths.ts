/** テナントのトランザクションを張らないパス（完全一致、または、配下を含む接頭辞）。テナントが決まる前、またはテナントの外から呼ばれる */
const EXACT = new Set(['/api/health', '/api/stripe/webhook']);
const PREFIXES = ['/api/auth', '/webhook/line'];

/** 管理 API（`/api/` 配下）のうち、テナントのトランザクションを張る対象か */
export function isTenantScopedPath(path: string): boolean {
  if (!path.startsWith('/api/')) return false;
  if (EXACT.has(path)) return false;
  return !PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
