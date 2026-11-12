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

  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, headers })
      const retryable = response.status === 409 || [502, 503, 504].includes(response.status)
      if (!retryable) sessionStorage.removeItem(storageKey)
      if (!retryable || attempt === 3) return response
    } catch (error) {
      lastError = error
      if (attempt === 3) throw error
    }
    await new Promise(resolve => window.setTimeout(resolve, 500 * (attempt + 1)))
  }
  throw lastError instanceof Error ? lastError : new Error('ไม่สามารถเชื่อมต่อระบบได้')
}
