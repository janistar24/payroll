export interface Department {
  id: number
  code: string
  name: string
  is_active: boolean
}

interface DepartmentsResponse {
  success: boolean
  count: number
  data: Department[]
}

const API_URL =
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

export async function getDepartments(): Promise<Department[]> {
  const response = await fetch(`${API_URL}/departments`)

  if (!response.ok) {
    throw new Error(`โหลดข้อมูลหน่วยงานไม่สำเร็จ: ${response.status}`)
  }

  const result = (await response.json()) as DepartmentsResponse

  if (!result.success) {
    throw new Error('API ไม่สามารถส่งข้อมูลหน่วยงานได้')
  }

  return result.data
}
