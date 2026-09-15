import { Fragment, Children, isValidElement, useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import takhliLogo from './imports/takhli_logo_color.jpeg'
import {
  getDepartments,
  type Department
} from './api/departments'
import {
  createEmployee,
  deactivateEmployee,
  getEmployees,
  updateEmployee,
  updateEmployeeEmail,
  type Employee as DatabaseEmployee,
  type EmployeeSaveInput,
} from './api/employees'
import { createPosition, getPositions, type Position } from './api/positions'
import { getAppData } from './api/bootstrap'
import { clearAccessToken, loginWithDatabase, type AuthUser } from './api/auth'
import { activateSystemUser, approveAccessRequest, changeMyPassword, createSystemUser, createUserInvite, deactivateSystemUser, deleteSystemUser, getAccessRequests, getUsers, rejectAccessRequest, resetSystemUserPassword, revealAccessRequestPassword, type AccessRequest, type SystemUser } from './api/users'
import { getInvite, submitInvite, type InviteData } from './api/invites'
import { createPayrollPeriod, createPayrollRevision, getPayrollBatchHistory, getPayslipPdf, payrollBatchAction, savePayrollBatchItems, sendPayslipEmail, type PayrollBatchRecord, type PayrollPeriodRecord } from './api/payroll'
// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'hr' | 'director' | 'admin'
type DeptStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'closed'
type EmailStatus = 'waiting' | 'sending' | 'sent' | 'failed'
type PayslipDeliveryRow = {
  period: PayrollPeriod
  dept: DeptPayroll
  employee: Employee
  payrollItemId?: number
  status: EmailStatus
  hasEmail: boolean
}

type FloatingDropdownPosition = { top: number; left: number; width: number }

function EyeIcon({ off = false }: { off?: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.7" />{off && <path d="M3 3l18 18" />}</svg>
}

function PersonIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.3" /><path d="M5.5 20c.8-3.3 3-5.1 6.5-5.1s5.7 1.8 6.5 5.1" /></svg>
}

function PencilIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>
}

/** Keeps every write action visually consistent while an API request is running. */
function BusyLabel({ busy, label, children }: { busy: boolean; label: string; children: React.ReactNode }) {
  return <>
    {busy && <span className="btn-spinner" aria-hidden="true" />}
    <span>{busy ? label : children}</span>
  </>
}

type Page =
  | 'login'
  | 'dashboard'
  | 'periods'
  | 'period-detail'
  | 'dept-table'
  | 'director-approvals'
  | 'director-detail'
  | 'employees'
  | 'employee-form'
  | 'payslip-status'
  | 'admin-users'

interface Employee {
  id: string
  databaseId?: number
  title: string
  firstName: string
  lastName: string
  position: string
  department: string
  baseSalary: number
  email: string
  status: 'active' | 'inactive'
  startDate: string
  taxId: string
  socialSecId: string
}

interface PayrollRow {
  empId: string
  extra: number        // เงินเพิ่ม
  posAllowance: number // เงินประจำตำแหน่ง
  debtKTB: number      // เพื่อชำระหนี้ธนาคารกรุงไทย
  tax: number          // ภาษีหัก ณ ที่จ่าย
  social: number       // ประกันสังคม
  funeral: number      // ฌาปนกิจ
  ktb: number          // ธนาคารกรุงไทย
  gsb: number          // ธนาคารออมสิน
}

interface DeptPayroll {
  id: string
  databaseId?: number
  periodId: string
  department: string
  status: DeptStatus
  rows: Record<string, PayrollRow>
  submittedBy?: string
  submittedAt?: string
  approvedBy?: string
  approvedAt?: string
  rejectedAt?: string
  rejectionReason?: string
  updatedAt: string
  emailStatuses?: Record<string, EmailStatus>
  emailItemIds?: Record<string, number>
  emailSentAt?: Record<string, string>
  excludedEmployeeIds?: string[]
  employees?: Employee[]
  revisionNumber?: number
  revisionType?: string
  revisionReason?: string
  revisionCreatedBy?: string
}

interface PayrollPeriod {
  id: string
  databaseId?: number
  month: number
  year: number
  payDate: string
  note?: string
  createdAt: string
  createdBy: string
  depts: DeptPayroll[]
}

interface UserAccount { id: string; username: string; name: string; role: Role; active: boolean }

const EMPLOYEE_PREFIXES = [
  'นาย', 'นาง', 'นางสาว',
  'พล.อ.', 'พล.ท.', 'พล.ต.', 'พ.อ.', 'พ.ท.', 'พ.ต.', 'ร.อ.', 'ร.ท.', 'ร.ต.', 'จ.ส.อ.', 'จ.ส.ท.', 'จ.ส.ต.', 'ส.อ.', 'ส.ท.', 'ส.ต.',
  'พล.ต.อ.', 'พล.ต.ท.', 'พล.ต.ต.', 'พ.ต.อ.', 'พ.ต.ท.', 'พ.ต.ต.', 'ร.ต.อ.', 'ร.ต.โท', 'ร.ต.ต.', 'ด.ต.', 'หมู่ใหญ่', 'ส.ต.อ.', 'ส.ต.ท.', 'ส.ต.ต.',
  'ผศ.', 'รศ.', 'ศ.', 'ดร.',
] as const

const EMPLOYEE_TYPE_OPTIONS: { value: DatabaseEmployee['employee_type']; label: string }[] = [
  { value: 'CIVIL_SERVANT', label: 'ข้าราชการ' },
  { value: 'GENERAL_EMPLOYEE', label: 'พนักงานจ้างทั่วไป' },
  { value: 'CONTRACT_EMPLOYEE', label: 'พนักงานจ้างเหมา' },
  { value: 'POLITICAL_OFFICIAL', label: 'ข้าราชการการเมือง' },
  { value: 'REGULAR_PENSIONER', label: 'ข้าราชการบำนาญปกติ' },
  { value: 'TEACHER_PENSIONER', label: 'ข้าราชการบำนาญครู' },
  { value: 'PERMANENT_WORKER_MONTHLY_PENSION', label: 'ลูกจ้างประจำรับบำเหน็จรายเดือน' },
  { value: 'OTHER', label: 'อื่นๆ (โปรดระบุ)' },
]

// ─── Seed Data ────────────────────────────────────────────────────────────────

const DEPARTMENTS = [
  'สำนักปลัดเทศบาล',
  'กองคลัง',
  'กองช่าง',
  'กองสาธารณสุขและสิ่งแวดล้อม',
  'กองยุทธศาสตร์และงบประมาณ',
  'กองการศึกษา',
  'กองการประปา',
  'กองสวัสดิการสังคม',
]

const EMPLOYEES: Employee[] = [
  { id:'EMP001', title:'นาย',   firstName:'สมชาย',   lastName:'ใจดี',       position:'นักทรัพยากรบุคคล',          department:'สำนักปลัดเทศบาล', baseSalary:28500, email:'somchai@muni.go.th',   status:'active', startDate:'2558-01-15', taxId:'1234567890001', socialSecId:'SS0001' },
  { id:'EMP002', title:'นาง',   firstName:'สุดา',    lastName:'มีสุข',      position:'นักจัดการงานทั่วไป',         department:'สำนักปลัดเทศบาล', baseSalary:26000, email:'suda@muni.go.th',      status:'active', startDate:'2560-03-01', taxId:'1234567890002', socialSecId:'SS0002' },
  { id:'EMP003', title:'นาย',   firstName:'ประสิทธิ์',lastName:'ทองดี',     position:'เจ้าพนักงานธุรการ',          department:'สำนักปลัดเทศบาล', baseSalary:21000, email:'prasit@muni.go.th',    status:'active', startDate:'2562-06-10', taxId:'1234567890003', socialSecId:'SS0003' },
  { id:'EMP004', title:'นาง',   firstName:'วิภา',    lastName:'รักษ์ดี',    position:'นักวิชาการเงินและบัญชี',     department:'กองคลัง',          baseSalary:30000, email:'wipa@muni.go.th',      status:'active', startDate:'2557-09-20', taxId:'1234567890004', socialSecId:'SS0004' },
  { id:'EMP005', title:'นางสาว',firstName:'มนัสสา', lastName:'พรหมสุข',    position:'เจ้าพนักงานการเงินและบัญชี', department:'กองคลัง',          baseSalary:24000, email:'manassa@muni.go.th',   status:'active', startDate:'2561-11-05', taxId:'1234567890005', socialSecId:'SS0005' },
  { id:'EMP006', title:'นาย',   firstName:'อรรถพล', lastName:'สว่างจิต',   position:'นักวิชาการเงินและบัญชี',     department:'กองคลัง',          baseSalary:29000, email:'attaphon@muni.go.th',  status:'active', startDate:'2558-07-12', taxId:'1234567890006', socialSecId:'SS0006' },
  { id:'EMP007', title:'นาย',   firstName:'วีรศักดิ์',lastName:'ก้าวหน้า', position:'วิศวกรโยธา',                 department:'กองช่าง',          baseSalary:35000, email:'weerasak@muni.go.th',  status:'active', startDate:'2556-04-18', taxId:'1234567890007', socialSecId:'SS0007' },
  { id:'EMP008', title:'นาย',   firstName:'สุรชัย',  lastName:'แกล้วกล้า', position:'นายช่างโยธา',                department:'กองช่าง',          baseSalary:27000, email:'surachai@muni.go.th',  status:'active', startDate:'2560-02-28', taxId:'1234567890008', socialSecId:'SS0008' },
  { id:'EMP009', title:'นางสาว',firstName:'ลัดดา',  lastName:'บุญเรือง',   position:'เจ้าพนักงานธุรการ',          department:'กองช่าง',          baseSalary:20000, email:'ladda@muni.go.th',     status:'active', startDate:'2563-08-01', taxId:'1234567890009', socialSecId:'SS0009' },
  { id:'EMP010', title:'นาง',   firstName:'ศิริพร',  lastName:'สุขสงบ',    position:'นักวิชาการสาธารณสุข',        department:'กองสาธารณสุขและสิ่งแวดล้อม', baseSalary:31000, email:'siriporn@muni.go.th', status:'active', startDate:'2557-06-01', taxId:'1234567890010', socialSecId:'SS0010' },
  { id:'EMP011', title:'นาย',   firstName:'ธนกร',   lastName:'รุ่งเรือง',  position:'นักวิชาการสาธารณสุข',        department:'กองสาธารณสุขและสิ่งแวดล้อม', baseSalary:29500, email:'tanakorn@muni.go.th', status:'active', startDate:'2559-10-15', taxId:'1234567890011', socialSecId:'SS0011' },
  { id:'EMP012', title:'นางสาว',firstName:'สุภาพร', lastName:'ดีงาม',      position:'เจ้าพนักงานธุรการ',          department:'กองสาธารณสุขและสิ่งแวดล้อม', baseSalary:19500, email:'supaporn@muni.go.th', status:'active', startDate:'2564-01-10', taxId:'1234567890012', socialSecId:'SS0012' },
  { id:'EMP013', title:'นาย',   firstName:'ณรงค์',  lastName:'พิทักษ์ชน', position:'ครู',                         department:'กองการศึกษา',      baseSalary:32000, email:'narong@muni.go.th',    status:'active', startDate:'2555-09-01', taxId:'1234567890013', socialSecId:'SS0013' },
  { id:'EMP014', title:'นาง',   firstName:'กาญจนา', lastName:'เพ็งพิทักษ์',position:'ครู',                         department:'กองการศึกษา',      baseSalary:32000, email:'kanjana@muni.go.th',   status:'active', startDate:'2556-03-20', taxId:'1234567890014', socialSecId:'SS0014' },
  { id:'EMP015', title:'นางสาว',firstName:'ปิยะมาศ',lastName:'หมั่นเรียน', position:'นักจัดการงานทั่วไป',         department:'กองการศึกษา',      baseSalary:25500, email:'piyamas@muni.go.th',   status:'active', startDate:'2561-05-14', taxId:'1234567890015', socialSecId:'SS0015' },
  { id:'EMP016', title:'นาย',   firstName:'ชาตรี',  lastName:'คิดดี',      position:'นักวิเคราะห์นโยบาย',         department:'กองยุทธศาสตร์และงบประมาณ', baseSalary:33000, email:'chatri@muni.go.th',  status:'active', startDate:'2557-11-08', taxId:'1234567890016', socialSecId:'SS0016' },
  { id:'EMP017', title:'นาง',   firstName:'นิตยา',  lastName:'เจริญสุข',   position:'นักวิเคราะห์นโยบาย',         department:'กองยุทธศาสตร์และงบประมาณ', baseSalary:31500, email:'nittaya@muni.go.th', status:'active', startDate:'2559-02-22', taxId:'1234567890017', socialSecId:'SS0017' },
  { id:'EMP018', title:'นาย',   firstName:'ไพรัตน์',lastName:'ขยันดี',     position:'เจ้าพนักงานธุรการ',          department:'กองยุทธศาสตร์และงบประมาณ', baseSalary:21500, email:'pairat@muni.go.th',  status:'active', startDate:'2562-07-30', taxId:'1234567890018', socialSecId:'SS0018' },
  { id:'EMP019', title:'นาย',   firstName:'บุญเลิศ',lastName:'ดีมาก',      position:'นายช่างโยธา',                department:'กองช่าง',          baseSalary:26500, email:'boonlert@muni.go.th',  status:'active', startDate:'2560-09-15', taxId:'1234567890019', socialSecId:'SS0019' },
  { id:'EMP020', title:'นางสาว',firstName:'อังคณา',lastName:'สดชื่น',      position:'นักทรัพยากรบุคคล',           department:'สำนักปลัดเทศบาล', baseSalary:27000, email:'angkana@muni.go.th',   status:'active', startDate:'2560-12-01', taxId:'1234567890020', socialSecId:'SS0020' },
]

const makeDefaultRow = (e: Employee): PayrollRow => ({
  // A new payroll line must never invent statutory deductions or allowances.
  // HR enters and saves the actual values for the period.
  empId: e.id, extra: 0, posAllowance: 0,
  debtKTB: 0, tax: 0, social: 0, funeral: 0, ktb: 0, gsb: 0,
})

// Deterministic extras per employee index so seed data is stable
const EXTRA_AMOUNTS = [1500, 800, 0, 1200, 0, 900, 2000, 600, 0, 1100, 1400, 0, 700, 1800, 500, 1300, 0, 1000, 1600, 400]
const DEBT_KTB_AMOUNTS = [2500, 0, 0, 1800, 0, 3000, 0, 2200, 0, 1500, 0, 0, 2800, 0, 1000, 0, 2400, 0, 1900, 0]
const KTB_AMOUNTS = [1500, 0, 0, 1200, 800, 0, 1700, 0, 0, 900, 0, 0, 1100, 1300, 0, 1000, 0, 700, 0, 600]

const buildDept = (id: string, pid: string, dept: string, status: DeptStatus, sub?: string, subAt?: string, approvedBy?: string, approvedAt?: string, rejectedAt?: string, rejectionReason?: string): DeptPayroll => {
  const emps = EMPLOYEES.filter(e => e.department === dept)
  const rows: Record<string, PayrollRow> = {}
  emps.forEach(e => {
    const globalIdx = EMPLOYEES.findIndex(emp => emp.id === e.id)
    rows[e.id] = { ...makeDefaultRow(e), extra: EXTRA_AMOUNTS[globalIdx] ?? 0, debtKTB: DEBT_KTB_AMOUNTS[globalIdx] ?? 0, ktb: KTB_AMOUNTS[globalIdx] ?? 0 }
  })
  const emailStatuses: Record<string, EmailStatus> = {}
  emps.forEach(e => { emailStatuses[e.id] = status === 'approved' ? 'sent' : 'waiting' })
  return { id, periodId: pid, department: dept, status, rows, submittedBy: sub, submittedAt: subAt, approvedBy, approvedAt, rejectedAt, rejectionReason, updatedAt: subAt || '2025-07-28T09:00:00Z', emailStatuses, employees: emps }
}

const SEED_PERIODS: PayrollPeriod[] = [
  {
    id: 'PP-2025-07', month: 7, year: 2025, payDate: '2025-07-31', note: 'รอบเงินเดือนปกติ เดือนกรกฎาคม 2568',
    createdAt: '2025-07-20T08:00:00Z', createdBy: 'นางสาวสมใจ พนักงานฝ่ายธุรการ',
    depts: [
      buildDept('DP-01', 'PP-2025-07', 'สำนักปลัดเทศบาล',             'approved', 'นางสาวสมใจ พนักงานฝ่ายธุรการ', '2025-07-25T10:00:00Z', 'นายวิเชียร ผู้บริหาร', '2025-07-26T09:00:00Z'),
      buildDept('DP-02', 'PP-2025-07', 'กองคลัง',                      'approved', 'นางสาวสมใจ พนักงานฝ่ายธุรการ', '2025-07-25T11:00:00Z', 'นายวิเชียร ผู้บริหาร', '2025-07-26T09:30:00Z'),
      buildDept('DP-03', 'PP-2025-07', 'กองช่าง',                      'pending',  'นางสาวสมใจ พนักงานฝ่ายธุรการ', '2025-07-27T14:00:00Z'),
      buildDept('DP-04', 'PP-2025-07', 'กองสาธารณสุขและสิ่งแวดล้อม',   'rejected', 'นางสาวสมใจ พนักงานฝ่ายธุรการ', '2025-07-26T16:00:00Z', undefined, undefined, '2025-07-27T08:30:00Z', 'ยอดภาษีหัก ณ ที่จ่ายไม่ถูกต้อง กรุณาตรวจสอบและส่งใหม่'),
      buildDept('DP-05', 'PP-2025-07', 'กองการศึกษา',                  'draft'),
      buildDept('DP-06', 'PP-2025-07', 'กองยุทธศาสตร์และงบประมาณ',     'draft'),
    ],
  },
  {
    id: 'PP-2025-06', month: 6, year: 2025, payDate: '2025-06-30', note: '',
    createdAt: '2025-06-18T08:00:00Z', createdBy: 'นางสาวสมใจ พนักงานฝ่ายธุรการ',
    depts: DEPARTMENTS.map((dept, i) => buildDept(`DP-JUN-0${i+1}`, 'PP-2025-06', dept, 'closed', 'นางสาวสมใจ พนักงานฝ่ายธุรการ', '2025-06-22T10:00:00Z', 'นายวิเชียร ผู้บริหาร', '2025-06-23T09:00:00Z')),
  },
]

const SEED_USERS: UserAccount[] = [
  { id: 'U1', username: 'hr01',       name: 'นางสาวสมใจ รักงาน',      role: 'hr',       active: true },
  { id: 'U2', username: 'director01', name: 'นายวิเชียร บริหารดี',     role: 'director', active: true },
  { id: 'U3', username: 'admin01',    name: 'นายสุทธิ IT Support',     role: 'admin',    active: true },
  { id: 'U4', username: 'hr02',       name: 'นางพรทิพย์ ขยันดี',      role: 'hr',       active: true },
]

const LOGIN_MAP: Record<string, { name: string; role: Role; department: string | null }> = {
  hr01:       { name: 'นางสาวสมใจ รักงาน',  role: 'hr', department: 'กองคลัง' },
  director01: { name: 'นายวิเชียร บริหารดี', role: 'director', department: null },
  admin01:    { name: 'นายสุทธิ IT Support', role: 'admin', department: null },
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const thb = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const thbInt = (n: number) => n.toLocaleString('th-TH')
const BUDDHIST_LOCALE = 'th-TH-u-ca-buddhist'
const formatBuddhistDate = (value: string | Date, long = false) => new Intl.DateTimeFormat(BUDDHIST_LOCALE, {
  timeZone: 'Asia/Bangkok', day: 'numeric', month: long ? 'long' : 'numeric', year: 'numeric',
}).format(new Date(value))
const formatBuddhistDateTime = (value: string | Date) => new Intl.DateTimeFormat(BUDDHIST_LOCALE, {
  timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(value))

const MONTH_TH = ['', 'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
const MONTH_EN_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const periodLabel = (p: PayrollPeriod) => `${MONTH_TH[p.month]} ${p.year + 543}`

const batchStatus = (status: string): DeptStatus => ({
  DRAFT: 'draft', SUBMITTED: 'pending', APPROVED: 'approved', REJECTED: 'rejected', PAID: 'closed',
}[status] ?? 'draft')

const databaseEmployeeToPayrollEmployee = (employee: DatabaseEmployee, departments: Department[], positions: Position[]): Employee => ({
  id: employee.employee_code, databaseId: employee.id,
  title: employee.prefix ?? '',
  firstName: employee.first_name,
  lastName: employee.last_name,
  position: positions.find(position => position.id === employee.position_id)?.name ?? '–',
  department: departments.find(department => department.id === employee.department_id)?.name ?? '–',
  baseSalary: Number(employee.base_salary),
  email: employee.email ?? '',
  status: employee.status === 'ACTIVE' ? 'active' : 'inactive',
  startDate: employee.start_date ?? '',
  taxId: employee.national_id,
  socialSecId: '',
})

const mapPayrollPeriods = (records: PayrollPeriodRecord[], employees: DatabaseEmployee[], departments: Department[], positions: Position[]): PayrollPeriod[] => {
  const payrollEmployees = employees.map(employee => databaseEmployeeToPayrollEmployee(employee, departments, positions))
  const payrollEmployeesByCode = new Map(payrollEmployees.map(employee => [employee.id, employee]))
  return records.map(record => ({
    id: String(record.id), databaseId: record.id, month: record.month, year: record.year,
    payDate: record.pay_date ?? `${record.year}-${String(record.month).padStart(2, '0')}-01`, note: record.note ?? '',
    createdAt: record.created_at, createdBy: record.created_by_name ?? '–',
    depts: record.departments.map(batch => {
      const rows: Record<string, PayrollRow> = {}
      const emailStatuses: Record<string, EmailStatus> = {}
      const emailItemIds: Record<string, number> = {}
      const emailSentAt: Record<string, string> = {}
      batch.payroll_items.forEach(item => {
        const lines = Object.fromEntries(item.lines.map(line => [line.code, Number(line.amount)]))
        rows[item.employee_code] = {
          empId: item.employee_code, extra: lines.EXTRA_PAY ?? 0, posAllowance: lines.POS_ALLOW ?? 0,
          debtKTB: lines.KTB_LOAN ?? 0, tax: lines.TAX ?? 0, social: lines.SSF ?? 0,
          funeral: lines.FUNERAL_FUND ?? 0, ktb: 0, gsb: lines.SAVINGS_BANK_LOAN ?? 0,
        }
        const status = item.email_status
        emailStatuses[item.employee_code] = status === 'SENT' ? 'sent' : status === 'FAILED' ? 'failed' : 'waiting'
        emailItemIds[item.employee_code] = item.id
        if (item.email_sent_at) emailSentAt[item.employee_code] = item.email_sent_at
      })
      // A payroll batch is a historical snapshot.  Do not replace its staff list
      // with every current employee in the department: someone removed from this
      // month's table must not reappear in Director/Admin summaries after login.
      const batchEmployees = batch.payroll_items.map(item => {
        const currentEmployee = payrollEmployeesByCode.get(item.employee_code)
        if (currentEmployee) {
          return {
            ...currentEmployee,
            title: item.prefix ?? currentEmployee.title,
            firstName: item.first_name,
            lastName: item.last_name,
            position: item.position_name ?? currentEmployee.position,
            department: batch.department_name,
            baseSalary: Number(item.base_salary),
          }
        }
        // Keep old payrolls viewable even if the employee was later deactivated
        // and therefore is no longer returned by the live employee directory.
        return {
          id: item.employee_code,
          title: item.prefix ?? '',
          firstName: item.first_name,
          lastName: item.last_name,
          position: item.position_name ?? '–',
          department: batch.department_name,
          baseSalary: Number(item.base_salary),
          email: '',
          status: 'inactive' as const,
          startDate: '',
          taxId: '',
          socialSecId: '',
        }
      })
      return {
        id: String(batch.id), databaseId: batch.id, periodId: String(record.id), department: batch.department_name,
        status: batchStatus(batch.status), rows, submittedBy: batch.submitted_by_name ?? undefined,
        submittedAt: batch.submitted_at ?? undefined, approvedBy: batch.approved_by_name ?? undefined,
        approvedAt: batch.approved_at ?? undefined, rejectionReason: batch.reject_reason ?? undefined,
        updatedAt: batch.approved_at ?? batch.submitted_at ?? batch.created_at,
        emailStatuses,
        emailItemIds,
        emailSentAt,
        excludedEmployeeIds: batch.excluded_employee_codes ?? [],
        employees: batchEmployees,
        revisionNumber: batch.revision_number ?? 0,
        revisionType: batch.revision_type ?? undefined,
        revisionReason: batch.revision_reason ?? undefined,
        revisionCreatedBy: batch.revision_created_by_name ?? undefined,
      }
    }),
  }))
}

const mapPayrollHistoryBatch = (batch: PayrollBatchRecord, period: PayrollPeriod): DeptPayroll => {
  const rows: Record<string, PayrollRow> = {}
  const employees = batch.payroll_items.map(item => {
    const lines = Object.fromEntries(item.lines.map(line => [line.code, Number(line.amount)]))
    rows[item.employee_code] = {
      empId: item.employee_code, extra: lines.EXTRA_PAY ?? 0, posAllowance: lines.POS_ALLOW ?? 0,
      debtKTB: lines.KTB_LOAN ?? 0, tax: lines.TAX ?? 0, social: lines.SSF ?? 0,
      funeral: lines.FUNERAL_FUND ?? 0, ktb: 0, gsb: lines.SAVINGS_BANK_LOAN ?? 0,
    }
    return {
      id: item.employee_code, title: item.prefix ?? '', firstName: item.first_name, lastName: item.last_name,
      position: item.position_name ?? '–', department: batch.department_name, baseSalary: Number(item.base_salary),
      email: '', status: 'inactive' as const, startDate: '', taxId: '', socialSecId: '',
    }
  })
  return {
    id: String(batch.id), databaseId: batch.id, periodId: period.id, department: batch.department_name,
    status: batchStatus(batch.status), rows, submittedBy: batch.submitted_by_name ?? undefined,
    submittedAt: batch.submitted_at ?? undefined, approvedBy: batch.approved_by_name ?? undefined,
    approvedAt: batch.approved_at ?? undefined, rejectionReason: batch.reject_reason ?? undefined,
    updatedAt: batch.approved_at ?? batch.submitted_at ?? batch.created_at, employees,
    revisionNumber: batch.revision_number ?? 0, revisionType: batch.revision_type ?? undefined,
    revisionReason: batch.revision_reason ?? undefined, revisionCreatedBy: batch.revision_created_by_name ?? undefined,
  }
}

const escapeMarkup = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

const rowGross = (e: Employee, r: PayrollRow) => e.baseSalary + r.extra + r.posAllowance
const rowDeduct = (r: PayrollRow) => r.debtKTB + r.tax + r.social + r.funeral + r.ktb + r.gsb
const rowNet = (e: Employee, r: PayrollRow) => rowGross(e, r) - rowDeduct(r)

// รูปแบบทางการของรายงาน ใช้ร่วมกันทั้ง HR / Director / Admin
const PAYROLL_REPORT_COLUMNS = [
  'ลำดับ', 'ชื่อ-นามสกุล', 'ตำแหน่ง', 'เงินเดือน', 'เงินเพิ่ม/\nค่าตอบแทน',
  'เงินประจำ\nตำแหน่ง', 'รวมรายการรับ', 'เพื่อชำระหนี้\nธนาคารกรุงไทย', 'ภาษีหัก ณ\nที่จ่าย',
  'ประกันสังคม', 'ฌาปนกิจ', 'ธนาคาร\nกรุงไทย', 'ธนาคารออมสิน\nสาขาตาคลี', 'รวมรายการหัก', 'ยอดรับสุทธิ',
]
const PAYROLL_REPORT_WIDTHS = [7.19, 21.79, 21.59, 12.39, 12.39, 11.19, 14.39, 15.99, 10.59, 12.39, 10.59, 15.78, 15.19, 14.19, 12.39]
type PayrollExportEntry = { employee: Employee; row: PayrollRow }

const exportPayrollWorkbook = async ({ period, department, entries }: {
  period: PayrollPeriod; department: string; entries: PayrollExportEntry[]
}) => {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'PayFlow'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet(`เงินเดือน ${MONTH_TH[period.month]}`)
  sheet.properties.defaultRowHeight = 13
  sheet.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, scale: 67,
    margins: { left: 0.75, right: 0.75, top: 1, bottom: 1, header: 0.51, footer: 0.51 },
  }
  sheet.pageSetup.horizontalCentered = false
  sheet.columns = PAYROLL_REPORT_WIDTHS.map(width => ({ width }))
  PAYROLL_REPORT_WIDTHS.forEach((width, index) => { sheet.getColumn(index + 1).width = width })

  const border = { top: { style: 'thin' as const }, left: { style: 'thin' as const }, bottom: { style: 'thin' as const }, right: { style: 'thin' as const } }
  const centered = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: false }
  const printedAt = formatBuddhistDateTime(new Date())

  sheet.mergeCells('E1:L1'); sheet.getCell('E1').value = 'เทศบาลเมืองตาคลี'
  sheet.mergeCells('E2:L2'); sheet.getCell('E2').value = 'รายงานการปรับปรุงข้อมูลเงินเดือน'
  sheet.getCell('A3').value = `วันที่พิมพ์ : ${printedAt}`
  sheet.mergeCells('A4:D4'); sheet.getCell('A4').value = '1 ซ.ประชาตาคลี 3 ต.ตาคลี'
  sheet.mergeCells('A5:D5'); sheet.getCell('A5').value = 'อ.ตาคลี จ.นครสวรรค์   60140'
  sheet.mergeCells('E4:L4'); sheet.getCell('E4').value = department
  sheet.mergeCells('E5:L5'); sheet.getCell('E5').value = `ประจำเดือน ${MONTH_TH[period.month]} พ.ศ.${period.year + 543}`
  sheet.getCell('P1').value = 'หน้า 1/1'
  ;[1, 2, 4, 5].forEach(rowNumber => { sheet.getRow(rowNumber).height = rowNumber === 1 ? 26 : rowNumber === 2 ? 16 : 15 })
  ;['E1', 'E2', 'E4', 'E5'].forEach((address, index) => {
    const cell = sheet.getCell(address)
    cell.font = { name: 'Tahoma', size: index === 0 ? 16 : 12, bold: true }
    cell.alignment = centered
  })
  sheet.getCell('A3').font = { name: 'Tahoma', size: 10 }
  sheet.getCell('A4').font = { name: 'Tahoma', size: 10 }
  sheet.getCell('A5').font = { name: 'Tahoma', size: 10 }
  sheet.getCell('P1').font = { name: 'Tahoma', size: 9 }

  try {
    const response = await fetch(takhliLogo)
    const logoId = workbook.addImage({ buffer: await response.arrayBuffer(), extension: 'jpeg' })
    sheet.addImage(logoId, { tl: { col: 6.8, row: 0 }, ext: { width: 48, height: 48 } })
  } catch {
    // รายงานยัง export ได้แม้เบราว์เซอร์ไม่สามารถอ่านไฟล์โลโก้จาก cache ได้
  }

  sheet.mergeCells('A7:D7'); sheet.mergeCells('E7:G7'); sheet.mergeCells('H7:N7'); sheet.mergeCells('O7:O8')
  sheet.getCell('A7').value = 'ข้อมูลพนักงาน'; sheet.getCell('E7').value = 'รายการรับ'; sheet.getCell('H7').value = 'รายการหัก'; sheet.getCell('O7').value = 'ยอดรับสุทธิ'
  PAYROLL_REPORT_COLUMNS.forEach((label, index) => { sheet.getCell(8, index + 1).value = label })
  sheet.getRow(7).height = 13; sheet.getRow(8).height = 42
  for (let row = 7; row <= 8; row += 1) {
    sheet.getRow(row).eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: 'Tahoma', size: 10, bold: true }
      cell.alignment = { ...centered, wrapText: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFCC' } }
      cell.border = border
    })
  }

  const totals = Array(12).fill(0) as number[]
  entries.forEach(({ employee, row }, index) => {
    const values = [employee.baseSalary, row.extra, row.posAllowance, rowGross(employee, row), row.debtKTB, row.tax, row.social, row.funeral, row.ktb, row.gsb, rowDeduct(row), rowNet(employee, row)]
    values.forEach((value, valueIndex) => { totals[valueIndex] += value })
    const sheetRow = sheet.addRow([index + 1, `${employee.title}${employee.firstName} ${employee.lastName}`, employee.position, ...values])
    sheetRow.height = 13
    sheetRow.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { name: 'Tahoma', size: 10 }
      cell.border = border
      cell.alignment = column <= 1 ? centered : { horizontal: column >= 4 ? 'right' : 'left', vertical: 'middle', wrapText: false }
      if (column >= 4) cell.numFmt = '#,##0.00'
    })
  })
  const totalRow = sheet.addRow(['รวมทั้งสิ้น', '', '', ...totals])
  sheet.mergeCells(`A${totalRow.number}:C${totalRow.number}`)
  totalRow.height = 13
  totalRow.eachCell({ includeEmpty: true }, (cell, column) => {
    cell.font = { name: 'Tahoma', size: 10, bold: true }
    cell.border = border
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFCC' } }
    cell.alignment = column >= 4 ? { horizontal: 'right', vertical: 'middle', wrapText: false } : centered
    if (column >= 4) cell.numFmt = '#,##0.00'
  })

  const raw = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `ตารางรอบเดือน_${department.replace(/[\\/:*?"<>|]/g, '-')}_${MONTH_EN_SHORT[period.month]}.xlsx`
  anchor.click()
  URL.revokeObjectURL(url)
}

