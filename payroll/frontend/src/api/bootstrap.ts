import { authorizationHeaders } from './auth'
import type { Department } from './departments'
import type { Employee } from './employees'
import type { Position } from './positions'
import type { PayrollPeriodRecord } from './payroll'
import type { PayItemType } from './payItemTypes'
import type { Organization } from './organizations'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

interface AppDataResponse {
  success: boolean
  data: {
    employees: Employee[]
    departments: Department[]
    positions: Position[]
    payroll_periods: PayrollPeriodRecord[]
    pay_item_types: PayItemType[]
    organizations: Organization[]
    warnings?: Record<string, string>
  }
}

export async function getAppData(): Promise<AppDataResponse['data']> {
  let response: Response | null = null
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(`${API_URL}/app-data`, { headers: authorizationHeaders(), cache: 'no-store' })
      if (response.status < 500) break
    } catch (error) {
      lastError = error
      response = null
    }
    if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, (attempt + 1) * 1000))
  }
  if (!response) throw lastError instanceof Error ? lastError : new Error('ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง')
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    const detail = errorBody?.detail
    const message = typeof detail === 'string' ? detail : detail?.message
    throw new Error(message ?? `โหลดข้อมูลเริ่มต้นไม่สำเร็จ: ${response.status}`)
  }
  const body = await response.json() as AppDataResponse
  if (!body.success) throw new Error('ระบบไม่สามารถส่งข้อมูลเริ่มต้นได้')
  return body.data
}
