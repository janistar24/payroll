import { authorizationHeaders } from './auth'
import { idempotentFetch } from './idempotency'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'

export type PayItemType = {
  id: number
  code: string
  name: string
  category: 'EARNING' | 'DEDUCTION'
  is_taxable: boolean
  is_active: boolean
}

export async function createPayItemType(input: { name: string; category: PayItemType['category'] }): Promise<PayItemType> {
  const response = await idempotentFetch(`${API_URL}/pay_item_types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authorizationHeaders() },
    body: JSON.stringify(input),
  }, `POST:/pay_item_types:${input.category}:${input.name.trim().toLowerCase()}`)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : 'เพิ่มประเภทรายการเงินเดือนไม่สำเร็จ')
  }
  return (await response.json()).data as PayItemType
}

export async function savePayrollBatchColumns(batchId: number, codes: string[]): Promise<string[]> {
  const response = await idempotentFetch(`${API_URL}/payroll_department_batches/${batchId}/columns`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authorizationHeaders() },
    body: JSON.stringify({ codes }),
  }, `PUT:/payroll_department_batches/${batchId}/columns`)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? 'บันทึกคอลัมน์ไม่สำเร็จ')
  }
  return (await response.json()).data.codes as string[]
}
