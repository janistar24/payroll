import { authorizationHeaders } from './auth'
import { idempotentFetch } from './idempotency'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

export type SystemAnnouncement = {
  id: number
  title: string
  content: string
  starts_at: string
  created_at: string
  created_by_name: string
}

async function parseResponse(response: Response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? 'ดำเนินการประกาศไม่สำเร็จ')
  return body
}

export async function getAnnouncements(): Promise<SystemAnnouncement[]> {
  const response = await fetch(`${API_URL}/announcements`, { headers: authorizationHeaders(), cache: 'no-store' })
  return (await parseResponse(response)).data as SystemAnnouncement[]
}

export async function createAnnouncement(input: { title: string; content: string; starts_at: string }): Promise<SystemAnnouncement> {
  const response = await idempotentFetch(`${API_URL}/announcements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authorizationHeaders() },
    body: JSON.stringify(input),
  }, 'POST:/announcements')
  return (await parseResponse(response)).data as SystemAnnouncement
}

export async function closeAnnouncement(id: number): Promise<void> {
  const response = await idempotentFetch(`${API_URL}/announcements/${id}`, {
    method: 'DELETE', headers: authorizationHeaders(),
  }, `DELETE:/announcements/${id}`)
  await parseResponse(response)
}
