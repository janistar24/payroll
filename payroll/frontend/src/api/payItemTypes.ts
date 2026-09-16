import { authorizationHeaders } from './auth'

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
  const response = await fetch(`${API_URL}/pay_item_types`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authorizationHeaders() },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : 'เพิ่มประเภทรายการเงินเดือนไม่สำเร็จ')
  }
  return (await response.json()).data as PayItemType
}
