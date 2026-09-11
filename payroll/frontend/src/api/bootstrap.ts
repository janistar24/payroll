import { authorizationHeaders } from './auth'
import type { Department } from './departments'
import type { Employee } from './employees'
import type { Position } from './positions'
import type { PayrollPeriodRecord } from './payroll'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

interface AppDataResponse {
  success: boolean
  data: { employees: Employee[]; departments: Department[]; positions: Position[]; payroll_periods: PayrollPeriodRecord[] }
}

export async function getAppData(): Promise<AppDataResponse['data']> {
  const response = await fetch(`${API_URL}/app-data`, { headers: authorizationHeaders() })
  if (!response.ok) throw new Error(`โหลดข้อมูลเริ่มต้นไม่สำเร็จ: ${response.status}`)
  const body = await response.json() as AppDataResponse
  if (!body.success) throw new Error('ระบบไม่สามารถส่งข้อมูลเริ่มต้นได้')
  return body.data
}
