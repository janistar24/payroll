const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'
const TOKEN_KEY = 'payroll_access_token'

export interface AuthUser {
  id: number
  username: string
  full_name: string | null
  email: string | null
  role: string
  can_approve_payroll: boolean
  department_id: number | null
  department_name: string | null
}

interface LoginResponse {
  success: boolean
  data: { access_token: string; token_type: string; user: AuthUser }
}

export interface AuthSession {
  session_id: string
  device_label: string
  ip_address: string
  created_at: string
  last_seen_at: string
  is_current?: boolean
}

export class SessionLimitError extends Error {
  sessions: AuthSession[]
  constructor(message: string, sessions: AuthSession[]) {
    super(message)
    this.name = 'SessionLimitError'
    this.sessions = sessions
  }
}

export function getAccessToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
  // Remove tokens issued by older versions of the application.
  localStorage.removeItem(TOKEN_KEY)
}

export async function logoutCurrentSession(): Promise<void> {
  const token = getAccessToken()
  if (!token) return
  try {
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: authorizationHeaders(), cache: 'no-store' })
  } catch {
    // Local logout must still complete when the network is unavailable.
  }
}

export function authorizationHeaders(): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export type SessionStatus = 'active' | 'replaced' | 'expired' | 'unavailable'

export async function checkCurrentSession(): Promise<SessionStatus> {
  if (!getAccessToken()) return 'expired'
  try {
    const response = await fetch(`${API_URL}/auth/me`, { headers: authorizationHeaders(), cache: 'no-store' })
    if (response.ok) return 'active'
    if (response.status !== 401) return 'unavailable'
    const body = await response.json().catch(() => null)
    return body?.detail?.code === 'SESSION_REPLACED' ? 'replaced' : 'expired'
  } catch {
    return 'unavailable'
  }
}

const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds))

async function postLoginWithWakeRetry(username: string, password: string, replaceSessionId?: string): Promise<Response> {
  let lastResponse: Response | null = null
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, replace_session_id: replaceSessionId || null }),
        cache: 'no-store',
      })
      // Never retry invalid credentials or validation errors. Retry only a
      // temporarily unavailable/cold backend.
      if (response.status < 500) return response
      lastResponse = response
    } catch (error) {
      lastError = error
    }
    if (attempt < 2) await wait((attempt + 1) * 1000)
  }
  if (lastResponse) return lastResponse
  throw lastError instanceof Error ? lastError : new Error('ไม่สามารถเชื่อมต่อระบบได้')
}

export async function loginWithDatabase(username: string, password: string, replaceSessionId?: string): Promise<AuthUser> {
  const response = await postLoginWithWakeRetry(username, password, replaceSessionId)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (response.status === 409 && body?.detail?.code === 'SESSION_LIMIT') {
      throw new SessionLimitError(body.detail.message || 'บัญชีนี้เข้าสู่ระบบครบ 2 อุปกรณ์แล้ว', body.detail.sessions || [])
    }
    if (response.status === 401) throw new Error(typeof body?.detail === 'string' ? body.detail : 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    if (response.status === 429) throw new Error(typeof body?.detail === 'string' ? body.detail : 'บัญชีถูกล็อกชั่วคราว กรุณารอสักครู่แล้วลองใหม่')
    throw new Error(`เข้าสู่ระบบไม่สำเร็จ: ${response.status}`)
  }

  const result = (await response.json()) as LoginResponse
  if (!result.success || !result.data?.access_token) throw new Error('ระบบไม่สามารถออก token สำหรับเข้าสู่ระบบได้')
  sessionStorage.setItem(TOKEN_KEY, result.data.access_token)
  return result.data.user
}

export async function getAuthSessions(): Promise<AuthSession[]> {
  const response = await fetch(`${API_URL}/auth/sessions`, { headers: authorizationHeaders(), cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'โหลดอุปกรณ์ที่เข้าสู่ระบบไม่สำเร็จ')
  return body.data || []
}

export async function revokeAuthSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_URL}/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', headers: authorizationHeaders(), cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'นำอุปกรณ์ออกจากระบบไม่สำเร็จ')
}
