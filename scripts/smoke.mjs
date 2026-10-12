// تست دود روی سرور در حال اجرا:  node scripts/smoke.mjs http://127.0.0.1:3000 رمز
const base = process.argv[2] || 'http://127.0.0.1:3000';
const password = process.argv[3] || 'admin1234';
const j = async (method, url, body, cookie) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie: cookie || '' }, body: body ? JSON.stringify(body) : undefined });
  return { r, data: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
};
const must = (c, m) => { if (!c) { console.error('SMOKE FAIL:', m); process.exit(1); } console.log('ok -', m); };
for (let i = 0; i < 30; i++) { try { if ((await fetch(base + '/api/version')).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 1000)); }
const v = await j('GET', '/api/version'); must(v.data?.version, 'version ' + v.data?.version);
const l = await j('POST', '/api/login', { username: 'admin', password }); must(l.r.ok, 'login');
const cookie = l.r.headers.get('set-cookie').split(';')[0];
must((await j('POST', '/api/products', { code: '101', description: 'کالای آزمایشی', unit: 'عدد', price: 1000 }, cookie)).r.status === 201, 'product');
const inv = await j('POST', '/api/invoices', { jdate: '1405/07/20', buyer: { name: 'خریدار آزمایشی' }, items: [{ code: '101', qty: 3 }], finalize: true }, cookie);
must(inv.r.status === 201 && inv.data.payable === 3000, 'final invoice + PDF');
const pdf = Buffer.from(await (await fetch(base + `/api/invoices/${inv.data.id}/pdf`, { headers: { cookie } })).arrayBuffer());
must(pdf.subarray(0, 4).toString() === '%PDF', 'pdf served');
must((await fetch(base + '/')).ok && (await fetch(base + '/vendor/jalaali.js')).ok && (await fetch(base + '/fonts.css')).ok, 'static files');
console.log('SMOKE OK');