const printPayrollReport = ({ period, department, status, entries }: {
  period: PayrollPeriod; department: string; status: DeptStatus; entries: PayrollExportEntry[]
}) => {
  const printWindow = window.open('', '_blank', 'width=1200,height=800')
  if (!printWindow) return false
  printWindow.opener = null
  const totals = Array(12).fill(0) as number[]
  const body = entries.map(({ employee, row }, index) => {
    const values = [employee.baseSalary, row.extra, row.posAllowance, rowGross(employee, row), row.debtKTB, row.tax, row.social, row.funeral, row.ktb, row.gsb, rowDeduct(row), rowNet(employee, row)]
    values.forEach((value, valueIndex) => { totals[valueIndex] += value })
    return `<tr><td class="center">${index + 1}</td><td>${escapeMarkup(`${employee.title}${employee.firstName} ${employee.lastName}`)}</td><td>${escapeMarkup(employee.position)}</td>${values.map(value => `<td class="num">${thb(value)}</td>`).join('')}</tr>`
  }).join('')
  printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>รายงานการปรับปรุงข้อมูลเงินเดือน</title><style>@page{size:297mm 210mm;margin:8mm 7mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}*{box-sizing:border-box}body{margin:0;color:#000;background:#fff;font-family:Tahoma,sans-serif;font-size:7.2pt}.head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center}.head img{width:14mm;height:14mm;object-fit:contain}.head-title{text-align:center}.head-title h1,.head-title h2,.head-title p{margin:0}.head-title h1{font-size:13pt;line-height:1.25}.head-title h2{font-size:11pt;line-height:1.25}.head-title p{font-size:8.5pt;margin-top:2px}.page{text-align:right;font-size:8pt}.meta{display:grid;grid-template-columns:repeat(3,1fr);margin:5mm 0 2mm}.meta div:nth-child(2){text-align:center}.meta div:last-child{text-align:right}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:.45pt solid #000;padding:3px 2px;vertical-align:middle}thead th{background:#ffffcc;text-align:center;font-weight:700;line-height:1.15;font-size:7pt;overflow-wrap:anywhere}tbody td,tfoot td{font-size:6.6pt;line-height:1.15;white-space:nowrap;overflow-wrap:normal;word-break:keep-all}td.num{text-align:right;font-variant-numeric:tabular-nums}td.center{text-align:center}tfoot td{background:#ffffcc;font-weight:700;border-top:1pt solid #000;border-bottom:1pt solid #000}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:16mm;margin-top:9mm;text-align:center;line-height:1.65}col.c1{width:3.4%}col.c2{width:4.8%}col.c3{width:11.5%}col.c4{width:7.6%}col.c5{width:7.3%}col.c6{width:6.4%}col.c7{width:7.4%}col.c8{width:7.4%}col.c9{width:6.4%}col.c10{width:6.4%}col.c11{width:6.4%}col.c12{width:6.4%}col.c13{width:6.4%}col.c14{width:6.4%}col.c15{width:7.4%}col.c16{width:7.7%}</style></head><body><div class="head"><div><img src="${takhliLogo}" alt="ตราเทศบาลเมืองตาคลี"></div><div class="head-title"><h1>เทศบาลเมืองตาคลี</h1><h2>รายงานการปรับปรุงข้อมูลเงินเดือน</h2><p>${escapeMarkup(department)} · ประจำเดือน ${escapeMarkup(periodLabel(period))}</p></div><div class="page">หน้า 1/1</div></div><div class="meta"><div><b>วันที่จ่าย:</b> ${escapeMarkup(new Date(period.payDate).toLocaleDateString('th-TH', { dateStyle: 'long' }))}</div><div><b>จำนวนพนักงาน:</b> ${entries.length} คน</div><div><b>สถานะ:</b> ${escapeMarkup(statusLabel[status])}</div></div><table><colgroup>${Array.from({ length: 16 }, (_, index) => `<col class="c${index + 1}">`).join('')}</colgroup><thead><tr><th colspan="5">ข้อมูลพนักงาน</th><th colspan="3">รายการรับ</th><th colspan="7">รายการหัก</th><th rowspan="2">ยอดรับสุทธิ</th></tr><tr>${PAYROLL_REPORT_COLUMNS.slice(0, -1).map(value => `<th>${value}</th>`).join('')}</tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="4">รวมทั้งสิ้น</td>${totals.map(value => `<td class="num">${thb(value)}</td>`).join('')}</tr></tfoot></table><div class="signatures"><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้จัดทำ</div><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้ตรวจสอบ</div><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้อนุมัติ</div></div><script>window.addEventListener('load',()=>{window.print();window.addEventListener('afterprint',()=>window.close())})<\/script></body></html>`)
  // เอกสารเก่ามี listener print ตอน load อยู่แล้ว จึงกันไม่ให้เรียกซ้ำ แล้วสั่งพิมพ์จาก click นี้โดยตรง
  printWindow.addEventListener('load', event => event.stopImmediatePropagation(), true)
  printWindow.document.close()
  return true
}

const legacyPrintPayrollTemplate = ({ period, department, status, entries }: {
  period: PayrollPeriod; department: string; status: DeptStatus; entries: PayrollExportEntry[]
}) => {
  const printWindow = window.open('', '_blank', 'width=1200,height=800')
  if (!printWindow) return false
  printWindow.opener = null
  const totals = Array(12).fill(0) as number[]
  const body = entries.map(({ employee, row }, index) => {
    const values = [employee.baseSalary, row.extra, row.posAllowance, rowGross(employee, row), row.debtKTB, row.tax, row.social, row.funeral, row.ktb, row.gsb, rowDeduct(row), rowNet(employee, row)]
    values.forEach((value, valueIndex) => { totals[valueIndex] += value })
    return `<tr><td>${index + 1}</td><td>${escapeMarkup(`${employee.title}${employee.firstName} ${employee.lastName}`)}</td><td>${escapeMarkup(employee.position)}</td>${values.map(value => `<td class="num">${thb(value)}</td>`).join('')}</tr>`
  }).join('')
  const widths = PAYROLL_REPORT_WIDTHS.map(width => `${(width / PAYROLL_REPORT_WIDTHS.reduce((sum, value) => sum + value, 0)) * 100}%`)
  const printedAt = formatBuddhistDateTime(new Date())
  printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>รายงานการปรับปรุงข้อมูลเงินเดือน</title><style>
@page{size:A4 landscape;margin:12mm 11mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}*{box-sizing:border-box}body{margin:0;color:#111;background:#fff;font-family:Tahoma,sans-serif;font-size:10pt}.report-head{position:relative;text-align:center;padding-bottom:4mm}.report-head img{position:absolute;left:0;top:0;width:17mm;height:17mm;object-fit:contain}.report-head h1,.report-head h2,.report-head p{margin:0}.report-head h1{font-size:16pt;line-height:1.25}.report-head h2{font-size:12pt;line-height:1.3}.report-head p{font-size:10pt;line-height:1.35}.page{position:absolute;right:0;top:0;font-size:9pt}.report-lines{margin:2mm 0 4mm;font-size:10pt;line-height:1.45}.report-lines div{min-height:5mm}.report-lines .address{text-align:center}.report-lines .department,.report-lines .period{text-align:center;font-size:12pt}.report-lines .period{font-weight:700}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:.5pt solid #000;padding:2px 3px;vertical-align:middle}thead th{background:#e6f2ff;text-align:center;font-size:10pt;font-weight:700;line-height:1.2;white-space:normal;overflow-wrap:anywhere}tbody td,tfoot td{font-size:10pt;line-height:1.2;white-space:nowrap;overflow-wrap:normal;word-break:keep-all}td:nth-child(1),td:nth-child(2){text-align:center}td.num{text-align:right;font-variant-numeric:tabular-nums}tfoot td{background:#e6f2ff;font-weight:700}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:16mm;margin-top:10mm;text-align:center;line-height:1.7;font-size:10pt}
</style></head><body><div class="report-head"><img src="${takhliLogo}" alt="ตราเทศบาลเมืองตาคลี"><div class="page">หน้า 1/1</div><h1>เทศบาลเมืองตาคลี</h1><h2>รายงานการปรับปรุงข้อมูลเงินเดือน</h2></div><div class="report-lines"><div>วันที่พิมพ์ : ${escapeMarkup(printedAt)}</div><div class="address">1 ซ.ประชาตาคลี 3 ต.ตาคลี อ.ตาคลี จ.นครสวรรค์ 60140</div><div class="department">${escapeMarkup(department)}</div><div class="period">ประจำเดือน ${escapeMarkup(periodLabel(period))}</div></div><table><colgroup>${widths.map(width => `<col style="width:${width}">`).join('')}</colgroup><thead><tr><th colspan="5">ข้อมูลพนักงาน</th><th colspan="3">รายการรับ</th><th colspan="7">รายการหัก</th><th rowspan="2">ยอดรับสุทธิ</th></tr><tr>${PAYROLL_REPORT_COLUMNS.slice(0, -1).map(value => `<th>${value}</th>`).join('')}</tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="4">รวมทั้งสิ้น</td>${totals.map(value => `<td class="num">${thb(value)}</td>`).join('')}</tr></tfoot></table><div class="signatures"><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้จัดทำ</div><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้ตรวจสอบ</div><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้อนุมัติ</div></div><script>window.addEventListener('load',()=>{window.print();window.addEventListener('afterprint',()=>window.close())})<\/script></body></html>`)
  printWindow.document.close()
  return true
}

const printPayrollTemplate = ({ period, department, status: _status, entries }: {
  period: PayrollPeriod; department: string; status: DeptStatus; entries: PayrollExportEntry[]
}) => {
  const printWindow = window.open('', '_blank', 'width=1200,height=800')
  if (!printWindow) return false
  printWindow.opener = null
  const totals = Array(12).fill(0) as number[]
  const body = entries.map(({ employee, row }, index) => {
    const values = [employee.baseSalary, row.extra, row.posAllowance, rowGross(employee, row), row.debtKTB, row.tax, row.social, row.funeral, row.ktb, row.gsb, rowDeduct(row), rowNet(employee, row)]
    values.forEach((value, valueIndex) => { totals[valueIndex] += value })
    return `<tr><td>${index + 1}</td><td>${escapeMarkup(`${employee.title}${employee.firstName} ${employee.lastName}`)}</td><td>${escapeMarkup(employee.position)}</td>${values.map(value => `<td class="num">${thb(value)}</td>`).join('')}</tr>`
  }).join('')
  const columnTracks = PAYROLL_REPORT_WIDTHS.map(width => `${width}fr`).join(' ')
  const colgroup = PAYROLL_REPORT_WIDTHS.map(width => `<col style="width:${(width / PAYROLL_REPORT_WIDTHS.reduce((sum, value) => sum + value, 0)) * 100}%">`).join('')
  const headerCells = PAYROLL_REPORT_COLUMNS.slice(0, -1).map(label => `<th>${escapeMarkup(label).replace(/\n/g, '<br>')}</th>`).join('')
  const printedAt = formatBuddhistDateTime(new Date())
  printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>รายงานการปรับปรุงข้อมูลเงินเดือน</title><style>
@page{size:A4 landscape;margin:25.4mm 19.05mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}*{box-sizing:border-box}body{margin:0;color:#000;background:#fff;font-family:Tahoma,sans-serif;font-size:10pt}.sheet-head{display:grid;grid-template-columns:${columnTracks};grid-template-rows:26pt 16pt 15pt 15pt 12pt;align-items:center;position:relative}.town{grid-column:5/13;grid-row:1;text-align:center;font-weight:700;font-size:16pt}.report-title{grid-column:5/13;grid-row:2;text-align:center;font-weight:700;font-size:12pt}.printed{grid-column:1/5;grid-row:3;font-size:10pt}.address{grid-column:5/13;grid-row:3;text-align:center;font-size:12pt}.department{grid-column:5/13;grid-row:4;text-align:center;font-size:12pt;font-weight:700}.period{grid-column:5/13;grid-row:5;text-align:center;font-size:12pt;font-weight:700}.page{grid-column:16;grid-row:1;text-align:right;font-size:9pt}.logo{grid-column:6/7;grid-row:1/4;z-index:2;justify-self:center;width:13.5mm;height:14.5mm;object-fit:contain}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:6mm}th,td{border:.5pt solid #000;padding:2px 3px;vertical-align:middle}thead th{background:#ffffcc;text-align:center;font-family:Tahoma,sans-serif;font-size:10pt;font-weight:700;line-height:1.2;white-space:normal}thead tr:first-child{height:13pt}thead tr:last-child{height:42pt}tbody tr,tfoot tr{height:13pt}tbody td,tfoot td{font-family:Tahoma,sans-serif;font-size:10pt;white-space:nowrap;overflow:visible;line-height:1.2}td:nth-child(1),td:nth-child(2){text-align:center}td.num{text-align:right;font-variant-numeric:tabular-nums}tfoot td{background:#ffffcc;font-weight:700}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:16mm;margin-top:10mm;text-align:center;line-height:1.7;font-size:10pt}
</style></head><body><div class="sheet-head"><div class="town">เทศบาลเมืองตาคลี</div><div class="report-title">รายงานการปรับปรุงข้อมูลเงินเดือน</div><div class="printed">วันที่พิมพ์ : ${escapeMarkup(printedAt)}</div><div class="address">1 ซ.ประชาตาคลี 3 ต.ตาคลี อ.ตาคลี จ.นครสวรรค์ 60140</div><div class="department">${escapeMarkup(department)}</div><div class="period">ประจำเดือน ${escapeMarkup(periodLabel(period))}</div><div class="page">หน้า 1/1</div><img class="logo" src="${takhliLogo}" alt="ตราเทศบาลเมืองตาคลี"></div><table><colgroup>${colgroup}</colgroup><thead><tr><th colspan="5">ข้อมูลพนักงาน</th><th colspan="3">รายการรับ</th><th colspan="7">รายการหัก</th><th rowspan="2">ยอดรับสุทธิ</th></tr><tr>${headerCells}</tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="4">รวมทั้งสิ้น</td>${totals.map(value => `<td class="num">${thb(value)}</td>`).join('')}</tr></tfoot></table><div class="signatures"><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้จัดทำ</div><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้ตรวจสอบ</div><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้อนุมัติ</div></div><script>window.addEventListener('load',()=>{window.print();window.addEventListener('afterprint',()=>window.close()})<\/script></body></html>`)
  printWindow.document.close()
  return true
}

const printPayrollTemplateExact = ({ period, department, status: _status, entries }: {
  period: PayrollPeriod; department: string; status: DeptStatus; entries: PayrollExportEntry[]
}) => {
  const printFrame = document.createElement('iframe')
  printFrame.setAttribute('aria-hidden', 'true')
  Object.assign(printFrame.style, { position: 'fixed', left: '-10000px', top: '0', width: '1px', height: '1px', border: '0', pointerEvents: 'none' })
  document.body.appendChild(printFrame)
  const printWindow = printFrame.contentWindow
  if (!printWindow) {
    printFrame.remove()
    return false
  }
  const totals = Array(12).fill(0) as number[]
  const body = entries.map(({ employee, row }, index) => {
    const values = [employee.baseSalary, row.extra, row.posAllowance, rowGross(employee, row), row.debtKTB, row.tax, row.social, row.funeral, row.ktb, row.gsb, rowDeduct(row), rowNet(employee, row)]
    values.forEach((value, valueIndex) => { totals[valueIndex] += value })
    return `<tr><td>${index + 1}</td><td>${escapeMarkup(`${employee.title}${employee.firstName} ${employee.lastName}`)}</td><td>${escapeMarkup(employee.position)}</td>${values.map(value => `<td class="num">${thb(value)}</td>`).join('')}</tr>`
  }).join('')
  const colgroup = PAYROLL_REPORT_WIDTHS.map(width => `<col style="width:${(width / PAYROLL_REPORT_WIDTHS.reduce((sum, value) => sum + value, 0)) * 100}%">`).join('')
  const headers = PAYROLL_REPORT_COLUMNS.slice(0, -1).map(label => `<th>${escapeMarkup(label).replace(/\n/g, '<br>')}</th>`).join('')
  const printedAt = formatBuddhistDateTime(new Date())
  printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>รายงานการปรับปรุงข้อมูลเงินเดือน</title><style>@page{size:A4 landscape;margin:25.4mm 19.05mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}*{box-sizing:border-box}body{margin:0;color:#000;font-family:Tahoma,sans-serif;font-size:10pt}.header{position:relative}.header img{position:absolute;width:13.5mm;height:14.5mm;object-fit:contain;left:31%;top:0}.header table,.payroll{width:100%;border-collapse:collapse;table-layout:fixed}.header td{height:15pt;vertical-align:middle}.header .municipality{text-align:center;font-size:16pt;font-weight:700;height:26pt}.header .title{text-align:center;font-size:12pt;font-weight:700;height:16pt}.header .date,.header .address{font-size:10pt}.header .department,.header .period{text-align:center;font-size:12pt;font-weight:700}.payroll{margin-top:6mm}.payroll th,.payroll td{border:.5pt solid #000;padding:2px 3px;vertical-align:middle}.payroll thead th{background:#ffffcc;text-align:center;font-size:10pt;font-weight:700;line-height:1.2;white-space:normal}.payroll thead tr:first-child{height:13pt}.payroll thead tr:last-child{height:42pt}.payroll tbody tr,.payroll tfoot tr{height:13pt}.payroll tbody td,.payroll tfoot td{font-size:10pt;white-space:nowrap;line-height:1.2}.payroll td:nth-child(1),.payroll td:nth-child(2){text-align:center}.payroll .num{text-align:right;font-variant-numeric:tabular-nums}.payroll tfoot td{background:#ffffcc;font-weight:700}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:16mm;margin-top:10mm;text-align:center;line-height:1.7;font-size:10pt}</style></head><body><div class="header"><img src="${takhliLogo}" alt="ตราเทศบาลเมืองตาคลี"><table><colgroup>${colgroup}</colgroup><tbody><tr><td colspan="4"></td><td colspan="8" class="municipality">เทศบาลเมืองตาคลี</td><td colspan="3"></td><td class="date">หน้า 1/1</td></tr><tr><td colspan="4"></td><td colspan="8" class="title">รายงานการปรับปรุงข้อมูลเงินเดือน</td><td colspan="4"></td></tr><tr><td colspan="4" class="date">วันที่พิมพ์ : ${escapeMarkup(printedAt)}</td><td colspan="8"></td><td colspan="4"></td></tr><tr><td colspan="4" class="address">1 ซ.ประชาตาคลี 3 ต.ตาคลี</td><td colspan="8" class="department">${escapeMarkup(department)}</td><td colspan="4"></td></tr><tr><td colspan="4" class="address">อ.ตาคลี จ.นครสวรรค์&nbsp;&nbsp;&nbsp;60140</td><td colspan="8" class="period">ประจำเดือน ${escapeMarkup(periodLabel(period))}</td><td colspan="4"></td></tr></tbody></table></div><table class="payroll"><colgroup>${colgroup}</colgroup><thead><tr><th colspan="5">ข้อมูลพนักงาน</th><th colspan="3">รายการรับ</th><th colspan="7">รายการหัก</th><th rowspan="2">ยอดรับสุทธิ</th></tr><tr>${headers}</tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="4">รวมทั้งสิ้น</td>${totals.map(value => `<td class="num">${thb(value)}</td>`).join('')}</tr></tfoot></table><div class="signatures"><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้จัดทำ</div><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้ตรวจสอบ</div><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้อนุมัติ</div></div><script>window.addEventListener('load',()=>{window.print();window.addEventListener('afterprint',()=>window.close()})<\/script></body></html>`)
  printWindow.document.close()
  const tableStyle = printWindow.document.createElement('style')
  tableStyle.textContent = `
    .header .municipality { font-size: 14pt !important; }
    .header .title, .header .department, .header .period { font-size: 11pt !important; }
    .payroll thead th { background: #ECEFF1 !important; font-size: 5.6pt !important; line-height: 1.15 !important; padding: 1px !important; white-space: normal !important; overflow: hidden !important; overflow-wrap: normal !important; word-break: keep-all !important; }
    .payroll tbody td, .payroll tfoot td { font-size: 6.6pt !important; line-height: 1.15 !important; padding: 1px 1.5px !important; white-space: nowrap !important; overflow-wrap: normal !important; word-break: keep-all !important; }
  `
  printWindow.document.head.appendChild(tableStyle)
  printWindow.addEventListener('afterprint', () => printFrame.remove(), { once: true })
  printWindow.focus()
  printWindow.print()
  return true
}

const deptEmps = (dept: DeptPayroll) => dept.employees ?? []
const deptTotals = (dept: DeptPayroll) => {
  const emps = deptEmps(dept)
  let totalBase = 0, totalExtra = 0, totalPos = 0, totalGross = 0, totalDebtKTB = 0, totalTax = 0, totalSocial = 0, totalFuneral = 0, totalKTB = 0, totalGSB = 0, totalDeduct = 0, totalNet = 0
  emps.forEach(e => {
    const r = dept.rows[e.id] ?? makeDefaultRow(e)
    totalBase  += e.baseSalary
    totalExtra += r.extra
    totalPos   += r.posAllowance
    totalGross += rowGross(e, r)
    totalDebtKTB += r.debtKTB
    totalTax += r.tax
    totalSocial += r.social
    totalFuneral += r.funeral
    totalKTB += r.ktb
    totalGSB += r.gsb
    totalDeduct += rowDeduct(r)
    totalNet   += rowNet(e, r)
  })
  return { totalBase, totalExtra, totalPos, totalGross, totalDebtKTB, totalTax, totalSocial, totalFuneral, totalKTB, totalGSB, totalDeduct, totalNet, count: emps.length }
}

const periodTotals = (p: PayrollPeriod) => {
  let base = 0, gross = 0, deduct = 0, net = 0, emps = 0
  p.depts.forEach(d => { const t = deptTotals(d); base += t.totalBase; gross += t.totalGross; deduct += t.totalDeduct; net += t.totalNet; emps += t.count })
  return { base, gross, deduct, net, emps }
}

const statusLabel: Record<DeptStatus, string> = {
  draft: 'แบบร่าง', pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', closed: 'ปิดรอบแล้ว',
}

function StatusBadge({ s }: { s: DeptStatus }) {
  const dot: Record<DeptStatus, string> = { draft:'●', pending:'◔', approved:'✓', rejected:'✕', closed:'■' }
  return <span className={`badge badge-${s}`}>{dot[s]} {statusLabel[s]}</span>
}

// ─── Background ───────────────────────────────────────────────────────────────

function Background() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden" style={{ background: 'linear-gradient(160deg, #F7F8FF 0%, #FAFAFF 40%, #FFF8F6 80%, #F5F8FF 100%)' }}>
      <div className="orb" style={{ width: 500, height: 500, top: -120, left: -100, background: 'radial-gradient(circle, rgba(205,180,255,0.22) 0%, transparent 70%)' }} />
      <div className="orb" style={{ width: 400, height: 400, bottom: -60, right: -60, background: 'radial-gradient(circle, rgba(189,224,254,0.20) 0%, transparent 70%)' }} />
      <div className="orb" style={{ width: 280, height: 280, top: '35%', right: '20%', background: 'radial-gradient(circle, rgba(255,180,162,0.14) 0%, transparent 70%)' }} />
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, type, onClose }: { msg: string; type?: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t) }, [onClose])
  return (
    <div className={`toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`}>
      <span>{type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
      {msg}
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, children, onClose, size }: { title: string; children: React.ReactNode; onClose: () => void; size?: 'lg' }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size === 'lg' ? 'modal-lg' : ''}`}>
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: '#1A1A1A' }}>{title}</div>
          <button className="btn btn-ghost btn-sm" style={{ borderRadius: '50%', width: 32, height: 32, padding: 0 }} onClick={onClose}>✕</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ role, page, setPage }: { role: Role; page: Page; setPage: (p: Page) => void }) {
  type NavEntry = { id: Page; label: string; icon: string }
  const hrNav: NavEntry[] = [
    { id: 'dashboard', label: 'หน้าหลัก', icon: '🏠' },
    { id: 'periods',   label: 'รอบเงินเดือน', icon: '📅' },
    { id: 'employees', label: 'พนักงาน', icon: '👥' },
    { id: 'payslip-status', label: 'สถานะการส่งอีเมล', icon: '📨' },
  ]
  const dirNav: NavEntry[] = [
    { id: 'dashboard', label: 'หน้าหลัก', icon: '🏠' },
    { id: 'periods',   label: 'รอบเงินเดือน', icon: '📅' },
    { id: 'employees', label: 'พนักงาน', icon: '👥' },
    { id: 'payslip-status', label: 'สถานะการส่งอีเมล', icon: '📨' },
  ]
  const adminNav: NavEntry[] = [
    { id: 'dashboard',     label: 'หน้าหลัก', icon: '🏠' },
    { id: 'periods',       label: 'รอบเงินเดือน', icon: '📅' },
    { id: 'employees',     label: 'พนักงาน', icon: '👥' },
    { id: 'payslip-status',label: 'สถานะการส่งอีเมล', icon: '📨' },
    { id: 'admin-users',   label: 'จัดการผู้ใช้งาน', icon: '👤' },
  ]
  const navItems = role === 'hr' ? hrNav : role === 'director' ? dirNav : adminNav

  return (
    <aside className="sidebar flex flex-col" style={{ width: 220, minWidth: 220, height: '100vh', position: 'sticky', top: 0, flexShrink: 0 }}>
      {/* Logo */}
      <div className="px-4 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src={takhliLogo} alt="โลโก้หน่วยงาน" style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: '#1A1A1A', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            <span style={{ color: 'var(--purple-600)' }}>Pay</span>Flow
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>ระบบจัดทำเงินเดือน</div>
        </div>
      </div>
      {/* Nav */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        {navItems.map(n => (
          <button key={n.id} className={`nav-item ${page === n.id || (page === 'period-detail' && n.id === 'periods') || (page === 'dept-table' && n.id === 'periods') || (page === 'director-detail' && n.id === 'director-approvals') || (page === 'employee-form' && n.id === 'employees') ? 'active' : ''}`}
            onClick={() => setPage(n.id)}>
            <span style={{ fontSize: 15, width: 20, textAlign: 'center' }}>{n.icon}</span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}

// ─── Page Header ─────────────────────────────────────────────────────────────

function PageHeader({ title, subtitle, actions, breadcrumb }: { title: string; subtitle?: string; actions?: React.ReactNode; breadcrumb?: React.ReactNode }) {
  return (
    <div className="mb-6">
      {breadcrumb && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>{breadcrumb}</div>}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, color: '#1A1A1A', margin: 0, letterSpacing: '-0.02em' }}>{title}</h1>
          {subtitle && <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 4, margin: 0 }}>{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
      </div>
    </div>
  )
}

function Crumb({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span style={{ color: '#CBD5E1' }}>›</span>}
          {item.onClick
            ? <button onClick={item.onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--purple-600)', fontWeight: 500, padding: 0, fontSize: 'inherit' }}>{item.label}</button>
            : <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>}
        </span>
      ))}
    </>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, unit, icon, sub, accent, tone }: { label: string; value: string; unit?: string; icon: string; sub?: string; accent?: string; tone?: 'purple' | 'green' | 'orange' | 'blue' }) {
  const color = accent || 'var(--purple-600)'
  const toneStyle = tone === 'purple' ? { background: 'linear-gradient(135deg, #F2ECFF 0%, #E5F1FF 100%)', valueColor: '#7C4DCC' }
    : tone === 'green' ? { background: 'linear-gradient(135deg, #ECFDF3 0%, #F3FCF7 100%)', valueColor: '#15803D' }
    : tone === 'orange' ? { background: 'linear-gradient(135deg, #FFF5EA 0%, #FFF9F4 100%)', valueColor: '#C65B10' }
    : tone === 'blue' ? { background: 'linear-gradient(135deg, #F2ECFF 0%, #E5F1FF 100%)', valueColor: '#7C4DCC' }
    : null
  return (
    <div className="kpi-card" style={toneStyle ? { background: toneStyle.background, borderColor: 'rgba(124, 77, 204, 0.10)' } : undefined}>
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{icon}</div>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, color: toneStyle?.valueColor ?? '#1A1A1A', letterSpacing: '-0.02em', lineHeight: 1 }}>
        {value}{unit && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginLeft: 4 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

// ─── SVG Line Chart ───────────────────────────────────────────────────────────

function LineChart({ datasets, labels }: { datasets: { label: string; values: number[]; color: string }[]; labels: string[] }) {
  const W = 560, H = 160, PAD = { t: 16, r: 20, b: 28, l: 56 }
  const allVals = datasets.flatMap(d => d.values)
  const maxV = Math.max(...allVals) || 1
  const minV = 0
  const range = maxV - minV

  const xScale = (i: number) => PAD.l + (i / (labels.length - 1)) * (W - PAD.l - PAD.r)
  const yScale = (v: number) => PAD.t + (1 - (v - minV) / range) * (H - PAD.t - PAD.b)

  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(v)}`).join(' ')

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 400 }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const y = PAD.t + pct * (H - PAD.t - PAD.b)
          const val = maxV * (1 - pct)
          return (
            <g key={pct}>
              <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="rgba(0,0,0,0.06)" strokeWidth={1} />
              <text x={PAD.l - 6} y={y + 4} textAnchor="end" style={{ fontSize: 9, fill: 'var(--text-muted)' }}>{(val / 1000).toFixed(0)}k</text>
            </g>
          )
        })}
        {/* X labels */}
        {labels.map((l, i) => (
          <text key={i} x={xScale(i)} y={H - 4} textAnchor="middle" style={{ fontSize: 9, fill: 'var(--text-muted)' }}>{l}</text>
        ))}
        {/* Lines */}
        {datasets.map(d => (
          <g key={d.label}>
            <path d={path(d.values)} fill="none" stroke={d.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
            {d.values.map((v, i) => <circle key={i} cx={xScale(i)} cy={yScale(v)} r={3} fill={d.color} />)}
          </g>
        ))}
      </svg>
      <div className="flex items-center gap-5 justify-center mt-2" style={{ flexWrap: 'wrap' }}>
        {datasets.map(d => (
          <div key={d.label} className="flex items-center gap-1.5">
            <div style={{ width: 24, height: 3, borderRadius: 99, background: d.color }} />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnnualTaxBarChart({ values, labels, highlightedMonth }: { values: number[]; labels: string[]; highlightedMonth?: number }) {
  const W = 680, H = 205, PAD = { t: 22, r: 18, b: 34, l: 54 }
  const maxValue = Math.max(...values, 1)
  const plotWidth = W - PAD.l - PAD.r
  const plotHeight = H - PAD.t - PAD.b
  const slotWidth = plotWidth / values.length
  const barWidth = Math.min(28, slotWidth * 0.56)
  const formatAxis = (value: number) => value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value))

  return (
    <div className="dashboard-annual-tax-chart" aria-label="กราฟภาษีหัก ณ ที่จ่ายสะสมรายเดือน">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        <title>ภาษีหัก ณ ที่จ่ายสะสมรายเดือน</title>
        {[0, 0.25, 0.5, 0.75, 1].map(progress => {
          const y = PAD.t + (1 - progress) * plotHeight
          return <g key={progress}>
            <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="rgba(45, 32, 73, 0.10)" strokeWidth="1" />
            <text x={PAD.l - 8} y={y + 3.5} textAnchor="end" className="dashboard-annual-tax-axis">{formatAxis(maxValue * progress)}</text>
          </g>
        })}
        {values.map((value, index) => {
          const height = value > 0 ? Math.max(2, (value / maxValue) * plotHeight) : 0
          const x = PAD.l + index * slotWidth + (slotWidth - barWidth) / 2
          const y = PAD.t + plotHeight - height
          const isHighlighted = highlightedMonth === index + 1
          return <g key={labels[index]}>
            {value > 0 && <rect x={x} y={y} width={barWidth} height={height} rx="4" fill={isHighlighted ? '#6D3FD1' : '#A78BFA'} />}
            <text x={PAD.l + index * slotWidth + slotWidth / 2} y={H - 10} textAnchor="middle" className="dashboard-annual-tax-axis">{labels[index]}</text>
          </g>
        })}
      </svg>
    </div>
  )
}

function CategoryDonut({ title, total, items, tone }: {
  title: string; total: number; items: { label: string; value: number; color: string }[]; tone: 'income' | 'deduct'
}) {
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const [activeItem, setActiveItem] = useState<{ label: string; value: number; color: string } | null>(null)
  let progress = 0
  const visibleItems = items.filter(item => item.value > 0)

  return (
    <section className={`dashboard-category-donut dashboard-category-donut-${tone}`}>
      <div className="dashboard-category-donut-heading">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>รอบปัจจุบัน</div>
      </div>
      <div className="dashboard-category-donut-body">
        <div className="dashboard-category-donut-chart" aria-label={title}>
          <svg viewBox="0 0 88 88" role="img">
            <title>{title}</title>
            <circle cx="44" cy="44" r={radius} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="11" />
            {visibleItems.map(item => {
              const length = total > 0 ? (item.value / total) * circumference : 0
              const offset = -progress
              progress += length
              return <circle key={item.label} cx="44" cy="44" r={radius} fill="none" stroke={item.color} strokeWidth="11" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={offset} transform="rotate(-90 44 44)" style={{ cursor: 'pointer', transition: 'opacity 0.16s ease' }} opacity={activeItem && activeItem.label !== item.label ? 0.34 : 1} onMouseEnter={() => setActiveItem(item)} onMouseLeave={() => setActiveItem(null)} onFocus={() => setActiveItem(item)} onBlur={() => setActiveItem(null)} tabIndex={0} />
            })}
          </svg>
          <div className="dashboard-category-donut-total"><strong>{thb(Math.round(activeItem?.value ?? total))}</strong><span>{activeItem ? activeItem.label : 'รวมทั้งหมด'}</span></div>
        </div>
        <div className="dashboard-category-donut-list">
          {visibleItems.map(item => (
            <div key={item.label} className="dashboard-category-donut-row" onMouseEnter={() => setActiveItem(item)} onMouseLeave={() => setActiveItem(null)}>
              <span><i style={{ background: item.color }} />{item.label}</span>
              <strong>{thb(Math.round(item.value))} บาท</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Login Page ───────────────────────────────────────────────────────────────

function LoginPage({ onLogin }: { onLogin: (user: string, name: string, role: Role, department: string | null) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username || !password) { setError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'); return }
    setLoading(true)
    try {
      const user: AuthUser = await loginWithDatabase(username.trim(), password)
      if (user.role !== 'hr' && user.role !== 'director' && user.role !== 'admin') {
        clearAccessToken()
        throw new Error('บัญชีนี้ยังไม่มีสิทธิ์ใช้งานในหน้าเว็บ Payroll')
      }
      onLogin(user.username, user.full_name || user.username, user.role, user.department_name)
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'เข้าสู่ระบบไม่สำเร็จ')
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        overflowY: 'auto',
        background: 'linear-gradient(160deg,#F5F4FF 0%,#EDF5FF 50%,#FFF5F3 100%)',
      }}
    >
      <div className="orb" style={{ width: 500, height: 500, top: -120, left: -80, background: 'radial-gradient(circle,rgba(205,180,255,0.28) 0%,transparent 70%)' }} />
      <div className="orb" style={{ width: 400, height: 400, bottom: -80, right: -60, background: 'radial-gradient(circle,rgba(189,224,254,0.24) 0%,transparent 70%)' }} />
      <div className="glass" style={{ width: '100%', maxWidth: 400, borderRadius: 'var(--radius-xl)', padding: '40px 40px 36px', position: 'relative', zIndex: 1, margin: 'auto' }}>
        {/* Logo */}
        <div className="text-center mb-8">
          <img src={takhliLogo} alt="โลโก้หน่วยงาน" style={{ width: 72, height: 72, borderRadius: 18, objectFit: 'cover', margin: '0 auto 14px', display: 'block', boxShadow: '0 8px 24px rgba(108,82,217,0.18)' }} />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: '#1A1A1A', letterSpacing: '-0.02em' }}>
            <span style={{ color: 'var(--purple-600)' }}>Pay</span>Flow
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>ระบบจัดทำเงินเดือนและส่งสลิปเงินเดือน</div>
        </div>
        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1A1A1A', marginBottom: 6 }}>ชื่อผู้ใช้</label>
            <input className="inp" value={username} onChange={e => setUsername(e.target.value)} placeholder="กรอกชื่อผู้ใช้" autoComplete="username" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1A1A1A', marginBottom: 6 }}>รหัสผ่าน</label>
            <div style={{ position: 'relative' }}>
              <input className="inp" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="กรอกรหัสผ่าน" autoComplete="current-password" style={{ paddingRight: 44 }} />
              <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}>
                {showPw ? '◡' : '◠'}
              </button>
            </div>
          </div>
          {error && <div style={{ background: 'var(--status-rejected-bg)', border: '1px solid var(--status-rejected-border)', borderRadius: 10, padding: '9px 14px', fontSize: 13, color: 'var(--status-rejected-text)' }}>✕ {error}</div>}
          <button className="btn btn-primary" aria-busy={loading} type="submit" disabled={loading} style={{ width: '100%', marginTop: 4, height: 44, fontSize: 15 }}>
            <BusyLabel busy={loading} label="กำลังเข้าสู่ระบบ…">เข้าสู่ระบบ</BusyLabel>
          </button>
        </form>
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 20 }}>
          ลืมรหัสผ่าน? กรุณาติดต่อผู้ดูแลระบบ
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardAnalogClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value ?? 0)
  const hour = part('hour')
  const minute = part('minute')
  const second = part('second') + now.getMilliseconds() / 1000
  const thaiDate = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
  }).format(now)

  return (
    <div className="dashboard-analog-clock" aria-label={`วันที่ ${thaiDate}`}>
      <div className="dashboard-clock-face" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <i
            key={index}
            className={`dashboard-clock-tick ${index % 3 === 0 ? 'dashboard-clock-tick-major' : ''}`}
            style={{ transform: `translateX(-50%) rotate(${index * 30}deg)` }}
          />
        ))}
        <i className="dashboard-clock-hand dashboard-clock-hour" style={{ transform: `rotate(${(hour % 12) * 30 + minute * 0.5}deg)` }} />
        <i className="dashboard-clock-hand dashboard-clock-minute" style={{ transform: `rotate(${minute * 6 + second * 0.1}deg)` }} />
        <i className="dashboard-clock-hand dashboard-clock-second" style={{ transform: `rotate(${second * 6}deg)` }} />
        <i className="dashboard-clock-pin" />
      </div>
      <div className="dashboard-clock-date">{thaiDate}</div>
    </div>
  )
}

