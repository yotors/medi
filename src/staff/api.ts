export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { signal: AbortSignal.timeout(15000), ...options, credentials: 'same-origin', cache: 'no-store', headers: { ...options.headers, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } }); }
  catch { throw new ApiError(0, 'NETWORK', 'The server could not be reached. Check the connection and retry.'); }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(response.status, error.code ?? 'REQUEST_FAILED', error.message ?? 'The request could not be completed. Please retry.');
  }
  return response.status === 204 ? undefined as T : response.json();
}
