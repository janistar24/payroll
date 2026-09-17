import { authorizationHeaders } from './auth'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

export type AnnualTaxRow = {
  employee_id: number
  full_name: string
  department_name: string
  position_name: string
  months: number[]
  approved_months: boolean[]
  total: number
}

export async function getAnnualTaxReport(year: number, departmentId?: number, reportType: 'tax' | 'income' = 'tax'): Promise<AnnualTaxRow[]> {
  const query = new URLSearchParams({ year: String(year), report_type: reportType })
  if (departmentId) query.set('department_id', String(departmentId))
  const response = await fetch(`${API_URL}/reports/annual-tax?${query.toString()}`, { headers: authorizationHeaders(), cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? 'ไม่สามารถโหลดรายงานภาษีประจำปีได้')
  }
  const body = await response.json()
  return body.data.rows as AnnualTaxRow[]
}
