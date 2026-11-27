import { defineConfig } from 'vite-plus';

// ルートの vite.config.ts は、テスト（vp test）専用。アプリのビルド設定は各アプリの vite.config.ts。
// unit: 外部依存なし。integration: ローカル / CI の Postgres（docker compose）が必要
export default defineConfig({
  // 整形（Oxfmt）。コードだけを対象にし、Markdown・YAML・生成物・検証用コード（spike）は触らない
  fmt: {
    singleQuote: true,
    printWidth: 120,
    // Tailwind のクラスを、公式（prettier-plugin-tailwindcss）と同じ順に並べる。Tailwind 4 は、トークン（@theme）を読むため CSS を指定する
    sortTailwindcss: { stylesheet: './apps/admin/styles/app.css' },
    ignorePatterns: [
      '**/*.md',
      '**/*.yml',
      '**/*.yaml',
      '**/*.sql',
      '**/*.json',
      '**/pnpm-lock.yaml',
      '**/dist/**',
      '**/.void/**',
      '**/.cloudflare/**',
      '**/db/migrations/**',
      'spike/**',
      '.claude/**',
    ],
  },
  // リント（Oxlint）と型チェック。Biome / pint の代わり
  lint: {
    ignorePatterns: ['**/dist/**', '**/.void/**', '**/.cloudflare/**', 'spike/**', '.claude/**'],
    // plugins を指定すると既定（typescript / unicorn / oxc）を上書きするので、すべて列挙する。
    // react = eslint-plugin-react + react-hooks + React Compiler の規則 / jsx-a11y = アクセシビリティ（React Aria と合わせて守る）
    plugins: ['typescript', 'unicorn', 'oxc', 'react', 'jsx-a11y'],
    // フックの規則は、明示しないと検出されない（実測）。依存配列の漏れは、古い値を使うバグになるのでエラーにする
    rules: { 'react/rules-of-hooks': 'error', 'react/exhaustive-deps': 'error' },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'deploy/**/test/**/*.test.ts', 'architecture/**/*.test.ts'],
          exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.integration.test.ts', 'deploy/**/test/**/*.integration.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
