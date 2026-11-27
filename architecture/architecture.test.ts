import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { extractImports } from './imports.ts';
import { findViolations } from './rules.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');

describe('このリポジトリ', () => {
  it('層の依存方向に違反がない（packages はフレームワーク非依存、client は server 専用を import しない）', () => {
    const violations = findViolations(repoRoot);

    expect(violations, violations.map((v) => `${v.file} → ${v.specifier}\n  ${v.rule}`).join('\n')).toEqual([]);
  });
});

describe('違反の検出（ルールが機能していること）', () => {
  let root: string;
  const write = (file: string, content: string) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  const specifiers = () => findViolations(root).map((v) => `${v.file}: ${v.specifier}`);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'club-arch-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('許可された import は違反にしない', () => {
    write('packages/core/src/a.ts', "import { z } from '@club/shared';\nexport const a = z;\n");
    write('packages/shared/src/b.ts', "import * as v from 'valibot';\nexport const b = v;\n");
    write('packages/db/src/c.ts', "import { sql } from 'drizzle-orm/pg-core';\nexport const c = sql;\n");
    write('packages/db/src/d.ts', "import type { Port } from '@club/core';\nexport type D = Port;\n"); // db は ports を実装する
    write(
      'packages/core/src/application/uc.ts',
      "import { x } from '../domain/x';\nimport type { P } from '../ports/p';\nexport const uc = [x, {} as P];\n",
    );

    expect(findViolations(root)).toEqual([]);
  });

  it('core が Void / Hono / DB / Node に依存したら検出する', () => {
    write('packages/core/src/a.ts', "import { db } from 'void/db';\nexport const a = db;\n");
    write('packages/core/src/b.ts', "import { Hono } from 'hono';\nexport const b = Hono;\n");
    write('packages/core/src/c.ts', "import { withTenant } from '@club/db';\nexport const c = withTenant;\n");
    write('packages/core/src/d.ts', "import fs from 'node:fs';\nexport const d = fs;\n");

    expect(specifiers()).toEqual(
      expect.arrayContaining([
        'packages/core/src/a.ts: void/db',
        'packages/core/src/b.ts: hono',
        'packages/core/src/c.ts: @club/db',
        'packages/core/src/d.ts: node:fs',
      ]),
    );
  });

  it('core の内部の層: domain は ports / application を、ports は application を知ってはいけない', () => {
    write('packages/core/src/domain/a.ts', "import { uc } from '../application/uc';\nexport const a = uc;\n");
    write('packages/core/src/domain/b.ts', "import type { P } from '../ports/p';\nexport type B = P;\n");
    write('packages/core/src/ports/c.ts', "import { uc } from '../application/uc';\nexport const c = uc;\n");

    expect(specifiers().sort()).toEqual([
      'packages/core/src/domain/a.ts: ../application/uc',
      'packages/core/src/domain/b.ts: ../ports/p',
      'packages/core/src/ports/c.ts: ../application/uc',
    ]);
  });

  it('core が db に依存したら検出する（db が core の ports を実装する向きだけを許す）', () => {
    write(
      'packages/core/src/application/a.ts',
      "import { withTenant } from '@club/db';\nexport const a = withTenant;\n",
    );

    expect(specifiers()).toEqual(['packages/core/src/application/a.ts: @club/db']);
  });

  it('バリデーションは Valibot に統一する: zod を直接 import したら、どこでも検出する', () => {
    write('packages/shared/src/a.ts', "import { z } from 'zod';\nexport const a = z;\n");
    write('apps/admin/routes/api/b.ts', "import { z } from 'zod/v4';\nexport const b = z;\n");
    write('deploy/scripts/c.mts', "import { z } from 'zod';\nexport const c = z;\n");

    expect(specifiers().sort()).toEqual([
      'apps/admin/routes/api/b.ts: zod/v4',
      'deploy/scripts/c.mts: zod',
      'packages/shared/src/a.ts: zod',
    ]);
  });

  it('db が Void に依存したら検出する', () => {
    write('packages/db/src/a.ts', "import { defineHandler } from 'void';\nexport const a = defineHandler;\n");

    expect(specifiers()).toEqual(['packages/db/src/a.ts: void']);
  });

  it('他パッケージを相対パスで import したら検出する', () => {
    write('packages/core/src/a.ts', "export * from '../../shared/src/index';\n");

    expect(specifiers()).toEqual(['packages/core/src/a.ts: ../../shared/src/index']);
  });

  it('複数行の import / 動的 import も検出する', () => {
    write('packages/core/src/a.ts', "import {\n  x,\n  y,\n} from 'void/db';\nexport const a = [x, y];\n");
    write('packages/core/src/b.ts', "export const b = () => import('hono');\n");

    expect(specifiers()).toEqual(
      expect.arrayContaining(['packages/core/src/a.ts: void/db', 'packages/core/src/b.ts: hono']),
    );
  });

  it('コメント内の import 文は無視する', () => {
    write(
      'packages/core/src/a.ts',
      "// import { db } from 'void/db';\n/* import x from 'hono'; */\nexport const a = 1;\n",
    );

    expect(findViolations(root)).toEqual([]);
  });

  it('pages / components（ブラウザに配信される）がサーバー専用を import したら検出する。.server.ts と routes は許可', () => {
    write('apps/admin/pages/x.tsx', "import { db } from 'void/db';\nexport default db;\n");
    write('apps/admin/components/y.tsx', "import { applyTenant } from '@club/db';\nexport default applyTenant;\n");
    write('apps/admin/pages/x.server.ts', "import { db } from 'void/db';\nexport const loader = db;\n");
    write('apps/admin/routes/api/z.ts', "import { db } from 'void/db';\nexport const GET = db;\n");

    expect(specifiers().sort()).toEqual(['apps/admin/components/y.tsx: @club/db', 'apps/admin/pages/x.tsx: void/db']);
  });

  it('pages / routes などの中に置かれたテストファイルを検出する（ルートとして扱われるため）。tests/ は許可', () => {
    write('apps/admin/pages/x.test.tsx', 'export {};\n');
    write('apps/admin/routes/api/y.test.ts', 'export {};\n');
    write('apps/admin/tests/pages/x.test.tsx', 'export {};\n');

    expect(specifiers().sort()).toEqual([
      'apps/admin/pages/x.test.tsx: (ファイル)',
      'apps/admin/routes/api/y.test.ts: (ファイル)',
    ]);
  });

  it('React Aria は components/ui のラッパーの中でだけ import できる（pages や他の components は、ラッパーを使う）', () => {
    write('apps/admin/pages/x.tsx', "import { Button } from 'react-aria-components';\nexport default Button;\n");
    write(
      'apps/admin/components/card.tsx',
      "import { useButton } from 'react-aria';\nexport const Card = useButton;\n",
    );
    write(
      'apps/admin/components/ui/button.tsx',
      "import { Button } from 'react-aria-components';\nexport { Button };\n",
    );
    write(
      'apps/admin/tests/pages/x.test.tsx',
      "import { Button } from 'react-aria-components';\nexport default Button;\n",
    );

    expect(specifiers().sort()).toEqual([
      'apps/admin/components/card.tsx: react-aria',
      'apps/admin/pages/x.tsx: react-aria-components',
    ]);
  });

  it('アプリ同士の依存、packages から apps への依存を検出する', () => {
    write('apps/admin/routes/a.ts', "import { x } from '@club/liff';\nexport const a = x;\n");
    write('packages/core/src/b.ts', "import { x } from '../../../apps/admin/routes/a';\nexport const b = x;\n");

    expect(specifiers()).toEqual(
      expect.arrayContaining([
        'apps/admin/routes/a.ts: @club/liff',
        'packages/core/src/b.ts: ../../../apps/admin/routes/a',
      ]),
    );
  });
});

describe('extractImports', () => {
  it('静的・型・再エクスポート・動的・require を取り出す', () => {
    const source = [
      "import a from 'a';",
      "import type { B } from 'b';",
      "export { c } from 'c';",
      "export * from 'd';",
      "const e = await import('e');",
      "const f = require('f');",
      "import './g.css';",
    ].join('\n');

    expect(extractImports(source).sort()).toEqual(['./g.css', 'a', 'b', 'c', 'd', 'e', 'f']);
  });
});
