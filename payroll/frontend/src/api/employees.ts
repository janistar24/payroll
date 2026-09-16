export interface Employee {
  id: number
  employee_code: string
  national_id: string
  prefix: string | null
  first_name: string
  last_name: string
  department_id: number | null
  organization_id: number | null
  organization_name?: string | null
  position_id: number | null
  employee_type:
    | 'CIVIL_SERVANT'
    | 'MUNICIPAL_EMPLOYEE'
    | 'PERMANENT_WORKER'
    | 'TEMPORARY_EMPLOYEE'
    | 'GENERAL_EMPLOYEE'
    | 'CONTRACT_EMPLOYEE'
    | 'POLITICAL_OFFICIAL'
    | 'REGULAR_PENSIONER'
    | 'TEACHER_PENSIONER'
    | 'PERMANENT_WORKER_MONTHLY_PENSION'
    | 'OTHER'
  employee_type_other: string | null
  status: 'ACTIVE' | 'ON_LEAVE' | 'RESIGNED' | 'RETIRED' | 'TERMINATED'
  birth_date: string | null
  start_date: string | null
  end_date: string | null
  email: string | null
  phone: string | null
  bank_name: string | null
  bank_account_no: string | null
  base_salary: string
  created_at: string
  updated_at: string
}

interface EmployeesResponse {
  success: boolean
  count: number
  data: Employee[]
}

const API_URL =
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

export async function getEmployees(): Promise<Employee[]> {
  const response = await fetch(`${API_URL}/employees`, { headers: authorizationHeaders() })

  if (!response.ok) {
    throw new Error(`โหลดข้อมูลพนักงานไม่สำเร็จ: ${response.status}`)
  }

  const result = (await response.json()) as EmployeesResponse

  if (!result.success) {
    throw new Error('API ไม่สามารถส่งข้อมูลพนักงานได้')
  }

  return result.data
}

export type EmployeeSaveInput = Omit<Employee, 'id' | 'created_at' | 'updated_at'>

async function parseApiError(response: Response): Promise<string> {
  try {
    const result = await response.json()
    if (typeof result.detail === 'string') return result.detail
    if (result.detail?.message) return result.detail.message
  } catch {
    // Use the status fallback below when the response is not JSON.
  }
  return `บันทึกข้อมูลพนักงานไม่สำเร็จ: ${response.status}`
}

export async function createEmployee(data: EmployeeSaveInput): Promise<{ id: number; employee_code: string }> {
  const response = await fetch(`${API_URL}/employees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authorizationHeaders() },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error(await parseApiError(response))
  const result = await response.json()
  return result.data
}

export async function updateEmployee(employeeId: number, data: EmployeeSaveInput): Promise<void> {
  const response = await fetch(`${API_URL}/employees/${employeeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authorizationHeaders() },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error(await parseApiError(response))
}

/** Soft-delete: retain payroll history but remove the employee from active lists. */
export async function deactivateEmployee(employeeId: number): Promise<void> {
  const response = await fetch(`${API_URL}/employees/${employeeId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authorizationHeaders() },
    body: JSON.stringify({ status: 'TERMINATED' }),
  })
  if (!response.ok) throw new Error(await parseApiError(response))
}

export async function updateEmployeeEmail(employeeId: number, email: string): Promise<void> {
  const response = await fetch(`${API_URL}/employees/${employeeId}/email`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authorizationHeaders() },
    body: JSON.stringify({ email }),
  })
  if (!response.ok) throw new Error(await parseApiError(response))
}

import { authorizationHeaders } from './auth'
