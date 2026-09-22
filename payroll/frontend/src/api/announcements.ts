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

export type AnnouncementSnapshot = {
  announcements: SystemAnnouncement[]
  server_time: string
}

async function parseResponse(response: Response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? 'ดำเนินการประกาศไม่สำเร็จ')
  return body
}

export async function getAnnouncements(): Promise<SystemAnnouncement[]> {
  return (await getAnnouncementSnapshot()).announcements
}

export async function getAnnouncementSnapshot(): Promise<AnnouncementSnapshot> {
  const response = await fetch(`${API_URL}/announcements`, { headers: authorizationHeaders(), cache: 'no-store' })
  const body = await parseResponse(response)
  return {
    announcements: body.data as SystemAnnouncement[],
    server_time: String(body.server_time ?? new Date().toISOString()),
  }
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

export async function getSystemReleaseId(): Promise<string> {
  const backendRoot = API_URL.replace(/\/api\/?$/, '')
  const response = await fetch(`${backendRoot}/healthz`, { cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.status !== 'ok' || !body?.release_id) {
    throw new Error('ระบบเวอร์ชันใหม่ยังไม่พร้อมใช้งาน')
  }
  return String(body.release_id)
}
