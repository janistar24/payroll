const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

export type InviteRole = 'hr' | 'director' | 'admin'
export type InviteReference = { id: number; code: string; name: string }
export type InviteData = { email: string; requested_role: InviteRole; departments: InviteReference[]; positions: InviteReference[] }

async function publicRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'ไม่สามารถดำเนินการได้')
  return body
}

export async function getInvite(token: string): Promise<InviteData> { return (await publicRequest(`/invites/${token}`)).data }
export async function submitInvite(token: string, body: unknown) { return publicRequest(`/invites/${token}/submit`, { method: 'POST', body: JSON.stringify(body) }) }
