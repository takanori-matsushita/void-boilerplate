import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import Layout from '../../pages/layout';

afterEach(cleanup);

describe('ルートのレイアウト', () => {
  it('子のページをそのまま描画する（共通の CSS を読み込む役割で、見た目の枠は持たない）', () => {
    render(
      <Layout>
        <p>本文</p>
      </Layout>,
    );

    expect(screen.getByText('本文')).toBeTruthy();
  });
});
