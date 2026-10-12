import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSea } from 'node:sea';

/** پوشه‌ی برنامه: کنار فایل exe (حالت بسته‌بندی‌شده) یا ریشه‌ی پروژه. */
export const SEA = isSea();
export const ROOT = SEA
  ? path.dirname(process.execPath)
  : process.env.APP_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** اولین مسیر موجود از میان گزینه‌ها (برای فایل‌های vendor). */
export const firstExisting = (...c) => c.find((p) => fs.existsSync(p)) || c[c.length - 1];
