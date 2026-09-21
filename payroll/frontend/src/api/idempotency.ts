const pendingPrefix = 'payflow:pending-request:'

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4${Math.random().toString(16).slice(2, 5)}-8${Math.random().toString(16).slice(2, 5)}-${Math.random().toString(16).slice(2)}`
}

/**
 * Keeps one request id until the server gives a definite HTTP response.
 * A network retry or a second click after reconnecting therefore cannot create
 * the same logical mutation twice.
 */
export async function idempotentFetch(url: string, init: RequestInit, operationKey: string): Promise<Response> {
  const storageKey = `${pendingPrefix}${operationKey}`
  let requestId = sessionStorage.getItem(storageKey) || newRequestId()
  sessionStorage.setItem(storageKey, requestId)
  const headers = new Headers(init.headers)
  headers.set('X-Idempotency-Key', requestId)

  try {
    const response = await fetch(url, { ...init, headers })
    // A real response means the backend knows the outcome. PROCESSING keeps the
    // same key so the next attempt asks for that result instead of starting over.
    if (response.status !== 409) sessionStorage.removeItem(storageKey)
    return response
  } catch (error) {
    // Keep the key after a network failure. The caller can retry safely.
    throw error
  }
}
