import { authorizationHeaders } from './auth'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

export type AuditLogSource = 'all' | 'audit' | 'access'
export type AuditLogOutcome = '' | 'SUCCESS' | 'FAILED'

export type AuditLogRow = {
  id: string
  log_type: 'audit' | 'access'
  occurred_at: string
  username: string | null
  role: string | null
  action: string
  resource_type: string
  resource_id: string | null
  outcome: 'SUCCESS' | 'FAILED'
  ip_address: string | null
  user_agent: string | null
  request_id: string | null
  details: Record<string, unknown>
  total_count: number
}

export type AuditLogFilters = {
  source: AuditLogSource
  date_from: string
  date_to: string
  username: string
  action: string
  outcome: AuditLogOutcome
}

function queryString(filters: AuditLogFilters, page?: number) {
  const query = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value) })
  if (page) query.set('page', String(page))
  query.set('page_size', '100')
  return query.toString()
}

export async function getAuditLogs(filters: AuditLogFilters, page = 1): Promise<{ rows: AuditLogRow[]; total: number; retentionDays: number }> {
  const response = await fetch(`${API_URL}/admin/audit-logs?${queryString(filters, page)}`, { headers: authorizationHeaders(), cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? 'โหลดบันทึกการใช้งานไม่สำเร็จ')
  return { rows: body.data, total: body.pagination.total, retentionDays: body.retention_days }
}

export async function exportAuditLogsCsv(filters: AuditLogFilters): Promise<void> {
  const response = await fetch(`${API_URL}/admin/audit-logs/export.csv?${queryString(filters)}`, { headers: authorizationHeaders(), cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? 'ส่งออก CSV ไม่สำเร็จ')
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'payflow_logs.csv'
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
