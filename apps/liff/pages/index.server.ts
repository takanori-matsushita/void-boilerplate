import { defineHandler } from 'void';

// 管理画面・LIFF は SSR なし（CLAUDE.md の技術スタック）
export const ssr = false;
export const loader = defineHandler(() => ({}));
