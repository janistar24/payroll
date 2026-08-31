export interface Employee {
  id: number
  employee_code: string
  national_id: string
  prefix: string | null
  first_name: string
  last_name: string
  department_id: number | null
  position_id: number | null
  employee_type: 'CIVIL_SERVANT' | 'MUNICIPAL_EMPLOYEE' | 'PERMANENT_WORKER' | 'TEMPORARY_EMPLOYEE'
  status: 'ACTIVE' | 'ON_LEAVE' | 'RESIGNED' | 'RETIRED' | 'TERMINATED'
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
  const response = await fetch(`${API_URL}/employees`)

  if (!response.ok) {
    throw new Error(`โหลดข้อมูลพนักงานไม่สำเร็จ: ${response.status}`)
  }

  const result = (await response.json()) as EmployeesResponse

  if (!result.success) {
    throw new Error('API ไม่สามารถส่งข้อมูลพนักงานได้')
  }

  return result.data
}
