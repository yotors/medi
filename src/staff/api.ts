import i18n, { t } from '../i18n';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      signal: AbortSignal.timeout(15000),
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...options.headers,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', t('errors:NETWORK'));
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = payload && typeof payload === 'object' ? payload : {};
    throw new ApiError(
      response.status,
      error.code ?? 'REQUEST_FAILED',
      t(
        error.code === 'MFA_REQUIRED' && path.startsWith('/api/auth/mfa')
          ? 'errors:MFA_PROOF_INVALID'
          : i18n.exists(`errors:${error.code}`)
            ? `errors:${error.code}`
            : response.status >= 500
              ? 'errors:READ_UNAVAILABLE'
              : 'errors:REQUEST_FAILED',
      ),
    );
  }
  const expiry = response.headers.get('X-Session-Expires-At');
  if (expiry) window.dispatchEvent(new CustomEvent('staff-session-activity', { detail: expiry }));
  return response.status === 204 ? (undefined as T) : response.json();
}
