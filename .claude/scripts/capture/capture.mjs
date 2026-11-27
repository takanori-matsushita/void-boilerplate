// ログインして画面を撮る共有スクリプト(`tdd-front-impl` のデザイン確認と、`pr` のメディア添付が使う)。
// Node.js で動かす(bun は使わない)。前提: 開発サーバーが起動している(`vp run -F @club/admin dev`)、
// `vp exec playwright install chromium` 済み。
//
// 1) ページ1枚のスクリーンショット:
//   node .claude/scripts/capture/capture.mjs <パス> <出力先.png> [--mobile] [--full]
//   例: node .claude/scripts/capture/capture.mjs /classes /tmp/classes.png --mobile
//
// 2) シナリオ(操作の再生)。操作の途中でスクショを撮り、`--video` で通しの WebM も録る:
//   node .claude/scripts/capture/capture.mjs --scenario <シナリオ.mjs> --out <出力先ディレクトリ> [--mobile] [--full] [--video] [--name <動画のファイル名>]
//   シナリオは `export default async (page, { shot, origin }) => { ... }` を書く。
//     page   … Playwright の Page(ログイン済み)
//     shot   … `await shot('名前')` で `<出力先>/<名前>.png` を保存する
//     origin … `http://localhost:<port>`(`page.goto(`${origin}/...`)` に使う)
//   動画はログインの後から録る(ログイン画面を映さない)。`<出力先>/<name>.webm`(既定は `scenario.webm`)。
//
// ログイン(管理画面の Better Auth。メール + パスワード)は、SHOT_EMAIL と SHOT_PASSWORD の両方があるときだけ行う。
// 認証が無い画面(フェーズ 3 より前、LIFF の公開ページなど)は、何も設定しなければログインせずに撮る。
//   SHOT_EMAIL / SHOT_PASSWORD … サンプルテナントの管理者(シードで作る。実在の人物の情報を使わない)
//   SHOT_ORG_SLUG              … ログイン後にアクティブにする組織のスラッグ(テナント。省略可)
//   SHOT_PORT / SHOT_ORIGIN    … 既定は http://localhost:5301(管理画面の開発サーバー。LIFF は SHOT_PORT=5302)
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const USAGE = [
    '使い方:',
    '  node capture.mjs <パス> <出力先.png> [--mobile] [--full]',
    '  node capture.mjs --scenario <シナリオ.mjs> --out <出力先ディレクトリ> [--mobile] [--full] [--video] [--name <動画名>]',
].join('\n');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a === '--mobile' || a === '--full' || a === '--video'));
const option = (name) => {
    const i = argv.indexOf(name);

    return i === -1 ? undefined : argv[i + 1];
};
const scenarioPath = option('--scenario');
const outDir = option('--out');
const videoName = option('--name') ?? 'scenario';
const optionValues = new Set([scenarioPath, outDir, option('--name')].filter(Boolean));
const positional = argv.filter((a) => !a.startsWith('--') && !optionValues.has(a));

if (scenarioPath ? !outDir : positional.length < 2) {
    console.error(USAGE);
    process.exit(2);
}

const email = process.env.SHOT_EMAIL;
const password = process.env.SHOT_PASSWORD;
const orgSlug = process.env.SHOT_ORG_SLUG;
const origin = process.env.SHOT_ORIGIN ?? `http://localhost:${process.env.SHOT_PORT ?? '5301'}`;
const mobile = flags.has('--mobile');
const full = flags.has('--full');
const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const deviceScaleFactor = mobile ? 2 : 1;

/** はみ出している要素(横スクロールの原因)を返す。無ければ null。 */
const findOverflowing = (page) =>
    page.evaluate(() => {
        const width = window.innerWidth;
        if (document.documentElement.scrollWidth <= width) return null;

        return [...document.body.querySelectorAll('*')]
            .filter((el) => el.getBoundingClientRect().right > width + 1)
            .slice(0, 5)
            .map(
                (el) =>
                    `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} 「${(el.textContent ?? '').trim().slice(0, 20)}」`,
            );
    });

const reportOverflow = async (page) => {
    const overflowing = await findOverflowing(page);
    console.log(overflowing ? `横スクロール: あり(はみ出している要素を直す)\n  ${overflowing.join('\n  ')}` : '横スクロール: なし');
};

/** ログインして、そのセッション(Cookie)を返す。SHOT_EMAIL / SHOT_PASSWORD が無ければ、ログインしない。 */
const login = async (browser) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor });
    if (email && password) {
        // Better Auth の API で直接サインインする(Cookie は context に保存される)。CSRF 対策のため Origin ヘッダを付ける
        const headers = { origin, 'content-type': 'application/json' };
        const signIn = await context.request.post(`${origin}/api/auth/sign-in/email`, { data: { email, password }, headers });
        if (!signIn.ok()) {
            throw new Error(`ログインに失敗しました(${signIn.status()})。SHOT_EMAIL / SHOT_PASSWORD と、開発サーバーの DB のシードを確認する`);
        }
        if (orgSlug) {
            const active = await context.request.post(`${origin}/api/auth/organization/set-active`, {
                data: { organizationSlug: orgSlug },
                headers,
            });
            if (!active.ok()) console.warn(`警告: 組織 ${orgSlug} をアクティブにできませんでした(${active.status()})`);
        }
    } else {
        console.log('SHOT_EMAIL / SHOT_PASSWORD が未設定のため、ログインせずに撮ります');
    }
    const state = await context.storageState();
    await context.close();

    return state;
};

const runPage = async (browser) => {
    const [path, out] = positional;
    const context = await browser.newContext({ viewport, deviceScaleFactor, storageState: await login(browser) });
    const page = await context.newPage();
    const response = await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
    console.log(`${response?.status()} ${page.url()}`);
    const arrived = new URL(page.url()).pathname;
    if (arrived !== path.split('?')[0]) {
        console.warn(`警告: ${path} ではなく ${arrived} に着きました(リダイレクトされています)`);
    }
    await reportOverflow(page);
    mkdirSync(dirname(resolve(out)), { recursive: true });
    await page.screenshot({ path: out, fullPage: full });
    console.log(`保存: ${out}`);
    await context.close();
};

const runScenario = async (browser) => {
    const scenario = (await import(pathToFileURL(resolve(scenarioPath)).href)).default;
    if (typeof scenario !== 'function') {
        throw new Error(`シナリオは default export に async 関数を書く: ${scenarioPath}`);
    }
    mkdirSync(outDir, { recursive: true });
    const rawVideoDir = join(outDir, '.video-tmp');
    const context = await browser.newContext({
        viewport,
        deviceScaleFactor,
        storageState: await login(browser),
        ...(flags.has('--video') ? { recordVideo: { dir: rawVideoDir, size: viewport } } : {}),
    });
    const page = await context.newPage();
    const shot = async (name) => {
        const file = join(outDir, `${basename(name)}.png`);
        await page.screenshot({ path: file, fullPage: full });
        console.log(`保存: ${file}`);
        await reportOverflow(page);
    };
    try {
        await scenario(page, { shot, origin });
        console.log(`終了時の URL: ${page.url()}`);
    } finally {
        const video = page.video();
        await context.close(); // 動画はコンテキストを閉じてから確定する
        if (video) {
            const file = join(outDir, `${videoName}.webm`);
            renameSync(await video.path(), file);
            rmSync(rawVideoDir, { recursive: true, force: true });
            console.log(`保存: ${file}`);
        }
    }
};

const browser = await chromium.launch();
try {
    await (scenarioPath ? runScenario(browser) : runPage(browser));
} finally {
    await browser.close();
}
