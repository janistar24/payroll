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

export async function loginWithDatabase(username: string, password: string): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  if (!response.ok) {
    throw new Error(response.status === 401 ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' : `เข้าสู่ระบบไม่สำเร็จ: ${response.status}`)
  }

  const result = (await response.json()) as LoginResponse
  if (!result.success || !result.data?.access_token) throw new Error('ระบบไม่สามารถออก token สำหรับเข้าสู่ระบบได้')
  localStorage.setItem(TOKEN_KEY, result.data.access_token)
  return result.data.user
}
