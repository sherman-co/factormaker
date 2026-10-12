// ساخت بسته‌ی اجرایی (Node SEA):  node scripts/build-exe.mjs
// خروجی: release/FactorMaker/  (exe + public + shared + fonts + vendor + package.json)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const out = path.join(root, 'release', 'FactorMaker');
const work = path.join(root, 'release', '.work');
fs.rmSync(path.join(root, 'release'), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(work, { recursive: true });

// ۱) یک فایل CJS از کل سرور
await build({
  entryPoints: [path.join(root, 'server/index.js')],
  outfile: path.join(work, 'app.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning',
  external: ['node:sea', 'chromium-bidi/*', 'electron'],
  alias: { puppeteer: 'puppeteer-core' },
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
});

// ۲) بلوب SEA
fs.writeFileSync(path.join(work, 'sea-config.json'), JSON.stringify({ main: path.join(work, 'app.cjs'), output: path.join(work, 'app.blob'), disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--experimental-sea-config', path.join(work, 'sea-config.json')], { stdio: 'inherit' });

// ۳) تزریق در نسخه‌ای از node (روی ویندوز: node.exe)
const exeName = process.platform === 'win32' ? 'FactorMaker.exe' : 'FactorMaker';
const exe = path.join(out, exeName);
fs.copyFileSync(process.execPath, exe);
const postject = require.resolve('postject/dist/cli.js');
execFileSync(process.execPath, [postject, exe, 'NODE_SEA_BLOB', path.join(work, 'app.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])], { stdio: 'inherit' });

// ۴) فایل‌های کنار exe
const cp = (a, b) => fs.cpSync(path.join(root, a), path.join(out, b), { recursive: true });
cp('public', 'public'); cp('shared', 'shared'); cp('package.json', 'package.json');
fs.mkdirSync(path.join(out, 'fonts'));
fs.copyFileSync(path.join(root, 'fonts/README.txt'), path.join(out, 'fonts/README.txt'));
fs.mkdirSync(path.join(out, 'vendor'));
fs.copyFileSync(path.join(root, 'node_modules/jalaali-js/dist/index.js'), path.join(out, 'vendor/jalaali.js'));
fs.copyFileSync(path.join(root, 'node_modules/vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2'), path.join(out, 'vendor/Vazirmatn[wght].woff2'));
fs.copyFileSync(path.join(root, 'scripts/README-exe.txt'), path.join(out, 'README.txt'));
fs.rmSync(work, { recursive: true, force: true });
console.log('Built:', out);
