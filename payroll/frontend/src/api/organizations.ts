import { authorizationHeaders } from './auth'
import { idempotentFetch } from './idempotency'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

export type Organization = { id: number; name: string; is_active: boolean }

export async function createOrganization(name: string): Promise<Organization> {
  const response = await idempotentFetch(`${API_URL}/organizations`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authorizationHeaders() }, body: JSON.stringify({ name }) }, `POST:/organizations:${name.trim().toLowerCase()}`)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.detail?.message ?? 'ไม่สามารถเพิ่มหน่วยงานได้')
  return body.data as Organization
}
