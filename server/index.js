import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';

const { app, firstAdmin } = createApp(dataDir);
app.listen(port, host, () => {
  console.log('\n==============================================');
  console.log(`  برنامه پیش‌فاکتور اجرا شد:  http://localhost:${port}`);
  console.log(`  پوشه اطلاعات (دیتابیس و PDFها): ${dataDir}`);
  if (firstAdmin) console.log(`  اولین ورود → نام کاربری: ${firstAdmin.username}   رمز: ${firstAdmin.password}  (حتماً در تنظیمات عوض کنید)`);
  console.log('==============================================\n');
});
