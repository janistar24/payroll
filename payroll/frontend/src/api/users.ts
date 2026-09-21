import { authorizationHeaders } from './auth'
import { idempotentFetch } from './idempotency'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

export interface SystemUser {
  id: number; username: string; full_name: string; email: string | null; employee_id: number | null
  is_active: boolean; role: 'hr' | 'director' | 'admin'; employee_code: string | null; department_name: string | null
  access_request_id: number | null; has_initial_password: boolean
}

async function request(path: string, init?: RequestInit) {
  const options = { ...init, headers: { 'Content-Type': 'application/json', ...authorizationHeaders(), ...(init?.headers ?? {}) } }
  const response = init?.method && init.method !== 'GET'
    ? await idempotentFetch(`${API_URL}${path}`, options, `${init.method}:${path}`)
    : await fetch(`${API_URL}${path}`, options)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'ดำเนินการไม่สำเร็จ')
  return body
}

export async function getUsers(): Promise<SystemUser[]> { return (await request('/users')).data }
export async function createSystemUser(input: { username: string; temporary_password: string; employee_id: number; role: SystemUser['role'] }) { return request('/users', { method: 'POST', body: JSON.stringify(input) }) }
export async function resetSystemUserPassword(id: number, temporary_password: string) { return request(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ temporary_password }) }) }
export async function deleteSystemUser(id: number) { return request(`/users/${id}`, { method: 'DELETE' }) }
export async function deactivateSystemUser(id: number) { return request(`/users/${id}/deactivate`, { method: 'POST' }) }
export async function activateSystemUser(id: number) { return request(`/users/${id}/activate`, { method: 'POST' }) }
export async function changeMyPassword(current_password: string, new_password: string) { return request('/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }) }
export async function createUserInvite(email: string, requested_role: SystemUser['role']) { return request('/admin/invites', { method: 'POST', body: JSON.stringify({ email, requested_role }) }) }
export interface AccessRequest { id: number; username: string; requested_role: SystemUser['role']; status: 'PENDING' | 'APPROVED' | 'REJECTED'; employee_data: Record<string, unknown>; created_at: string; invited_email: string }
export async function getAccessRequests(): Promise<AccessRequest[]> { return (await request('/admin/access-requests')).data }
export async function approveAccessRequest(id: number, actual_role: SystemUser['role']) { return request(`/admin/access-requests/${id}/approve`, { method: 'POST', body: JSON.stringify({ actual_role }) }) }
export async function rejectAccessRequest(id: number, reason?: string) { return request(`/admin/access-requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason || null }) }) }
export async function revealAccessRequestPassword(id: number): Promise<string> { return (await request(`/admin/access-requests/${id}/password`)).data.password }
