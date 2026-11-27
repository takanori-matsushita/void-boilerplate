import type { ReactNode } from 'react';
import '../styles/app.css';

// 共通の CSS（Tailwind とデザイントークン）を、全ページに 1 回だけ読み込む
export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
