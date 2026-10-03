/** Thin fetch wrapper: JSON, cookies, CSRF header, typed errors. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: unknown,
  ) {
    super(message);
  }
}

function csrfToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)nsut_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const t = csrfToken();
    if (t) headers['X-CSRF-Token'] = t;
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      ...init,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Unable to reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && !path.startsWith('/auth/')) onUnauthorized();
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Something went wrong. Please try again.', e?.fields, e?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, q?: Query) => request<T>('GET', path + qs(q)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body ?? {}),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

/** Download a file endpoint (CSV/XLSX/PDF) using the session cookie. */
export async function download(path: string, q?: Query): Promise<void> {
  const res = await fetch(`/api${path}${qs(q)}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Unable to generate report. Please try again.');
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'report';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
