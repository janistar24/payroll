import { authorizationHeaders } from './auth'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

export interface SystemUser {
  id: number; username: string; full_name: string; email: string | null; employee_id: number | null
  is_active: boolean; role: 'hr' | 'director' | 'admin'; employee_code: string | null; department_name: string | null
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...authorizationHeaders(), ...(init?.headers ?? {}) } })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'ดำเนินการไม่สำเร็จ')
  return body
}

export async function getUsers(): Promise<SystemUser[]> { return (await request('/users')).data }
export async function createSystemUser(input: { username: string; temporary_password: string; employee_id: number; role: SystemUser['role'] }) { return request('/users', { method: 'POST', body: JSON.stringify(input) }) }
export async function resetSystemUserPassword(id: number, temporary_password: string) { return request(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ temporary_password }) }) }
export async function changeMyPassword(current_password: string, new_password: string) { return request('/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }) }