function Dashboard({ role, userName, userDepartment, periods, employees, departments, setPage, setActivePeriodId, setActiveDeptId }: {
  role: Role; userName: string; userDepartment: string | null; periods: PayrollPeriod[];
  employees: DatabaseEmployee[]; departments: Department[];
  setPage: (p: Page) => void; setActivePeriodId: (id: string) => void; setActiveDeptId: (id: string) => void;
}) {
  const [dashboardPeriodId, setDashboardPeriodId] = useState(periods[0]?.id ?? '')
  useEffect(() => {
    if (!periods.some(period => period.id === dashboardPeriodId)) setDashboardPeriodId(periods[0]?.id ?? '')
  }, [periods, dashboardPeriodId])
  const currentPeriod = periods.find(period => period.id === dashboardPeriodId) ?? periods[0]
  const [dashboardDepartment, setDashboardDepartment] = useState('')
  const dashboardDepartmentNames = [...new Set(currentPeriod?.depts.map(department => department.department) ?? [])]
  useEffect(() => {
    if (role !== 'director') return
    if (!dashboardDepartmentNames.includes(dashboardDepartment)) {
      setDashboardDepartment(dashboardDepartmentNames[0] ?? '')
    }
  }, [role, dashboardDepartment, dashboardDepartmentNames.join('|')])
  const currentPeriodIndex = periods.findIndex(period => period.id === currentPeriod?.id)
  const prevPeriod = currentPeriodIndex >= 0 ? periods[currentPeriodIndex + 1] : undefined
  const dashboardYears = [...new Set(periods.map(period => period.year))].sort((a, b) => b - a)
  const dashboardMonths = periods.filter(period => period.year === currentPeriod?.year).map(period => period.month).sort((a, b) => b - a)
  const selectDashboardPeriod = (year: number, month: number) => {
    const period = periods.find(item => item.year === year && item.month === month)
    if (period) setDashboardPeriodId(period.id)
  }
  const [expandedDashboardPeriodId, setExpandedDashboardPeriodId] = useState<string | null>(null)
  const [isDashboardPrinting, setIsDashboardPrinting] = useState(false)
  const [isRecentPeriodsHighlighted, setIsRecentPeriodsHighlighted] = useState(false)
  const recentPeriodsRef = useRef<HTMLDivElement>(null)
  const recentPeriodsHighlightTimer = useRef<number | null>(null)
  const reportDepartment = role === 'director' ? dashboardDepartment : role === 'hr' ? userDepartment ?? '' : ''
  const departmentsForReport = (period: PayrollPeriod) => reportDepartment
    ? period.depts.filter(department => department.department === reportDepartment)
    : period.depts
  const totalsForReport = (period: PayrollPeriod) => departmentsForReport(period).reduce((totals, department) => {
    const departmentTotals = deptTotals(department)
    return {
      base: totals.base + departmentTotals.totalBase,
      gross: totals.gross + departmentTotals.totalGross,
      deduct: totals.deduct + departmentTotals.totalDeduct,
      net: totals.net + departmentTotals.totalNet,
      emps: totals.emps + departmentTotals.count,
    }
  }, { base: 0, gross: 0, deduct: 0, net: 0, emps: 0 })
  const currentTotals = currentPeriod ? totalsForReport(currentPeriod) : { base: 0, gross: 0, deduct: 0, net: 0, emps: 0 }
  const prevTotals = prevPeriod ? totalsForReport(prevPeriod) : null

  const pendingDepts = currentPeriod?.depts.filter(d => d.status === 'pending') ?? []

  // Use only records returned by the API; never display demo chart values.
  const chartPeriods = [...periods].slice(0, 7).reverse()
  const monthLabels = chartPeriods.map(period => `${MONTH_TH[period.month].slice(0, 3)} ${String(period.year + 543).slice(-2)}`)
  const lineData = [
    { label: 'รายการรับรวม', values: chartPeriods.map(period => totalsForReport(period).gross), color: '#9C6FE4' },
    { label: 'รายการหักรวม', values: chartPeriods.map(period => totalsForReport(period).deduct), color: '#FFB4A2' },
    { label: 'ยอดรับสุทธิรวม', values: chartPeriods.map(period => totalsForReport(period).net), color: '#22C55E' },
  ]
  const dashboardRows = currentPeriod ? departmentsForReport(currentPeriod).flatMap(dept => Object.values(dept.rows)) : []
  const currentPayrollEmployeeCodes = new Set(dashboardRows.map(row => row.empId))
  const currentPayrollEmployees = employees.filter(employee =>
    employee.status === 'ACTIVE' && currentPayrollEmployeeCodes.has(employee.employee_code)
  )
  const missingEmailCount = currentPayrollEmployees.filter(employee => !employee.email?.trim()).length
  const missingPayrollCount = employees.filter(employee =>
    employee.status === 'ACTIVE' && !currentPayrollEmployeeCodes.has(employee.employee_code)
  ).length
  const failedEmailCount = currentPeriod?.depts.reduce((count, dept) =>
    count + Object.entries(dept.emailStatuses ?? {}).filter(([employeeCode, status]) =>
      currentPayrollEmployeeCodes.has(employeeCode) && status === 'failed'
    ).length
  , 0) ?? 0
  const incomeCategories = [
    { label: 'ฐานเงินเดือน', value: currentTotals.base, color: '#7C4DCC' },
    { label: 'เงินเพิ่ม', value: dashboardRows.reduce((sum, row) => sum + row.extra, 0), color: '#A78BFA' },
    { label: 'เงินประจำตำแหน่ง', value: dashboardRows.reduce((sum, row) => sum + row.posAllowance, 0), color: '#D8CCFF' },
  ]
  const deductionCategories = [
    { label: 'ชำระหนี้ KTB', value: dashboardRows.reduce((sum, row) => sum + row.debtKTB, 0), color: '#E66B62' },
    { label: 'ภาษีหัก ณ ที่จ่าย', value: dashboardRows.reduce((sum, row) => sum + row.tax, 0), color: '#F0A49D' },
    { label: 'ประกันสังคม', value: dashboardRows.reduce((sum, row) => sum + row.social, 0), color: '#F6C8C3' },
    { label: 'ฌาปนกิจ', value: dashboardRows.reduce((sum, row) => sum + row.funeral, 0), color: '#F9DEDA' },
    { label: 'ธนาคาร', value: dashboardRows.reduce((sum, row) => sum + row.ktb + row.gsb, 0), color: '#EBC1B9' },
  ]
  // `periods` is already filtered by the API for the signed-in role.  This
  // keeps HR within its own department and Director/Admin across all departments.
  const annualTaxYear = currentPeriod?.year
  const annualTaxByMonth = Array.from({ length: 12 }, () => 0)
  if (annualTaxYear !== undefined) {
    periods
      .filter(period => period.year === annualTaxYear)
      .forEach(period => period.depts
        .filter(department => department.status === 'approved' && (!reportDepartment || department.department === reportDepartment))
        .forEach(department => {
          Object.values(department.rows).forEach(row => {
            annualTaxByMonth[period.month - 1] += Number(row.tax) || 0
          })
        }))
  }
  const annualTaxTotal = annualTaxByMonth.reduce((sum, value) => sum + value, 0)
  const annualTaxApprovedMonths = annualTaxByMonth.filter(value => value > 0).length
  const annualTaxScope = reportDepartment || 'ทุกฝ่าย'

  const now = new Date()
  const hour = now.getHours()
  const greet = hour < 12 ? 'สวัสดีตอนเช้า' : hour < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น'

  const openCurrentDepartment = () => {
    const department = currentPeriod?.depts[0]
    if (!currentPeriod || !department) return
    setActivePeriodId(currentPeriod.id)
    setActiveDeptId(department.id)
    setPage('dept-table')
  }

  const printDashboard = () => {
    if (role === 'hr') {
      window.print()
      return
    }
    setIsDashboardPrinting(true)
    window.setTimeout(() => window.print(), 120)
  }

  const focusApprovalStatus = () => {
    recentPeriodsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setIsRecentPeriodsHighlighted(true)
    if (recentPeriodsHighlightTimer.current !== null) window.clearTimeout(recentPeriodsHighlightTimer.current)
    recentPeriodsHighlightTimer.current = window.setTimeout(() => {
      setIsRecentPeriodsHighlighted(false)
      recentPeriodsHighlightTimer.current = null
    }, 2600)
  }

  useEffect(() => {
    const resetPrintState = () => setIsDashboardPrinting(false)
    window.addEventListener('afterprint', resetPrintState)
    return () => {
      window.removeEventListener('afterprint', resetPrintState)
      if (recentPeriodsHighlightTimer.current !== null) window.clearTimeout(recentPeriodsHighlightTimer.current)
    }
  }, [])

  const quickMenuItems = role === 'hr' ? [
    { step: '①', icon: '👥', label: 'ตรวจรายชื่อพนักงาน', action: () => setPage('employees') },
    { step: '②', icon: '🧾', label: 'จัดทำข้อมูลเงินเดือน', action: () => setPage('periods') },
    { step: '③', icon: '✅', label: 'ตรวจและส่งอนุมัติ', action: openCurrentDepartment },
    { step: '④', icon: '📨', label: 'ติดตามสลิปเงินเดือน', action: () => setPage('payslip-status') },
  ] : role === 'admin' ? [
    { step: '①', icon: '👥', label: 'ตรวจรายชื่อพนักงาน', action: () => setPage('employees') },
    { step: '②', icon: '🧾', label: 'จัดทำข้อมูลเงินเดือน', action: () => setPage('periods') },
    { step: '③', icon: '✅', label: 'ตรวจสอบสถานะอนุมัติ', action: focusApprovalStatus },
    { step: '④', icon: '👤', label: 'จัดการผู้ใช้งาน', action: () => setPage('admin-users') },
  ] : role === 'director' ? [
    { step: '①', icon: '📋', label: 'ตรวจสอบรอบเงินเดือน', action: () => setPage('periods') },
    { step: '②', icon: '✅', label: 'ตรวจสอบสถานะอนุมัติ', action: focusApprovalStatus },
    { step: '③', icon: '👥', label: 'ดูข้อมูลพนักงาน', action: () => setPage('employees') },
    { step: '④', icon: '🗂️', label: 'ดูประวัติรอบเงินเดือน', action: () => setPage('periods') },
  ] : []

  return (
    <div className="anim flex flex-col gap-5">
      {/* Welcome */}
      <div className="glass" style={{ borderRadius: 'var(--radius-lg)', padding: '24px 28px', background: 'linear-gradient(120deg, rgba(205,180,255,0.18) 0%, rgba(189,224,254,0.15) 60%, rgba(255,180,162,0.10) 100%)' }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--purple-600)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{greet}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: '#1A1A1A', letterSpacing: '-0.02em' }}>
              {userName}{role === 'hr' && userDepartment ? <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginLeft: 10 }}>พนักงานธุรการฝ่าย{userDepartment}</span> : null}
            </div>
            {currentPeriod && (
              <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 6 }}>
                รอบเงินเดือน <strong style={{ color: '#1A1A1A' }}>{periodLabel(currentPeriod)}</strong> · วันที่จ่าย {formatBuddhistDate(currentPeriod.payDate)}
                {role === 'hr' && pendingDepts.length > 0 && <span style={{ marginLeft: 12, color: 'var(--status-pending-text)', fontWeight: 600 }}>◔ ข้อมูลฝ่ายรออนุมัติ</span>}
              </div>
            )}
          </div>
          <div className="flex items-start gap-3">
            <button className="btn btn-secondary dashboard-print-button" onClick={printDashboard}>🖨️ พิมพ์รายงาน</button>
            <DashboardAnalogClock />
          </div>
        </div>
      </div>

      <div className="card" aria-label="เลือกเดือน ปี และฝ่ายสำหรับแสดงรายงาน" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <AppSelect className="inp" style={{ width: 150 }} value={String(currentPeriod?.month ?? '')} onChange={event => selectDashboardPeriod(currentPeriod?.year ?? 0, Number(event.target.value))}>
          {dashboardMonths.map(month => <option key={month} value={month}>{MONTH_TH[month]}</option>)}
        </AppSelect>
        <AppSelect className="inp" style={{ width: 120 }} value={String(currentPeriod?.year ?? '')} onChange={event => {
          const year = Number(event.target.value)
          const period = periods.find(item => item.year === year && item.month === currentPeriod?.month) ?? periods.find(item => item.year === year)
          if (period) setDashboardPeriodId(period.id)
        }}>
          {dashboardYears.map(year => <option key={year} value={year}>{year + 543}</option>)}
        </AppSelect>
        {role === 'director' && (
          <AppSelect className="inp" style={{ width: 230 }} value={dashboardDepartment} onChange={event => setDashboardDepartment(event.target.value)} aria-label="เลือกฝ่ายที่ต้องการดูรายงาน">
            {dashboardDepartmentNames.map(department => <option key={department} value={department}>{department}</option>)}
          </AppSelect>
        )}
      </div>

      <div className="dashboard-quick-menu">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
          เมนูลัด
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
          {quickMenuItems.map(item => (
            <button key={item.step} className="quick-menu-card" onClick={item.action}>
              <div className="quick-menu-card-icon"><span>{item.step}</span><span>{item.icon}</span></div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{item.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Unified payroll summary */}
      <div className="dashboard-payroll-summary">
        <div className="dashboard-payroll-summary-head">
          <div>
            <div className="dashboard-payroll-summary-title">สรุปรอบเงินเดือน {currentPeriod ? periodLabel(currentPeriod) : ''}</div>
            <div className="dashboard-payroll-summary-subtitle">ภาพรวมรายการเงินเดือนของ{reportDepartment || 'ทุกฝ่าย'}</div>
          </div>
          <div className="dashboard-payroll-people">👥 พนักงาน {thbInt(currentTotals.emps)} คน</div>
        </div>
        <div className="dashboard-payroll-summary-body">
          <div className="dashboard-payroll-net">
            <div className="dashboard-payroll-label">ยอดรับสุทธิรวม</div>
            <div className="dashboard-payroll-net-value">{thb(Math.round(currentTotals.net))}</div>
            <div className="dashboard-payroll-unit">บาท</div>
            {prevTotals && <div className="dashboard-payroll-previous">เดือนก่อน {thb(Math.round(prevTotals.net))} บาท</div>}
          </div>
          <div className="dashboard-payroll-breakdown">
            <div className="dashboard-payroll-row">
              <span>ฐานเงินเดือนรวม</span><strong>{thb(Math.round(currentTotals.base))} บาท</strong>
            </div>
            <div className="dashboard-payroll-row">
              <span>รายการรับรวม</span><strong>{thb(Math.round(currentTotals.gross))} บาท</strong>
            </div>
            <div className="dashboard-payroll-row dashboard-payroll-deduct">
              <span>รายการหักรวม</span><strong>{thb(Math.round(currentTotals.deduct))} บาท</strong>
            </div>
          </div>
        </div>
      </div>

      {role === 'admin' && (
        <>
          <section className="dashboard-admin-alert-strip" aria-label="รายการที่ควรตรวจสอบ">
            <div className="dashboard-admin-alert-item is-failed">
              <span>สถานะการส่งสลิป</span>
              <strong>📨 {failedEmailCount} ราย <em>ส่งไม่สำเร็จ</em></strong>
            </div>
            <div className="dashboard-admin-alert-item is-warning">
              <span>ข้อมูลติดต่อ</span>
              <strong>⚠️ {missingEmailCount} ราย <em>ไม่มีอีเมล</em></strong>
            </div>
            <div className="dashboard-admin-alert-item is-payroll">
              <span>ความครบถ้วนของรอบ</span>
              <strong>👥 {missingPayrollCount} ราย <em>ยังไม่เข้ารอบ</em></strong>
            </div>
            <div className="dashboard-admin-alert-action">
              <button className="btn btn-ghost btn-sm" onClick={() => setPage('payslip-status')}>ดูรายละเอียด →</button>
            </div>
          </section>
        </>
      )}

      <div className="card dashboard-monthly-report" style={{ padding: 24, width: '100%' }}>
        <div className="dashboard-monthly-report-chart">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: '#1A1A1A' }}>แนวโน้มค่าใช้จ่ายรายเดือน</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>ข้อมูลย้อนหลัง 7 เดือน (บาท)</div>
            </div>
          </div>
          <LineChart datasets={lineData} labels={monthLabels} />
        </div>
        <aside className="dashboard-monthly-report-donuts">
          <CategoryDonut title="รายการรับสะสมตามประเภท" total={currentTotals.gross} items={incomeCategories} tone="income" />
          <CategoryDonut title="รายการหักสะสมตามประเภท" total={currentTotals.deduct} items={deductionCategories} tone="deduct" />
        </aside>
      </div>

      <section className="card dashboard-annual-tax-report" aria-label="ภาษีหัก ณ ที่จ่ายสะสมรายปี">
        <div className="dashboard-annual-tax-heading">
          <div>
            <div className="dashboard-annual-tax-title">ภาษีหัก ณ ที่จ่ายสะสมรายปี</div>
            <div className="dashboard-annual-tax-subtitle">{annualTaxScope} · เฉพาะรอบเงินเดือนที่อนุมัติแล้ว</div>
          </div>
          <div className="dashboard-annual-tax-total">
            <span>ปี พ.ศ. {annualTaxYear ? annualTaxYear + 543 : '—'}</span>
            <strong>{thb(Math.round(annualTaxTotal))} <em>บาท</em></strong>
          </div>
        </div>
        <AnnualTaxBarChart values={annualTaxByMonth} labels={['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']} highlightedMonth={currentPeriod?.month} />
        <div className="dashboard-annual-tax-footer">
          <span>แสดงยอดภาษีที่หักในแต่ละเดือน</span>
          <span>มีข้อมูลภาษี {annualTaxApprovedMonths} เดือน</span>
        </div>
      </section>

      {/* Recent list */}
      <div ref={recentPeriodsRef} className={`card dashboard-recent-periods ${(role === 'director' || role === 'admin') ? 'dashboard-recent-periods-detailed' : ''} ${isRecentPeriodsHighlighted ? 'is-highlighted' : ''}`} style={{ padding: 24 }}>
        <div className="flex items-center justify-between mb-4">
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>รายการรอบเงินเดือนล่าสุด{role === 'director' && dashboardDepartment ? ` · ${dashboardDepartment}` : ''}</div>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--purple-600)' }} onClick={() => setPage('periods')}>ดูทั้งหมด →</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>รอบเงินเดือน</th>
                <th>วันที่จ่าย</th>
                <th>จำนวนพนักงาน</th>
                <th style={{ textAlign: 'right' }}>รายการรับรวม (บาท)</th>
                <th style={{ textAlign: 'right' }}>ยอดรับสุทธิรวม (บาท)</th>
                <th>สถานะ</th>
                {(role === 'director' || role === 'admin') && <th style={{ width: 54, textAlign: 'center' }} aria-label="ดูสถานะแยกฝ่าย" />}
              </tr>
            </thead>
            <tbody>
              {periods.slice(0, 6).map(period => {
                // HR and the Director's selected report view describe one
                // department, not an aggregate such as "remaining 1/6".
                const scopedDepartment = role === 'hr'
                  ? period.depts.find(department => department.department === userDepartment) ?? period.depts[0]
                  : role === 'director' && dashboardDepartment
                    ? period.depts.find(department => department.department === dashboardDepartment)
                    : undefined
                const totals = scopedDepartment
                  ? (() => {
                      const departmentTotals = deptTotals(scopedDepartment)
                      return {
                        emps: departmentTotals.count,
                        gross: departmentTotals.totalGross,
                        net: departmentTotals.totalNet,
                      }
                    })()
                  : periodTotals(period)
                const isExpanded = expandedDashboardPeriodId === period.id
                const completedCount = period.depts.filter(department => ['approved', 'closed'].includes(department.status)).length
                const remainingCount = period.depts.length - completedCount
                const periodStatus = scopedDepartment
                  ? { type: scopedDepartment.status, label: statusLabel[scopedDepartment.status] }
                  : remainingCount > 0
                    ? { type: 'pending', label: `รอดำเนินการ ${remainingCount}/${period.depts.length} ฝ่าย` }
                    : { type: 'approved', label: `เสร็จสิ้น ${completedCount}/${period.depts.length} ฝ่าย` }
                return (
                  <Fragment key={period.id}>
                    <tr key={period.id} style={{ cursor: 'pointer' }} onClick={() => {
                      setActivePeriodId(period.id)
                      if (role === 'hr' && scopedDepartment) {
                        setActiveDeptId(scopedDepartment.id)
                        setPage('dept-table')
                      } else {
                        setPage('period-detail')
                      }
                    }}>
                      <td style={{ fontWeight: 600 }}>{periodLabel(period)}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{formatBuddhistDate(period.payDate)}</td>
                      <td>{totals.emps} คน</td>
                      <td className="num">{thb(totals.gross)}</td>
                      <td className="num" style={{ fontWeight: 600, color: 'var(--purple-600)' }}>{thb(totals.net)}</td>
                      <td>
                        <span className={`badge badge-${periodStatus.type}`} title="ดูรายละเอียดสถานะแยกฝ่ายจากปุ่มลูกศรด้านขวา">{periodStatus.label}</span>
                      </td>
                      {(role === 'director' || role === 'admin') && (
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            title={isExpanded ? 'ซ่อนสถานะการอนุมัติแยกฝ่าย' : 'แสดงสถานะการอนุมัติแยกฝ่าย'}
                            aria-expanded={isExpanded}
                            onClick={event => {
                              event.stopPropagation()
                              setExpandedDashboardPeriodId(previous => previous === period.id ? null : period.id)
                            }}
                            style={{ color: 'var(--purple-600)', minWidth: 32, padding: '3px 7px', lineHeight: 1, fontSize: 17 }}
                          >{isExpanded ? '⌃' : '⌄'}</button>
                        </td>
                      )}
                    </tr>
                    {(isExpanded || isDashboardPrinting) && (role === 'director' || role === 'admin') && (
                      <tr key={`${period.id}-approval-drawer`} className="dashboard-approval-drawer">
                        <td colSpan={7} style={{ padding: '14px 16px 18px', background: '#FAF9FF' }}>
                          <div className="flex items-center justify-between gap-3" style={{ marginBottom: 10 }}>
                            <div>
                              <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700 }}>สถานะการอนุมัติแยกฝ่าย</div>
                              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>รายละเอียดของรอบ {periodLabel(period)}</div>
                            </div>
                            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{period.depts.length} ฝ่าย</span>
                          </div>
                          <div style={{ background: '#FFFFFF', border: '1px solid var(--border)', borderRadius: 10, overflowX: 'auto' }}>
                            <table className="tbl" style={{ minWidth: 800 }}>
                              <thead><tr><th>ฝ่าย</th><th style={{ textAlign: 'center' }}>จำนวนพนักงาน</th><th style={{ textAlign: 'right' }}>รายการรับ</th><th style={{ textAlign: 'right' }}>รายการหัก</th><th style={{ textAlign: 'right' }}>ยอดสุทธิ</th><th style={{ textAlign: 'center' }}>สถานะอนุมัติ</th><th style={{ textAlign: 'center' }}>ดู</th></tr></thead>
                              <tbody>
                                {period.depts.map(dept => {
                                  const departmentTotals = deptTotals(dept)
                                  return <tr key={dept.id}>
                                    <td style={{ fontWeight: 600 }}>{dept.department}</td>
                                    <td style={{ textAlign: 'center' }}>{departmentTotals.count} คน</td>
                                    <td className="num" style={{ color: '#15803D' }}>{thb(departmentTotals.totalGross)}</td>
                                    <td className="num" style={{ color: '#B91C1C' }}>{thb(departmentTotals.totalDeduct)}</td>
                                    <td className="num" style={{ color: 'var(--purple-600)', fontWeight: 700 }}>{thb(departmentTotals.totalNet)}</td>
                                    <td style={{ textAlign: 'center' }}><StatusBadge s={dept.status} /></td>
                                    <td style={{ textAlign: 'center' }}><button className="btn btn-secondary btn-xs" onClick={() => { setActivePeriodId(period.id); setActiveDeptId(dept.id); setPage('director-detail') }}>ดู</button></td>
                                  </tr>
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Payroll Periods List ─────────────────────────────────────────────────────

function PeriodsPage({ periods, setPage, setActivePeriodId, setActiveDeptId, role, userDepartment, reloadPayroll, error }: {
  periods: PayrollPeriod[];
  setPage: (p: Page) => void; setActivePeriodId: (id: string) => void; setActiveDeptId: (id: string) => void;
  role: Role; userDepartment: string | null; reloadPayroll: () => Promise<void>; error: string;
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [createMonth, setCreateMonth] = useState(String(new Date().getMonth() + 1))
  const [createYear, setCreateYear] = useState(String(new Date().getFullYear() + 543))
  const [createPayDate, setCreatePayDate] = useState('')
  const [createNote, setCreateNote] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    try {
      const gregorianYear = parseInt(createYear) - 543
      const periodId = await createPayrollPeriod({ year: gregorianYear, month: parseInt(createMonth), pay_date: createPayDate, note: createNote })
      await reloadPayroll()
      setActivePeriodId(String(periodId))
      setActiveDeptId('')
      setShowCreate(false)
      setPage(role === 'hr' ? 'dept-table' : 'period-detail')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="anim">
      <PageHeader
        title="รอบเงินเดือน"
        subtitle="จัดการและติดตามรอบเงินเดือนทั้งหมด"
        actions={role === 'hr' || role === 'admin' ? <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ สร้างรอบเงินเดือน</button> : undefined}
      />
      <div className="flex flex-col gap-4">
        {error ? (
          <div className="card" style={{ padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
            <div style={{ fontWeight: 700 }}>ไม่สามารถโหลดรอบเงินเดือนได้</div>
            <div style={{ marginTop: 6, color: 'var(--text-secondary)', fontSize: 13 }}>{error}</div>
            <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => void reloadPayroll()}>↻ ลองโหลดใหม่</button>
          </div>
        ) : periods.length === 0 ? (
          <div className="card empty-state"><div className="empty-icon">📅</div><div>ยังไม่มีรอบเงินเดือน</div></div>
        ) : periods.map(p => {
          const t = periodTotals(p)
          const completedCount = p.depts.filter(d => ['approved', 'closed'].includes(d.status)).length
          const remainingCount = p.depts.length - completedCount
          const periodStatus = remainingCount > 0
            ? { type: 'pending', label: `รอดำเนินการ ${remainingCount}/${p.depts.length} ฝ่าย` }
            : { type: 'approved', label: `เสร็จสิ้น ${completedCount}/${p.depts.length} ฝ่าย` }
          return (
            <div key={p.id} className="card" style={{ padding: '20px 24px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
              onClick={() => {
                setActivePeriodId(p.id)
                if (role === 'hr' && p.depts[0]) {
                  setActiveDeptId(p.depts[0].id)
                  setPage('dept-table')
                } else {
                  setPage('period-detail')
                }
              }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'var(--shadow-sm)')}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: '#1A1A1A' }}>{periodLabel(p)}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                    วันที่จ่าย {formatBuddhistDate(p.payDate)} · สร้างโดย {p.createdBy}
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>ยอดรับสุทธิรวม</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: '#1A1A1A' }}>{thbInt(Math.round(t.net))} บาท</div>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end" style={{ maxWidth: 220 }}>
                    {role === 'hr' ? (
                      p.depts[0] ? <StatusBadge s={p.depts[0].status} /> : null
                    ) : (
                      <span className={`badge badge-${periodStatus.type}`}>{periodStatus.label}</span>
                    )}
                  </div>
                  <span style={{ color: '#CBD5E1', fontSize: 18 }}>›</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showCreate && (
        <Modal title="สร้างรอบเงินเดือน" onClose={() => setShowCreate(false)}>
          <div className="flex flex-col gap-4">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>เดือน <span style={{ color: 'red' }}>*</span></label>
                <AppSelect className="inp" value={createMonth} onChange={e => setCreateMonth(e.target.value)}>
                  {MONTH_TH.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                </AppSelect>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>ปี (พ.ศ.) <span style={{ color: 'red' }}>*</span></label>
                <input className="inp" type="number" min="2500" max="2700" value={createYear} onChange={e => setCreateYear(e.target.value)} />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>วันที่จ่ายเงินเดือน (พ.ศ.) <span style={{ color: 'red' }}>*</span></label>
              <BuddhistDateInput value={createPayDate} onChange={setCreatePayDate} required />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>หมายเหตุ</label>
              <textarea className="inp" rows={2} value={createNote} onChange={e => setCreateNote(e.target.value)} style={{ resize: 'none' }} />
            </div>
            <div className="flex gap-3 justify-end mt-2">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)} disabled={creating}>ยกเลิก</button>
            <button className="btn btn-primary" aria-busy={creating} onClick={() => void handleCreate()} disabled={!createPayDate || creating}><BusyLabel busy={creating} label="กำลังสร้าง…">สร้างรอบเงินเดือน</BusyLabel></button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Period Detail ────────────────────────────────────────────────────────────

function PeriodDetail({ period, setPage, setActiveDeptId, role }: {
  period: PayrollPeriod; setPage: (p: Page) => void; setActiveDeptId: (id: string) => void; role: Role;
}) {
  const t = periodTotals(period)
  return (
    <div className="anim">
      <PageHeader
        title={`รอบเงินเดือน ${periodLabel(period)}`}
        subtitle={`วันที่จ่าย ${formatBuddhistDate(period.payDate)} · สร้างโดย ${period.createdBy}`}
        breadcrumb={<Crumb items={[{ label: 'รอบเงินเดือน', onClick: () => setPage('periods') }, { label: periodLabel(period) }]} />}
      />
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        <KpiCard label="จำนวนพนักงาน" value={thbInt(t.emps)} unit="คน" icon="👥" accent="var(--purple-600)" tone="purple" />
        <KpiCard label="ยอดรายการรับรวม" value={thbInt(Math.round(t.gross))} unit="บาท" icon="💰" accent="#22C55E" tone="green" />
        <KpiCard label="ยอดรายการหักรวม" value={thbInt(Math.round(t.deduct))} unit="บาท" icon="🧾" accent="#F59E0B" tone="orange" />
        <KpiCard label="ยอดรับสุทธิรวม" value={thbInt(Math.round(t.net))} unit="บาท" icon="💵" accent="#3B82F6" tone="blue" />
      </div>
      {/* Dept list */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>รายการฝ่าย</div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>ฝ่าย</th>
              <th style={{ textAlign: 'center' }}>จำนวนพนักงาน</th>
              <th style={{ textAlign: 'right' }}>รายการรับรวม</th>
              <th style={{ textAlign: 'right' }}>รายการหักรวม</th>
              <th style={{ textAlign: 'right' }}>ยอดรับสุทธิรวม</th>
              <th>สถานะ</th>
              <th>แก้ไขล่าสุด</th>
              <th>ดำเนินการ</th>
            </tr>
          </thead>
          <tbody>
            {period.depts.map(d => {
              const dt = deptTotals(d)
              return (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.department}</td>
                  <td style={{ textAlign: 'center' }}>{dt.count}</td>
                  <td className="num">{thb(dt.totalGross)}</td>
                  <td className="num">{thb(dt.totalDeduct)}</td>
                  <td className="num total">{thb(dt.totalNet)}</td>
                  <td><StatusBadge s={d.status} /></td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatBuddhistDate(d.updatedAt)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      {(role === 'hr' || role === 'admin') && (d.status === 'draft' || d.status === 'rejected') && (
                        <button className="btn btn-primary btn-xs" onClick={() => { setActiveDeptId(d.id); setPage('dept-table') }}>
                          {d.status === 'rejected' ? 'แก้ไข' : 'เริ่มกรอก'}
                        </button>
                      )}
                      {(d.status === 'pending' || d.status === 'approved' || d.status === 'closed') && (
                        <button className="btn btn-secondary btn-xs" onClick={() => { setActiveDeptId(d.id); setPage(role !== 'hr' ? 'director-detail' : 'dept-table') }}>ดู</button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── CellInput (hoisted so React never remounts it) ──────────────────────────

interface CellInputProps {
  empId: string
  field: keyof PayrollRow
  value: number
  isReadonly: boolean
  onFocus: (id: string) => void
  onCommit: (empId: string, field: keyof PayrollRow, val: number) => void
}

function CellInput({ empId, field, value, isReadonly, onFocus, onCommit }: CellInputProps) {
  const [localVal, setLocalVal] = useState(String(value))
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { setLocalVal(String(value)) }, [value])

  if (isReadonly) return <td className="num readonly">{thb(value)}</td>

  return (
    <td style={{ padding: '4px 8px' }}>
      <input
        ref={ref}
        className="cell-inp"
        type="number"
        min={0}
        value={localVal}
        placeholder="0.00"
        onFocus={() => onFocus(empId)}
        onBlur={() => {
          const n = parseFloat(localVal) || 0
          if (n < 0) return
          onCommit(empId, field, n)
        }}
        onChange={event => {
          const nextValue = event.target.value
          setLocalVal(nextValue)
          // Update the shared draft immediately, rather than waiting for blur.
          // This keeps the pending-change count accurate for every numeric cell.
          const parsed = Number(nextValue)
          if (nextValue === '' || (Number.isFinite(parsed) && parsed >= 0)) {
            onCommit(empId, field, nextValue === '' ? 0 : parsed)
          }
        }}
        onKeyDown={e => e.key === 'Enter' && ref.current?.blur()}
      />
    </td>
  )
}

// ─── Dept Payroll Table ───────────────────────────────────────────────────────

function DeptPayrollTable({ period, dept, setPeriods, setPage, showToast, databaseEmployees, departments, positions, reloadPayroll }: {
  period: PayrollPeriod; dept: DeptPayroll; setPeriods: React.Dispatch<React.SetStateAction<PayrollPeriod[]>>;
  setPage: (p: Page) => void; showToast: (msg: string, t?: 'success' | 'error') => void;
  databaseEmployees: DatabaseEmployee[]; departments: Department[]; positions: Position[]; reloadPayroll: () => Promise<void>;
}) {
  // Combine the payroll snapshot with the live employee directory.  A staff member
  // added after this payroll period was first loaded must be available immediately.
  const allDepartmentEmployees = useMemo(() => {
    const byCode = new Map(deptEmps(dept).map(employee => [employee.id, employee]))
    databaseEmployees
      .filter(employee => employee.status === 'ACTIVE')
      .map(employee => databaseEmployeeToPayrollEmployee(employee, departments, positions))
      .filter(employee => employee.department === dept.department)
      .forEach(employee => byCode.set(employee.id, employee))
    return Array.from(byCode.values())
  }, [databaseEmployees, departments, dept, positions])
  const [includedEmployeeIds, setIncludedEmployeeIds] = useState<string[]>(() => {
    const savedEmployeeIds = Object.keys(dept.rows)
    const excludedIds = new Set(dept.excludedEmployeeIds ?? [])
    // Active employees that were already present when this screen loaded are
    // part of the initial table, not an unsaved change.  This prevents a fresh
    // page reload from incorrectly showing “1 รายการ” before the user edits.
    const activeDirectoryIds = allDepartmentEmployees
      .filter(employee => employee.status === 'active' && !excludedIds.has(employee.id))
      .map(employee => employee.id)
    return Array.from(new Set([...savedEmployeeIds, ...activeDirectoryIds]))
  })
  const [excludedEmployeeIds, setExcludedEmployeeIds] = useState<string[]>(() => dept.excludedEmployeeIds ?? [])
  const emps = useMemo(
    () => allDepartmentEmployees.filter(employee => includedEmployeeIds.includes(employee.id)),
    [allDepartmentEmployees, includedEmployeeIds]
  )
  const [rows, setRows] = useState<Record<string, PayrollRow>>(() => {
    const r: Record<string, PayrollRow> = {}
    emps.forEach(e => { r[e.id] = dept.rows[e.id] ?? makeDefaultRow(e) })
    return r
  })
  const initialIncludedEmployeeIds = useRef<string[]>(includedEmployeeIds)
  const initialRows = useRef<Record<string, PayrollRow>>(rows)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showDiscardModal, setShowDiscardModal] = useState(false)
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [showLockedEditModal, setShowLockedEditModal] = useState(false)
  const [showRevisionModal, setShowRevisionModal] = useState(false)
  const [revisionType, setRevisionType] = useState('')
  const [revisionReason, setRevisionReason] = useState('')
  const [creatingRevision, setCreatingRevision] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [focusRow, setFocusRow] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [search, setSearch] = useState('')
  const [inlineAddSearch, setInlineAddSearch] = useState('')
  const [inlineAddOpen, setInlineAddOpen] = useState(false)
  const [inlineAddPosition, setInlineAddPosition] = useState<FloatingDropdownPosition | null>(null)
  const inlineAddRef = useRef<HTMLDivElement>(null)
  const inlineDropdownRef = useRef<HTMLDivElement>(null)
  const isReadonly = dept.status === 'pending' || dept.status === 'approved' || dept.status === 'closed'
  const availableEmployees = allDepartmentEmployees.filter(employee => !includedEmployeeIds.includes(employee.id))
  const visibleEmployees = emps.filter(employee => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return true
    return `${employee.firstName} ${employee.lastName}`.toLowerCase().includes(keyword)
  })
  const inlineCandidates = useMemo(() => {
    const keyword = inlineAddSearch.trim().toLowerCase()
    if (!keyword) return []
    return availableEmployees.filter(employee =>
      // One-character searches are useful for names, but every employee code
      // includes "EMP".  Only begin matching codes after two characters.
      `${employee.firstName} ${employee.lastName}`.toLowerCase().includes(keyword) ||
      false
    ).slice(0, 8)
  }, [availableEmployees, inlineAddSearch])

  const updateInlineAddPosition = useCallback(() => {
    const rect = inlineAddRef.current?.getBoundingClientRect()
    if (!rect) return
    setInlineAddPosition({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 290) })
  }, [])

  const openInlineDropdown = useCallback(() => {
    updateInlineAddPosition()
    setInlineAddOpen(true)
  }, [updateInlineAddPosition])

  useEffect(() => {
    const closeDropdown = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        inlineAddRef.current && !inlineAddRef.current.contains(target) &&
        inlineDropdownRef.current && !inlineDropdownRef.current.contains(target)
      ) {
        setInlineAddOpen(false)
      }
    }
    document.addEventListener('mousedown', closeDropdown)
    return () => document.removeEventListener('mousedown', closeDropdown)
  }, [])

  useEffect(() => {
    if (!inlineAddOpen) return
    const update = () => updateInlineAddPosition()
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
    }
  }, [inlineAddOpen, updateInlineAddPosition])

  useEffect(() => {
    if (isReadonly) return
    const newlyAvailable = allDepartmentEmployees.filter(employee =>
      employee.status === 'active' && !includedEmployeeIds.includes(employee.id) && !excludedEmployeeIds.includes(employee.id)
    )
    if (newlyAvailable.length === 0) return
    setIncludedEmployeeIds(previous => Array.from(new Set([...previous, ...newlyAvailable.map(employee => employee.id)])))
    setRows(previous => ({
      ...previous,
      ...Object.fromEntries(newlyAvailable.map(employee => [employee.id, previous[employee.id] ?? makeDefaultRow(employee)])),
    }))
    setDirty(true)
  }, [allDepartmentEmployees, excludedEmployeeIds, includedEmployeeIds, isReadonly])

  const setCell = useCallback((empId: string, field: keyof PayrollRow, val: number) => {
    setRows(prev => ({ ...prev, [empId]: { ...prev[empId], [field]: val } }))
    setDirty(true)
  }, [])

  const pendingChangeCount = useMemo(() => {
    const originalIds = new Set(initialIncludedEmployeeIds.current)
    const currentIds = new Set(includedEmployeeIds)
    const added = includedEmployeeIds.filter(id => !originalIds.has(id)).length
    const removed = initialIncludedEmployeeIds.current.filter(id => !currentIds.has(id)).length
    const editableFields: Array<Exclude<keyof PayrollRow, 'empId'>> = ['extra', 'posAllowance', 'debtKTB', 'tax', 'social', 'funeral', 'ktb', 'gsb']
    const editedCells = includedEmployeeIds.reduce((count, id) => {
      if (!originalIds.has(id)) return count
      const original = initialRows.current[id]
      const current = rows[id]
      if (!original || !current) return count
      return count + editableFields.filter(field => original[field] !== current[field]).length
    }, 0)
    return added + removed + editedCells
  }, [includedEmployeeIds, rows])
  const hasPendingChanges = pendingChangeCount > 0

  const persistRows = async () => {
    if (!dept.databaseId) throw new Error('ไม่พบรหัสรายการฝ่ายในฐานข้อมูล')
    const byCode = new Map(databaseEmployees.map(employee => [employee.employee_code, employee.id]))
    const payload = includedEmployeeIds.map(employeeCode => {
      const row = rows[employeeCode]
      const employeeId = byCode.get(employeeCode)
      if (!employeeId || !row) throw new Error('ไม่พบข้อมูลพนักงาน')
      return { employee_id: employeeId, lines: {
        EXTRA_PAY: row.extra, POS_ALLOW: row.posAllowance, KTB_LOAN: row.debtKTB,
        TAX: row.tax, SSF: row.social, FUNERAL_FUND: row.funeral, SAVINGS_BANK_LOAN: row.gsb,
      } }
    })
    await savePayrollBatchItems(dept.databaseId, payload)
  }

  const closeEditor = () => {
    setEditing(false)
    setInlineAddOpen(false)
    setInlineAddSearch('')
    setFocusRow(null)
  }

  const discardUnsavedChanges = () => {
    // Restore the exact last-saved snapshot.  Local table actions must never
    // survive merely because the editor was closed without saving.
    const savedIds = [...initialIncludedEmployeeIds.current]
    setIncludedEmployeeIds(savedIds)
    setRows(Object.fromEntries(
      savedIds
        .filter(id => initialRows.current[id])
        .map(id => [id, { ...initialRows.current[id] }])
    ))
    setExcludedEmployeeIds(dept.excludedEmployeeIds ?? [])
    setDirty(false)
    setShowDiscardModal(false)
    closeEditor()
  }

  const requestCloseEditor = () => {
    if (hasPendingChanges) {
      setShowDiscardModal(true)
      return
    }
    closeEditor()
  }

  const save = async (): Promise<boolean> => {
    if (saving) return false
    setSaving(true)
    try {
      await persistRows()
      initialIncludedEmployeeIds.current = [...includedEmployeeIds]
      initialRows.current = Object.fromEntries(includedEmployeeIds.map(id => [id, { ...rows[id] }]))
      setDirty(false)
      closeEditor()
      showToast('บันทึกข้อมูลแบบร่างเรียบร้อยแล้ว', 'success')
      // The table is already in its confirmed local state.  Refresh the rest of
      // the page in the background so saving is not delayed by several read APIs.
      void reloadPayroll().catch(() => undefined)
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'บันทึกข้อมูลไม่สำเร็จ', 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  const saveAndCloseEditor = async () => {
    const saved = await save()
    if (saved) setShowDiscardModal(false)
  }
  const createRevision = async () => {
    if (!revisionType) {
      showToast('กรุณาเลือกประเภทการแก้ไข', 'error')
      return
    }
    if (revisionReason.trim().length < 5) {
      showToast('กรุณาระบุเหตุผลการแก้ไขอย่างน้อย 5 ตัวอักษร', 'error')
      return
    }
    if (!dept.databaseId) {
      showToast('ไม่พบรหัสรายการฝ่ายในฐานข้อมูล', 'error')
      return
    }
    try { setCreatingRevision(true); await createPayrollRevision(dept.databaseId, revisionType, revisionReason.trim()); showToast('สร้างฉบับแก้ไขเพิ่มเติมแล้ว กรุณาแก้ไขและส่งอนุมัติใหม่', 'success'); setShowRevisionModal(false); await reloadPayroll() }
    catch (error) { showToast(error instanceof Error ? error.message : 'สร้างฉบับแก้ไขไม่สำเร็จ', 'error') }
    finally { setCreatingRevision(false) }
  }

  const addEmployeeToTable = (employee: Employee) => {
    setRows(previous => ({ ...previous, [employee.id]: previous[employee.id] ?? initialRows.current[employee.id] ?? makeDefaultRow(employee) }))
    setIncludedEmployeeIds(previous => [...previous, employee.id])
    setExcludedEmployeeIds(previous => previous.filter(employeeId => employeeId !== employee.id))
    setDirty(true)
    setEditing(true)
    setInlineAddSearch('')
    setInlineAddOpen(false)
    showToast(`เพิ่ม ${employee.firstName} ${employee.lastName} เข้าตารางแล้ว`, 'success')
  }

  const removeEmployeeFromTable = (employee: Employee) => {
    setIncludedEmployeeIds(previous => previous.filter(employeeId => employeeId !== employee.id))
    setExcludedEmployeeIds(previous => Array.from(new Set([...previous, employee.id])))
    setRows(previous => {
      const next = { ...previous }
      delete next[employee.id]
      return next
    })
    setDirty(true)
    showToast(`นำ ${employee.firstName} ${employee.lastName} ออกจากตารางแล้ว`, 'success')
  }

  const submitForApproval = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      if (!dept.databaseId) throw new Error('ไม่พบรหัสรายการฝ่ายในฐานข้อมูล')
      await persistRows()
      await payrollBatchAction(dept.databaseId, 'submit')
      setPeriods(current => current.map(savedPeriod => savedPeriod.id !== period.id ? savedPeriod : {
        ...savedPeriod,
        depts: savedPeriod.depts.map(savedDept => savedDept.id === dept.id ? { ...savedDept, status: 'pending' } : savedDept),
      }))
      setDirty(false)
      setShowSubmitModal(false)
      showToast('บันทึกและส่งอนุมัติเรียบร้อยแล้ว', 'success')
      setPage('dept-table')
      void reloadPayroll().catch(() => undefined)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'ส่งอนุมัติไม่สำเร็จ', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const totals = useMemo(() => {
    let base = 0, extra = 0, pos = 0, gross = 0, debtKTB = 0, tax = 0, social = 0, funeral = 0, ktb = 0, gsb = 0, deduct = 0, net = 0
    emps.forEach(e => {
      const r = rows[e.id]
      base += e.baseSalary
      extra += r.extra; pos += r.posAllowance; gross += rowGross(e, r)
      debtKTB += r.debtKTB; tax += r.tax; social += r.social; funeral += r.funeral; ktb += r.ktb; gsb += r.gsb
      deduct += rowDeduct(r); net += rowNet(e, r)
    })
    return { base, extra, pos, gross, debtKTB, tax, social, funeral, ktb, gsb, deduct, net }
  }, [rows, emps])

  const handleFocus = useCallback((id: string) => setFocusRow(id), [])
  const handleCommit = useCallback((id: string, field: keyof PayrollRow, val: number) => {
    setCell(id, field, val)
  }, [setCell])

  const exportExcel = () => exportPayrollWorkbook({
    period,
    department: dept.department,
    entries: emps.map(employee => ({ employee, row: rows[employee.id] })),
  })

  const legacyExportExcel = () => {
    const numberCell = (value: number, style = 'Number') => `<Cell ss:StyleID="${style}"><Data ss:Type="Number">${value}</Data></Cell>`
    const textCell = (value: unknown, style = 'Text') => `<Cell ss:StyleID="${style}"><Data ss:Type="String">${escapeMarkup(value)}</Data></Cell>`
    const totalValues = [totals.base, totals.extra, totals.pos, totals.gross, totals.debtKTB, totals.tax, totals.social, totals.funeral, totals.ktb, totals.gsb, totals.deduct, totals.net]
    const dataRows = emps.map((employee, index) => {
      const row = rows[employee.id]
      const gross = rowGross(employee, row)
      const deduct = rowDeduct(row)
      const net = rowNet(employee, row)
      return `<Row>${textCell(index + 1, 'Center')}${textCell(`${employee.title}${employee.firstName} ${employee.lastName}`)}${textCell(employee.position)}${numberCell(employee.baseSalary)}${numberCell(row.extra)}${numberCell(row.posAllowance)}${numberCell(gross)}${numberCell(row.debtKTB)}${numberCell(row.tax)}${numberCell(row.social)}${numberCell(row.funeral)}${numberCell(row.ktb)}${numberCell(row.gsb)}${numberCell(deduct)}${numberCell(net)}</Row>`
    }).join('')
    const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Tahoma" ss:Size="10"/><Alignment ss:Vertical="Center"/></Style>
  <Style ss:ID="Title"><Font ss:FontName="Tahoma" ss:Size="16" ss:Bold="1"/><Alignment ss:Horizontal="Center"/></Style>
  <Style ss:ID="Subtitle"><Font ss:FontName="Tahoma" ss:Size="12" ss:Bold="1"/><Alignment ss:Horizontal="Center"/></Style>
  <Style ss:ID="Header"><Font ss:FontName="Tahoma" ss:Bold="1"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Interior ss:Color="#E8E8E8" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="Text"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="Center"><Alignment ss:Horizontal="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="Number"><NumberFormat ss:Format="#,##0.00"/><Alignment ss:Horizontal="Right"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="Total" ss:Parent="Number"><Font ss:Bold="1"/><Interior ss:Color="#F0F0F0" ss:Pattern="Solid"/></Style>
</Styles>
<Worksheet ss:Name="เงินเดือน ${escapeMarkup(MONTH_TH[period.month])}"><Table>
  <Row><Cell ss:MergeAcross="15" ss:StyleID="Title"><Data ss:Type="String">เทศบาลเมืองตาคลี</Data></Cell></Row>
  <Row><Cell ss:MergeAcross="15" ss:StyleID="Subtitle"><Data ss:Type="String">บัญชีรายละเอียดการจ่ายเงินเดือน ประจำเดือน${escapeMarkup(periodLabel(period))}</Data></Cell></Row>
  <Row><Cell ss:MergeAcross="15" ss:StyleID="Subtitle"><Data ss:Type="String">${escapeMarkup(dept.department)}</Data></Cell></Row>
  <Row></Row>
  <Row><Cell ss:MergeAcross="4" ss:StyleID="Header"><Data ss:Type="String">ข้อมูลพนักงาน</Data></Cell><Cell ss:MergeAcross="2" ss:StyleID="Header"><Data ss:Type="String">รายการรับ</Data></Cell><Cell ss:MergeAcross="6" ss:StyleID="Header"><Data ss:Type="String">รายการหัก</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">ยอดรับสุทธิ</Data></Cell></Row>
  <Row>${['ลำดับ','ชื่อ-นามสกุล','ตำแหน่ง','ฐานเงินเดือน','เงินเพิ่ม','เงินประจำตำแหน่ง','รวมรายการรับ','ชำระหนี้ KTB','ภาษีหัก ณ ที่จ่าย','ประกันสังคม','ฌาปนกิจ','ธนาคารกรุงไทย','ธนาคารออมสิน','รวมรายการหัก','ยอดรับสุทธิ'].map(value => textCell(value, 'Header')).join('')}</Row>
  ${dataRows}
  <Row><Cell ss:MergeAcross="3" ss:StyleID="Header"><Data ss:Type="String">รวมทั้งสิ้น</Data></Cell>${totalValues.map(value => numberCell(value, 'Total')).join('')}</Row>
</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Selected/><FreezePanes/><FrozenNoSplit/><SplitHorizontal>6</SplitHorizontal><TopRowBottomPane>6</TopRowBottomPane><ActivePane>2</ActivePane><PageSetup><Layout x:Orientation="Landscape" xmlns:x="urn:schemas-microsoft-com:office:excel"/></PageSetup></WorksheetOptions></Worksheet>
</Workbook>`
    const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    const safeDepartmentName = dept.department.replace(/[\\/:*?"<>|]/g, '-')
    anchor.download = `ตารางรอบเดือน_${safeDepartmentName}_${MONTH_EN_SHORT[period.month]}.xls`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const printPayrollTable = () => {
    if (!printPayrollTemplateExact({ period, department: dept.department, status: dept.status, entries: emps.map(employee => ({ employee, row: rows[employee.id] })) })) {
      showToast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up', 'error')
    }
  }

  const legacyPrintPayrollTable = () => {
    const printTotalValues = [totals.base, totals.extra, totals.pos, totals.gross, totals.debtKTB, totals.tax, totals.social, totals.funeral, totals.ktb, totals.gsb, totals.deduct, totals.net]
    const printRows = emps.map((employee, index) => {
      const row = rows[employee.id]
      const values = [employee.baseSalary, row.extra, row.posAllowance, rowGross(employee, row), row.debtKTB, row.tax, row.social, row.funeral, row.ktb, row.gsb, rowDeduct(row), rowNet(employee, row)]
      return `<tr><td class="center">${index + 1}</td><td class="employee-name">${escapeMarkup(`${employee.title}${employee.firstName} ${employee.lastName}`)}</td><td>${escapeMarkup(employee.position)}</td>${values.map(value => `<td class="num">${thb(value)}</td>`).join('')}</tr>`
    }).join('')
    const printWindow = window.open('', '_blank', 'width=1200,height=800')
    if (!printWindow) {
      showToast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up', 'error')
      return
    }
    printWindow.opener = null
    printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>บัญชีรายละเอียดการจ่ายเงินเดือน</title><style>
      @page{size:297mm 210mm!important;margin:8mm 7mm!important}@media print{html,body{width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;overflow:visible!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}*{box-sizing:border-box}body{margin:0;color:#000;background:#fff;font-family:Thonburi,Tahoma,sans-serif;font-size:7.2pt}h1,h2,p{margin:0}h1{text-align:center;font-size:13pt;line-height:1.25}h2{text-align:center;font-size:11pt;line-height:1.25}.department{text-align:center;font-size:8.5pt;margin-top:2px}.meta{display:grid;grid-template-columns:repeat(3,1fr);margin:5mm 0 2mm}.meta div:nth-child(2){text-align:center}.meta div:last-child{text-align:right}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:.45pt solid #000;padding:3px 2px;vertical-align:middle;overflow-wrap:anywhere}thead th{background:#ececec;text-align:center;font-weight:600;line-height:1.15;font-size:7pt}thead tr:last-child th:first-child{white-space:nowrap;overflow-wrap:normal;word-break:keep-all;font-size:6.6pt}tbody td,tfoot td{font-size:6.6pt;line-height:1.15;white-space:nowrap;overflow-wrap:normal;word-break:keep-all}td.num{text-align:right;font-variant-numeric:tabular-nums}td.center{text-align:center}tfoot td{background:#f3f3f3;font-weight:600;border-top:1pt solid #000;border-bottom:1pt solid #000}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:16mm;margin-top:9mm;text-align:center;line-height:1.65}col.c1{width:3.4%}col.c2{width:4.8%}col.c3{width:11.5%}col.c4{width:7.6%}col.c5{width:7.3%}col.c6{width:6.4%}col.c7{width:7.4%}col.c8{width:7.4%}col.c9{width:6.4%}col.c10{width:6.4%}col.c11{width:6.4%}col.c12{width:6.4%}col.c13{width:6.4%}col.c14{width:6.4%}col.c15{width:7.4%}col.c16{width:7.7%}
    </style></head><body><h1>เทศบาลเมืองตาคลี</h1><h2>รายงานการปรับปรุงข้อมูลเงินเดือน</h2><p class="department">${escapeMarkup(dept.department)} · ประจำเดือน ${escapeMarkup(periodLabel(period))}</p><div class="meta"><div><b>วันที่จ่าย:</b> ${escapeMarkup(new Date(period.payDate).toLocaleDateString('th-TH', { dateStyle: 'long' }))}</div><div><b>จำนวนพนักงาน:</b> ${emps.length} คน</div><div><b>สถานะ:</b> ${escapeMarkup(statusLabel[dept.status])}</div></div><table><colgroup>${Array.from({ length: 16 }, (_, index) => `<col class="c${index + 1}">`).join('')}</colgroup><thead><tr><th colspan="5">ข้อมูลพนักงาน</th><th colspan="3">รายการรับ</th><th colspan="7">รายการหัก</th><th>ยอดรับสุทธิ</th></tr><tr>${PAYROLL_REPORT_COLUMNS.map(value => `<th>${value}</th>`).join('')}</tr></thead><tbody>${printRows}</tbody><tfoot><tr><td colspan="4">รวมทั้งสิ้น</td>${printTotalValues.map(value => `<td class="num">${thb(value)}</td>`).join('')}</tr></tfoot></table><div class="signatures"><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้จัดทำ</div><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้ตรวจสอบ</div><div>ลงชื่อ ........................................................<br>(........................................................)<br>ผู้อนุมัติ</div></div><script>window.addEventListener('load',()=>{window.print();window.addEventListener('afterprint',()=>window.close())})<\/script></body></html>`)
    printWindow.document.close()
  }

  return (
    <div className="anim">
      <PageHeader
        title={dept.department}
        breadcrumb={<Crumb items={[
          { label: 'รอบเงินเดือน', onClick: () => setPage('periods') },
          { label: periodLabel(period), onClick: () => setPage('periods') },
          { label: dept.department },
        ]} />}
        actions={!isReadonly ? (
          <>
            {dept.status !== 'pending' && <button className="btn btn-primary" aria-busy={saving} onClick={() => void save().then(saved => { if (saved) setShowSubmitModal(true) })} disabled={saving}><BusyLabel busy={saving} label="กำลังบันทึก…">บันทึกและส่งอนุมัติ</BusyLabel></button>}
          </>
        ) : <StatusBadge s={dept.status} />}
      />

      {/* Rejection notice */}
      {dept.status === 'rejected' && dept.rejectionReason && (
        <div style={{ background: 'var(--status-rejected-bg)', border: '1px solid var(--status-rejected-border)', borderRadius: 'var(--radius-sm)', padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--status-rejected-text)' }}>
          <strong>เหตุผลที่ไม่อนุมัติ:</strong> {dept.rejectionReason}
        </div>
      )}
      {(dept.revisionNumber ?? 0) > 0 && (
        <div style={{ background: '#F6F3FF', border: '1px solid #D9CBFF', borderRadius: 'var(--radius-sm)', padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#4D3A78' }}>
          <strong>ฉบับแก้ไขเพิ่มเติม ครั้งที่ {dept.revisionNumber}</strong>
          {dept.revisionType ? <> · {dept.revisionType}</> : null}
          {dept.revisionReason ? <><br />เหตุผล: {dept.revisionReason}</> : null}
          {dept.revisionCreatedBy ? <> · สร้างโดย {dept.revisionCreatedBy}</> : null}
        </div>
      )}

      <div className="card" style={{ padding: '12px 14px', marginBottom: 16 }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap" style={{ flex: 1 }}>
            <input className="inp" style={{ maxWidth: 300 }} value={search} onChange={event => setSearch(event.target.value)} placeholder="🔍 ค้นหาชื่อพนักงาน" />
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{visibleEmployees.length} รายการ</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn btn-secondary" onClick={printPayrollTable}>🖨️ พิมพ์ตาราง</button>
            <button className="btn btn-secondary" onClick={exportExcel}>📥 ส่งออก Excel</button>
            <button className="btn btn-secondary" onClick={() => {
              if (dept.status === 'approved' || dept.status === 'closed') {
                setRevisionType('')
                setRevisionReason('')
                setShowRevisionModal(true)
                return
              }
              if (isReadonly) {
                setShowLockedEditModal(true)
                return
              }
              if (editing) requestCloseEditor()
              else setEditing(true)
            }} title={isReadonly ? 'รอบนี้ถูกล็อก ไม่สามารถแก้ไขข้อมูลได้' : undefined} style={editing ? {
              color: '#A85B00',
              border: '2px solid #E4A11B',
              background: '#FFF8E8',
              boxShadow: '0 1px 4px rgba(168,91,0,.12)',
            } : undefined}>
              {dept.status === 'approved' || dept.status === 'closed'
                ? '✏️ แก้ไขเพิ่มเติม'
                : editing
                ? `✏️ ปิดการแก้ไข${hasPendingChanges ? ` · ${pendingChangeCount} รายการแก้ไข` : ''}`
                : '✏️ แก้ไขข้อมูล'}
            </button>
            <button className="btn btn-primary" aria-busy={saving} onClick={() => void save()} disabled={isReadonly || !hasPendingChanges || saving} title={isReadonly ? 'รอบนี้ถูกล็อก ไม่สามารถบันทึกข้อมูลได้' : undefined}><BusyLabel busy={saving} label="กำลังบันทึก…">💾 บันทึก</BusyLabel></button>
          </div>
        </div>
      </div>

      {/* Compact period metadata */}
      <div className="payroll-period-meta">
        <span>📅 วันที่จ่าย {formatBuddhistDate(period.payDate)}</span>
        <span>👥 {emps.length} คน</span>
        <span>🕘 แก้ไขล่าสุด {formatBuddhistDateTime(dept.updatedAt)}</span>
        <StatusBadge s={dept.status} />
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table className="tbl payroll-detail-table" style={{ minWidth: 1200 }}>
          <thead>
            <tr>
              <th colSpan={4} className="th-group th-group-emp">ข้อมูลพนักงาน</th>
              <th colSpan={3} className="th-group th-group-income">รายการรับ</th>
              <th colSpan={7} className="th-group th-group-deduct">รายการหัก</th>
              <th colSpan={1} className="th-group th-group-net">ยอดรับสุทธิ</th>
              {editing && !isReadonly && <th rowSpan={2} className="th-group th-group-emp" style={{ minWidth: 88 }}>ดำเนินการ</th>}
            </tr>
            <tr>
              {/* Emp */}
              <th className="th-emp">#</th>
              <th className="th-emp">ชื่อ–นามสกุล</th>
              <th className="th-emp">ตำแหน่ง</th>
              <th className="th-emp" style={{ textAlign: 'right' }}>ฐานเงินเดือน</th>
              {/* Income */}
              <th className="th-income" style={{ textAlign: 'right' }}>เงินเพิ่ม</th>
              <th className="th-income" style={{ textAlign: 'right' }}>เงินประจำตำแหน่ง</th>
              <th className="th-income" style={{ textAlign: 'right' }}>รวมรายการรับ</th>
              {/* Deduct */}
              <th className="th-deduct" style={{ textAlign: 'right' }}>ชำระหนี้ KTB</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>ภาษีหัก ณ ที่จ่าย</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>ประกันสังคม</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>ฌาปนกิจ</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>ธนาคารกรุงไทย</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>ธนาคารออมสิน</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>รวมรายการหัก</th>
              {/* Net */}
              <th className="th-net" style={{ textAlign: 'right' }}>ยอดรับสุทธิ</th>
            </tr>
          </thead>
          <tbody>
            {visibleEmployees.map((e, idx) => {
              const r = rows[e.id]
              const g = rowGross(e, r), d = rowDeduct(r), n = rowNet(e, r)
              const isActive = focusRow === e.id
              return (
                <tr key={e.id} className={isActive ? 'editing' : ''}>
                  <td className="readonly" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{idx + 1}</td>
                  <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{e.title}{e.firstName} {e.lastName}</td>
                  <td className="readonly" style={{ fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{e.position}</td>
                  <td className="num readonly">{thb(e.baseSalary)}</td>
                  <CellInput empId={e.id} field="extra"        value={r.extra}        isReadonly={isReadonly || !editing} onFocus={handleFocus} onCommit={handleCommit} />
                  <CellInput empId={e.id} field="posAllowance" value={r.posAllowance} isReadonly={isReadonly || !editing} onFocus={handleFocus} onCommit={handleCommit} />
                  <td className="num total" style={{ background: '#F0FDF4', color: '#15803D' }}>{thb(g)}</td>
                  <CellInput empId={e.id} field="debtKTB" value={r.debtKTB} isReadonly={isReadonly || !editing} onFocus={handleFocus} onCommit={handleCommit} />
                  <CellInput empId={e.id} field="tax"     value={r.tax}     isReadonly={isReadonly || !editing} onFocus={handleFocus} onCommit={handleCommit} />
                  <CellInput empId={e.id} field="social"  value={r.social}  isReadonly={isReadonly || !editing} onFocus={handleFocus} onCommit={handleCommit} />
                  <CellInput empId={e.id} field="funeral" value={r.funeral} isReadonly={isReadonly || !editing} onFocus={handleFocus} onCommit={handleCommit} />
                  <CellInput empId={e.id} field="ktb"     value={r.ktb}     isReadonly={isReadonly || !editing} onFocus={handleFocus} onCommit={handleCommit} />
                  <CellInput empId={e.id} field="gsb"     value={r.gsb}     isReadonly={isReadonly || !editing} onFocus={handleFocus} onCommit={handleCommit} />
                  <td className="num total" style={{ background: '#FFF8F6', color: '#B91C1C' }}>{thb(d)}</td>
                  <td className="num total" style={{ background: '#F5F3FF', color: 'var(--purple-600)', fontFamily: 'var(--font-display)' }}>{thb(n)}</td>
                  {editing && !isReadonly && (
                    <td className="readonly" style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-danger btn-xs" onClick={() => removeEmployeeFromTable(e)}>ลบ</button>
                    </td>
                  )}
                </tr>
              )
            })}
            {editing && !isReadonly && (
              <tr className="payroll-inline-add-row" style={{ background: 'rgba(240,236,251,0.35)', borderTop: '2px dashed rgba(124,92,191,0.25)' }}>
                <td colSpan={2} style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--purple-600)', marginBottom: 6, fontWeight: 700 }}>+ เพิ่มพนักงาน</div>
                  <div ref={inlineAddRef} style={{ position: 'relative', width: '100%' }}>
                    <input
                      className="inp"
                      placeholder="พิมพ์ชื่อพนักงาน"
                      value={inlineAddSearch}
                      onChange={event => { setInlineAddSearch(event.target.value); openInlineDropdown() }}
                      onFocus={() => inlineAddSearch && openInlineDropdown()}
                      style={{ fontSize: 12, padding: '7px 10px', width: '100%' }}
                    />
                  </div>
                </td>
                <td colSpan={13} />
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ fontWeight: 700 }}>รวมทั้งสิ้น</td>
              <td className="num">{thb(totals.base)}</td>
              <td className="num">{thb(totals.extra)}</td>
              <td className="num">{thb(totals.pos)}</td>
              <td className="num" style={{ color: '#15803D' }}>{thb(totals.gross)}</td>
              <td className="num">{thb(totals.debtKTB)}</td>
              <td className="num">{thb(totals.tax)}</td>
              <td className="num">{thb(totals.social)}</td>
              <td className="num">{thb(totals.funeral)}</td>
              <td className="num">{thb(totals.ktb)}</td>
              <td className="num">{thb(totals.gsb)}</td>
              <td className="num" style={{ color: '#B91C1C' }}>{thb(totals.deduct)}</td>
              <td className="num" style={{ color: 'var(--purple-600)' }}>{thb(totals.net)}</td>
              {editing && !isReadonly && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {inlineAddOpen && inlineAddPosition && createPortal(
        <div ref={inlineDropdownRef} style={{
          position: 'fixed', top: inlineAddPosition.top, left: inlineAddPosition.left,
          width: inlineAddPosition.width, maxHeight: 230, overflowY: 'auto', zIndex: 1000,
          background: 'rgba(255,255,255,.98)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(196,181,240,.5)', borderRadius: 12,
          boxShadow: '0 8px 24px rgba(124,92,191,.18)',
        }}>
          {!inlineAddSearch.trim() ? (
            <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              พิมพ์ชื่อพนักงานเพื่อค้นหา
            </div>
          ) : inlineCandidates.length === 0 ? (
            <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              ไม่พบพนักงานที่ยังไม่อยู่ในตาราง
            </div>
          ) : inlineCandidates.map(employee => (
            <button key={employee.id} type="button" onMouseDown={() => addEmployeeToTable(employee)} style={{
              display: 'block', width: '100%', border: 0, borderBottom: '1px solid rgba(200,190,240,.18)',
              background: 'transparent', padding: '10px 14px', textAlign: 'left', cursor: 'pointer',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{employee.title}{employee.firstName} {employee.lastName}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 2, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>{employee.position}</span>
              </div>
            </button>
          ))}
        </div>,
        document.body,
      )}

      {showDiscardModal && (
        <Modal title="มีรายการแก้ไขที่ยังไม่ได้บันทึก" onClose={() => setShowDiscardModal(false)}>
          <div className="flex flex-col gap-4">
            <div style={{ background: 'var(--status-pending-bg)', border: '1px solid var(--status-pending-border)', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: 'var(--status-pending-text)' }}>
              คุณมี <strong>{pendingChangeCount} รายการ</strong> ที่ยังไม่ได้บันทึก หากปิดการแก้ไขโดยไม่บันทึก ระบบจะคืนตารางเป็นข้อมูลล่าสุดที่บันทึกไว้
            </div>
            <div className="flex gap-3 justify-end flex-wrap">
              <button className="btn btn-secondary" onClick={() => setShowDiscardModal(false)}>กลับไปแก้ไข</button>
              <button className="btn btn-secondary" onClick={discardUnsavedChanges}>ไม่บันทึก</button>
              <button className="btn btn-primary" aria-busy={saving} disabled={saving} onClick={() => void saveAndCloseEditor()}><BusyLabel busy={saving} label="กำลังบันทึก…">💾 บันทึกและออก</BusyLabel></button>
            </div>
          </div>
        </Modal>
      )}

      {showLockedEditModal && (
        <Modal title={dept.status === 'pending' ? 'กำลังรอการอนุมัติ' : 'รอบเงินเดือนถูกล็อก'} onClose={() => setShowLockedEditModal(false)}>
          <div className="flex flex-col gap-4">
            <div style={{ background: 'var(--status-pending-bg)', border: '1px solid var(--status-pending-border)', borderRadius: 10, padding: '14px 16px', fontSize: 13, lineHeight: 1.7, color: 'var(--status-pending-text)' }}>
              {dept.status === 'pending'
                ? <>รอบเงินเดือนของ <strong>{dept.department}</strong> ถูกส่งให้ผู้บริหารพิจารณาแล้ว จึงยังไม่สามารถแก้ไขข้อมูลได้<br />กรุณารอผลการอนุมัติ หรือรอให้ส่งกลับมาแก้ไขก่อน</>
                : <>รอบเงินเดือนนี้อยู่ในสถานะ <strong>{statusLabel[dept.status]}</strong> จึงไม่สามารถแก้ไขข้อมูลได้</>}
            </div>
            <div className="flex justify-end">
              <button className="btn btn-primary" onClick={() => setShowLockedEditModal(false)}>รับทราบ</button>
            </div>
          </div>
        </Modal>
      )}

      {showRevisionModal && <Modal title="แก้ไขเพิ่มเติมหลังอนุมัติ" onClose={() => !creatingRevision && setShowRevisionModal(false)}><div className="flex flex-col gap-4"><div style={{ background: '#F6F3FF', borderRadius: 10, padding: 13, fontSize: 13, lineHeight: 1.65 }}>ระบบจะสร้างฉบับแก้ไขใหม่เฉพาะ <strong>{dept.department}</strong> ของรอบ <strong>{periodLabel(period)}</strong> โดยเก็บฉบับเดิมไว้เป็นประวัติ</div><FormField label="ประเภทการแก้ไข" required><AppSelect className="inp" value={revisionType} onChange={e => setRevisionType(e.target.value)}><option value="">เลือกประเภทการแก้ไข</option><option>เพิ่มพนักงานกลางเดือน</option><option>แก้ไขรายการรับหรือรายการหัก</option><option>พนักงานลาออกหรือปรับยอดสุดท้าย</option><option>อื่น ๆ</option></AppSelect></FormField><FormField label="เหตุผลการแก้ไข" required><textarea className="inp" rows={3} value={revisionReason} onChange={e => setRevisionReason(e.target.value)} placeholder="ระบุเหตุผลอย่างน้อย 5 ตัวอักษร" /></FormField><div className="flex justify-end gap-3"><button className="btn btn-secondary" disabled={creatingRevision} onClick={() => setShowRevisionModal(false)}>ยกเลิก</button><button className="btn btn-primary" aria-busy={creatingRevision} disabled={creatingRevision} onClick={() => void createRevision()}><BusyLabel busy={creatingRevision} label="กำลังสร้าง…">สร้างฉบับแก้ไข</BusyLabel></button></div></div></Modal>}

      {/* Submit modal */}
      {showSubmitModal && (
        <Modal title="ยืนยันการส่งอนุมัติ" onClose={() => setShowSubmitModal(false)}>
          <div className="flex flex-col gap-4">
            <div style={{ background: '#F8F9FC', borderRadius: 12, padding: 16 }}>
              {[
                ['ฝ่าย', dept.department],
                ['รอบเงินเดือน', periodLabel(period)],
                ['จำนวนพนักงาน', `${emps.length} คน`],
                ['รายการรับรวม', `${thb(totals.gross)} บาท`],
                ['รายการหักรวม', `${thb(totals.deduct)} บาท`],
                ['ยอดรับสุทธิรวม', `${thb(totals.net)} บาท`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between items-center py-1.5" style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{k}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ background: 'var(--status-pending-bg)', border: '1px solid var(--status-pending-border)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--status-pending-text)' }}>
              หลังจากส่งอนุมัติแล้ว ท่านจะไม่สามารถแก้ไขข้อมูลได้ จนกว่าผู้บริหารจะไม่อนุมัติหรือส่งกลับมาแก้ไข
            </div>
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" disabled={submitting} onClick={() => setShowSubmitModal(false)}>ยกเลิก</button>
              <button className="btn btn-primary" aria-busy={submitting} disabled={submitting} onClick={submitForApproval}><BusyLabel busy={submitting} label="กำลังส่ง…">ยืนยันส่งอนุมัติ</BusyLabel></button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Director Approvals ───────────────────────────────────────────────────────

function DirectorApprovals({ periods, setPage, setActivePeriodId, setActiveDeptId }: {
  periods: PayrollPeriod[]; setPage: (p: Page) => void; setActivePeriodId: (id: string) => void; setActiveDeptId: (id: string) => void;
}) {
  const [filterPeriod, setFilterPeriod] = useState('all')
  const [filterDept, setFilterDept] = useState('all')
  const [filterStatus, setFilterStatus] = useState<DeptStatus | 'all'>('pending')
  const [search, setSearch] = useState('')

  const allDepts = useMemo(() =>
    periods.flatMap(p => p.depts.map(d => ({ period: p, dept: d }))),
    [periods]
  )

  const filtered = useMemo(() => allDepts.filter(({ period: p, dept: d }) => {
    if (filterPeriod !== 'all' && p.id !== filterPeriod) return false
    if (filterDept !== 'all' && d.department !== filterDept) return false
    if (filterStatus !== 'all' && d.status !== filterStatus) return false
    if (search && !d.department.includes(search)) return false
    return true
  }), [allDepts, filterPeriod, filterDept, filterStatus, search])

  return (
    <div className="anim">
      <PageHeader title="อนุมัติเงินเดือน" subtitle="ตรวจสอบและอนุมัติข้อมูลเงินเดือนแยกตามฝ่าย" />
      {/* Filters */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <input className="inp" style={{ maxWidth: 200 }} placeholder="ค้นหาฝ่าย..." value={search} onChange={e => setSearch(e.target.value)} />
          <AppSelect className="inp" style={{ maxWidth: 180 }} value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}>
            <option value="all">ทุกรอบ</option>
            {periods.map(p => <option key={p.id} value={p.id}>{periodLabel(p)}</option>)}
          </AppSelect>
          <AppSelect className="inp" style={{ maxWidth: 220 }} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
            <option value="all">ทุกฝ่าย</option>
            {[...new Set(allDepts.map(({ dept }) => dept.department))].map(d => <option key={d} value={d}>{d}</option>)}
          </AppSelect>
          <AppSelect className="inp" style={{ maxWidth: 160 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value as DeptStatus | 'all')}>
            <option value="all">ทุกสถานะ</option>
            <option value="pending">รออนุมัติ</option>
            <option value="approved">อนุมัติแล้ว</option>
            <option value="rejected">ไม่อนุมัติ</option>
          </AppSelect>
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterPeriod('all'); setFilterDept('all'); setFilterStatus('pending') }}>ล้างตัวกรอง</button>
        </div>
      </div>
      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>รอบเงินเดือน</th>
              <th>ฝ่าย</th>
              <th style={{ textAlign: 'center' }}>พนักงาน</th>
              <th style={{ textAlign: 'right' }}>รายการรับรวม</th>
              <th style={{ textAlign: 'right' }}>รายการหักรวม</th>
              <th style={{ textAlign: 'right' }}>ยอดรับสุทธิรวม</th>
              <th>ผู้ส่งอนุมัติ</th>
              <th>วันที่ส่ง</th>
              <th>สถานะ</th>
              <th>ดำเนินการ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={10}><div className="empty-state"><div className="empty-icon">◫</div><div>ไม่พบรายการที่ตรงกับเงื่อนไข</div></div></td></tr>
            )}
            {filtered.map(({ period: p, dept: d }) => {
              const t = deptTotals(d)
              return (
                <tr key={d.id}>
                  <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{periodLabel(p)}</td>
                  <td style={{ fontWeight: 600 }}>{d.department}</td>
                  <td style={{ textAlign: 'center' }}>{t.count}</td>
                  <td className="num">{thb(t.totalGross)}</td>
                  <td className="num">{thb(t.totalDeduct)}</td>
                  <td className="num total">{thb(t.totalNet)}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{d.submittedBy ?? '–'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.submittedAt ? formatBuddhistDate(d.submittedAt) : '–'}</td>
                  <td><StatusBadge s={d.status} /></td>
                  <td>
                    <button className="btn btn-secondary btn-xs" onClick={() => { setActivePeriodId(p.id); setActiveDeptId(d.id); setPage('director-detail') }}>ดูรายละเอียด</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Director Detail ──────────────────────────────────────────────────────────

function DirectorDetail({ period, dept, setPeriods, setPage, showToast, reloadPayroll }: {
  period: PayrollPeriod; dept: DeptPayroll; setPeriods: React.Dispatch<React.SetStateAction<PayrollPeriod[]>>;
  setPage: (p: Page) => void; showToast: (msg: string, t?: 'success' | 'error') => void; reloadPayroll: () => Promise<void>;
}) {
  const emps = useMemo(() => deptEmps(dept), [dept])
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [search, setSearch] = useState('')
  const [processingDecision, setProcessingDecision] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyBatches, setHistoryBatches] = useState<DeptPayroll[]>([])
  const [historicBatch, setHistoricBatch] = useState<DeptPayroll | null>(null)

  const t = useMemo(() => deptTotals(dept), [dept])
  const visibleEmployees = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return emps
    return emps.filter(employee => `${employee.firstName} ${employee.lastName}`.toLowerCase().includes(keyword))
  }, [emps, search])

  const exportExcel = () => exportPayrollWorkbook({
    period,
    department: dept.department,
    entries: visibleEmployees.map(employee => ({ employee, row: dept.rows[employee.id] ?? makeDefaultRow(employee) })),
  })

  const legacyExportExcel = () => {
    const escapeCell = (value: unknown) => String(value ?? '').replace(/[\t\r\n]/g, ' ')
    const columns = ['ลำดับ', 'ชื่อ-นามสกุล', 'ตำแหน่ง', 'ฐานเงินเดือน', 'เงินเพิ่ม', 'เงินประจำตำแหน่ง', 'รวมรายการรับ', 'ชำระหนี้ KTB', 'ภาษีหัก ณ ที่จ่าย', 'ประกันสังคม', 'ฌาปนกิจ', 'ธนาคารกรุงไทย', 'ธนาคารออมสิน', 'รวมรายการหัก', 'ยอดรับสุทธิ']
    const rows = visibleEmployees.map((employee, index) => {
      const row = dept.rows[employee.id] ?? makeDefaultRow(employee)
      return [index + 1, `${employee.title}${employee.firstName} ${employee.lastName}`, employee.position, employee.baseSalary, row.extra, row.posAllowance, rowGross(employee, row), row.debtKTB, row.tax, row.social, row.funeral, row.ktb, row.gsb, rowDeduct(row), rowNet(employee, row)]
    })
    const content = `\ufeff${[columns, ...rows].map(row => row.map(escapeCell).join('\t')).join('\n')}`
    const url = URL.createObjectURL(new Blob([content], { type: 'application/vnd.ms-excel;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `payroll-${period.year}-${String(period.month).padStart(2, '0')}-${dept.department}.xls`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const printPayrollTable = () => {
    if (!printPayrollTemplateExact({ period, department: dept.department, status: dept.status, entries: visibleEmployees.map(employee => ({ employee, row: dept.rows[employee.id] ?? makeDefaultRow(employee) })) })) {
      showToast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up', 'error')
    }
  }

  const legacyPrintPayrollTable = () => {
    const printWindow = window.open('', '_blank', 'width=1200,height=800')
    if (!printWindow) { showToast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up', 'error'); return }
    const escapeMarkup = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const body = visibleEmployees.map((employee, index) => {
      const row = dept.rows[employee.id] ?? makeDefaultRow(employee)
      const values = [employee.baseSalary, row.extra, row.posAllowance, rowGross(employee, row), row.debtKTB, row.tax, row.social, row.funeral, row.ktb, row.gsb, rowDeduct(row), rowNet(employee, row)]
      return `<tr><td>${index + 1}</td><td>${escapeMarkup(`${employee.title}${employee.firstName} ${employee.lastName}`)}</td><td>${escapeMarkup(employee.position)}</td>${values.map(value => `<td class="num">${thb(value)}</td>`).join('')}</tr>`
    }).join('')
    printWindow.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>บัญชีรายละเอียดการจ่ายเงินเดือน</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:Tahoma,sans-serif;color:#000;font-size:8pt}h1,h2,p{text-align:center;margin:0}h1{font-size:14pt}h2{font-size:11pt}.meta{margin:5mm 0}table{width:100%;border-collapse:collapse}th,td{border:.5pt solid #000;padding:3px}th{background:#eee;text-align:center}.num{text-align:right}tfoot td{font-weight:bold;background:#eee}</style></head><body><h1>เทศบาลเมืองตาคลี</h1><h2>บัญชีรายละเอียดการจ่ายเงินเดือน ประจำเดือน${escapeMarkup(periodLabel(period))}</h2><p>${escapeMarkup(dept.department)}</p><p class="meta">วันที่จ่าย ${escapeMarkup(new Date(period.payDate).toLocaleDateString('th-TH'))} · จำนวนพนักงาน ${visibleEmployees.length} คน</p><table><thead><tr><th>#</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>ฐานเงินเดือน</th><th>เงินเพิ่ม</th><th>เงินประจำตำแหน่ง</th><th>รวมรายการรับ</th><th>ชำระหนี้ KTB</th><th>ภาษี</th><th>ประกันสังคม</th><th>ฌาปนกิจ</th><th>ธ.กรุงไทย</th><th>ธ.ออมสิน</th><th>รวมรายการหัก</th><th>ยอดสุทธิ</th></tr></thead><tbody>${body}</tbody></table><script>window.addEventListener('load',()=>window.print())<\/script></body></html>`)
    printWindow.document.close()
  }

  const handleApprove = async () => {
    if (processingDecision) return
    setProcessingDecision(true)
    try {
      if (!dept.databaseId) throw new Error('ไม่พบรหัสรายการฝ่ายในฐานข้อมูล')
      await payrollBatchAction(dept.databaseId, 'approve')
      setPeriods(current => current.map(savedPeriod => savedPeriod.id !== period.id ? savedPeriod : {
        ...savedPeriod,
        depts: savedPeriod.depts.map(savedDept => savedDept.id === dept.id ? { ...savedDept, status: 'approved' } : savedDept),
      }))
      setShowApproveModal(false)
      showToast('อนุมัติเรียบร้อยแล้ว และบันทึกสถานะอีเมลลงฐานข้อมูลแล้ว', 'success')
      setPage('dashboard')
      void reloadPayroll().catch(() => undefined)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'อนุมัติไม่สำเร็จ', 'error')
    } finally {
      setProcessingDecision(false)
    }
  }

  const handleReject = async () => {
    if (!rejectReason.trim()) return
    if (processingDecision) return
    setProcessingDecision(true)
    try {
      if (!dept.databaseId) throw new Error('ไม่พบรหัสรายการฝ่ายในฐานข้อมูล')
      await payrollBatchAction(dept.databaseId, 'reject', rejectReason)
      setPeriods(current => current.map(savedPeriod => savedPeriod.id !== period.id ? savedPeriod : {
        ...savedPeriod,
        depts: savedPeriod.depts.map(savedDept => savedDept.id === dept.id ? { ...savedDept, status: 'rejected', rejectionReason: rejectReason } : savedDept),
      }))
      setShowRejectModal(false)
      showToast('ส่งกลับไปให้พนักงานฝ่ายธุรการแก้ไขแล้ว', 'error')
      setPage('dashboard')
      void reloadPayroll().catch(() => undefined)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'ส่งกลับแก้ไขไม่สำเร็จ', 'error')
    } finally {
      setProcessingDecision(false)
    }
  }

  const openHistory = async () => {
    if (!dept.databaseId) return
    setHistoryOpen(true)
    setHistoryError('')
    setHistoryLoading(true)
    try {
      const records = await getPayrollBatchHistory(dept.databaseId)
      setHistoryBatches(records.map(record => mapPayrollHistoryBatch(record, period)))
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'ไม่สามารถโหลดประวัติฉบับเงินเดือนได้')
    } finally {
      setHistoryLoading(false)
    }
  }

  if (historicBatch) {
    return <HistoricPayrollView period={period} dept={historicBatch} onBack={() => setHistoricBatch(null)} />
  }

  return (
    <div className="anim">
      <PageHeader
        title={dept.department}
        subtitle={`${periodLabel(period)} · ส่งโดย ${dept.submittedBy ?? '–'} · ${dept.submittedAt ? formatBuddhistDate(dept.submittedAt) : ''}`}
        breadcrumb={<Crumb items={[{ label: 'หน้าหลัก', onClick: () => setPage('dashboard') }, { label: dept.department }]} />}
        actions={dept.status === 'pending' ? (
          <>
            <button className="btn btn-danger" onClick={() => setShowRejectModal(true)}>✕ ไม่อนุมัติ</button>
            <button className="btn btn-approve" onClick={() => setShowApproveModal(true)}>✓ อนุมัติ</button>
          </>
        ) : <StatusBadge s={dept.status} />}
      />

      {(dept.revisionNumber ?? 0) > 0 && (
        <div style={{ background: '#F6F3FF', border: '1px solid #D9CBFF', borderRadius: 'var(--radius-sm)', padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#4D3A78', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div><strong>ฉบับแก้ไขเพิ่มเติม ครั้งที่ {dept.revisionNumber}</strong>
            {dept.revisionType ? <> · {dept.revisionType}</> : null}
            {dept.revisionReason ? <><br />เหตุผล: {dept.revisionReason}</> : null}
            {dept.revisionCreatedBy ? <> · สร้างโดย {dept.revisionCreatedBy}</> : null}
          </div>
          <button className="btn btn-secondary btn-sm" aria-busy={historyLoading} disabled={historyLoading} onClick={() => void openHistory()}><BusyLabel busy={historyLoading} label="กำลังโหลด…">🗂️ ดูประวัติฉบับก่อน</BusyLabel></button>
        </div>
      )}

      <div className="card" style={{ padding: '12px 14px', marginBottom: 16 }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap" style={{ flex: 1 }}>
            <input className="inp" style={{ maxWidth: 300 }} value={search} onChange={event => setSearch(event.target.value)} placeholder="🔍 ค้นหาชื่อพนักงาน" />
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{visibleEmployees.length} รายการ</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn btn-secondary" onClick={printPayrollTable}>🖨️ พิมพ์ตาราง</button>
            <button className="btn btn-secondary" onClick={exportExcel}>📥 ส่งออก Excel</button>
          </div>
        </div>
      </div>

      <div className="payroll-period-meta">
        <span>📅 วันที่จ่าย {formatBuddhistDate(period.payDate)}</span>
        <span>👥 {emps.length} คน</span>
        <span>🕘 แก้ไขล่าสุด {formatBuddhistDateTime(dept.updatedAt)}</span>
        <StatusBadge s={dept.status} />
      </div>

      {/* Read-only table */}
      <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table className="tbl payroll-detail-table" style={{ minWidth: 1200 }}>
          <thead>
            <tr>
              <th colSpan={4} className="th-group th-group-emp">ข้อมูลพนักงาน</th>
              <th colSpan={3} className="th-group th-group-income">รายการรับ</th>
              <th colSpan={7} className="th-group th-group-deduct">รายการหัก</th>
              <th colSpan={1} className="th-group th-group-net">ยอดรับสุทธิ</th>
            </tr>
            <tr>
              <th className="th-emp">#</th>
              <th className="th-emp">ชื่อ–นามสกุล</th>
              <th className="th-emp">ตำแหน่ง</th>
              <th className="th-emp" style={{ textAlign: 'right' }}>ฐานเงินเดือน</th>
              <th className="th-income" style={{ textAlign: 'right' }}>เงินเพิ่ม</th>
              <th className="th-income" style={{ textAlign: 'right' }}>เงินประจำตำแหน่ง</th>
              <th className="th-income" style={{ textAlign: 'right' }}>รวมรายการรับ</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>ชำระหนี้ KTB</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>ภาษีหัก ณ ที่จ่าย</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>ประกันสังคม</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>ฌาปนกิจ</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>ธนาคารกรุงไทย</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>ธนาคารออมสิน</th>
              <th className="th-deduct" style={{ textAlign: 'right' }}>รวมรายการหัก</th>
              <th className="th-net" style={{ textAlign: 'right' }}>ยอดรับสุทธิ</th>
            </tr>
          </thead>
          <tbody>
            {visibleEmployees.map((e, idx) => {
              const r = dept.rows[e.id] ?? makeDefaultRow(e)
              const g = rowGross(e, r), d = rowDeduct(r), n = rowNet(e, r)
              return (
                <tr key={e.id}>
                  <td className="readonly" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{idx + 1}</td>
                  <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{e.title}{e.firstName} {e.lastName}</td>
                  <td className="readonly" style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{e.position}</td>
                  <td className="num readonly">{thb(e.baseSalary)}</td>
                  <td className="num readonly">{thb(r.extra)}</td>
                  <td className="num readonly">{thb(r.posAllowance)}</td>
                  <td className="num total" style={{ background: '#F0FDF4', color: '#15803D' }}>{thb(g)}</td>
                  <td className="num readonly">{thb(r.debtKTB)}</td>
                  <td className="num readonly">{thb(r.tax)}</td>
                  <td className="num readonly">{thb(r.social)}</td>
                  <td className="num readonly">{thb(r.funeral)}</td>
                  <td className="num readonly">{thb(r.ktb)}</td>
                  <td className="num readonly">{thb(r.gsb)}</td>
                  <td className="num total" style={{ background: '#FFF8F6', color: '#B91C1C' }}>{thb(d)}</td>
                  <td className="num total" style={{ background: '#F5F3FF', color: 'var(--purple-600)', fontFamily: 'var(--font-display)' }}>{thb(n)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ fontWeight: 700 }}>รวมทั้งสิ้น</td>
              <td className="num">{thb(t.totalBase)}</td>
              <td className="num">{thb(t.totalExtra)}</td>
              <td className="num">{thb(t.totalPos)}</td>
              <td className="num" style={{ color: '#15803D' }}>{thb(t.totalGross)}</td>
              <td className="num">{thb(t.totalDebtKTB)}</td>
              <td className="num">{thb(t.totalTax)}</td>
              <td className="num">{thb(t.totalSocial)}</td>
              <td className="num">{thb(t.totalFuneral)}</td>
              <td className="num">{thb(t.totalKTB)}</td>
              <td className="num">{thb(t.totalGSB)}</td>
              <td className="num" style={{ color: '#B91C1C' }}>{thb(t.totalDeduct)}</td>
              <td className="num" style={{ color: 'var(--purple-600)' }}>{thb(t.totalNet)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Approve modal */}
      {showApproveModal && (
        <Modal title="ยืนยันการอนุมัติข้อมูลเงินเดือน" onClose={() => setShowApproveModal(false)}>
          <div className="flex flex-col gap-4">
            <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 12, padding: 16 }}>
              {[['ฝ่าย', dept.department], ['รอบเงินเดือน', periodLabel(period)], ['จำนวนพนักงาน', `${t.count} คน`], ['ยอดรับสุทธิรวม', `${thb(t.totalNet)} บาท`]]
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1.5" style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{k}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>ยืนยันการอนุมัติข้อมูลเงินเดือนของฝ่ายนี้หรือไม่? ระบบจะสร้าง PDF และส่งอีเมลให้พนักงานทุกคนทันที</div>
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" disabled={processingDecision} onClick={() => setShowApproveModal(false)}>ยกเลิก</button>
              <button className="btn btn-approve" aria-busy={processingDecision} disabled={processingDecision} onClick={handleApprove}><BusyLabel busy={processingDecision} label="กำลังอนุมัติ…">✓ ยืนยันอนุมัติ</BusyLabel></button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject modal */}
      {showRejectModal && (
        <Modal title="ไม่อนุมัติข้อมูลเงินเดือน" onClose={() => setShowRejectModal(false)}>
          <div className="flex flex-col gap-4">
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
              ฝ่าย: <strong style={{ color: '#1A1A1A' }}>{dept.department}</strong> · รอบ: <strong style={{ color: '#1A1A1A' }}>{periodLabel(period)}</strong>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>เหตุผลที่ไม่อนุมัติ <span style={{ color: 'red' }}>*</span></label>
              <textarea className="inp" rows={4} style={{ resize: 'none' }} placeholder="กรุณาระบุเหตุผลที่ชัดเจน..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{rejectReason.length} ตัวอักษร · เหตุผลจะถูกส่งกลับไปให้พนักงานฝ่ายธุรการแก้ไข</div>
            </div>
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" disabled={processingDecision} onClick={() => setShowRejectModal(false)}>ยกเลิก</button>
              <button className="btn btn-danger" aria-busy={processingDecision} onClick={handleReject} disabled={!rejectReason.trim() || processingDecision}><BusyLabel busy={processingDecision} label="กำลังส่งกลับ…">✕ ยืนยันไม่อนุมัติ</BusyLabel></button>
            </div>
          </div>
        </Modal>
      )}

      {historyOpen && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', justifyContent: 'flex-end', background: 'rgba(28, 21, 46, 0.22)' }} onMouseDown={() => setHistoryOpen(false)}>
          <aside role="dialog" aria-modal="true" aria-label="ประวัติฉบับเงินเดือน" onMouseDown={event => event.stopPropagation()} style={{ width: 'min(390px, 100%)', height: '100%', background: '#FFFFFF', boxShadow: '-14px 0 36px rgba(36, 25, 66, 0.18)', padding: 22, overflowY: 'auto' }}>
            <div className="flex justify-between items-start gap-3" style={{ paddingBottom: 15, borderBottom: '1px solid var(--border)' }}>
              <div><div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>ประวัติฉบับเงินเดือน</div><div style={{ marginTop: 3, color: 'var(--text-secondary)', fontSize: 12.5 }}>{dept.department} · {periodLabel(period)}</div></div>
              <button className="btn btn-ghost btn-sm" aria-label="ปิด" onClick={() => setHistoryOpen(false)}>✕</button>
            </div>
            {historyLoading ? <div className="flex items-center gap-2" style={{ padding: '26px 0', color: 'var(--purple-600)', fontSize: 13, fontWeight: 600 }}><span className="btn-spinner" />กำลังโหลดประวัติ…</div>
              : historyError ? <div style={{ padding: '22px 0', color: '#B42318', fontSize: 13 }}>{historyError}</div>
              : <div style={{ position: 'relative', marginTop: 20, paddingLeft: 25 }}>
                <div style={{ position: 'absolute', left: 6, top: 7, bottom: 23, width: 2, background: '#E3DDF7' }} />
                {historyBatches.map(batch => {
                  const isCurrent = batch.databaseId === dept.databaseId
                  const isOldVersion = !isCurrent
                  return <div key={batch.id} style={{ position: 'relative', paddingBottom: 18 }}>
                    <span style={{ position: 'absolute', left: -23, top: 6, width: 12, height: 12, borderRadius: '50%', border: `3px solid ${isCurrent ? '#7651DC' : '#A8A5B3'}`, background: '#FFF' }} />
                    <div style={{ border: `1px solid ${isCurrent ? '#D6C7FF' : '#E5E3EB'}`, background: isCurrent ? '#F7F4FF' : '#FFF', borderRadius: 10, padding: 12 }}>
                      <div className="flex justify-between gap-2"><strong style={{ fontSize: 13 }}>{isCurrent ? `ฉบับปัจจุบัน · ครั้งที่ ${batch.revisionNumber ?? 0}` : batch.revisionNumber ? `ฉบับแก้ไข ครั้งที่ ${batch.revisionNumber}` : 'ฉบับเดิม · รอบปกติ'}</strong><StatusBadge s={batch.status} /></div>
                      {batch.revisionType && <div style={{ marginTop: 7, fontSize: 12, color: 'var(--text-secondary)' }}>{batch.revisionType}</div>}
                      {batch.revisionReason && <div style={{ marginTop: 3, fontSize: 12, color: 'var(--text-secondary)' }}>เหตุผล: {batch.revisionReason}</div>}
                      <div style={{ marginTop: 7, fontSize: 11.5, color: 'var(--text-muted)' }}>{batch.approvedAt ? `อนุมัติ ${formatBuddhistDateTime(batch.approvedAt)}` : `สร้าง ${formatBuddhistDateTime(batch.updatedAt)}`}</div>
                      {isOldVersion && <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 10 }} onClick={() => { setHistoricBatch(batch); setHistoryOpen(false) }}>ดูตารางฉบับนี้</button>}
                    </div>
                  </div>
                })}
              </div>}
          </aside>
        </div>, document.body
      )}
    </div>
  )
}

function HistoricPayrollView({ period, dept, onBack }: { period: PayrollPeriod; dept: DeptPayroll; onBack: () => void }) {
  const employees = useMemo(() => deptEmps(dept), [dept])
  const totals = useMemo(() => deptTotals(dept), [dept])
  const entries = employees.map(employee => ({ employee, row: dept.rows[employee.id] ?? makeDefaultRow(employee) }))
  const print = () => {
    if (!printPayrollTemplateExact({ period, department: dept.department, status: dept.status, entries })) window.alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up')
  }
  return <div className="anim">
    <button type="button" onClick={onBack} style={{ border: 0, background: 'transparent', color: '#4A3A78', cursor: 'pointer', fontSize: 14, fontWeight: 700, padding: '2px 0', display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14 }}><span style={{ fontSize: 20, lineHeight: 1 }}>←</span>กลับไปฉบับปัจจุบัน</button>
    <PageHeader title={`${dept.department} · ฉบับเดิม`} subtitle={`${periodLabel(period)} · ${dept.approvedAt ? `อนุมัติเมื่อ ${formatBuddhistDateTime(dept.approvedAt)}` : `สร้างเมื่อ ${formatBuddhistDateTime(dept.updatedAt)}`}`} breadcrumb={<Crumb items={[{ label: 'อนุมัติเงินเดือน' }, { label: 'ประวัติฉบับเงินเดือน' }]} />} actions={<StatusBadge s={dept.status} />} />
    <div style={{ background: '#F6F3FF', border: '1px solid #D9CBFF', borderRadius: 'var(--radius-sm)', padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#4D3A78' }}><strong>{(dept.revisionNumber ?? 0) === 0 ? 'รอบปกติ (ฉบับเดิม)' : `ฉบับแก้ไขเพิ่มเติม ครั้งที่ ${dept.revisionNumber}`}</strong><br />ข้อมูลฉบับนี้เป็นประวัติ เปิดดู พิมพ์ และส่งออกได้เท่านั้น ไม่สามารถแก้ไขได้</div>
    <div className="card" style={{ padding: '12px 14px', marginBottom: 16 }}><div className="flex justify-between items-center gap-3 flex-wrap"><span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>👥 {employees.length} คน · ข้อมูล ณ เวลาของฉบับนี้</span><div className="flex gap-2"><button className="btn btn-secondary" onClick={print}>🖨️ พิมพ์ตาราง</button><button className="btn btn-secondary" onClick={() => exportPayrollWorkbook({ period, department: dept.department, entries })}>📥 ส่งออก Excel</button></div></div></div>
    <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 310px)' }}><table className="tbl payroll-detail-table" style={{ minWidth: 1200 }}><thead><tr><th colSpan={5} className="th-group th-group-emp">ข้อมูลพนักงาน</th><th colSpan={3} className="th-group th-group-income">รายการรับ</th><th colSpan={7} className="th-group th-group-deduct">รายการหัก</th><th className="th-group th-group-net">ยอดรับสุทธิ</th></tr><tr><th className="th-emp">#</th><th className="th-emp">รหัส</th><th className="th-emp">ชื่อ–นามสกุล</th><th className="th-emp">ตำแหน่ง</th><th className="th-emp" style={{ textAlign: 'right' }}>ฐานเงินเดือน</th><th className="th-income" style={{ textAlign: 'right' }}>เงินเพิ่ม</th><th className="th-income" style={{ textAlign: 'right' }}>เงินประจำตำแหน่ง</th><th className="th-income" style={{ textAlign: 'right' }}>รวมรายการรับ</th><th className="th-deduct" style={{ textAlign: 'right' }}>ชำระหนี้ KTB</th><th className="th-deduct" style={{ textAlign: 'right' }}>ภาษีหัก ณ ที่จ่าย</th><th className="th-deduct" style={{ textAlign: 'right' }}>ประกันสังคม</th><th className="th-deduct" style={{ textAlign: 'right' }}>ฌาปนกิจ</th><th className="th-deduct" style={{ textAlign: 'right' }}>ธนาคารกรุงไทย</th><th className="th-deduct" style={{ textAlign: 'right' }}>ธนาคารออมสิน</th><th className="th-deduct" style={{ textAlign: 'right' }}>รวมรายการหัก</th><th className="th-net" style={{ textAlign: 'right' }}>ยอดรับสุทธิ</th></tr></thead><tbody>{employees.map((employee, index) => { const row = dept.rows[employee.id] ?? makeDefaultRow(employee); return <tr key={employee.id}><td className="readonly" style={{ textAlign: 'center' }}>{index + 1}</td><td className="readonly">{employee.id}</td><td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{employee.title}{employee.firstName} {employee.lastName}</td><td className="readonly">{employee.position}</td><td className="num readonly">{thb(employee.baseSalary)}</td><td className="num readonly">{thb(row.extra)}</td><td className="num readonly">{thb(row.posAllowance)}</td><td className="num total" style={{ background: '#F0FDF4', color: '#15803D' }}>{thb(rowGross(employee, row))}</td><td className="num readonly">{thb(row.debtKTB)}</td><td className="num readonly">{thb(row.tax)}</td><td className="num readonly">{thb(row.social)}</td><td className="num readonly">{thb(row.funeral)}</td><td className="num readonly">{thb(row.ktb)}</td><td className="num readonly">{thb(row.gsb)}</td><td className="num total" style={{ background: '#FFF8F6', color: '#B91C1C' }}>{thb(rowDeduct(row))}</td><td className="num total" style={{ background: '#F5F3FF', color: 'var(--purple-600)' }}>{thb(rowNet(employee, row))}</td></tr> })}</tbody><tfoot><tr><td colSpan={4} style={{ fontWeight: 700 }}>รวมทั้งสิ้น</td><td className="num">{thb(totals.totalBase)}</td><td className="num">{thb(totals.totalExtra)}</td><td className="num">{thb(totals.totalPos)}</td><td className="num" style={{ color: '#15803D' }}>{thb(totals.totalGross)}</td><td className="num">{thb(totals.totalDebtKTB)}</td><td className="num">{thb(totals.totalTax)}</td><td className="num">{thb(totals.totalSocial)}</td><td className="num">{thb(totals.totalFuneral)}</td><td className="num">{thb(totals.totalKTB)}</td><td className="num">{thb(totals.totalGSB)}</td><td className="num" style={{ color: '#B91C1C' }}>{thb(totals.totalDeduct)}</td><td className="num" style={{ color: 'var(--purple-600)' }}>{thb(totals.totalNet)}</td></tr></tfoot></table></div>
  </div>
}

// ─── Employees ────────────────────────────────────────────────────────────────

function EmployeesPage({ employees, departments, positions, loading, error, role, setPage, setEditEmpId, onChanged, showToast }: {
  employees: DatabaseEmployee[]
  departments: Department[]
  positions: Position[]
  loading: boolean
  error: string
  role: Role
  setPage: (page: Page) => void
  setEditEmpId: (id: number | null) => void
  onChanged: (employeeId: number) => void
  showToast: (message: string, type?: 'success' | 'error') => void
}) {
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('all')
  const [detailEmployee, setDetailEmployee] = useState<DatabaseEmployee | null>(null)
  const [employeeToDeactivate, setEmployeeToDeactivate] = useState<DatabaseEmployee | null>(null)
  const [deactivating, setDeactivating] = useState(false)
  const [deactivateError, setDeactivateError] = useState('')

  const departmentById = useMemo(
    () => new Map(departments.map(department => [department.id, department.name])),
    [departments]
  )
  const positionById = useMemo(
    () => new Map(positions.map(position => [position.id, position.name])),
    [positions]
  )

  const filtered = useMemo(() => employees.filter(e => {
    const name = `${e.prefix ?? ''}${e.first_name} ${e.last_name}`
    if (filterDept !== 'all' && String(e.department_id) !== filterDept) return false
    if (search && !name.includes(search)) return false
    return true
  }), [employees, search, filterDept])

  const activeCount = employees.filter(employee => employee.status === 'ACTIVE').length

  const statusLabel: Record<DatabaseEmployee['status'], string> = {
    ACTIVE: 'ปกติ',
    ON_LEAVE: 'ลา',
    RESIGNED: 'ลาออก',
    RETIRED: 'เกษียณ',
    TERMINATED: 'สิ้นสุดการจ้าง',
  }

  const employeeTypeLabel = (employee: DatabaseEmployee) =>
    employee.employee_type === 'OTHER'
      ? employee.employee_type_other || 'อื่นๆ'
      : EMPLOYEE_TYPE_OPTIONS.find(option => option.value === employee.employee_type)?.label || employee.employee_type

  const handleDeactivate = async () => {
    if (!employeeToDeactivate) return
    try {
      setDeactivating(true)
      setDeactivateError('')
      await deactivateEmployee(employeeToDeactivate.id)
      // The API has committed at this point.  Update the visible directory
      // immediately instead of making the user wait for another full GET.
      onChanged(employeeToDeactivate.id)
      showToast(`ลบ ${employeeToDeactivate.first_name} ${employeeToDeactivate.last_name} ออกจากรายการพนักงานแล้ว`, 'success')
      setEmployeeToDeactivate(null)
    } catch (deactivateFailure) {
      setDeactivateError(deactivateFailure instanceof Error ? deactivateFailure.message : 'ไม่สามารถลบข้อมูลพนักงานได้')
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <div className="anim">
      <PageHeader
        title="พนักงาน"
        subtitle={`พนักงานที่ใช้งานอยู่ ${activeCount} คน จากทั้งหมด ${employees.length} คน`}
        actions={<button className="btn btn-primary" onClick={() => { setEditEmpId(null); setPage('employee-form') }}>+ เพิ่มพนักงาน</button>}
      />
      <div className="card" style={{ padding: '14px 18px', marginBottom: 14 }}>
        <div className="flex items-center gap-3">
          <input className="inp" style={{ maxWidth: 240 }} placeholder="ค้นหาชื่อพนักงาน..." value={search} onChange={e => setSearch(e.target.value)} />
          {role !== 'hr' && (
            <AppSelect className="inp" style={{ maxWidth: 220 }} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
              <option value="all">ทุกฝ่าย</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </AppSelect>
          )}
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>ชื่อ–นามสกุล</th>
              <th>ตำแหน่ง</th>
              <th>ฝ่าย</th>
              <th style={{ textAlign: 'right' }}>ฐานเงินเดือน</th>
              <th>อีเมล</th>
              <th>สถานะ</th>
              <th>ดำเนินการ</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7}><div className="empty-state">กำลังโหลดข้อมูลพนักงานจากฐานข้อมูล...</div></td></tr>}
            {!loading && error && <tr><td colSpan={7}><div className="empty-state" style={{ color: '#B42318' }}>ไม่สามารถโหลดข้อมูลพนักงานได้: {error}</div></td></tr>}
            {!loading && !error && filtered.length === 0 && <tr><td colSpan={7}><div className="empty-state">ไม่พบพนักงานที่ตรงกับเงื่อนไข</div></td></tr>}
            {filtered.map(e => (
              <tr key={e.id}>
                <td style={{ fontWeight: 500 }}>{e.prefix}{e.first_name} {e.last_name}</td>
                <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{e.position_id ? positionById.get(e.position_id) ?? 'ไม่พบตำแหน่ง' : '–'}</td>
                <td style={{ fontSize: 12.5 }}>{e.department_id ? departmentById.get(e.department_id) ?? 'ไม่พบหน่วยงาน' : '–'}</td>
                <td className="num" style={{ fontWeight: 600 }}>{thb(Number(e.base_salary))}</td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{e.email ?? '–'}</td>
                <td><span className={`badge ${e.status === 'ACTIVE' ? 'badge-approved' : 'badge-rejected'}`}>● {statusLabel[e.status]}</span></td>
                <td>
                  <div className="flex gap-2 flex-wrap">
                    <button className="btn btn-ghost btn-xs" onClick={() => setDetailEmployee(e)}>ดูรายละเอียด</button>
                    <button className="btn btn-ghost btn-xs" onClick={() => { setEditEmpId(e.id); setPage('employee-form') }}>แก้ไข</button>
                    <button className="btn btn-danger btn-xs" onClick={() => { setDeactivateError(''); setEmployeeToDeactivate(e) }}>ลบ</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detailEmployee && (
        <Modal title="รายละเอียดพนักงาน" onClose={() => setDetailEmployee(null)}>
          <div className="flex flex-col gap-4">
            <div style={{ padding: 14, borderRadius: 10, background: 'var(--purple-100)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700 }}>{detailEmployee.prefix}{detailEmployee.first_name} {detailEmployee.last_name}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 12.5, marginTop: 3 }}>{detailEmployee.status === 'ACTIVE' ? 'ปกติ' : statusLabel[detailEmployee.status]}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 18px' }}>
              {[
                ['ฝ่าย', detailEmployee.department_id ? departmentById.get(detailEmployee.department_id) ?? '–' : '–'],
                ['ตำแหน่ง', detailEmployee.position_id ? positionById.get(detailEmployee.position_id) ?? '–' : '–'],
                ['ประเภทพนักงาน', employeeTypeLabel(detailEmployee)],
                ['ฐานเงินเดือน', `${thb(Number(detailEmployee.base_salary))} บาท`],
                ['อีเมล', detailEmployee.email ?? '–'],
                ['โทรศัพท์', detailEmployee.phone ?? '–'],
                ['ธนาคาร', detailEmployee.bank_name ?? '–'],
                ['เลขบัญชี', detailEmployee.bank_account_no ?? '–'],
              ].map(([label, value]) => (
                <div key={label as string} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{value}</div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <button className="btn btn-secondary" onClick={() => setDetailEmployee(null)}>ปิด</button>
              <button className="btn btn-primary" onClick={() => { setDetailEmployee(null); setEditEmpId(detailEmployee.id); setPage('employee-form') }}>แก้ไขข้อมูล</button>
            </div>
          </div>
        </Modal>
      )}

      {employeeToDeactivate && (
        <Modal title="ยืนยันการลบข้อมูลพนักงาน" onClose={() => !deactivating && setEmployeeToDeactivate(null)}>
          <div className="flex flex-col gap-4">
            <div style={{ padding: 14, borderRadius: 10, border: '1px solid #FECACA', background: '#FEF2F2', color: '#991B1B', fontSize: 13, lineHeight: 1.6 }}>
              ลบ <strong>{employeeToDeactivate.prefix}{employeeToDeactivate.first_name} {employeeToDeactivate.last_name}</strong> ออกจากรายการพนักงานหรือไม่?
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
              ระบบจะปิดใช้งานพนักงานในฐานข้อมูลและซ่อนจากรายการนี้ โดยไม่ลบข้อมูลหรือประวัติเงินเดือนเดิม
            </div>
            {deactivateError && <div style={{ color: '#B42318', fontSize: 13 }}>{deactivateError}</div>}
            <div className="flex justify-end gap-3">
              <button className="btn btn-secondary" disabled={deactivating} onClick={() => setEmployeeToDeactivate(null)}>ยกเลิก</button>
              <button className="btn btn-danger" aria-busy={deactivating} disabled={deactivating} onClick={handleDeactivate}><BusyLabel busy={deactivating} label="กำลังลบ…">ลบข้อมูลพนักงาน</BusyLabel></button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  )
}

// ─── Employee Form ────────────────────────────────────────────────────────────

function EmployeeForm({ empId, employees, departments, positions, setPage, showToast, onSaved }: {
  empId: number | null
  employees: DatabaseEmployee[]
  departments: Department[]
  positions: Position[]
  setPage: (p: Page) => void
  showToast: (msg: string, t?: 'success' | 'error') => void
  onSaved: (optimisticEmployee: DatabaseEmployee, createdPosition?: Position) => void
}) {
  const emp = empId ? employees.find(employee => employee.id === empId) : null
  const initialPrefix = emp?.prefix ?? ''
  const [nationalId, setNationalId] = useState(emp?.national_id ?? '')
  const [prefixChoice, setPrefixChoice] = useState(
    EMPLOYEE_PREFIXES.includes(initialPrefix as typeof EMPLOYEE_PREFIXES[number]) ? initialPrefix : initialPrefix ? 'OTHER' : ''
  )
  const [customPrefix, setCustomPrefix] = useState(
    EMPLOYEE_PREFIXES.includes(initialPrefix as typeof EMPLOYEE_PREFIXES[number]) ? '' : initialPrefix
  )
  const [firstName, setFirstName] = useState(emp?.first_name ?? '')
  const [lastName, setLastName] = useState(emp?.last_name ?? '')
  const [email, setEmail] = useState(emp?.email ?? '')
  const [phone, setPhone] = useState(emp?.phone ?? '')
  const [departmentId, setDepartmentId] = useState(String(emp?.department_id ?? departments.find(d => d.is_active)?.id ?? ''))
  const [positionName, setPositionName] = useState(positions.find(position => position.id === emp?.position_id)?.name ?? '')
  const [employeeType, setEmployeeType] = useState<DatabaseEmployee['employee_type']>(emp?.employee_type ?? 'CIVIL_SERVANT')
  const [employeeTypeOther, setEmployeeTypeOther] = useState(emp?.employee_type_other ?? '')
  const [status, setStatus] = useState<DatabaseEmployee['status']>(emp?.status ?? 'ACTIVE')
  const [birthDate, setBirthDate] = useState(emp?.birth_date ?? '')
  const [startDate, setStartDate] = useState(emp?.start_date ?? '')
  const [endDate, setEndDate] = useState(emp?.end_date ?? '')
  const [bankName, setBankName] = useState(emp?.bank_name ?? '')
  const [bankAccountNo, setBankAccountNo] = useState(emp?.bank_account_no ?? '')
  const [baseSalary, setBaseSalary] = useState(emp?.base_salary ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!positionName && emp?.position_id) {
      setPositionName(positions.find(position => position.id === emp.position_id)?.name ?? '')
    }
  }, [emp?.position_id, positionName, positions])

  const handleSave = async () => {
    if (nationalId.length !== 13 || !firstName.trim() || !lastName.trim() || !birthDate || !baseSalary || (prefixChoice === 'OTHER' && !customPrefix.trim()) || (employeeType === 'OTHER' && !employeeTypeOther.trim())) {
      setSaveError('กรุณากรอกช่องที่จำเป็นให้ครบ รวมถึงวันเดือนปีเกิด และเลขประจำตัวประชาชนต้องมี 13 หลัก')
      return
    }

    try {
      setSaving(true)
      setSaveError('')
      const normalizedPositionName = positionName.trim()
      const existingPosition = positions.find(position => position.name.trim().toLocaleLowerCase('th-TH') === normalizedPositionName.toLocaleLowerCase('th-TH'))
      const resolvedPosition = normalizedPositionName && !existingPosition
        ? await createPosition(normalizedPositionName)
        : existingPosition
      const resolvedPrefix = prefixChoice === 'OTHER' ? customPrefix.trim() : prefixChoice
      const payload: EmployeeSaveInput = {
        employee_code: emp?.employee_code ?? '',
        national_id: nationalId,
        prefix: resolvedPrefix || null,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        department_id: departmentId ? Number(departmentId) : null,
        position_id: resolvedPosition?.id ?? null,
        employee_type: employeeType,
        employee_type_other: employeeType === 'OTHER' ? employeeTypeOther.trim() : null,
        status,
        birth_date: birthDate || null,
        start_date: startDate || null,
        end_date: endDate || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        bank_name: bankName.trim() || null,
        bank_account_no: bankAccountNo.trim() || null,
        base_salary: baseSalary,
      }
      const createdEmployee = empId ? null : await createEmployee(payload)
      const savedEmployeeId = empId ?? createdEmployee!.id
      if (empId) await updateEmployee(empId, payload)
      const savedAt = new Date().toISOString()
      const optimisticEmployee: DatabaseEmployee = {
        id: savedEmployeeId,
        ...payload,
        employee_code: emp?.employee_code ?? createdEmployee!.employee_code,
        base_salary: String(payload.base_salary),
        created_at: emp?.created_at ?? savedAt,
        updated_at: savedAt,
      }
      onSaved(optimisticEmployee, resolvedPosition && !existingPosition ? resolvedPosition : undefined)
      showToast(empId ? 'อัปเดตข้อมูลพนักงานแล้ว' : 'เพิ่มพนักงานใหม่แล้ว', 'success')
      setPage('employees')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'บันทึกข้อมูลพนักงานไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="anim" style={{ maxWidth: 720 }}>
      <PageHeader
        title={empId ? 'แก้ไขข้อมูลพนักงาน' : 'เพิ่มพนักงาน'}
        breadcrumb={<Crumb items={[{ label: 'พนักงาน', onClick: () => setPage('employees') }, { label: empId ? 'แก้ไข' : 'เพิ่มใหม่' }]} />}
      />
      <div className="card" style={{ padding: 28 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--purple-600)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.04em' }}>ข้อมูลส่วนตัว</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <FormField label="เลขประจำตัวประชาชน" required><input className="inp" inputMode="numeric" maxLength={13} value={nationalId} onChange={e => setNationalId(e.target.value.replace(/\D/g, '').slice(0, 13))} /></FormField>
          <FormField label="คำนำหน้า">
            <AppSelect className="inp" value={prefixChoice} onChange={e => setPrefixChoice(e.target.value)}>
              <option value="">ไม่ระบุ</option>
              {EMPLOYEE_PREFIXES.map(option => <option key={option} value={option}>{option}</option>)}
              <option value="OTHER">อื่นๆ (โปรดระบุ)</option>
            </AppSelect>
          </FormField>
          {prefixChoice === 'OTHER' && (
            <FormField label="คำนำหน้าอื่นๆ"><input className="inp" value={customPrefix} onChange={e => setCustomPrefix(e.target.value)} maxLength={20} placeholder="โปรดระบุคำนำหน้า" /></FormField>
          )}
          <FormField label="ชื่อ" required><input className="inp" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="ชื่อ" /></FormField>
          <FormField label="นามสกุล" required><input className="inp" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="นามสกุล" /></FormField>
          <FormField label="วันเดือนปีเกิด (พ.ศ.)" required><BuddhistDateInput value={birthDate} onChange={setBirthDate} required /></FormField>
          <FormField label="อีเมล"><input className="inp" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="example@muni.go.th" /></FormField>
          <FormField label="โทรศัพท์"><input className="inp" value={phone} onChange={e => setPhone(e.target.value)} /></FormField>
        </div>
        <div className="divider" />
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--purple-600)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.04em' }}>ข้อมูลการทำงาน</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <FormField label="ฝ่าย" required>
            <AppSelect className="inp" value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
              <option value="">ไม่ระบุ</option>
              {departments
                .filter(d => d.is_active)
                .filter((department, index, options) => options.findIndex(option => option.name === department.name) === index)
                .map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </AppSelect>
          </FormField>
          <FormField label="ตำแหน่ง">
            <input className="inp" list="employee-position-options" value={positionName} onChange={e => setPositionName(e.target.value)} />
            <datalist id="employee-position-options">
              {positions.filter(p => p.is_active).map(p => <option key={p.id} value={p.name} />)}
            </datalist>
          </FormField>
          <FormField label="ประเภทพนักงาน" required>
            <AppSelect className="inp" value={employeeType} onChange={e => setEmployeeType(e.target.value as DatabaseEmployee['employee_type'])}>
              {EMPLOYEE_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </AppSelect>
          </FormField>
          {employeeType === 'OTHER' && (
            <FormField label="ประเภทพนักงานอื่นๆ" required>
              <input className="inp" value={employeeTypeOther} onChange={e => setEmployeeTypeOther(e.target.value)} maxLength={150} placeholder="โปรดระบุประเภทพนักงาน" />
            </FormField>
          )}
          <FormField label="สถานะ" required>
            <AppSelect className="inp" value={status} onChange={e => setStatus(e.target.value as DatabaseEmployee['status'])}>
              <option value="ACTIVE">ปกติ</option><option value="ON_LEAVE">ลา</option><option value="RESIGNED">ลาออก</option><option value="RETIRED">เกษียณ</option><option value="TERMINATED">สิ้นสุดการจ้าง</option>
            </AppSelect>
          </FormField>
          <FormField label="วันที่เริ่มงาน (พ.ศ.)"><BuddhistDateInput value={startDate} onChange={setStartDate} /></FormField>
          <FormField label="วันที่สิ้นสุด (พ.ศ.)"><BuddhistDateInput value={endDate} onChange={setEndDate} /></FormField>
        </div>
        <div className="divider" />
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--purple-600)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.04em' }}>ข้อมูลเงินเดือน</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <FormField label="ฐานเงินเดือน (บาท)" required>
            <input className="inp" type="number" min="0" step="0.01" value={baseSalary} onChange={e => setBaseSalary(e.target.value)} placeholder="0.00" />
          </FormField>
          <FormField label="ธนาคาร"><input className="inp" value={bankName} onChange={e => setBankName(e.target.value)} /></FormField>
          <FormField label="เลขบัญชีธนาคาร"><input className="inp" value={bankAccountNo} onChange={e => setBankAccountNo(e.target.value)} /></FormField>
        </div>
        {saveError && <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: '#FEF3F2', color: '#B42318', fontSize: 13 }}>{saveError}</div>}
        <div className="flex gap-3 justify-end mt-8">
          <button className="btn btn-secondary" onClick={() => setPage('employees')}>ยกเลิก</button>
          <button className="btn btn-primary" aria-busy={saving} onClick={handleSave} disabled={saving}><BusyLabel busy={saving} label="กำลังบันทึก…">บันทึก</BusyLabel></button>
        </div>
      </div>
    </div>
  )
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#1A1A1A' }}>
        {label} {required && <span style={{ color: '#EF4444' }}>*</span>}
      </label>
      {children}
    </div>
  )
}

/** A controlled menu rendered in a portal, so it always opens below its field. */
function AppSelect({ children, className = '', style, value, onChange, disabled, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const options = (Children.toArray(children).filter(node => isValidElement(node) && node.type === 'option') as React.ReactElement<{ value?: string | number; children?: React.ReactNode }>[]) 
  // Native <option> uses its text as the value when no explicit value is
  // supplied.  Mirror that behavior so a Thai label-only option never sends
  // an empty string to the API (for example, the payroll revision type).
  const optionValueOf = (option: React.ReactElement<{ value?: string | number; children?: React.ReactNode }>) =>
    String(option.props.value ?? (typeof option.props.children === 'string' ? option.props.children : ''))
  const selected = options.find(option => optionValueOf(option) === String(value ?? ''))
  const openMenu = () => {
    if (disabled || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setMenu({ left: rect.left, top: rect.bottom + 5, width: rect.width, maxHeight: Math.max(120, Math.min(300, window.innerHeight - rect.bottom - 14)) })
    setOpen(true)
  }
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (!buttonRef.current?.parentElement?.contains(target) && !document.getElementById('app-select-menu')?.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const choose = (next: string) => {
    onChange?.({ target: { value: next } } as React.ChangeEvent<HTMLSelectElement>)
    setOpen(false)
  }
  return <div style={{ position: 'relative', width: style?.width ?? '100%', maxWidth: style?.maxWidth, flexShrink: 0 }}>
    <button ref={buttonRef} type="button" className={`${className} app-select-trigger`} style={{ ...style, width: style?.width ?? '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={() => open ? setOpen(false) : openMenu()} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} {...props as React.ButtonHTMLAttributes<HTMLButtonElement>}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected?.props.children ?? 'เลือกข้อมูล'}</span><span aria-hidden="true" style={{ marginLeft: 10, color: '#766C90', fontSize: 15 }}>⌄</span>
    </button>
    {open && menu && createPortal(<div id="app-select-menu" role="listbox" style={{ position: 'fixed', zIndex: 1000, left: menu.left, top: menu.top, width: menu.width, maxHeight: menu.maxHeight, overflowY: 'auto', background: '#FFF', border: '1px solid #D8D2E6', borderRadius: 10, boxShadow: '0 10px 26px rgba(32, 21, 68, .20)', padding: 5 }}>
      {options.map(option => { const optionValue = optionValueOf(option); const active = optionValue === String(value ?? ''); return <button key={optionValue} type="button" role="option" aria-selected={active} onClick={() => choose(optionValue)} style={{ display: 'block', width: '100%', border: 0, borderRadius: 7, background: active ? '#EEE7FF' : 'transparent', color: '#292334', textAlign: 'left', padding: '9px 10px', cursor: 'pointer', fontSize: 14 }}>{option.props.children}</button> })}
    </div>, document.body)}
  </div>
}

/**
 * Renders a Thai Buddhist-era date while the value retained by the API stays
 * ISO/Gregorian (YYYY-MM-DD).  This keeps existing payroll data and database
 * date columns compatible without making users convert years themselves.
 */
function BuddhistDateInput({ value, onChange, required = false }: { value: string; onChange: (value: string) => void; required?: boolean }) {
  const fromIso = (iso: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    return match ? { day: String(Number(match[3])), month: String(Number(match[2])), year: String(Number(match[1]) + 543) } : { day: '', month: '', year: '' }
  }
  const [parts, setParts] = useState(() => fromIso(value))
  useEffect(() => { setParts(fromIso(value)) }, [value])
  const update = (key: 'day' | 'month' | 'year', nextValue: string) => {
    const next = { ...parts, [key]: nextValue }
    setParts(next)
    if (!next.day || !next.month || !next.year) { onChange(''); return }
    const gregorianYear = Number(next.year) - 543
    const lastDay = new Date(gregorianYear, Number(next.month), 0).getDate()
    const day = Math.min(Number(next.day), lastDay)
    onChange(`${gregorianYear}-${String(next.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  const currentBuddhistYear = new Date().getFullYear() + 543
  const years = Array.from({ length: 101 }, (_, index) => currentBuddhistYear + 10 - index)
  return <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.45fr 1.1fr', gap: 8 }}>
    <AppSelect className="inp" required={required} value={parts.day} onChange={event => update('day', event.target.value)} aria-label="วัน">
      <option value="">วัน</option>{Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
    </AppSelect>
    <AppSelect className="inp" required={required} value={parts.month} onChange={event => update('month', event.target.value)} aria-label="เดือน">
      <option value="">เดือน</option>{MONTH_TH.slice(1).map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
    </AppSelect>
    <AppSelect className="inp" required={required} value={parts.year} onChange={event => update('year', event.target.value)} aria-label="ปี พ.ศ.">
      <option value="">ปี พ.ศ.</option>{years.map(year => <option key={year} value={year}>{year}</option>)}
    </AppSelect>
  </div>
}

// ─── Payslip Status ───────────────────────────────────────────────────────────

function PayslipStatus({ periods, onReload, onEmployeeEmailUpdated, showToast, onManageEmployees }: {
  periods: PayrollPeriod[]
  onReload: () => Promise<void>
  onEmployeeEmailUpdated: (employeeId: number, email: string) => void
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
  onManageEmployees: () => void
}) {
  const [sendingId, setSendingId] = useState<number | null>(null)
  const [showBulkSendModal, setShowBulkSendModal] = useState(false)
  const [bulkSending, setBulkSending] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(0)
  const [bulkTarget, setBulkTarget] = useState<{ periodLabel: string; rows: PayslipDeliveryRow[]; missingEmailCount: number } | null>(null)
  const [editingEmailCode, setEditingEmailCode] = useState<string | null>(null)
  const [emailDraft, setEmailDraft] = useState('')
  const [savingEmailCode, setSavingEmailCode] = useState<string | null>(null)
  const approvedDepts = useMemo(() =>
    periods.flatMap(p => p.depts.filter(d => d.status === 'approved').map(d => ({ period: p, dept: d }))),
    [periods]
  )
  const approvedPeriods = useMemo(() => periods.map(period => ({
    period,
    depts: period.depts.filter(dept => dept.status === 'approved'),
  })).filter(group => group.depts.length > 0), [periods])
  const emailDeliveryRows = useMemo<PayslipDeliveryRow[]>(() => approvedDepts.flatMap(({ period, dept }) =>
    deptEmps(dept).map(employee => ({
      period,
      dept,
      employee,
      payrollItemId: dept.emailItemIds?.[employee.id],
      status: dept.emailStatuses?.[employee.id] ?? 'waiting' as EmailStatus,
      hasEmail: Boolean(employee.email?.trim()),
    }))
  ), [approvedDepts])
  const sendAllPending = async () => {
    const targetRows = bulkTarget?.rows ?? []
    if (bulkSending || targetRows.length === 0) return
    setBulkSending(true)
    setBulkProgress(0)
    let sent = 0
    let failed = 0
    try {
      // Send one at a time to keep SMTP connections stable and give every
      // employee an independent delivery status in the database.
      for (const [index, row] of targetRows.entries()) {
        try {
          await sendPayslipEmail(row.payrollItemId!)
          sent += 1
        } catch {
          failed += 1
        }
        setBulkProgress(index + 1)
      }
      setShowBulkSendModal(false)
      setBulkTarget(null)
      showToast(failed > 0
        ? `ส่งสำเร็จ ${sent} ราย และส่งไม่สำเร็จ ${failed} ราย`
        : `ส่งสลิปสำเร็จ ${sent} ราย`, failed > 0 ? 'error' : 'success')
      // SMTP has already completed.  Refresh delivery badges in the background
      // so the success message and controls do not feel stalled by a second
      // full bootstrap request.
      void onReload().catch(() => undefined)
    } finally {
      setBulkSending(false)
    }
  }

  return (
    <div className="anim">
      <PageHeader title="สถานะการส่งสลิปเงินเดือน" subtitle="ติดตามสถานะ PDF และอีเมลสลิปเงินเดือนแยกรอบและฝ่าย" />
      {approvedDepts.length === 0 && <div className="card"><div className="empty-state"><div className="empty-icon">✉</div><div>ยังไม่มีฝ่ายที่ได้รับการอนุมัติ</div></div></div>}
      {approvedPeriods.map(({ period: p, depts }) => {
        const periodRows = emailDeliveryRows.filter(row => row.period.id === p.id)
        const missingEmailRows = periodRows.filter(row => !row.hasEmail)
        const bulkSendRows = periodRows.filter(row => row.hasEmail && row.payrollItemId && row.status !== 'sent')
        return (
          <section key={p.id} className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
            <div className="flex items-center justify-between gap-4 px-6 py-5 flex-wrap" style={{ background: 'linear-gradient(100deg, #F4F0FF, #F8FAFF)', borderBottom: '1px solid #E6DFFE' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple-600)', letterSpacing: '.04em', marginBottom: 3 }}>รอบเงินเดือน</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19 }}>{periodLabel(p)}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>วันที่จ่าย {formatBuddhistDate(p.payDate)} · {depts.length} ฝ่ายที่อนุมัติแล้ว</div>
              </div>
              <button className="btn btn-primary" disabled={bulkSendRows.length === 0 || bulkSending} onClick={() => {
                setBulkTarget({ periodLabel: periodLabel(p), rows: bulkSendRows, missingEmailCount: missingEmailRows.length })
                setShowBulkSendModal(true)
              }}>📨 ส่งอีเมลทั้งหมด{bulkSendRows.length > 0 ? ` (${bulkSendRows.length})` : ''}</button>
            </div>
            {missingEmailRows.length > 0 && <div className="flex items-center justify-between gap-4 flex-wrap" style={{ margin: '16px 18px 0', padding: '12px 14px', borderRadius: 10, background: '#FFF8E8', border: '1px solid #F3D28B' }}>
              <div><strong style={{ color: '#9A5A00', fontSize: 13 }}>⚠️ พบ {missingEmailRows.length} รายที่ยังไม่มีอีเมล</strong><div style={{ fontSize: 12, color: '#7A5A24', marginTop: 2 }}>ระบบจะข้ามรายชื่อเหล่านี้ในการส่งของรอบนี้</div></div>
              <button className="btn btn-secondary btn-sm" onClick={onManageEmployees}>จัดการข้อมูลพนักงาน</button>
            </div>}
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {depts.map(d => {
              const emps = deptEmps(d)
              const sentCount = emps.filter(e => d.emailStatuses?.[e.id] === 'sent').length
              return <div key={d.id} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)', background: '#F0FDF4' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{d.department}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>อนุมัติโดย {d.approvedBy ?? '–'} · {d.approvedAt ? formatBuddhistDate(d.approvedAt) : '–'}</div>
              </div>
              <div className="flex items-center gap-4"><div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ส่งสำเร็จ</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: '#15803D' }}>{sentCount}/{emps.length}</div></div><span className="badge badge-approved">✓ อนุมัติแล้ว</span></div>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>ชื่อ–นามสกุล</th>
                  <th>อีเมล</th>
                  <th>สถานะ PDF</th>
                  <th>สถานะอีเมล</th>
                  <th>วันที่ส่ง</th>
                  <th>ดำเนินการ</th>
                </tr>
              </thead>
              <tbody>
                {emps.map(e => {
                  const es = d.emailStatuses?.[e.id] ?? 'waiting'
                  const payrollItemId = d.emailItemIds?.[e.id]
                  const sentAt = d.emailSentAt?.[e.id]
                  const sendEmail = async () => {
                    if (!payrollItemId) return
                    setSendingId(payrollItemId)
                    try {
                      const { recipient } = await sendPayslipEmail(payrollItemId)
                      showToast(`ส่งสลิปไปที่ ${recipient} แล้ว`, 'success')
                      void onReload().catch(() => undefined)
                    } catch (error) {
                      showToast(error instanceof Error ? error.message : 'ส่งอีเมลไม่สำเร็จ', 'error')
                      void onReload().catch(() => undefined)
                    } finally {
                      setSendingId(null)
                    }
                  }
                  const openPayslip = async (download = false) => {
                    if (!payrollItemId) return
                    const previewWindow = download ? null : window.open('', '_blank')
                    try {
                      const pdf = await getPayslipPdf(payrollItemId)
                      const url = URL.createObjectURL(pdf)
                      if (download) {
                        const link = document.createElement('a')
                        link.href = url
                        link.download = `payslip-${e.id}.pdf`
                        link.click()
                      } else if (previewWindow) {
                        previewWindow.location.href = url
                      }
                      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
                    } catch (error) {
                      previewWindow?.close()
                      showToast(error instanceof Error ? error.message : 'โหลดสลิปไม่สำเร็จ', 'error')
                    }
                  }
                  const editingEmail = editingEmailCode === e.id
                  const saveEmail = async () => {
                    const nextEmail = emailDraft.trim()
                    if (!e.databaseId) { showToast('ไม่พบข้อมูลพนักงานสำหรับบันทึกอีเมล', 'error'); return }
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) { showToast('กรุณากรอกอีเมลให้ถูกต้องก่อนบันทึก', 'error'); return }
                    setSavingEmailCode(e.id)
                    try {
                      await updateEmployeeEmail(e.databaseId, nextEmail)
                      onEmployeeEmailUpdated(e.databaseId, nextEmail)
                      setEditingEmailCode(null)
                      setEmailDraft('')
                      showToast('บันทึกอีเมลพนักงานแล้ว', 'success')
                    } catch (error) {
                      showToast(error instanceof Error ? error.message : 'บันทึกอีเมลไม่สำเร็จ', 'error')
                    } finally {
                      setSavingEmailCode(null)
                    }
                  }
                  return (
                    <tr key={e.id}>
                      <td>{e.title}{e.firstName} {e.lastName}</td>
                      <td style={{ fontSize: 12, color: e.email?.trim() ? 'var(--text-secondary)' : '#B45309', fontWeight: e.email?.trim() ? 400 : 600, minWidth: 250 }}>
                        {editingEmail ? <div className="flex items-center gap-1" style={{ minWidth: 228 }}><input className="inp" autoFocus type="email" value={emailDraft} onChange={event => setEmailDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void saveEmail(); if (event.key === 'Escape') { setEditingEmailCode(null); setEmailDraft('') } }} style={{ height: 32, minWidth: 0, padding: '6px 9px', fontSize: 12 }} /><button className="btn btn-primary btn-xs" aria-busy={savingEmailCode === e.id} disabled={savingEmailCode === e.id} onClick={() => void saveEmail()}><BusyLabel busy={savingEmailCode === e.id} label="กำลังบันทึก…">บันทึก</BusyLabel></button></div>
                          : <div className="flex items-center gap-1"><span>{e.email?.trim() || '⚠️ ยังไม่มีอีเมล'}</span><button type="button" aria-label={`แก้ไขอีเมล ${e.firstName} ${e.lastName}`} title="แก้ไขอีเมล" onClick={() => { setEditingEmailCode(e.id); setEmailDraft(e.email ?? '') }} style={{ border: 0, background: 'transparent', color: '#161616', cursor: 'pointer', padding: 3, display: 'inline-grid', placeItems: 'center' }}><PencilIcon /></button></div>}
                      </td>
                      <td><span className="badge badge-approved">✓ สร้างแล้ว</span></td>
                      <td><span className={`badge ${es === 'sent' ? 'badge-approved' : es === 'failed' ? 'badge-rejected' : 'badge-pending'}`}>{es === 'sent' ? '✓ ส่งสำเร็จ' : es === 'failed' ? '✕ ส่งไม่สำเร็จ' : '◔ รอส่ง'}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sentAt ? formatBuddhistDateTime(sentAt) : '–'}</td>
                      <td>
                        <div className="flex gap-1">
                          {payrollItemId && <button className="btn btn-ghost btn-xs" onClick={() => openPayslip()}>ดูสลิป</button>}
                          {payrollItemId && <button className="btn btn-ghost btn-xs" onClick={() => openPayslip(true)}>⬇ PDF</button>}
                          {e.email?.trim() && payrollItemId && <button className="btn btn-secondary btn-xs" aria-busy={sendingId === payrollItemId} disabled={sendingId === payrollItemId} onClick={sendEmail}><BusyLabel busy={sendingId === payrollItemId} label="กำลังส่ง…">{es === 'sent' ? 'ส่งอีกครั้ง' : es === 'failed' ? 'ส่งซ้ำ' : 'ส่งอีเมล'}</BusyLabel></button>}
                          {!e.email?.trim() && <button className="btn btn-secondary btn-xs" onClick={onManageEmployees}>เพิ่มอีเมล</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
            })}
            </div>
          </section>
        )
      })}
      {showBulkSendModal && (
        <Modal title="ยืนยันส่งสลิปทางอีเมล" onClose={() => !bulkSending && setShowBulkSendModal(false)}>
          <div className="flex flex-col gap-4">
            <div style={{ background: '#F6F3FF', border: '1px solid #DDD2FE', borderRadius: 10, padding: '14px 16px', fontSize: 13, lineHeight: 1.7 }}>
              ระบบจะส่งสลิป PDF ที่เข้ารหัสแล้วของรอบ <strong>{bulkTarget?.periodLabel}</strong> ให้ <strong>{bulkTarget?.rows.length ?? 0} ราย</strong> ที่อยู่ในสถานะรอส่งหรือส่งไม่สำเร็จ
              {(bulkTarget?.missingEmailCount ?? 0) > 0 && <><br />จะข้าม <strong>{bulkTarget?.missingEmailCount} ราย</strong> ที่ยังไม่มีอีเมล</>}
              <br /><span style={{ color: 'var(--text-secondary)' }}>รายการที่ส่งสำเร็จแล้วจะไม่ถูกส่งซ้ำจากปุ่มนี้</span>
            </div>
            {bulkSending && <div style={{ fontSize: 13, color: 'var(--purple-600)', fontWeight: 600 }}>กำลังส่ง {bulkProgress}/{bulkTarget?.rows.length ?? 0} ราย…</div>}
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" disabled={bulkSending} onClick={() => { setShowBulkSendModal(false); setBulkTarget(null) }}>ยกเลิก</button>
              <button className="btn btn-primary" aria-busy={bulkSending} disabled={bulkSending} onClick={() => void sendAllPending()}><BusyLabel busy={bulkSending} label="กำลังส่ง…">ยืนยันส่งอีเมล</BusyLabel></button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Reports ──────────────────────────────────────────────────────────────────

function ReportsPage({ periods }: { periods: PayrollPeriod[] }) {
  const [filterPeriod, setFilterPeriod] = useState(periods[0]?.id ?? 'all')
  const p = periods.find(p => p.id === filterPeriod) ?? periods[0]
  const t = p ? periodTotals(p) : { gross: 0, deduct: 0, net: 0, emps: 0 }

  return (
    <div className="anim">
      <PageHeader title="รายงาน" subtitle="สรุปข้อมูลเงินเดือนและส่งออกรายงาน" />
      <div className="card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div className="flex items-center gap-3">
          <AppSelect className="inp" style={{ maxWidth: 220 }} value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}>
            {periods.map(p => <option key={p.id} value={p.id}>{periodLabel(p)}</option>)}
          </AppSelect>
          <button className="btn btn-secondary btn-sm">แสดงผล</button>
          <div className="flex gap-2 ml-auto">
            <button className="btn btn-secondary btn-sm">⬇ ส่งออก Excel</button>
            <button className="btn btn-secondary btn-sm">⬇ ส่งออก PDF</button>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
        <KpiCard label="ยอดรายการรับรวม" value={thbInt(Math.round(t.gross))} unit="บาท" icon="▲" accent="#22C55E" />
        <KpiCard label="ยอดรายการหักรวม" value={thbInt(Math.round(t.deduct))} unit="บาท" icon="▼" accent="#F59E0B" />
        <KpiCard label="ยอดรับสุทธิรวม" value={thbInt(Math.round(t.net))} unit="บาท" icon="◈" accent="#3B82F6" />
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>สรุปค่าใช้จ่ายแยกตามฝ่าย — {p ? periodLabel(p) : ''}</div></div>
        <table className="tbl">
          <thead>
            <tr>
              <th>ฝ่าย</th>
              <th style={{ textAlign: 'center' }}>จำนวนพนักงาน</th>
              <th style={{ textAlign: 'right' }}>ยอดรายการรับรวม</th>
              <th style={{ textAlign: 'right' }}>ยอดรายการหักรวม</th>
              <th style={{ textAlign: 'right' }}>ยอดรับสุทธิรวม</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {p?.depts.map(d => {
              const dt = deptTotals(d)
              return (
                <tr key={d.id}>
                  <td style={{ fontWeight: 500 }}>{d.department}</td>
                  <td style={{ textAlign: 'center' }}>{dt.count}</td>
                  <td className="num">{thb(dt.totalGross)}</td>
                  <td className="num">{thb(dt.totalDeduct)}</td>
                  <td className="num total">{thb(dt.totalNet)}</td>
                  <td><StatusBadge s={d.status} /></td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ fontWeight: 700 }}>รวมทั้งหมด</td>
              <td style={{ textAlign: 'center', fontWeight: 700 }}>{t.emps}</td>
              <td className="num">{thb(t.gross)}</td>
              <td className="num">{thb(t.deduct)}</td>
              <td className="num" style={{ color: 'var(--purple-600)' }}>{thb(t.net)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ─── Admin Users ──────────────────────────────────────────────────────────────

function AdminUsers({ employees, showToast }: { employees: DatabaseEmployee[]; showToast: (msg: string, type?: 'success' | 'error') => void }) {
  const roleLabel: Record<Role, string> = { hr: 'พนักงานฝ่ายธุรการ', director: 'ผู้บริหาร', admin: 'แอดมิน' }
  const [users, setUsers] = useState<SystemUser[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [username, setUsername] = useState('')
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [newRole, setNewRole] = useState<Role>('hr')
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('hr')
  const [inviteUrl, setInviteUrl] = useState('')
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([])
  const [revealedPasswords, setRevealedPasswords] = useState<Record<number, string>>({})
  const [approvalRequest, setApprovalRequest] = useState<AccessRequest | null>(null)
  const [approvalRole, setApprovalRole] = useState<Role>('hr')
  const [rejectMode, setRejectMode] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SystemUser | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [creatingUser, setCreatingUser] = useState(false)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [reviewingRequest, setReviewingRequest] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [changingAccountStatusId, setChangingAccountStatusId] = useState<number | null>(null)
  const load = useCallback(async () => { try { setUsers(await getUsers()) } catch (error) { showToast(error instanceof Error ? error.message : 'โหลดบัญชีไม่สำเร็จ', 'error') } }, [showToast])
  const loadRequests = useCallback(async () => { try { setAccessRequests(await getAccessRequests()) } catch (error) { showToast(error instanceof Error ? error.message : 'โหลดคำขอไม่สำเร็จ', 'error') } }, [showToast])
  useEffect(() => { void load(); void loadRequests() }, [load, loadRequests])
  const create = async () => { if (creatingUser) return; setCreatingUser(true); try { await createSystemUser({ username, temporary_password: temporaryPassword, employee_id: Number(employeeId), role: newRole }); showToast('สร้างบัญชีผู้ใช้งานแล้ว', 'success'); setShowCreate(false); setUsername(''); setTemporaryPassword(''); setEmployeeId(''); void load() } catch (error) { showToast(error instanceof Error ? error.message : 'สร้างบัญชีไม่สำเร็จ', 'error') } finally { setCreatingUser(false) } }
  const reset = async (user: SystemUser) => { const password = window.prompt(`กำหนดรหัสผ่านชั่วคราวใหม่สำหรับ ${user.username} (อย่างน้อย 8 ตัวอักษร)`); if (!password) return; try { await resetSystemUserPassword(user.id, password); showToast('รีเซ็ตรหัสผ่านแล้ว', 'success') } catch (error) { showToast(error instanceof Error ? error.message : 'รีเซ็ตรหัสผ่านไม่สำเร็จ', 'error') } }
  const createInvite = async () => { if (creatingInvite) return; setCreatingInvite(true); try { const result = await createUserInvite(inviteEmail, inviteRole); setInviteUrl(result.data.invite_url); showToast('สร้างลิงก์คำเชิญแล้ว', 'success') } catch (error) { showToast(error instanceof Error ? error.message : 'สร้างคำเชิญไม่สำเร็จ', 'error') } finally { setCreatingInvite(false) } }
  const refreshUsers = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await Promise.all([load(), loadRequests()])
      showToast('อัปเดตรายชื่อผู้ใช้และคำขอล่าสุดแล้ว', 'success')
    } finally {
      setRefreshing(false)
    }
  }
  const approveRequest = async () => { if (!approvalRequest || reviewingRequest) return; setReviewingRequest(true); try { await approveAccessRequest(approvalRequest.id, approvalRole); showToast('อนุมัติและเปิดใช้งานบัญชีแล้ว', 'success'); setApprovalRequest(null); void Promise.all([load(), loadRequests()]) } catch (error) { showToast(error instanceof Error ? error.message : 'อนุมัติไม่สำเร็จ', 'error') } finally { setReviewingRequest(false) } }
  const rejectRequest = async () => { if (!approvalRequest || reviewingRequest) return; setReviewingRequest(true); try { await rejectAccessRequest(approvalRequest.id, rejectionReason); setAccessRequests(current => current.filter(request => request.id !== approvalRequest.id)); showToast('ไม่อนุมัติสิทธิ์และปิดคำขอแล้ว', 'success'); setApprovalRequest(null); setRejectMode(false); setRejectionReason('') } catch (error) { showToast(error instanceof Error ? error.message : 'ไม่สามารถปิดคำขอได้', 'error') } finally { setReviewingRequest(false) } }
  const openApproval = (request: AccessRequest) => { setApprovalRequest(request); setApprovalRole(request.requested_role); setRejectMode(false); setRejectionReason('') }
  const revealPassword = async (requestId: number) => { try { const password = await revealAccessRequestPassword(requestId); setRevealedPasswords(current => ({ ...current, [requestId]: password })) } catch (error) { showToast(error instanceof Error ? error.message : 'ไม่สามารถแสดงรหัสผ่านได้', 'error') } }
  const hidePassword = (requestId: number) => setRevealedPasswords(current => { const next = { ...current }; delete next[requestId]; return next })
  const deleteAccount = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try { await deleteSystemUser(deleteTarget.id); setUsers(current => current.filter(user => user.id !== deleteTarget.id)); showToast(`ลบบัญชี ${deleteTarget.username} และข้อมูลพนักงานแล้ว`, 'success'); setDeleteTarget(null) }
    catch (error) { showToast(error instanceof Error ? error.message : 'ลบบัญชีไม่สำเร็จ', 'error') }
    finally { setDeleting(false) }
  }
  const changeAccountStatus = async (target: SystemUser) => {
    if (changingAccountStatusId) return
    setChangingAccountStatusId(target.id)
    const nextActive = !target.is_active
    try {
      if (nextActive) await activateSystemUser(target.id)
      else await deactivateSystemUser(target.id)
      setUsers(current => current.map(user => user.id === target.id ? { ...user, is_active: nextActive } : user))
      showToast(`${nextActive ? 'เปิด' : 'ปิด'}การใช้งานบัญชี ${target.username} แล้ว`, 'success')
    }
    catch (error) { showToast(error instanceof Error ? error.message : `${nextActive ? 'เปิด' : 'ปิด'}การใช้งานบัญชีไม่สำเร็จ`, 'error') }
    finally { setChangingAccountStatusId(null) }
  }
  const linkedEmployeeIds = new Set(users.map(user => user.employee_id).filter((id): id is number => id !== null))
  return (
    <div className="anim">
      <PageHeader title="จัดการผู้ใช้งาน" subtitle="สร้างบัญชีโดยผูกกับข้อมูลพนักงานจริง" actions={<div className="flex gap-2"><button className="btn btn-secondary" aria-busy={refreshing} disabled={refreshing} onClick={() => void refreshUsers()}><BusyLabel busy={refreshing} label="กำลังรีเฟรช…">↻ รีเฟรช</BusyLabel></button><button className="btn btn-secondary" onClick={() => setShowInvite(true)}>✉ สร้างคำเชิญ</button><button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ เพิ่มผู้ใช้งาน</button></div>} />
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ</th><th>รหัสผ่าน</th><th>สิทธิ์การใช้งาน</th><th>สถานะ</th><th>ดำเนินการ</th><th>ลบบัญชี</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{u.username}</td>
                <td style={{ fontWeight: 500 }}>{u.full_name}</td>
                <td><span style={{ fontFamily: 'monospace' }}>{u.has_initial_password && u.access_request_id ? (revealedPasswords[u.access_request_id] ?? '••••••••') : '••••••••'}</span><button aria-label={u.has_initial_password && u.access_request_id ? 'กดค้างเพื่อดูรหัสผ่าน' : 'บัญชีเก่าไม่สามารถเปิดดูรหัสเดิมได้ กรุณารีเซ็ตรหัสผ่าน'} title={u.has_initial_password && u.access_request_id ? 'กดค้างเพื่อดูรหัสผ่าน' : 'บัญชีเก่า: กรุณารีเซ็ตรหัสผ่านหากต้องการกำหนดรหัสใหม่'} className="btn btn-ghost btn-xs" disabled={!u.has_initial_password || !u.access_request_id} style={{ marginLeft: 5, padding: '3px 5px', color: u.has_initial_password && u.access_request_id ? '#625B72' : '#B8B3C1', cursor: u.has_initial_password && u.access_request_id ? 'pointer' : 'not-allowed' }} onMouseDown={() => u.access_request_id && void revealPassword(u.access_request_id)} onMouseUp={() => u.access_request_id && hidePassword(u.access_request_id)} onMouseLeave={() => u.access_request_id && hidePassword(u.access_request_id)}><EyeIcon /></button></td>
                <td><span style={{ background: 'var(--purple-100)', color: 'var(--purple-600)', borderRadius: 99, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{roleLabel[u.role]}</span></td>
                <td><span className={`badge ${u.is_active ? 'badge-approved' : 'badge-rejected'}`}>{u.is_active ? '● ใช้งานอยู่' : '● ปิดการใช้งาน'}</span></td>
                <td>
                  <div className="flex gap-1">
                    <button className="btn btn-ghost btn-xs" onClick={() => void reset(u)}>รีเซ็ตรหัสผ่าน</button>
                  </div>
                </td>
                <td><div className="flex gap-1"><button className="btn btn-secondary btn-xs" aria-busy={changingAccountStatusId === u.id} disabled={changingAccountStatusId !== null} onClick={() => void changeAccountStatus(u)}><BusyLabel busy={changingAccountStatusId === u.id} label="กำลังบันทึก…">{u.is_active ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'}</BusyLabel></button><button className="btn btn-danger btn-xs" disabled={changingAccountStatusId !== null} onClick={() => setDeleteTarget(u)}>ลบบัญชี</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deleteTarget && <Modal title="ยืนยันการลบบัญชี" onClose={() => !deleting && setDeleteTarget(null)}><div className="flex flex-col gap-4"><div style={{ background: '#FFF1F0', border: '1px solid #F7B6B2', borderRadius: 10, padding: '14px 16px', color: '#9F1D17', lineHeight: 1.65 }}><strong>คำเตือน: การดำเนินการนี้ไม่สามารถย้อนกลับได้</strong><br />ระบบจะลบข้อมูลล็อกอินของ <strong>{deleteTarget.username}</strong>, ข้อมูลพนักงาน <strong>{deleteTarget.full_name}</strong>, รายการเงินเดือน, สลิป และสถานะการส่งอีเมลที่เกี่ยวข้อง ออกจากฐานข้อมูลโดยถาวร</div><div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>เมื่อยืนยันแล้ว ระบบจะถือว่าไม่เคยมีบัญชีนี้อยู่ในระบบ</div><div className="flex justify-end gap-3"><button className="btn btn-secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>ยกเลิก</button><button className="btn btn-danger" aria-busy={deleting} disabled={deleting} onClick={() => void deleteAccount()}><BusyLabel busy={deleting} label="กำลังลบ…">ยืนยันลบถาวร</BusyLabel></button></div></div></Modal>}
      {accessRequests.filter(request => request.status === 'PENDING').length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 20 }}><div style={{ padding: '15px 18px', fontWeight: 700 }}>คำขอเข้าใช้งานที่รอตรวจสอบ</div><table className="tbl"><thead><tr><th>ผู้ขอ</th><th>ชื่อผู้ใช้</th><th>รหัสผ่านที่ตั้งตอนสมัคร</th><th>สิทธิ์ที่ขอ</th><th>ดำเนินการ</th></tr></thead><tbody>{accessRequests.filter(request => request.status === 'PENDING').map(request => <tr key={request.id}><td><strong>{String(request.employee_data.prefix ?? '')}{String(request.employee_data.first_name ?? '')} {String(request.employee_data.last_name ?? '')}</strong><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{request.invited_email}</div></td><td style={{ fontFamily: 'monospace' }}>{request.username}</td><td><span style={{ fontFamily: 'monospace' }}>{revealedPasswords[request.id] ?? '••••••••'}</span><button aria-label="กดค้างเพื่อดูรหัสผ่าน" title="กดค้างเพื่อดูรหัสผ่าน" className="btn btn-ghost btn-xs" style={{ marginLeft: 5, padding: '3px 5px', color: '#625B72' }} onMouseDown={() => void revealPassword(request.id)} onMouseUp={() => hidePassword(request.id)} onMouseLeave={() => hidePassword(request.id)} onTouchStart={() => void revealPassword(request.id)} onTouchEnd={() => hidePassword(request.id)}><EyeIcon /></button></td><td>{roleLabel[request.requested_role]}</td><td><button className="btn btn-primary btn-xs" onClick={() => openApproval(request)}>ตรวจสอบและอนุมัติ</button></td></tr>)}</tbody></table></div>}
      {approvalRequest && <Modal title={rejectMode ? 'ไม่อนุมัติสิทธิ์' : 'ตรวจสอบและอนุมัติ'} onClose={() => setApprovalRequest(null)}><div className="flex flex-col gap-4"><div style={{ padding: '10px 12px', background: rejectMode ? '#FFF4F2' : '#F7F4FF', borderRadius: 10, fontSize: 13 }}><strong>{String(approvalRequest.employee_data.prefix ?? '')}{String(approvalRequest.employee_data.first_name ?? '')} {String(approvalRequest.employee_data.last_name ?? '')}</strong><br /><span style={{ color: 'var(--text-secondary)' }}>{approvalRequest.username} · {approvalRequest.invited_email}</span></div>{rejectMode ? <><FormField label="เหตุผล (ไม่บังคับ)"><textarea className="inp" value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} rows={3} placeholder="ระบุเหตุผลที่ไม่อนุมัติ" /></FormField><div className="flex justify-end gap-3"><button className="btn btn-secondary" onClick={() => setRejectMode(false)}>กลับ</button><button className="btn btn-danger" onClick={() => void rejectRequest()}>ไม่อนุมัติและปิดคำขอ</button></div></> : <><FormField label="กำหนดสิทธิ์เป็น :" required><select className="inp" value={approvalRole} onChange={event => setApprovalRole(event.target.value as Role)}><option value="hr">พนักงานฝ่ายธุรการ</option><option value="director">ผู้บริหาร</option><option value="admin">แอดมิน</option></select></FormField><div className="flex justify-end gap-3"><button className="btn btn-secondary" onClick={() => setApprovalRequest(null)}>ยกเลิก</button><button className="btn btn-danger" onClick={() => setRejectMode(true)}>ไม่อนุมัติสิทธิ์</button><button className="btn btn-primary" onClick={() => void approveRequest()}>อนุมัติและเปิดใช้งาน</button></div></>}</div></Modal>}
      {showCreate && <Modal title="เพิ่มผู้ใช้งาน" onClose={() => setShowCreate(false)}><div className="flex flex-col gap-4">
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>เลือกพนักงานที่มีข้อมูลจริงแล้ว ระบบจะใช้ชื่อและอีเมลจากข้อมูลพนักงานโดยอัตโนมัติ</div>
        <FormField label="พนักงาน" required><select className="inp" value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">เลือกพนักงาน</option>{employees.filter(e => !linkedEmployeeIds.has(e.id)).map(e => <option key={e.id} value={e.id}>{e.prefix}{e.first_name} {e.last_name}</option>)}</select></FormField>
        <FormField label="ชื่อผู้ใช้" required><input className="inp" value={username} onChange={e => setUsername(e.target.value)} /></FormField>
        <FormField label="รหัสผ่านชั่วคราว (อย่างน้อย 8 ตัวอักษร)" required><input className="inp" type="password" value={temporaryPassword} onChange={e => setTemporaryPassword(e.target.value)} /></FormField>
        <FormField label="สิทธิ์" required><select className="inp" value={newRole} onChange={e => setNewRole(e.target.value as Role)}><option value="hr">พนักงานฝ่ายธุรการ</option><option value="director">ผู้บริหาร</option><option value="admin">แอดมิน</option></select></FormField>
        <div className="flex justify-end gap-3"><button className="btn btn-secondary" disabled={creatingUser} onClick={() => setShowCreate(false)}>ยกเลิก</button><button className="btn btn-primary" aria-busy={creatingUser} disabled={!employeeId || username.trim().length < 3 || temporaryPassword.length < 8 || creatingUser} onClick={() => void create()}><BusyLabel busy={creatingUser} label="กำลังบันทึก…">บันทึกบัญชี</BusyLabel></button></div>
      </div></Modal>}
      {showInvite && <Modal title="สร้างคำเชิญเข้าใช้" onClose={() => !creatingInvite && setShowInvite(false)}><div className="flex flex-col gap-4"><div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>ผู้รับคำเชิญจะกรอกข้อมูลพนักงานและสร้างบัญชีเอง จากนั้นรอให้แอดมินอนุมัติ</div><FormField label="อีเมล" required><input className="inp" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} /></FormField><FormField label="สิทธิ์การใช้งานที่ต้องการ" required><select className="inp" value={inviteRole} onChange={e => setInviteRole(e.target.value as Role)}><option value="hr">พนักงานฝ่ายธุรการ</option><option value="director">ผู้บริหาร</option><option value="admin">แอดมิน</option></select></FormField>{inviteUrl && <div style={{ background: '#F4F0FF', borderRadius: 10, padding: 12, wordBreak: 'break-all', fontSize: 12 }}><strong>ลิงก์คำเชิญ (ใช้ได้ 7 วัน)</strong><br />{inviteUrl}<br /><button className="btn btn-ghost btn-xs" style={{ marginTop: 7 }} onClick={() => navigator.clipboard.writeText(inviteUrl)}>คัดลอกลิงก์</button></div>}<div className="flex justify-end gap-3"><button className="btn btn-secondary" disabled={creatingInvite} onClick={() => setShowInvite(false)}>ปิด</button><button className="btn btn-primary" aria-busy={creatingInvite} disabled={!inviteEmail || creatingInvite} onClick={() => void createInvite()}><BusyLabel busy={creatingInvite} label="กำลังสร้าง…">สร้างลิงก์คำเชิญ</BusyLabel></button></div></div></Modal>}
    </div>
  )
}



// ─── Root App ─────────────────────────────────────────────────────────────────
interface DatabaseDepartment {
  id: number
  name: string
}

function DatabaseDepartmentsPanel() {
  const [departments, setDepartments] = useState<DatabaseDepartment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadDepartments() {
      try {
        setLoading(true)
        setError('')

        const response = await fetch(
          'http://127.0.0.1:8000/api/departments'
        )

        if (!response.ok) {
          throw new Error(
            `โหลดข้อมูลไม่สำเร็จ รหัส ${response.status}`
          )
        }

        const result = await response.json()

        if (!result.success) {
          throw new Error('API ส่งข้อมูลหน่วยงานไม่สำเร็จ')
        }

        setDepartments(result.data)
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'เกิดข้อผิดพลาดในการโหลดข้อมูล'
        )
      } finally {
        setLoading(false)
      }
    }

    loadDepartments()
  }, [])

  return (
    <div
      className="card"
      style={{
        padding: 20,
        marginBottom: 24
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 17,
              fontWeight: 700
            }}
          >
            หน่วยงานจากฐานข้อมูล
          </div>

          <div
            style={{
              marginTop: 3,
              fontSize: 12.5,
              color: 'var(--text-secondary)'
            }}
          >
            ข้อมูลจาก PostgreSQL ผ่าน FastAPI
          </div>
        </div>

        {!loading && !error && (
          <span
            className="badge"
            style={{
              background: '#ECFDF3',
              color: '#027A48'
            }}
          >
            {departments.length} หน่วยงาน
          </span>
        )}
      </div>

      {loading && (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            background: 'rgba(205,180,255,0.15)'
          }}
        >
          กำลังโหลดข้อมูลหน่วยงาน...
        </div>
      )}

      {error && (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            background: '#FEF3F2',
            color: '#B42318'
          }}
        >
          ไม่สามารถโหลดข้อมูลได้: {error}
        </div>
      )}

      {!loading && !error && (
        <select
          defaultValue=""
          style={{
            width: '100%',
            padding: '11px 14px',
            borderRadius: 12,
            border: '1px solid rgba(0,0,0,0.12)',
            background: 'rgba(255,255,255,0.9)',
            fontSize: 14
          }}
        >
          <option value="" disabled>
            เลือกหน่วยงาน
          </option>

          {departments.map((department) => (
            <option
              key={department.id}
              value={department.id}
            >
              {department.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}





function InvitePage({ token }: { token: string }) {
  const [invite, setInvite] = useState<InviteData | null>(null)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({ national_id: '', prefix: '', custom_prefix: '', first_name: '', last_name: '', department_id: '', position_name: '', employee_type: 'CIVIL_SERVANT', employee_type_other: '', birth_date: '', start_date: '', end_date: '', email: '', phone: '', bank_name: '', bank_account_no: '', base_salary: '', username: '', password: '', confirm_password: '' })
  useEffect(() => { getInvite(token).then(data => { setInvite(data); setForm(current => ({ ...current, email: data.email })) }).catch(e => setError(e.message)) }, [token])
  const set = (key: string, value: string) => setForm(current => ({ ...current, [key]: value }))
  const uniqueDepartments = invite?.departments.filter((department, index, items) => items.findIndex(item => item.name.trim() === department.name.trim()) === index) ?? []
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    if (!form.birth_date) { setError('กรุณากรอกวันเดือนปีเกิดให้ครบถ้วน'); return }
    if (form.password !== form.confirm_password) { setError('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน'); return }
    setSaving(true)
    try {
      await submitInvite(token, { username: form.username, password: form.password, employee: {
        employee_code: '', national_id: form.national_id, prefix: form.prefix === 'OTHER' ? form.custom_prefix : form.prefix || null, first_name: form.first_name, last_name: form.last_name,
        department_id: Number(form.department_id) || null, position_id: null, employee_type: form.employee_type, status: 'ACTIVE',
        birth_date: form.birth_date || null, start_date: form.start_date || null, end_date: form.end_date || null, email: form.email, phone: form.phone || null,
        bank_name: form.bank_name || null, bank_account_no: form.bank_account_no || null, base_salary: Number(form.base_salary || 0), employee_type_other: form.employee_type === 'OTHER' ? form.employee_type_other : null
      }, position_name: form.position_name })
      setSubmitted(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'ส่งคำขอไม่สำเร็จ') } finally { setSaving(false) }
  }
  const field = (key: string, label: string, type = 'text', required = false, extra?: React.InputHTMLAttributes<HTMLInputElement>) => <FormField label={required ? label : `${label} (ไม่บังคับ)`} required={required}><input required={required} className="inp" type={type} value={form[key]} onChange={e => set(key, e.target.value)} {...extra} /></FormField>
  const passwordField = (key: 'password' | 'confirm_password', label: string, visible: boolean, setVisible: (visible: boolean) => void) => <FormField label={label} required><div style={{ position: 'relative' }}><input required minLength={8} className="inp" type={visible ? 'text' : 'password'} value={form[key]} onChange={e => set(key, e.target.value)} style={{ paddingRight: 44 }} /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} title={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 0, background: 'transparent', cursor: 'pointer', color: '#6B6480', display: 'grid', placeItems: 'center', padding: 5 }}><EyeIcon off={visible} /></button></div></FormField>
  const roleLabel = (role?: string) => role === 'hr' ? 'พนักงานฝ่ายธุรการ' : role === 'director' ? 'ผู้บริหาร' : 'แอดมิน'
  return <div style={{ minHeight: '100vh', background: '#F7F6FC', padding: '48px 20px', color: '#202124' }}><div style={{ maxWidth: 860, margin: 'auto', background: 'white', borderRadius: 20, padding: 32, boxShadow: '0 12px 36px rgba(78,57,138,.10)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}><img src={takhliLogo} style={{ width: 46, height: 46, borderRadius: '50%' }} /><div><strong style={{ fontSize: 22 }}>PayFlow</strong><div style={{ color: '#746D84', fontSize: 13 }}>ลงทะเบียนขอเข้าใช้งานระบบ</div></div></div>
    {error && <div style={{ background: '#FFF0F0', color: '#C23B3B', padding: 12, borderRadius: 9, marginBottom: 16 }}>{error}</div>}
    {!invite && !error && <div>กำลังตรวจสอบลิงก์คำเชิญ…</div>}
    {submitted ? <div style={{ textAlign: 'center', padding: '40px 0' }}><div style={{ fontSize: 42 }}>✓</div><h2>ส่งคำขอเรียบร้อย</h2><p style={{ color: '#6B7280' }}>แอดมินจะตรวจสอบข้อมูลพนักงานและกำหนดสิทธิ์ก่อนเปิดใช้งานบัญชี</p></div> : invite && <form onSubmit={save}>
      <div style={{ background: '#F0ECFF', padding: '12px 14px', borderRadius: 10, marginBottom: 22, fontSize: 14 }}>อีเมลคำเชิญ: <strong>{invite.email}</strong> · สิทธิ์การใช้งานที่ต้องการ: <strong>{roleLabel(invite.requested_role)}</strong></div>
      <p style={{ color: '#737080', fontSize: 13, marginBottom: 20 }}><span style={{ color: '#EF4444' }}>*</span> จำเป็นต้องกรอก · ช่องที่ระบุ “ไม่บังคับ” สามารถเว้นได้</p>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--purple-600)', marginBottom: 14 }}>ข้อมูลส่วนตัว</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 16, marginBottom: 24 }}>{field('national_id','เลขประจำตัวประชาชน','text',true,{ inputMode: 'numeric', maxLength: 13, onChange: e => set('national_id', e.target.value.replace(/\D/g, '')) })}<FormField label="คำนำหน้า (ไม่บังคับ)"><select className="inp" value={form.prefix} onChange={e => set('prefix', e.target.value)}><option value="">ไม่ระบุ</option>{EMPLOYEE_PREFIXES.map(option => <option key={option} value={option}>{option}</option>)}<option value="OTHER">อื่นๆ (โปรดระบุ)</option></select></FormField>{form.prefix === 'OTHER' && field('custom_prefix','คำนำหน้าอื่นๆ','text',true,{ maxLength: 20 })}{field('first_name','ชื่อ','text',true)}{field('last_name','นามสกุล','text',true)}<FormField label="วันเดือนปีเกิด (พ.ศ.)" required><BuddhistDateInput value={form.birth_date} onChange={value => set('birth_date', value)} required /></FormField><FormField label="อีเมล" required><input className="inp" type="email" value={form.email} readOnly style={{ background: '#F6F5F9' }} /></FormField>{field('phone','โทรศัพท์','tel')}</div>
      <div className="divider" /><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--purple-600)', marginBottom: 14 }}>ข้อมูลการทำงาน</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 16, marginBottom: 24 }}><FormField label="ฝ่าย" required><select className="inp" required value={form.department_id} onChange={e => set('department_id', e.target.value)}><option value="">ไม่ระบุ</option>{uniqueDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FormField><FormField label="ตำแหน่ง (ไม่บังคับ)"><input className="inp" list="invite-position-options" value={form.position_name} onChange={e => set('position_name', e.target.value)} /><datalist id="invite-position-options">{invite.positions.map(position => <option key={position.id} value={position.name} />)}</datalist></FormField><FormField label="ประเภทพนักงาน" required><select className="inp" value={form.employee_type} onChange={e => set('employee_type', e.target.value)}>{EMPLOYEE_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FormField>{form.employee_type === 'OTHER' && field('employee_type_other','ประเภทพนักงานอื่นๆ','text',true,{ maxLength: 150 })}<FormField label="วันที่เริ่มงาน (พ.ศ.) (ไม่บังคับ)"><BuddhistDateInput value={form.start_date} onChange={value => set('start_date', value)} /></FormField><FormField label="วันที่สิ้นสุด (พ.ศ.) (ไม่บังคับ)"><BuddhistDateInput value={form.end_date} onChange={value => set('end_date', value)} /></FormField></div>
      <div className="divider" /><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--purple-600)', marginBottom: 14 }}>ข้อมูลเงินเดือน</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 16 }}>{field('base_salary','ฐานเงินเดือน (บาท)','number',true,{ min: 0, step: '0.01' })}{field('bank_name','ธนาคาร')}{field('bank_account_no','เลขบัญชีธนาคาร')}</div>
      <div className="divider" /><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--purple-600)', marginBottom: 14 }}>สร้างบัญชี</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 16 }}>{field('username','ชื่อผู้ใช้','text',true)}{passwordField('password','รหัสผ่าน',showPassword,setShowPassword)}{passwordField('confirm_password','ยืนยันรหัสผ่าน',showConfirmPassword,setShowConfirmPassword)}</div>
      <button aria-busy={saving} disabled={saving} type="submit" style={{ marginTop: 26, width: '100%', border: 0, borderRadius: 10, padding: 13, background: '#7C4DDB', color: 'white', fontWeight: 700, fontSize: 15, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 6, cursor: saving ? 'progress' : 'pointer' }}><BusyLabel busy={saving} label="กำลังส่งคำขอ…">ส่งคำขอให้แอดมินตรวจสอบ</BusyLabel></button>
    </form>}
  </div></div>
}

export default function App() {
  const inviteMatch = window.location.pathname.match(/^\/invite\/([^/]+)$/)
  if (inviteMatch) return <InvitePage token={decodeURIComponent(inviteMatch[1])} />
  const [departments, setDepartments] = useState<Department[]>([])
  const [databaseEmployees, setDatabaseEmployees] = useState<DatabaseEmployee[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [employeeLoading, setEmployeeLoading] = useState(true)
  const [employeeError, setEmployeeError] = useState('')
  const [payrollError, setPayrollError] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [role, setRole] = useState<Role>('hr')
  const [userName, setUserName] = useState('')
  const [accountUsername, setAccountUsername] = useState('')
  const [userDepartment, setUserDepartment] = useState<string | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [showMyInfo, setShowMyInfo] = useState(false)
  const [showPasswordReset, setShowPasswordReset] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [page, setPage] = useState<Page>('dashboard')
  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [activePeriodId, setActivePeriodId] = useState<string>('')
  const [activeDeptId, setActiveDeptId] = useState<string>('')
  const [editEmpId, setEditEmpId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ msg: string; type?: 'success' | 'error'; key: number } | null>(null)
  const toastKey = useRef(0)

  const syncPayrollEmployeeEmails = useCallback((employees: DatabaseEmployee[]) => {
    const emailByCode = new Map(employees.map(employee => [employee.employee_code, employee.email ?? '']))
    setPeriods(current => current.map(period => ({
      ...period,
      depts: period.depts.map(department => ({
        ...department,
        employees: department.employees?.map(employee => ({ ...employee, email: emailByCode.get(employee.id) ?? employee.email })),
      })),
    })))
  }, [])

  const reloadEmployeeDirectory = useCallback(async (optimisticEmployee?: DatabaseEmployee) => {
    if (optimisticEmployee) {
      setDatabaseEmployees(current => {
        const existingIndex = current.findIndex(employee => employee.id === optimisticEmployee.id)
        return existingIndex >= 0
          ? current.map(employee => employee.id === optimisticEmployee.id ? optimisticEmployee : employee)
          : [...current, optimisticEmployee]
      })
    }
    const [employeeData, positionData] = await Promise.all([getEmployees(), getPositions()])
    setDatabaseEmployees(employeeData)
    setPositions(positionData)
    syncPayrollEmployeeEmails(employeeData)
  }, [syncPayrollEmployeeEmails])

  const updateEmailLocally = useCallback((employeeId: number, email: string) => {
    setDatabaseEmployees(current => current.map(employee => employee.id === employeeId ? { ...employee, email } : employee))
    setPeriods(current => current.map(period => ({
      ...period,
      depts: period.depts.map(department => ({
        ...department,
        employees: department.employees?.map(employee => employee.databaseId === employeeId ? { ...employee, email } : employee),
      })),
    })))
  }, [])

  const applyEmployeeSaved = useCallback((savedEmployee: DatabaseEmployee, createdPosition?: Position) => {
    setDatabaseEmployees(current => {
      const existingIndex = current.findIndex(employee => employee.id === savedEmployee.id)
      return existingIndex >= 0
        ? current.map(employee => employee.id === savedEmployee.id ? savedEmployee : employee)
        : [...current, savedEmployee]
    })
    if (createdPosition) {
      setPositions(current => current.some(position => position.id === createdPosition.id)
        ? current
        : [...current, createdPosition])
    }
    // Payroll figures are a historical snapshot, but a payslip must always use
    // the employee's latest email address.  Keep that small part in sync
    // locally rather than reloading the complete application payload.
    updateEmailLocally(savedEmployee.id, savedEmployee.email ?? '')
  }, [updateEmailLocally])

  const applyEmployeeDeactivated = useCallback((employeeId: number) => {
    setDatabaseEmployees(current => current.map(employee =>
      employee.id === employeeId ? { ...employee, status: 'TERMINATED' } : employee
    ))
  }, [])

  const loadEmployeeData = useCallback(async () => {
      try {
        setEmployeeLoading(true)
        setEmployeeError('')
        // One authenticated request avoids duplicate token checks and a second
        // browser round-trip on every login or full refresh.
        const { employees: employeeData, departments: departmentData, positions: positionData, payroll_periods: payrollData } = await getAppData()
        setDatabaseEmployees(employeeData)
        setDepartments(departmentData)
        setPositions(positionData)
        setEmployeeLoading(false)

        const mappedPeriods = mapPayrollPeriods(payrollData, employeeData, departmentData, positionData)
        setPeriods(mappedPeriods)
        setPayrollError('')
        setActivePeriodId(current => current && mappedPeriods.some(period => period.id === current) ? current : mappedPeriods[0]?.id ?? '')
        setActiveDeptId(current => current && mappedPeriods.some(period => period.depts.some(department => department.id === current)) ? current : mappedPeriods[0]?.depts[0]?.id ?? '')
      } catch (loadError) {
        setEmployeeError(loadError instanceof Error ? loadError.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล')
      } finally {
        setEmployeeLoading(false)
      }
  }, [])

  useEffect(() => {
    if (loggedIn) loadEmployeeData()
  }, [loggedIn, loadEmployeeData])

  const showToast = useCallback((msg: string, type?: 'success' | 'error') => {
    setToast({ msg, type, key: ++toastKey.current })
  }, [])

  const handleLogin = (username: string, name: string, r: Role, department: string | null) => {
    setUserName(name); setAccountUsername(username); setRole(r); setUserDepartment(department); setLoggedIn(true); setPage('dashboard')
  }

  const handleLogout = () => { clearAccessToken(); setProfileMenuOpen(false); setLoggedIn(false); setPage('login' as Page) }
  const roleLabel: Record<Role, string> = { hr: 'พนักงานฝ่ายธุรการ', director: 'ผู้บริหาร', admin: 'แอดมิน' }
  const saveMyPassword = async () => {
    if (newPassword.length < 8) { showToast('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร', 'error'); return }
    if (newPassword !== confirmNewPassword) { showToast('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน', 'error'); return }
    try { setPasswordSaving(true); await changeMyPassword(currentPassword, newPassword); setShowPasswordReset(false); setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword(''); showToast('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว', 'success') } catch (error) { showToast(error instanceof Error ? error.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ', 'error') } finally { setPasswordSaving(false) }
  }

  if (!loggedIn) return <LoginPage onLogin={handleLogin} />

  const visiblePeriods = role === 'hr' && userDepartment
    ? periods.map(period => ({ ...period, depts: period.depts.filter(department => department.department === userDepartment) }))
    : periods
  const visibleDepartments = role === 'hr' && userDepartment
    ? departments.filter(department => department.name === userDepartment)
    : departments
  const visibleDepartmentIds = new Set(visibleDepartments.map(department => department.id))
  const visibleEmployees = role === 'hr'
    ? databaseEmployees.filter(employee => employee.department_id !== null && visibleDepartmentIds.has(employee.department_id))
    : databaseEmployees

  const activePeriod = visiblePeriods.find(p => p.id === activePeriodId) ?? visiblePeriods[0]
  const activeDept = activePeriod?.depts.find(d => d.id === activeDeptId) ?? activePeriod?.depts[0]

  const pageTitle: Partial<Record<Page, string>> = {
    dashboard: 'หน้าหลัก', periods: 'รอบเงินเดือน', employees: 'พนักงาน',
    'payslip-status': 'สถานะการส่งอีเมล', 'director-approvals': 'อนุมัติเงินเดือน',
    'admin-users': 'จัดการผู้ใช้งาน', 'period-detail': 'รายละเอียดรอบเงินเดือน',
    'dept-table': 'รายละเอียดรอบเงินเดือน', 'director-detail': 'รายละเอียดการอนุมัติ',
    'employee-form': 'ข้อมูลพนักงาน',
  }
  const backTarget: Partial<Record<Page, Page>> = {
    'period-detail': 'periods',
    'dept-table': role === 'hr' ? 'periods' : 'period-detail',
    'director-detail': 'director-approvals',
    'employee-form': 'employees',
  }
  const canGoBack = Boolean(backTarget[page])

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Background />
      <Sidebar role={role} page={page} setPage={setPage} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Topbar */}
        <header style={{ background: 'rgba(255,255,255,0.80)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(0,0,0,0.06)', padding: '0 28px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, position: 'sticky', top: 0, zIndex: 10 }}>
          {canGoBack ? (
            <button
              type="button"
              onClick={() => setPage(backTarget[page] as Page)}
              aria-label="ย้อนกลับ"
              title="ย้อนกลับ"
              style={{ border: 0, background: 'transparent', color: '#4A3A78', cursor: 'pointer', fontSize: 14, fontWeight: 700, padding: '6px 0', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>←</span>
              <span>ย้อนกลับ</span>
            </button>
          ) : (
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A' }}>{pageTitle[page] ?? ''}</div>
          )}
          <div className="flex items-center gap-3" style={{ position: 'relative' }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>รอบปัจจุบัน: <strong style={{ color: '#1A1A1A' }}>{visiblePeriods[0] ? periodLabel(visiblePeriods[0]) : 'ยังไม่มีรอบเงินเดือน'}</strong></div>
            <button type="button" aria-label="เมนูผู้ใช้งาน" title="เมนูผู้ใช้งาน" onClick={() => setProfileMenuOpen(open => !open)} style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid #DCD7EC', background: '#FFFFFF', color: '#6C52D9', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}><PersonIcon /></button>
            {profileMenuOpen && <div style={{ position: 'absolute', top: 43, right: 0, width: 218, background: '#FFFFFF', border: '1px solid rgba(89,68,140,.14)', borderRadius: 12, boxShadow: '0 12px 28px rgba(39,28,66,.16)', padding: 6, zIndex: 30 }}><div style={{ padding: '9px 11px 10px', borderBottom: '1px solid rgba(0,0,0,.06)', marginBottom: 4 }}><div style={{ fontWeight: 700, fontSize: 13 }}>{userName}</div><div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{roleLabel[role]}</div></div><button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', fontSize: 13 }} onClick={() => { setProfileMenuOpen(false); setShowMyInfo(true) }}>ข้อมูลของฉัน</button><button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', fontSize: 13 }} onClick={() => { setProfileMenuOpen(false); setShowPasswordReset(true) }}>รีเซ็ตรหัสผ่าน</button><button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', color: '#C2413A', fontSize: 13 }} onClick={handleLogout}>ออกจากระบบ</button></div>}
          </div>
        </header>

        {showMyInfo && <Modal title="ข้อมูลของฉัน" onClose={() => setShowMyInfo(false)}><div className="flex flex-col gap-3"><div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '10px 16px', fontSize: 14 }}><span style={{ color: 'var(--text-secondary)' }}>ชื่อ</span><strong>{userName}</strong><span style={{ color: 'var(--text-secondary)' }}>ชื่อผู้ใช้</span><strong style={{ fontFamily: 'monospace' }}>{accountUsername}</strong><span style={{ color: 'var(--text-secondary)' }}>สิทธิ์</span><strong>{roleLabel[role]}</strong>{userDepartment && <><span style={{ color: 'var(--text-secondary)' }}>ฝ่าย</span><strong>{userDepartment}</strong></>}</div><div className="flex justify-end"><button className="btn btn-secondary" onClick={() => setShowMyInfo(false)}>ปิด</button></div></div></Modal>}
        {showPasswordReset && <Modal title="รีเซ็ตรหัสผ่าน" onClose={() => setShowPasswordReset(false)}><div className="flex flex-col gap-4"><FormField label="รหัสผ่านปัจจุบัน" required><input className="inp" type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></FormField><FormField label="รหัสผ่านใหม่" required><input className="inp" type="password" minLength={8} value={newPassword} onChange={event => setNewPassword(event.target.value)} /></FormField><FormField label="ยืนยันรหัสผ่านใหม่" required><input className="inp" type="password" minLength={8} value={confirmNewPassword} onChange={event => setConfirmNewPassword(event.target.value)} /></FormField><div className="flex justify-end gap-3"><button className="btn btn-secondary" disabled={passwordSaving} onClick={() => setShowPasswordReset(false)}>ยกเลิก</button><button className="btn btn-primary" aria-busy={passwordSaving} disabled={passwordSaving || !currentPassword || !newPassword || !confirmNewPassword} onClick={() => void saveMyPassword()}><BusyLabel busy={passwordSaving} label="กำลังบันทึก…">บันทึกรหัสผ่านใหม่</BusyLabel></button></div></div></Modal>}

        {/* Content */}
        <main style={{ flex: 1, padding: '28px 32px', overflowY: 'auto' }}>
          {page === 'dashboard' && (
            <Dashboard role={role} userName={userName} userDepartment={userDepartment} periods={visiblePeriods}
              employees={visibleEmployees} departments={visibleDepartments} setPage={setPage}
              setActivePeriodId={setActivePeriodId} setActiveDeptId={setActiveDeptId} />
          )}
          {page === 'periods' && (
            <PeriodsPage periods={visiblePeriods} setPage={setPage} setActivePeriodId={setActivePeriodId} setActiveDeptId={setActiveDeptId} role={role} userDepartment={userDepartment} reloadPayroll={loadEmployeeData} error={payrollError} />
          )}
          {page === 'period-detail' && activePeriod && role !== 'hr' && (
            <PeriodDetail period={activePeriod} setPage={setPage} setActiveDeptId={setActiveDeptId} role={role} />
          )}
          {(page === 'dept-table' || (page === 'period-detail' && role === 'hr')) && activePeriod && activeDept && (
            <DeptPayrollTable period={activePeriod} dept={activeDept} setPeriods={setPeriods} setPage={setPage} showToast={showToast}
              databaseEmployees={visibleEmployees} departments={departments} positions={positions} reloadPayroll={loadEmployeeData} />
          )}
          {page === 'director-approvals' && (
            <DirectorApprovals periods={visiblePeriods} setPage={setPage} setActivePeriodId={setActivePeriodId} setActiveDeptId={setActiveDeptId} />
          )}
          {page === 'director-detail' && activePeriod && activeDept && (
            <DirectorDetail period={activePeriod} dept={activeDept} setPeriods={setPeriods} setPage={setPage} showToast={showToast} reloadPayroll={loadEmployeeData} />
          )}
          {page === 'employees' && (
            <EmployeesPage
              employees={visibleEmployees}
              departments={visibleDepartments}
              positions={positions}
              loading={employeeLoading}
              error={employeeError}
              role={role}
              setPage={setPage}
              setEditEmpId={setEditEmpId}
              onChanged={applyEmployeeDeactivated}
              showToast={showToast}
            />
          )}
          {page === 'employee-form' && (
            <EmployeeForm empId={editEmpId} employees={visibleEmployees} departments={departments} positions={positions}
              setPage={setPage} showToast={showToast} onSaved={applyEmployeeSaved} />
          )}
          {page === 'payslip-status' && <PayslipStatus periods={visiblePeriods} onReload={loadEmployeeData} onEmployeeEmailUpdated={updateEmailLocally} showToast={showToast}
            onManageEmployees={() => setPage('employees')} />}
          {page === 'admin-users' && <AdminUsers employees={databaseEmployees} showToast={showToast} />}
        </main>
      </div>

      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
