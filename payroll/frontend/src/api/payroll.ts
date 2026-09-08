import { authorizationHeaders } from './auth'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

export interface PayrollPeriodRecord {
  id: number
  year: number
  month: number
  pay_date: string | null
  note: string | null
  status: string
  created_by_name: string | null
  created_at: string
  updated_at: string
  departments: PayrollBatchRecord[]
}

export interface PayrollBatchRecord {
  id: number
  payroll_period_id: number
  department_id: number
  department_name: string
  status: string
  submitted_by_name: string | null
  submitted_at: string | null
  approved_by_name: string | null
  approved_at: string | null
  reject_reason: string | null
  created_at: string
  payroll_items: PayrollItemRecord[]
}

export interface PayrollItemRecord {
  id: number
  employee_id: number
  employee_code: string
  prefix: string | null
  first_name: string
  last_name: string
  position_name: string | null
  base_salary: string | number
  email_status?: 'PENDING' | 'SENT' | 'FAILED' | null
  lines: { code: string; amount: string | number }[]
}

async function parseError(response: Response, fallback: string): Promise<never> {
  const body = await response.json().catch(() => null)
  throw new Error(typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? fallback)
}

export async function getPayrollPeriods(): Promise<PayrollPeriodRecord[]> {
  const response = await fetch(`${API_URL}/payroll_periods`, { headers: authorizationHeaders() })
  if (!response.ok) return parseError(response, `โหลดรอบเงินเดือนไม่สำเร็จ: ${response.status}`)
  const body = await response.json()
  return body.data as PayrollPeriodRecord[]
}

export async function createPayrollPeriod(input: { year: number; month: number; pay_date: string; note?: string }): Promise<number> {
  const response = await fetch(`${API_URL}/payroll_periods`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authorizationHeaders() }, body: JSON.stringify(input) })
  if (!response.ok) return parseError(response, `สร้างรอบเงินเดือนไม่สำเร็จ: ${response.status}`)
  return (await response.json()).data.id as number
}

export async function savePayrollBatchItems(batchId: number, rows: { employee_id: number; lines: Record<string, number> }[]): Promise<void> {
  const response = await fetch(`${API_URL}/payroll_department_batches/${batchId}/items`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authorizationHeaders() }, body: JSON.stringify({ rows }) })
  if (!response.ok) return parseError(response, `บันทึกตารางเงินเดือนไม่สำเร็จ: ${response.status}`)
}

export async function payrollBatchAction(batchId: number, action: 'submit' | 'approve' | 'reject', reject_reason?: string): Promise<void> {
  const response = await fetch(`${API_URL}/payroll_department_batches/${batchId}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authorizationHeaders() }, body: JSON.stringify({ action, reject_reason }) })
  if (!response.ok) return parseError(response, `เปลี่ยนสถานะเงินเดือนไม่สำเร็จ: ${response.status}`)
}
