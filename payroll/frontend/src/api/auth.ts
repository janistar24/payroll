const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'
const TOKEN_KEY = 'payroll_access_token'

export interface AuthUser {
  id: number
  username: string
  full_name: string | null
  email: string | null
  role: string
  department_id: number | null
  department_name: string | null
}

interface LoginResponse {
  success: boolean
  data: { access_token: string; token_type: string; user: AuthUser }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function clearAccessToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function authorizationHeaders(): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds))

async function postLoginWithWakeRetry(username: string, password: string): Promise<Response> {
  let lastResponse: Response | null = null
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
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

export async function loginWithDatabase(username: string, password: string): Promise<AuthUser> {
  const response = await postLoginWithWakeRetry(username, password)

  if (!response.ok) {
    throw new Error(response.status === 401 ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' : `เข้าสู่ระบบไม่สำเร็จ: ${response.status}`)
  }

  const result = (await response.json()) as LoginResponse
  if (!result.success || !result.data?.access_token) throw new Error('ระบบไม่สามารถออก token สำหรับเข้าสู่ระบบได้')
  localStorage.setItem(TOKEN_KEY, result.data.access_token)
  return result.data.user
}
