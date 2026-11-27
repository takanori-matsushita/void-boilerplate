import fs from 'node:fs';
import path from 'node:path';
import { extractImports, listSourceFiles } from './imports.ts';

export interface Violation {
  file: string;
  specifier: string;
  rule: string;
}

const isTestFile = (file: string) =>
  /\.test\.(ts|tsx)$/.test(file) ||
  file.includes(`${path.sep}test${path.sep}`) ||
  file.includes(`${path.sep}tests${path.sep}`);
const matches = (specifier: string, pattern: string) =>
  pattern.endsWith('/*') ? specifier.startsWith(pattern.slice(0, -1)) : specifier === pattern;
const anyMatch = (specifier: string, patterns: readonly string[]) => patterns.some((p) => matches(specifier, p));

interface PackageRule {
  /** リポジトリのルートからの相対ディレクトリ（src 配下だけを検査する。テストは対象外） */
  dir: string;
  /** import してよい外部パッケージ・ワークスペースパッケージ（相対パスは自パッケージ内のみ許可） */
  allow: readonly string[];
  why: string;
}

/**
 * packages/* は Void・Hono・React に依存させない（フレームワーク非依存。CLAUDE.md「Void の使い方」）。
 * 依存の向き: apps → core / db / line / stripe → shared（内側は外側を知らない）
 */
/** core の内部の層。内側（domain）は外側（ports → application）を知らない */
const CORE_LAYERS = ['domain', 'ports', 'application'] as const;
const CORE_FORBIDDEN: Record<string, readonly string[]> = {
  domain: ['ports', 'application'],
  ports: ['application'],
  application: [],
};

function coreLayerOf(root: string, file: string): string | undefined {
  const relative = path.relative(path.join(root, 'packages/core/src'), file).split(path.sep)[0] ?? '';
  return (CORE_LAYERS as readonly string[]).includes(relative) ? relative : undefined;
}

export const PACKAGE_RULES: readonly PackageRule[] = [
  { dir: 'packages/shared/src', allow: ['valibot'], why: 'shared は最も内側（valibot のみ）' },
  {
    dir: 'packages/core/src',
    allow: ['@club/shared', '@internationalized/date'],
    why: 'core は純粋関数。I/O・フレームワーク・DB に依存しない（日付計算の @internationalized/date は純粋なので可）',
  },
  {
    dir: 'packages/db/src',
    allow: ['@club/shared', '@club/core', 'drizzle-orm', 'drizzle-orm/*'],
    why: 'db は shared / core（ports の実装）/ Drizzle のみ（Void に依存させない）',
  },
  { dir: 'packages/line/src', allow: ['@club/shared', '@club/core'], why: 'line は shared / core のみ' },
  {
    dir: 'packages/stripe/src',
    allow: ['@club/shared', '@club/core', 'stripe'],
    why: 'stripe は shared / core / stripe のみ',
  },
];

/** ブラウザに配信されるコード（pages / components）が import してはいけないサーバー専用のもの */
export const CLIENT_FORBIDDEN: readonly string[] = [
  'void/db',
  'void/auth',
  'void/env',
  'void/queues',
  'void/storage',
  'void/kv',
  'hono',
  'hono/*',
  'pg',
  'drizzle-orm',
  'drizzle-orm/*',
  'stripe',
  '@club/db',
  '@club/stripe',
  '@club/line',
];

const WORKSPACE_APPS = ['admin', 'liff'];

/** React Aria は、アプリの components/ui/（自分たちの薄いラッパー）の中でだけ import する */
const isReactAria = (specifier: string) =>
  specifier === 'react-aria' || specifier.startsWith('react-aria-') || specifier.startsWith('react-aria/');

function relativeEscapes(file: string, specifier: string, rootDir: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const target = path.resolve(path.dirname(file), specifier);
  const relative = path.relative(rootDir, target);
  return relative.startsWith('..') || path.isAbsolute(relative);
}

const isZod = (specifier: string) => specifier === 'zod' || specifier.startsWith('zod/');

