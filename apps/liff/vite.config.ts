import { defineConfig } from 'vite-plus';
import tailwindcss from '@tailwindcss/vite';
import { voidPlugin } from 'void';
import { voidReact } from '@void/react/plugin';

export default defineConfig({
  plugins: [voidPlugin(), voidReact({ react: { compiler: true } }), tailwindcss()],
  // コンポーネントテスト（Testing Library + happy-dom）。tests/ に置く（pages/ や routes/ に置くとルートとして扱われる）
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
