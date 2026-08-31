export interface Employee {
  id: number
  name: string
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