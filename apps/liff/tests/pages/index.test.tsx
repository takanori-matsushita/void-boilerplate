import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import Home from '../../pages/index';

afterEach(cleanup);

describe('トップページ', () => {
  it('見出しを表示する', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { name: '保護者画面（LIFF）' })).toBeTruthy();
  });
});
