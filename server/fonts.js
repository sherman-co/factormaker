import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FONTS_DIR = path.join(root, 'fonts');
const VAZIR_DIR = path.join(root, 'node_modules', 'vazirmatn', 'fonts', 'webfonts');
const MIME = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
const FMT = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype' };

/** فایل‌های B Yekan داخل پوشه fonts (هر نام شامل yekan). */
function yekanFiles() {
  if (!fs.existsSync(FONTS_DIR)) return [];
  return fs.readdirSync(FONTS_DIR)
    .filter((f) => /yekan/i.test(f) && MIME[path.extname(f).toLowerCase()])
    .map((f) => ({ file: path.join(FONTS_DIR, f), url: '/fonts/' + encodeURIComponent(f), bold: /bold|bd|black/i.test(f), ext: path.extname(f).toLowerCase() }));
}

export function hasYekan() {
  return yekanFiles().length > 0;
}

/**
 * CSS فونت‌ها. اگر embed=true فایل‌ها به‌صورت base64 درون HTML می‌روند (برای PDF).
 * خانواده‌ی «BYekan» اگر فایل نبود، خالی می‌ماند و Vazirmatn جایگزین می‌شود.
 */
export function fontCss({ embed = false } = {}) {
  const src = (f, url) => {
    const u = embed ? `data:${MIME[f.ext]};base64,${fs.readFileSync(f.file).toString('base64')}` : url;
    return `url("${u}") format("${FMT[f.ext]}")`;
  };
  let css = '';
  const ys = yekanFiles();
  const normal = ys.filter((f) => !f.bold);
  const bold = ys.filter((f) => f.bold);
  if (normal.length) css += `@font-face{font-family:"B Yekan";font-weight:400;src:${normal.map((f) => src(f, f.url)).join(',')};}\n`;
  if (bold.length) css += `@font-face{font-family:"B Yekan";font-weight:700;src:${bold.map((f) => src(f, f.url)).join(',')};}\n`;
  else if (normal.length) css += `@font-face{font-family:"B Yekan";font-weight:700;src:${normal.map((f) => src(f, f.url)).join(',')};}\n`;
  const vf = path.join(VAZIR_DIR, 'Vazirmatn[wght].woff2');
  if (fs.existsSync(vf)) {
    const f = { file: vf, ext: '.woff2' };
    css += `@font-face{font-family:"Vazirmatn";font-weight:100 900;src:${src(f, '/vendor/vazirmatn.woff2')};}\n`;
  }
  return css;
}

export const FONT_STACK = '"B Yekan","Vazirmatn",Tahoma,sans-serif';
export const VAZIR_FILE = path.join(VAZIR_DIR, 'Vazirmatn[wght].woff2');
