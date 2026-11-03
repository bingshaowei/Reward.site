export async function api<T = { ok: boolean }>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${url}`, { ...options, headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('auth/')) window.location.assign('/login');
    throw new Error(result.error ?? '操作失败，请稍后重试');
  }
  return result;
}
export function formBody(data: unknown, files: File[] = []) {
  const form = new FormData(); form.set('data', JSON.stringify(data));
  for (const file of files) form.append('files', file); return form;
}
export const date = (value: string | null | undefined, includeTime = false) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}) }) : '未设置';
export const serializable = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
