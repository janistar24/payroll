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
  revision_number?: number
  parent_batch_id?: number | null
  revision_type?: string | null
  revision_reason?: string | null
  revision_created_by_name?: string | null
  is_current?: boolean
  edit_version?: number
  last_edited_at?: string | null
  last_edited_by_name?: string | null
  payroll_items: PayrollItemRecord[]
  excluded_employee_codes?: string[]
}

export interface PayrollItemRecord {
  id: number
  employee_id: number
  employee_code: string
  prefix: string | null
  first_name: string
  last_name: string
  position_name: string | null
  organization_name?: string | null
  base_salary: string | number
  email_status?: 'PENDING' | 'SENT' | 'FAILED' | null
  email_sent_at?: string | null
  lines: { code: string; amount: string | number; name?: string | null; category?: 'EARNING' | 'DEDUCTION' | null }[]
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

export async function createPayrollPeriod(input: { year: number; month: number; pay_date: string; note?: string; department_id?: number }): Promise<{ period_id: number; batch_id: number; existing: boolean }> {
  const response = await fetch(`${API_URL}/payroll_periods`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authorizationHeaders() }, body: JSON.stringify(input) })
  if (!response.ok) return parseError(response, `สร้างรอบเงินเดือนไม่สำเร็จ: ${response.status}`)
  return (await response.json()).data as { period_id: number; batch_id: number; existing: boolean }
}

export async function deletePayrollPeriod(periodId: number): Promise<void> {
  const response = await fetch(`${API_URL}/payroll_periods/${periodId}`, { method: 'DELETE', headers: authorizationHeaders() })
  if (!response.ok) return parseError(response, `ลบรอบเงินเดือนไม่สำเร็จ: ${response.status}`)
}

export type PayrollChangeNote = {
  id?: number
  employee_id: number
  field_code: string
  old_value: number
  new_value: number
  reason: string
  employee_name?: string
  changed_by_name?: string
  changed_at?: string
}

export type PayrollPreviousValue = {
  employee_id: number
  field_code: string
  amount: string | number
}

export type PayrollChangeLog = {
  notes: PayrollChangeNote[]
  previous_values: PayrollPreviousValue[]
}

export async function savePayrollBatchItems(
  batchId: number,
  rows: { employee_id: number; lines: Record<string, number> }[],
  change_notes: PayrollChangeNote[] = [],
  expected_version?: number,
): Promise<{ edit_version: number }> {
  const response = await fetch(
    `${API_URL}/payroll_department_batches/${batchId}/items`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authorizationHeaders(),
      },
      body: JSON.stringify({ rows, change_notes, expected_version }),
    },
  )
  if (!response.ok) {
    return parseError(response, `บันทึกตารางเงินเดือนไม่สำเร็จ: ${response.status}`)
  }
  return (await response.json()).data as { edit_version: number }
}

export async function getPayrollChangeNotes(
  batchId: number,
): Promise<PayrollChangeLog> {
  const response = await fetch(
    `${API_URL}/payroll_department_batches/${batchId}/change-notes`,
    { headers: authorizationHeaders() },
  )
  if (!response.ok) {
    return parseError(response, `โหลดรายการแก้ไขไม่สำเร็จ: ${response.status}`)
  }
  return (await response.json()).data as PayrollChangeLog
}

export async function createPayrollRevision(batchId: number, revision_type: string, reason: string): Promise<{ batch_id: number }> {
  const response = await fetch(`${API_URL}/payroll_department_batches/${batchId}/revisions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authorizationHeaders() }, body: JSON.stringify({ revision_type, reason }) })
  if (!response.ok) return parseError(response, `สร้างฉบับแก้ไขไม่สำเร็จ: ${response.status}`)
  return (await response.json()).data as { batch_id: number }
}

export async function getPayrollBatchHistory(batchId: number): Promise<PayrollBatchRecord[]> {
  const response = await fetch(`${API_URL}/payroll_department_batches/${batchId}/history`, { headers: authorizationHeaders() })
  if (!response.ok) return parseError(response, `โหลดประวัติฉบับเงินเดือนไม่สำเร็จ: ${response.status}`)
  return (await response.json()).data as PayrollBatchRecord[]
}

export async function payrollBatchAction(batchId: number, action: 'submit' | 'approve' | 'reject', reject_reason?: string): Promise<void> {
  const response = await fetch(`${API_URL}/payroll_department_batches/${batchId}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authorizationHeaders() }, body: JSON.stringify({ action, reject_reason }) })
  if (!response.ok) return parseError(response, `เปลี่ยนสถานะเงินเดือนไม่สำเร็จ: ${response.status}`)
}

export async function sendPayslipEmail(payrollItemId: number): Promise<{ recipient: string }> {
  const response = await fetch(`${API_URL}/payslip-email-deliveries/${payrollItemId}/send`, {
    method: 'POST',
    headers: authorizationHeaders(),
  })
  if (!response.ok) return parseError(response, `ส่งอีเมลไม่สำเร็จ: ${response.status}`)
  return (await response.json()).data as { recipient: string }
}

export async function getPayslipPdf(payrollItemId: number): Promise<Blob> {
  const response = await fetch(`${API_URL}/payslip-email-deliveries/${payrollItemId}/pdf`, {
    headers: authorizationHeaders(),
  })
  if (!response.ok) return parseError(response, `โหลดสลิปไม่สำเร็จ: ${response.status}`)
  return response.blob()
}
