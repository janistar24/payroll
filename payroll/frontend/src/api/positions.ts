export interface Position {
  id: number
  code: string
  name: string
  level: string | null
  is_active: boolean
}

interface PositionsResponse {
  success: boolean
  count: number
  data: Position[]
}

const API_URL =
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

export async function getPositions(): Promise<Position[]> {
  const response = await fetch(`${API_URL}/positions`, { headers: authorizationHeaders() })

  if (!response.ok) {
    throw new Error(`โหลดข้อมูลตำแหน่งงานไม่สำเร็จ: ${response.status}`)
  }

  const result = (await response.json()) as PositionsResponse

  if (!result.success) {
    throw new Error('API ไม่สามารถส่งข้อมูลตำแหน่งงานได้')
  }

  return result.data
}

export async function createPosition(name: string): Promise<Position> {
  const response = await fetch(`${API_URL}/positions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authorizationHeaders() },
    body: JSON.stringify({ name }),
  })

  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(result?.detail?.message ?? `เพิ่มตำแหน่งงานไม่สำเร็จ: ${response.status}`)
  }

  const result = await response.json()
  return result.data as Position
}
import { authorizationHeaders } from './auth'