export function findViolations(root: string): Violation[] {
  const violations: Violation[] = [];
  const add = (file: string, specifier: string, rule: string) =>
    violations.push({ file: path.relative(root, file), specifier, rule });
  const imports = (file: string) => extractImports(fs.readFileSync(file, 'utf8'));

  for (const rule of PACKAGE_RULES) {
    const dir = path.join(root, rule.dir);
    const packageRoot = path.dirname(dir);
    for (const file of listSourceFiles(dir)) {
      for (const specifier of imports(file)) {
        if (specifier.startsWith('.')) {
          if (relativeEscapes(file, specifier, packageRoot))
            add(file, specifier, `${rule.dir}: 他パッケージを相対パスで import しない`);
          if (rule.dir === 'packages/core/src') {
            const from = coreLayerOf(root, file);
            const to = coreLayerOf(root, path.resolve(path.dirname(file), specifier));
            if (from && to && CORE_FORBIDDEN[from]?.includes(to)) {
              add(file, specifier, `packages/core: ${from}/ は ${to}/ を知らない（内側は外側に依存しない）`);
            }
          }
          continue;
        }
        if (isZod(specifier)) continue; // zod は下の全体のルールで 1 回だけ報告する
        if (!anyMatch(specifier, rule.allow)) add(file, specifier, `${rule.dir}: ${rule.why}`);
      }
    }
  }

  for (const app of WORKSPACE_APPS) {
    const appRoot = path.join(root, 'apps', app);
    const otherApps = WORKSPACE_APPS.filter((a) => a !== app);
    for (const file of listSourceFiles(appRoot)) {
      const clientSide =
        /^(pages|components)[\\/]/.test(path.relative(appRoot, file)) &&
        !/\.server\.(ts|tsx)$/.test(file) &&
        !isTestFile(file);
      if (/^(pages|routes|middleware|queues|crons)[\\/]/.test(path.relative(appRoot, file)) && isTestFile(file)) {
        add(
          file,
          '(ファイル)',
          `apps/${app}: テストを pages / routes / middleware / queues / crons に置かない（ルートとして扱われる）。tests/ に置く`,
        );
      }
      for (const specifier of imports(file)) {
        if (otherApps.some((other) => specifier === `@club/${other}` || specifier.startsWith(`@club/${other}/`))) {
          add(file, specifier, `apps/${app}: 別のアプリを import しない（共有するものは packages/ へ）`);
        }
        if (specifier.startsWith('.') && relativeEscapes(file, specifier, appRoot)) {
          add(
            file,
            specifier,
            `apps/${app}: アプリの外を相対パスで import しない（packages/* はパッケージ名で import する）`,
          );
        }
        const relativeToApp = path.relative(appRoot, file);
        if (isReactAria(specifier) && !isTestFile(file) && !/^components[\\/]ui[\\/]/.test(relativeToApp)) {
          add(
            file,
            specifier,
            `apps/${app}: React Aria は components/ui/ のラッパーの中でだけ import する。ページや他の部品は、ラッパーを使う`,
          );
        }
        if (clientSide && anyMatch(specifier, CLIENT_FORBIDDEN)) {
          add(
            file,
            specifier,
            `apps/${app}: pages / components（ブラウザに配信される）からサーバー専用のものを import しない。.server.ts か routes/ に置く`,
          );
        }
      }
    }
  }

  for (const file of listSourceFiles(path.join(root, 'packages')).concat(listSourceFiles(path.join(root, 'deploy')))) {
    for (const specifier of imports(file)) {
      if (
        WORKSPACE_APPS.some(
          (app) =>
            specifier === `@club/${app}` || specifier.startsWith(`@club/${app}/`) || /(^|\/)apps\//.test(specifier),
        )
      ) {
        add(file, specifier, 'packages / deploy は apps に依存しない');
      }
    }
  }
  for (const dir of ['apps', 'packages', 'deploy']) {
    for (const file of listSourceFiles(path.join(root, dir))) {
      for (const specifier of imports(file)) {
        if (isZod(specifier)) add(file, specifier, 'バリデーションは Valibot に統一する（zod を直接 import しない）');
      }
    }
  }
  return violations;
}
