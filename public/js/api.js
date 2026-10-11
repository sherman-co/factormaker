export class ApiError extends Error {
  constructor(message, data, status) { super(message); this.data = data; this.status = status; }
}

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/me')) {
    window.dispatchEvent(new Event('fm-logout'));
  }
  if (!res.ok) throw new ApiError(data.error || 'خطا در ارتباط با سرور', data, res.status);
  return data;
}
export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const put = (u, b = {}) => api('PUT', u, b);
export const del = (u) => api('DELETE', u);
