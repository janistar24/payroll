import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import takhliLogo from './imports/takhli_logo_color.jpeg'
import {
  getDepartments,
  type Department
} from './api/departments'
import {
  createEmployee,
  getEmployees,
  updateEmployee,
  type Employee as DatabaseEmployee,
  type EmployeeSaveInput,
} from './api/employees'
import { createPosition, getPositions, type Position } from './api/positions'
// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'hr' | 'director' | 'admin'
type DeptStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'closed'
type EmailStatus = 'waiting' | 'sending' | 'sent' | 'failed'

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
  | 'reports'
  | 'admin-users'
  | 'admin-settings'

interface Employee {
  id: string
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
}

interface PayrollPeriod {
  id: string
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
  { value: 'OTHER', label: 'อื่น ๆ' },
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
  empId: e.id, extra: 0, posAllowance: e.position.startsWith('ครู') ? 5000 : e.position.includes('วิศวกร') ? 3000 : 0,
  debtKTB: 0, tax: Math.round(e.baseSalary * 0.05), social: 750, funeral: 200, ktb: 0, gsb: 0,
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
  return { id, periodId: pid, department: dept, status, rows, submittedBy: sub, submittedAt: subAt, approvedBy, approvedAt, rejectedAt, rejectionReason, updatedAt: subAt || '2025-07-28T09:00:00Z', emailStatuses }
}

const SEED_PERIODS: PayrollPeriod[] = [
  {
    id: 'PP-2025-07', month: 7, year: 2025, payDate: '2025-07-31', note: 'รอบเงินเดือนปกติ เดือนกรกฎาคม 2568',
    createdAt: '2025-07-20T08:00:00Z', createdBy: 'นางสาวสมใจ เจ้าหน้าที่ HR',
    depts: [
      buildDept('DP-01', 'PP-2025-07', 'สำนักปลัดเทศบาล',             'approved', 'นางสาวสมใจ HR', '2025-07-25T10:00:00Z', 'นายวิเชียร ผู้อำนวยการ', '2025-07-26T09:00:00Z'),
      buildDept('DP-02', 'PP-2025-07', 'กองคลัง',                      'approved', 'นางสาวสมใจ HR', '2025-07-25T11:00:00Z', 'นายวิเชียร ผู้อำนวยการ', '2025-07-26T09:30:00Z'),
      buildDept('DP-03', 'PP-2025-07', 'กองช่าง',                      'pending',  'นางสาวสมใจ HR', '2025-07-27T14:00:00Z'),
      buildDept('DP-04', 'PP-2025-07', 'กองสาธารณสุขและสิ่งแวดล้อม',   'rejected', 'นางสาวสมใจ HR', '2025-07-26T16:00:00Z', undefined, undefined, '2025-07-27T08:30:00Z', 'ยอดภาษีหัก ณ ที่จ่ายไม่ถูกต้อง กรุณาตรวจสอบและส่งใหม่'),
      buildDept('DP-05', 'PP-2025-07', 'กองการศึกษา',                  'draft'),
      buildDept('DP-06', 'PP-2025-07', 'กองยุทธศาสตร์และงบประมาณ',     'draft'),
    ],
  },
  {
    id: 'PP-2025-06', month: 6, year: 2025, payDate: '2025-06-30', note: '',
    createdAt: '2025-06-18T08:00:00Z', createdBy: 'นางสาวสมใจ เจ้าหน้าที่ HR',
    depts: DEPARTMENTS.map((dept, i) => buildDept(`DP-JUN-0${i+1}`, 'PP-2025-06', dept, 'closed', 'นางสาวสมใจ HR', '2025-06-22T10:00:00Z', 'นายวิเชียร ผู้อำนวยการ', '2025-06-23T09:00:00Z')),
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

const MONTH_TH = ['', 'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

const periodLabel = (p: PayrollPeriod) => `${MONTH_TH[p.month]} ${p.year + 543}`

const rowGross = (e: Employee, r: PayrollRow) => e.baseSalary + r.extra + r.posAllowance
const rowDeduct = (r: PayrollRow) => r.debtKTB + r.tax + r.social + r.funeral + r.ktb + r.gsb
const rowNet = (e: Employee, r: PayrollRow) => rowGross(e, r) - rowDeduct(r)

const deptEmps = (dept: DeptPayroll) => EMPLOYEES.filter(e => e.department === dept.department)
const deptTotals = (dept: DeptPayroll) => {
  const emps = deptEmps(dept)
  let totalBase = 0, totalExtra = 0, totalPos = 0, totalGross = 0, totalDeduct = 0, totalNet = 0
  emps.forEach(e => {
    const r = dept.rows[e.id] ?? makeDefaultRow(e)
    totalBase  += e.baseSalary
    totalExtra += r.extra
    totalPos   += r.posAllowance
    totalGross += rowGross(e, r)
    totalDeduct += rowDeduct(r)
    totalNet   += rowNet(e, r)
  })
  return { totalBase, totalExtra, totalPos, totalGross, totalDeduct, totalNet, count: emps.length }
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

function Sidebar({ role, name, department, page, setPage }: { role: Role; name: string; department: string | null; page: Page; setPage: (p: Page) => void }) {
  type NavEntry = { id: Page; label: string; icon: string }
  const hrNav: NavEntry[] = [
    { id: 'dashboard', label: 'หน้าหลัก', icon: '⊞' },
    { id: 'periods',   label: 'รอบเงินเดือน', icon: '◫' },
    { id: 'employees', label: 'พนักงาน', icon: '◉' },
    { id: 'reports',   label: 'รายงาน', icon: '◧' },
  ]
  const dirNav: NavEntry[] = [
    { id: 'dashboard',           label: 'หน้าหลัก', icon: '⊞' },
    { id: 'director-approvals',  label: 'อนุมัติเงินเดือน', icon: '◈' },
    { id: 'periods',             label: 'ประวัติรอบเงินเดือน', icon: '◫' },
  ]
  const adminNav: NavEntry[] = [
    { id: 'dashboard',     label: 'Dashboard ระบบ', icon: '⊞' },
    { id: 'admin-users',   label: 'จัดการผู้ใช้งาน', icon: '◉' },
    { id: 'admin-settings',label: 'ตั้งค่าระบบ', icon: '◧' },
    { id: 'reports',       label: 'ประวัติการใช้งาน', icon: '◫' },
  ]
  const navItems = role === 'hr' ? hrNav : role === 'director' ? dirNav : adminNav

  const roleLabel: Record<Role, string> = { hr: 'HR Officer', director: 'Director', admin: 'Administrator' }
  const roleBg: Record<Role, string> = { hr: 'var(--purple-100)', director: 'var(--blue-100)', admin: 'var(--salmon-100)' }

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
      {/* User */}
      <div className="px-4 py-4" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="flex items-center gap-3">
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: roleBg[role], display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: role === 'hr' ? 'var(--purple-600)' : role === 'director' ? '#1565C0' : '#9A3412', flexShrink: 0 }}>
            {name.split(' ')[0][0]}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1A1A1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{role === 'hr' && department ? `พนักงานธุรการฝ่าย${department}` : roleLabel[role]}</div>
          </div>
        </div>
      </div>
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

function KpiCard({ label, value, unit, icon, sub, accent }: { label: string; value: string; unit?: string; icon: string; sub?: string; accent?: string }) {
  const color = accent || 'var(--purple-600)'
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{icon}</div>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, color: '#1A1A1A', letterSpacing: '-0.02em', lineHeight: 1 }}>
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

// ─── Login Page ───────────────────────────────────────────────────────────────

function LoginPage({ onLogin }: { onLogin: (user: string, name: string, role: Role, department: string | null) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username || !password) { setError('กรุณากรอก Username และ Password'); return }
    setLoading(true)
    setTimeout(() => {
      const user = LOGIN_MAP[username]
      if (user && password === '1234') {
        onLogin(username, user.name, user.role, user.department)
      } else {
        setError('Username หรือ Password ไม่ถูกต้อง')
        setLoading(false)
      }
    }, 600)
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
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1A1A1A', marginBottom: 6 }}>Username</label>
            <input className="inp" value={username} onChange={e => setUsername(e.target.value)} placeholder="กรอก Username" autoComplete="username" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1A1A1A', marginBottom: 6 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input className="inp" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="กรอก Password" autoComplete="current-password" style={{ paddingRight: 44 }} />
              <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}>
                {showPw ? '◡' : '◠'}
              </button>
            </div>
          </div>
          {error && <div style={{ background: 'var(--status-rejected-bg)', border: '1px solid var(--status-rejected-border)', borderRadius: 10, padding: '9px 14px', fontSize: 13, color: 'var(--status-rejected-text)' }}>✕ {error}</div>}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: 4, height: 44, fontSize: 15 }}>
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 20 }}>
          ลืมรหัสผ่าน? กรุณาติดต่อผู้ดูแลระบบ
        </div>
        <div style={{ background: 'var(--purple-100)', borderRadius: 10, padding: '10px 14px', marginTop: 16, fontSize: 11.5, color: 'var(--purple-600)', lineHeight: 1.8 }}>
          <strong>Demo accounts (password: 1234)</strong><br />
          hr01 · director01 · admin01
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ role, userName, userDepartment, periods, setPage, setActivePeriodId, setActiveDeptId }: {
  role: Role; userName: string; userDepartment: string | null; periods: PayrollPeriod[];
  setPage: (p: Page) => void; setActivePeriodId: (id: string) => void; setActiveDeptId: (id: string) => void;
}) {
  const currentPeriod = periods[0]
  const prevPeriod = periods[1]
  const currentTotals = currentPeriod ? periodTotals(currentPeriod) : { base: 0, gross: 0, deduct: 0, net: 0, emps: 0 }
  const prevTotals = prevPeriod ? periodTotals(prevPeriod) : null

  const pendingDepts = currentPeriod?.depts.filter(d => d.status === 'pending') ?? []

  const monthLabels = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.']
  const lineData = [
    { label: 'รายการรับรวม', values: [820000, 835000, 828000, 842000, 851000, 838000, currentTotals.gross, 0].slice(0, 7), color: '#9C6FE4' },
    { label: 'รายการหักรวม', values: [92000,  94000,  91000,  95000,  97000,  93000,  currentTotals.deduct, 0].slice(0, 7), color: '#FFB4A2' },
    { label: 'ยอดรับสุทธิรวม', values: [728000, 741000, 737000, 747000, 754000, 745000, currentTotals.net, 0].slice(0, 7), color: '#22C55E' },
  ]

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

  const quickMenuItems = role === 'hr' ? [
    { step: '①', icon: '👥', label: 'ตรวจรายชื่อพนักงาน', sub: `ตรวจข้อมูลพนักงานใน${userDepartment ?? 'ฝ่ายของคุณ'}`, action: () => setPage('employees') },
    { step: '②', icon: '🧾', label: 'จัดทำข้อมูลเงินเดือน', sub: 'กรอกรายการรับและรายการหักของรอบปัจจุบัน', action: openCurrentDepartment },
    { step: '③', icon: '✅', label: 'ตรวจและส่งอนุมัติ', sub: 'ตรวจยอดรวมของฝ่ายก่อนส่งให้ผู้อำนวยการ', action: openCurrentDepartment },
    { step: '④', icon: '📨', label: 'ติดตามสลิปเงินเดือน', sub: 'ตรวจสถานะ PDF และการส่งอีเมลหลังอนุมัติ', action: () => setPage('payslip-status') },
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
                รอบเงินเดือน <strong style={{ color: '#1A1A1A' }}>{periodLabel(currentPeriod)}</strong> · วันที่จ่าย {new Date(currentPeriod.payDate).toLocaleDateString('th-TH')}
                {pendingDepts.length > 0 && <span style={{ marginLeft: 12, color: 'var(--status-pending-text)', fontWeight: 600 }}>◔ ข้อมูลฝ่ายรออนุมัติ</span>}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {role === 'hr' && <button className="btn btn-primary" onClick={openCurrentDepartment}>จัดทำเงินเดือนฝ่าย</button>}
            {role === 'director' && pendingDepts.length > 0 && <button className="btn btn-primary" onClick={() => setPage('director-approvals')}>◈ ดูรายการรออนุมัติ ({pendingDepts.length})</button>}
          </div>
        </div>
      </div>

      {role === 'hr' && (
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, marginBottom: 10 }}>ขั้นตอนการทำงานเงินเดือน</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            {quickMenuItems.map(item => (
              <button key={item.step} onClick={item.action} style={{ minHeight: 132, padding: '18px 20px', border: '1px solid rgba(112,78,190,0.72)', borderRadius: 16, cursor: 'pointer', textAlign: 'left', background: 'linear-gradient(135deg, #7654c2 0%, #8262ca 100%)', boxShadow: '0 5px 16px rgba(104,72,180,0.18)', color: '#fff', fontFamily: 'var(--font-sans)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 20, marginBottom: 10 }}><span>{item.step}</span><span>{item.icon}</span></div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.76)' }}>{item.sub}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Unified payroll summary */}
      <div className="dashboard-payroll-summary">
        <div className="dashboard-payroll-summary-head">
          <div>
            <div className="dashboard-payroll-summary-title">สรุปรอบเงินเดือน {currentPeriod ? periodLabel(currentPeriod) : ''}</div>
            <div className="dashboard-payroll-summary-subtitle">ภาพรวมรายการเงินเดือนของ{role === 'hr' && userDepartment ? userDepartment : 'ทุกฝ่าย'}</div>
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

      {/* Monthly trend */}
      <div className="card" style={{ padding: 24, width: '100%' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: '#1A1A1A' }}>แนวโน้มค่าใช้จ่ายรายเดือน</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>ข้อมูลย้อนหลัง 7 เดือน (บาท)</div>
          </div>
        </div>
        <LineChart datasets={lineData} labels={monthLabels} />
      </div>

      {/* Recent list */}
      <div className="card" style={{ padding: 24 }}>
        <div className="flex items-center justify-between mb-4">
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>รายการรอบเงินเดือนล่าสุด</div>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--purple-600)' }} onClick={() => setPage('periods')}>ดูทั้งหมด →</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>รอบเงินเดือน</th>
                <th>วันที่จ่าย</th>
                <th>จำนวนพนักงาน</th>
                <th style={{ textAlign: 'right' }}>รายการรับรวม (บาท)</th>
                <th style={{ textAlign: 'right' }}>ยอดรับสุทธิรวม (บาท)</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {periods.slice(0, 6).map(period => {
                const totals = periodTotals(period)
                const statuses = (['draft', 'pending', 'approved', 'rejected'] as DeptStatus[])
                  .map(status => ({ status, count: period.depts.filter(department => department.status === status).length }))
                  .filter(item => item.count > 0)
                return (
                  <tr key={period.id} style={{ cursor: 'pointer' }} onClick={() => {
                    setActivePeriodId(period.id)
                    if (role === 'hr' && period.depts[0]) {
                      setActiveDeptId(period.depts[0].id)
                      setPage('dept-table')
                    } else {
                      setPage('period-detail')
                    }
                  }}>
                    <td style={{ fontWeight: 600 }}>{periodLabel(period)}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{new Date(period.payDate).toLocaleDateString('th-TH')}</td>
                    <td>{totals.emps} คน</td>
                    <td className="num">{thb(totals.gross)}</td>
                    <td className="num" style={{ fontWeight: 600, color: 'var(--purple-600)' }}>{thb(totals.net)}</td>
                    <td>
                      <div className="flex gap-2 flex-wrap">
                        {statuses.map(item => <span key={item.status} className={`badge badge-${item.status}`}>{item.count > 1 ? `${item.count} ` : ''}{statusLabel[item.status]}</span>)}
                      </div>
                    </td>
                  </tr>
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

function PeriodsPage({ periods, setPeriods, setPage, setActivePeriodId, setActiveDeptId, role, userDepartment }: {
  periods: PayrollPeriod[]; setPeriods: React.Dispatch<React.SetStateAction<PayrollPeriod[]>>;
  setPage: (p: Page) => void; setActivePeriodId: (id: string) => void; setActiveDeptId: (id: string) => void;
  role: Role; userDepartment: string | null;
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [createMonth, setCreateMonth] = useState(String(new Date().getMonth() + 1))
  const [createYear, setCreateYear] = useState(String(new Date().getFullYear() + 543))
  const [createPayDate, setCreatePayDate] = useState('')
  const [createNote, setCreateNote] = useState('')

  const handleCreate = () => {
    const periodDepartments = role === 'hr' && userDepartment ? [userDepartment] : DEPARTMENTS
    const gregorianYear = parseInt(createYear) - 543
    const periodId = `PP-${gregorianYear}-${createMonth.padStart(2,'0')}`
    const newPeriod: PayrollPeriod = {
      id: periodId,
      month: parseInt(createMonth), year: gregorianYear, payDate: createPayDate, note: createNote,
      createdAt: new Date().toISOString(), createdBy: 'นางสาวสมใจ รักงาน',
      depts: periodDepartments.map((d, i) => buildDept(`DP-NEW-${i}`, periodId, d, 'draft')),
    }
    setPeriods(prev => [newPeriod, ...prev])
    setActivePeriodId(newPeriod.id)
    setShowCreate(false)
    if (role === 'hr' && newPeriod.depts[0]) {
      setActiveDeptId(newPeriod.depts[0].id)
      setPage('dept-table')
    } else {
      setPage('period-detail')
    }
  }

  return (
    <div className="anim">
      <PageHeader
        title="รอบเงินเดือน"
        subtitle="จัดการและติดตามรอบเงินเดือนทั้งหมด"
        actions={role === 'hr' ? <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ สร้างรอบเงินเดือน</button> : undefined}
      />
      <div className="flex flex-col gap-4">
        {periods.map(p => {
          const t = periodTotals(p)
          const approvedCount = p.depts.filter(d => d.status === 'approved').length
          const pendingCount = p.depts.filter(d => d.status === 'pending').length
          const rejectedCount = p.depts.filter(d => d.status === 'rejected').length
          const draftCount = p.depts.filter(d => d.status === 'draft').length
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
                    วันที่จ่าย {new Date(p.payDate).toLocaleDateString('th-TH')} · สร้างโดย {p.createdBy}
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>ยอดรับสุทธิรวม</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: '#1A1A1A' }}>{thbInt(Math.round(t.net))} บาท</div>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end" style={{ maxWidth: 220 }}>
                    {draftCount > 0    && <span className="badge badge-draft">{draftCount} แบบร่าง</span>}
                    {pendingCount > 0  && <span className="badge badge-pending">{pendingCount} รออนุมัติ</span>}
                    {approvedCount > 0 && <span className="badge badge-approved">{approvedCount} อนุมัติแล้ว</span>}
                    {rejectedCount > 0 && <span className="badge badge-rejected">{rejectedCount} ไม่อนุมัติ</span>}
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
                <select className="inp" value={createMonth} onChange={e => setCreateMonth(e.target.value)}>
                  {MONTH_TH.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>ปี (พ.ศ.) <span style={{ color: 'red' }}>*</span></label>
                <input className="inp" type="number" min="2500" max="2700" value={createYear} onChange={e => setCreateYear(e.target.value)} />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>วันที่จ่ายเงินเดือน <span style={{ color: 'red' }}>*</span></label>
              <input className="inp" type="date" value={createPayDate} onChange={e => setCreatePayDate(e.target.value)} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>หมายเหตุ</label>
              <textarea className="inp" rows={2} value={createNote} onChange={e => setCreateNote(e.target.value)} style={{ resize: 'none' }} />
            </div>
            <div className="flex gap-3 justify-end mt-2">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!createPayDate}>สร้างรอบเงินเดือน</button>
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
        subtitle={`วันที่จ่าย ${new Date(period.payDate).toLocaleDateString('th-TH')} · สร้างโดย ${period.createdBy}`}
        breadcrumb={<Crumb items={[{ label: 'รอบเงินเดือน', onClick: () => setPage('periods') }, { label: periodLabel(period) }]} />}
      />
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        <KpiCard label="จำนวนพนักงาน" value={thbInt(t.emps)} unit="คน" icon="◉" accent="var(--purple-600)" />
        <KpiCard label="ยอดรายการรับรวม" value={thbInt(Math.round(t.gross))} unit="บาท" icon="▲" accent="#22C55E" />
        <KpiCard label="ยอดรายการหักรวม" value={thbInt(Math.round(t.deduct))} unit="บาท" icon="▼" accent="#F59E0B" />
        <KpiCard label="ยอดรับสุทธิรวม" value={thbInt(Math.round(t.net))} unit="บาท" icon="◈" accent="#3B82F6" />
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
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(d.updatedAt).toLocaleDateString('th-TH')}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      {role === 'hr' && (d.status === 'draft' || d.status === 'rejected') && (
                        <button className="btn btn-primary btn-xs" onClick={() => { setActiveDeptId(d.id); setPage('dept-table') }}>
                          {d.status === 'rejected' ? 'แก้ไข' : 'เริ่มกรอก'}
                        </button>
                      )}
                      {(d.status === 'pending' || d.status === 'approved' || d.status === 'closed') && (
                        <button className="btn btn-secondary btn-xs" onClick={() => { setActiveDeptId(d.id); setPage(role === 'director' ? 'director-detail' : 'dept-table') }}>ดู</button>
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
  const [localVal, setLocalVal] = useState(value === 0 ? '' : String(value))
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { setLocalVal(value === 0 ? '' : String(value)) }, [value])

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
        onChange={e => setLocalVal(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && ref.current?.blur()}
      />
    </td>
  )
}

// ─── Dept Payroll Table ───────────────────────────────────────────────────────

function DeptPayrollTable({ period, dept, setPeriods, setPage, showToast }: {
  period: PayrollPeriod; dept: DeptPayroll; setPeriods: React.Dispatch<React.SetStateAction<PayrollPeriod[]>>;
  setPage: (p: Page) => void; showToast: (msg: string, t?: 'success' | 'error') => void;
}) {
  const allDepartmentEmployees = useMemo(() => EMPLOYEES.filter(e => e.department === dept.department), [dept.department])
  const [includedEmployeeIds, setIncludedEmployeeIds] = useState<string[]>(() => Object.keys(dept.rows))
  const emps = useMemo(
    () => allDepartmentEmployees.filter(employee => includedEmployeeIds.includes(employee.id)),
    [allDepartmentEmployees, includedEmployeeIds]
  )
  const [rows, setRows] = useState<Record<string, PayrollRow>>(() => {
    const r: Record<string, PayrollRow> = {}
    emps.forEach(e => { r[e.id] = dept.rows[e.id] ?? makeDefaultRow(e) })
    return r
  })
  const [dirty, setDirty] = useState(false)
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false)
  const [focusRow, setFocusRow] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [search, setSearch] = useState('')
  const isReadonly = dept.status === 'pending' || dept.status === 'approved' || dept.status === 'closed'
  const availableEmployees = allDepartmentEmployees.filter(employee => !includedEmployeeIds.includes(employee.id))
  const visibleEmployees = emps.filter(employee => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return true
    return employee.id.toLowerCase().includes(keyword) || `${employee.firstName} ${employee.lastName}`.toLowerCase().includes(keyword)
  })

  const setCell = useCallback((empId: string, field: keyof PayrollRow, val: number) => {
    setRows(prev => ({ ...prev, [empId]: { ...prev[empId], [field]: val } }))
    setDirty(true)
  }, [])

  const save = () => {
    setPeriods(prev => prev.map(p => p.id === period.id ? {
      ...p, depts: p.depts.map(d => d.id === dept.id ? { ...d, rows: { ...rows }, updatedAt: new Date().toISOString() } : d)
    } : p))
    setDirty(false)
    setEditing(false)
    showToast('บันทึกข้อมูลแบบร่างเรียบร้อยแล้ว', 'success')
  }

  const addEmployeeToTable = (employee: Employee) => {
    setRows(previous => ({ ...previous, [employee.id]: makeDefaultRow(employee) }))
    setIncludedEmployeeIds(previous => [...previous, employee.id])
    setDirty(true)
    setEditing(true)
    setShowAddEmployeeModal(false)
    showToast(`เพิ่ม ${employee.firstName} ${employee.lastName} เข้าตารางแล้ว`, 'success')
  }

  const submitForApproval = () => {
    setPeriods(prev => prev.map(p => p.id === period.id ? {
      ...p, depts: p.depts.map(d => d.id === dept.id ? { ...d, rows: { ...rows }, status: 'pending', submittedBy: 'นางสาวสมใจ รักงาน', submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : d)
    } : p))
    setDirty(false)
    setShowSubmitModal(false)
    showToast('ส่งข้อมูลให้ผู้อำนวยการอนุมัติแล้ว', 'success')
    setPage('dept-table')
  }

  const totals = useMemo(() => {
    let base = 0, gross = 0, deduct = 0, net = 0
    emps.forEach(e => {
      const r = rows[e.id]
      base += e.baseSalary
      gross += rowGross(e, r); deduct += rowDeduct(r); net += rowNet(e, r)
    })
    return { base, gross, deduct, net }
  }, [rows, emps])

  const handleFocus = useCallback((id: string) => setFocusRow(id), [])
  const handleCommit = useCallback((id: string, field: keyof PayrollRow, val: number) => {
    setCell(id, field, val)
  }, [setCell])

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
            {dirty && <span style={{ fontSize: 12, color: 'var(--status-pending-text)', fontWeight: 600 }}>● ยังไม่ได้บันทึก</span>}
            {dept.status !== 'pending' && <button className="btn btn-primary" onClick={() => { save(); setShowSubmitModal(true) }}>ส่งให้ผู้อำนวยการอนุมัติ →</button>}
          </>
        ) : <StatusBadge s={dept.status} />}
      />

      {/* Rejection notice */}
      {dept.status === 'rejected' && dept.rejectionReason && (
        <div style={{ background: 'var(--status-rejected-bg)', border: '1px solid var(--status-rejected-border)', borderRadius: 'var(--radius-sm)', padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--status-rejected-text)' }}>
          <strong>เหตุผลที่ไม่อนุมัติ:</strong> {dept.rejectionReason}
        </div>
      )}

      <div className="card" style={{ padding: '12px 14px', marginBottom: 16 }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap" style={{ flex: 1 }}>
            <input className="inp" style={{ maxWidth: 300 }} value={search} onChange={event => setSearch(event.target.value)} placeholder="🔍 ค้นหาชื่อหรือรหัสพนักงาน" />
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{visibleEmployees.length} รายการ</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn btn-secondary" onClick={() => setShowAddEmployeeModal(true)} disabled={isReadonly} title={isReadonly ? 'รอบนี้ถูกส่งอนุมัติหรืออนุมัติแล้ว จึงไม่สามารถเพิ่มพนักงานได้' : undefined}>➕ เพิ่มพนักงานเข้าตาราง</button>
            <button className="btn btn-secondary" onClick={() => setEditing(true)} disabled={isReadonly} title={isReadonly ? 'รอบนี้ถูกล็อก ไม่สามารถแก้ไขข้อมูลได้' : undefined}>✏️ แก้ไขข้อมูล</button>
            <button className="btn btn-primary" onClick={save} disabled={isReadonly || !dirty} title={isReadonly ? 'รอบนี้ถูกล็อก ไม่สามารถบันทึกข้อมูลได้' : undefined}>💾 บันทึก</button>
          </div>
        </div>
      </div>

      {/* Compact period metadata */}
      <div className="payroll-period-meta">
        <span>📅 วันที่จ่าย {new Date(period.payDate).toLocaleDateString('th-TH')}</span>
        <span>👥 {emps.length} คน</span>
        <span>🕘 แก้ไขล่าสุด {new Date(dept.updatedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</span>
        <StatusBadge s={dept.status} />
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table className="tbl payroll-detail-table" style={{ minWidth: 1200 }}>
          <thead>
            <tr>
              <th colSpan={5} className="th-group th-group-emp">ข้อมูลพนักงาน</th>
              <th colSpan={3} className="th-group th-group-income">รายการรับ</th>
              <th colSpan={7} className="th-group th-group-deduct">รายการหัก</th>
              <th colSpan={1} className="th-group th-group-net">ยอดรับสุทธิ</th>
            </tr>
            <tr>
              {/* Emp */}
              <th className="th-emp">#</th>
              <th className="th-emp">รหัส</th>
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
                  <td className="readonly">{e.id}</td>
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
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} style={{ fontWeight: 700 }}>รวมทั้งหมด ({emps.length} คน)</td>
              <td className="num">{thb(totals.base)}</td>
              <td />
              <td />
              <td className="num" style={{ color: '#15803D' }}>{thb(totals.gross)}</td>
              <td colSpan={6} />
              <td className="num" style={{ color: '#B91C1C' }}>{thb(totals.deduct)}</td>
              <td className="num" style={{ color: 'var(--purple-600)' }}>{thb(totals.net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {showAddEmployeeModal && (
        <Modal title="เพิ่มพนักงานเข้าตารางเงินเดือน" onClose={() => setShowAddEmployeeModal(false)}>
          {availableEmployees.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">👥</div><div>พนักงานในฝ่ายถูกเพิ่มเข้าตารางครบแล้ว</div><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>หากต้องการเพิ่มคนใหม่ ให้เพิ่มในเมนูพนักงานก่อน</div></div>
          ) : (
            <div className="flex flex-col gap-2">
              {availableEmployees.map(employee => (
                <button key={employee.id} className="btn btn-secondary" style={{ justifyContent: 'space-between' }} onClick={() => addEmployeeToTable(employee)}>
                  <span>{employee.title}{employee.firstName} {employee.lastName}</span><span style={{ color: 'var(--text-muted)' }}>{employee.id} · เพิ่ม</span>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Submit modal */}
      {showSubmitModal && (
        <Modal title="ยืนยันส่งให้ผู้อำนวยการอนุมัติ" onClose={() => setShowSubmitModal(false)}>
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
              หลังจากส่งอนุมัติแล้ว ท่านจะไม่สามารถแก้ไขข้อมูลได้ จนกว่าผู้อำนวยการจะไม่อนุมัติหรือส่งกลับมาแก้ไข
            </div>
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={() => setShowSubmitModal(false)}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={submitForApproval}>ยืนยันส่งอนุมัติ</button>
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
          <select className="inp" style={{ maxWidth: 180 }} value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}>
            <option value="all">ทุกรอบ</option>
            {periods.map(p => <option key={p.id} value={p.id}>{periodLabel(p)}</option>)}
          </select>
          <select className="inp" style={{ maxWidth: 220 }} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
            <option value="all">ทุกฝ่าย</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="inp" style={{ maxWidth: 160 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value as DeptStatus | 'all')}>
            <option value="all">ทุกสถานะ</option>
            <option value="pending">รออนุมัติ</option>
            <option value="approved">อนุมัติแล้ว</option>
            <option value="rejected">ไม่อนุมัติ</option>
          </select>
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
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.submittedAt ? new Date(d.submittedAt).toLocaleDateString('th-TH') : '–'}</td>
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

function DirectorDetail({ period, dept, setPeriods, setPage, showToast }: {
  period: PayrollPeriod; dept: DeptPayroll; setPeriods: React.Dispatch<React.SetStateAction<PayrollPeriod[]>>;
  setPage: (p: Page) => void; showToast: (msg: string, t?: 'success' | 'error') => void;
}) {
  const emps = useMemo(() => EMPLOYEES.filter(e => e.department === dept.department), [dept.department])
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const t = useMemo(() => deptTotals(dept), [dept])

  const handleApprove = () => {
    setPeriods(prev => prev.map(p => p.id === period.id ? {
      ...p, depts: p.depts.map(d => d.id === dept.id ? {
        ...d, status: 'approved' as DeptStatus,
        approvedBy: 'นายวิเชียร บริหารดี', approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        emailStatuses: Object.fromEntries(emps.map(e => [e.id, 'sent' as EmailStatus])),
      } : d)
    } : p))
    setShowApproveModal(false)
    showToast('อนุมัติเรียบร้อย — กำลังสร้าง PDF และส่งอีเมล', 'success')
    setPage('director-approvals')
  }

  const handleReject = () => {
    if (!rejectReason.trim()) return
    setPeriods(prev => prev.map(p => p.id === period.id ? {
      ...p, depts: p.depts.map(d => d.id === dept.id ? {
        ...d, status: 'rejected' as DeptStatus,
        rejectedAt: new Date().toISOString(), rejectionReason: rejectReason, updatedAt: new Date().toISOString(),
      } : d)
    } : p))
    setShowRejectModal(false)
    showToast('ส่งกลับไปให้ HR แก้ไขแล้ว', 'error')
    setPage('director-approvals')
  }

  return (
    <div className="anim">
      <PageHeader
        title={dept.department}
        subtitle={`${periodLabel(period)} · ส่งโดย ${dept.submittedBy ?? '–'} · ${dept.submittedAt ? new Date(dept.submittedAt).toLocaleDateString('th-TH') : ''}`}
        breadcrumb={<Crumb items={[{ label: 'อนุมัติเงินเดือน', onClick: () => setPage('director-approvals') }, { label: dept.department }]} />}
        actions={dept.status === 'pending' ? (
          <>
            <button className="btn btn-danger" onClick={() => setShowRejectModal(true)}>✕ ไม่อนุมัติ</button>
            <button className="btn btn-approve" onClick={() => setShowApproveModal(true)}>✓ อนุมัติ</button>
          </>
        ) : <StatusBadge s={dept.status} />}
      />

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        <KpiCard label="จำนวนพนักงาน" value={String(t.count)} unit="คน" icon="◉" accent="var(--purple-600)" />
        <KpiCard label="รายการรับรวม" value={thbInt(Math.round(t.totalGross))} unit="บาท" icon="▲" accent="#22C55E" />
        <KpiCard label="รายการหักรวม" value={thbInt(Math.round(t.totalDeduct))} unit="บาท" icon="▼" accent="#F59E0B" />
        <KpiCard label="ยอดรับสุทธิรวม" value={thbInt(Math.round(t.totalNet))} unit="บาท" icon="◈" accent="#3B82F6" />
      </div>

      {/* Read-only table */}
      <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table className="tbl" style={{ minWidth: 1200 }}>
          <thead>
            <tr>
              <th colSpan={5} className="th-group th-group-emp">ข้อมูลพนักงาน</th>
              <th colSpan={3} className="th-group th-group-income">รายการรับ</th>
              <th colSpan={7} className="th-group th-group-deduct">รายการหัก</th>
              <th colSpan={1} className="th-group th-group-net">ยอดรับสุทธิ</th>
            </tr>
            <tr>
              <th className="th-emp">#</th>
              <th className="th-emp">รหัส</th>
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
            {emps.map((e, idx) => {
              const r = dept.rows[e.id] ?? makeDefaultRow(e)
              const g = rowGross(e, r), d = rowDeduct(r), n = rowNet(e, r)
              return (
                <tr key={e.id}>
                  <td className="readonly" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{idx + 1}</td>
                  <td className="readonly">{e.id}</td>
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
              <td colSpan={4} style={{ fontWeight: 700 }}>รวมทั้งหมด ({emps.length} คน)</td>
              <td className="num">{thb(t.totalBase)}</td>
              <td className="num">{thb(t.totalExtra)}</td>
              <td className="num">{thb(t.totalPos)}</td>
              <td className="num" style={{ color: '#15803D' }}>{thb(t.totalGross)}</td>
              <td colSpan={6} />
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
              <button className="btn btn-secondary" onClick={() => setShowApproveModal(false)}>ยกเลิก</button>
              <button className="btn btn-approve" onClick={handleApprove}>✓ ยืนยันอนุมัติ</button>
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
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{rejectReason.length} ตัวอักษร · เหตุผลจะถูกส่งกลับไปให้ HR แก้ไข</div>
            </div>
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={() => setShowRejectModal(false)}>ยกเลิก</button>
              <button className="btn btn-danger" onClick={handleReject} disabled={!rejectReason.trim()}>✕ ยืนยันไม่อนุมัติ</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Employees ────────────────────────────────────────────────────────────────

function EmployeesPage({ employees, departments, positions, loading, error, role, setPage, setEditEmpId }: {
  employees: DatabaseEmployee[]
  departments: Department[]
  positions: Position[]
  loading: boolean
  error: string
  role: Role
  setPage: (page: Page) => void
  setEditEmpId: (id: number | null) => void
}) {
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('all')

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
    if (search && !name.includes(search) && !e.employee_code.includes(search)) return false
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

  return (
    <div className="anim">
      <PageHeader
        title="พนักงาน"
        subtitle={`พนักงานที่ใช้งานอยู่ ${activeCount} คน จากทั้งหมด ${employees.length} คน`}
        actions={<button className="btn btn-primary" onClick={() => { setEditEmpId(null); setPage('employee-form') }}>+ เพิ่มพนักงาน</button>}
      />
      <div className="card" style={{ padding: '14px 18px', marginBottom: 14 }}>
        <div className="flex items-center gap-3">
          <input className="inp" style={{ maxWidth: 240 }} placeholder="ค้นหาชื่อหรือรหัสพนักงาน..." value={search} onChange={e => setSearch(e.target.value)} />
          {role !== 'hr' && (
            <select className="inp" style={{ maxWidth: 220 }} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
              <option value="all">ทุกฝ่าย</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>รหัสพนักงาน</th>
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
            {loading && <tr><td colSpan={8}><div className="empty-state">กำลังโหลดข้อมูลพนักงานจากฐานข้อมูล...</div></td></tr>}
            {!loading && error && <tr><td colSpan={8}><div className="empty-state" style={{ color: '#B42318' }}>ไม่สามารถโหลดข้อมูลพนักงานได้: {error}</div></td></tr>}
            {!loading && !error && filtered.length === 0 && <tr><td colSpan={8}><div className="empty-state">ไม่พบพนักงานที่ตรงกับเงื่อนไข</div></td></tr>}
            {filtered.map(e => (
              <tr key={e.id}>
                <td style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>{e.employee_code}</td>
                <td style={{ fontWeight: 500 }}>{e.prefix}{e.first_name} {e.last_name}</td>
                <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{e.position_id ? positionById.get(e.position_id) ?? 'ไม่พบตำแหน่ง' : '–'}</td>
                <td style={{ fontSize: 12.5 }}>{e.department_id ? departmentById.get(e.department_id) ?? 'ไม่พบหน่วยงาน' : '–'}</td>
                <td className="num" style={{ fontWeight: 600 }}>{thb(Number(e.base_salary))}</td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{e.email ?? '–'}</td>
                <td><span className={`badge ${e.status === 'ACTIVE' ? 'badge-approved' : 'badge-rejected'}`}>● {statusLabel[e.status]}</span></td>
                <td>
                  <button className="btn btn-ghost btn-xs" onClick={() => { setEditEmpId(e.id); setPage('employee-form') }}>แก้ไข</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  onSaved: () => Promise<void>
}) {
  const emp = empId ? employees.find(employee => employee.id === empId) : null
  const initialPrefix = emp?.prefix ?? ''
  const [employeeCode, setEmployeeCode] = useState(emp?.employee_code ?? '')
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
  const [status, setStatus] = useState<DatabaseEmployee['status']>(emp?.status ?? 'ACTIVE')
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
    if (!employeeCode.trim() || nationalId.length !== 13 || !firstName.trim() || !lastName.trim() || !baseSalary || (prefixChoice === 'OTHER' && !customPrefix.trim())) {
      setSaveError('กรุณากรอกช่องที่จำเป็นให้ครบ และเลขประจำตัวประชาชนต้องมี 13 หลัก')
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
        employee_code: employeeCode.trim(),
        national_id: nationalId,
        prefix: resolvedPrefix || null,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        department_id: departmentId ? Number(departmentId) : null,
        position_id: resolvedPosition?.id ?? null,
        employee_type: employeeType,
        status,
        start_date: startDate || null,
        end_date: endDate || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        bank_name: bankName.trim() || null,
        bank_account_no: bankAccountNo.trim() || null,
        base_salary: baseSalary,
      }
      if (empId) await updateEmployee(empId, payload)
      else await createEmployee(payload)
      await onSaved()
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
          <FormField label="รหัสพนักงาน" required><input className="inp" value={employeeCode} onChange={e => setEmployeeCode(e.target.value)} /></FormField>
          <FormField label="เลขประจำตัวประชาชน" required><input className="inp" inputMode="numeric" maxLength={13} value={nationalId} onChange={e => setNationalId(e.target.value.replace(/\D/g, ''))} /></FormField>
          <FormField label="คำนำหน้า">
            <select className="inp" value={prefixChoice} onChange={e => setPrefixChoice(e.target.value)}>
              <option value="">ไม่ระบุ</option>
              {EMPLOYEE_PREFIXES.map(option => <option key={option} value={option}>{option}</option>)}
              <option value="OTHER">อื่นๆ (โปรดระบุ)</option>
            </select>
          </FormField>
          {prefixChoice === 'OTHER' && (
            <FormField label="คำนำหน้าอื่นๆ"><input className="inp" value={customPrefix} onChange={e => setCustomPrefix(e.target.value)} maxLength={20} placeholder="โปรดระบุคำนำหน้า" /></FormField>
          )}
          <FormField label="ชื่อ" required><input className="inp" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="ชื่อ" /></FormField>
          <FormField label="นามสกุล" required><input className="inp" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="นามสกุล" /></FormField>
          <FormField label="อีเมล"><input className="inp" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="example@muni.go.th" /></FormField>
          <FormField label="โทรศัพท์"><input className="inp" value={phone} onChange={e => setPhone(e.target.value)} /></FormField>
        </div>
        <div className="divider" />
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--purple-600)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.04em' }}>ข้อมูลการทำงาน</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <FormField label="ฝ่าย" required>
            <select className="inp" value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
              <option value="">ไม่ระบุ</option>
              {departments
                .filter(d => d.is_active && DEPARTMENTS.includes(d.name))
                .filter((department, index, options) => options.findIndex(option => option.name === department.name) === index)
                .map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </FormField>
          <FormField label="ตำแหน่ง">
            <input className="inp" list="employee-position-options" value={positionName} onChange={e => setPositionName(e.target.value)} placeholder="เลือกหรือพิมพ์ตำแหน่งใหม่" />
            <datalist id="employee-position-options">
              {positions.filter(p => p.is_active).map(p => <option key={p.id} value={p.name} />)}
            </datalist>
          </FormField>
          <FormField label="ประเภทพนักงาน" required>
            <select className="inp" value={employeeType} onChange={e => setEmployeeType(e.target.value as DatabaseEmployee['employee_type'])}>
              {EMPLOYEE_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </FormField>
          <FormField label="สถานะ" required>
            <select className="inp" value={status} onChange={e => setStatus(e.target.value as DatabaseEmployee['status'])}>
              <option value="ACTIVE">ปกติ</option><option value="ON_LEAVE">ลา</option><option value="RESIGNED">ลาออก</option><option value="RETIRED">เกษียณ</option><option value="TERMINATED">สิ้นสุดการจ้าง</option>
            </select>
          </FormField>
          <FormField label="วันที่เริ่มงาน"><input className="inp" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></FormField>
          <FormField label="วันที่สิ้นสุด"><input className="inp" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></FormField>
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
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
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

// ─── Payslip Status ───────────────────────────────────────────────────────────

function PayslipStatus({ periods }: { periods: PayrollPeriod[] }) {
  const approvedDepts = useMemo(() =>
    periods.flatMap(p => p.depts.filter(d => d.status === 'approved').map(d => ({ period: p, dept: d }))),
    [periods]
  )

  return (
    <div className="anim">
      <PageHeader title="สถานะการส่งสลิปเงินเดือน" subtitle="ติดตามสถานะ PDF และอีเมลสลิปเงินเดือนรายฝ่าย" />
      {approvedDepts.length === 0 && <div className="card"><div className="empty-state"><div className="empty-icon">✉</div><div>ยังไม่มีฝ่ายที่ได้รับการอนุมัติ</div></div></div>}
      {approvedDepts.map(({ period: p, dept: d }) => {
        const emps = EMPLOYEES.filter(e => e.department === d.department)
        const sentCount = emps.filter(e => d.emailStatuses?.[e.id] === 'sent').length
        return (
          <div key={d.id} className="card" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.07)', background: '#F0FDF4' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{d.department}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{periodLabel(p)} · อนุมัติโดย {d.approvedBy} · {d.approvedAt ? new Date(d.approvedAt).toLocaleDateString('th-TH') : ''}</div>
              </div>
              <div className="flex items-center gap-4">
                <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ส่งสำเร็จ</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: '#15803D' }}>{sentCount}/{emps.length}</div></div>
                <span className="badge badge-approved">✓ อนุมัติแล้ว</span>
              </div>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>รหัสพนักงาน</th>
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
                  const es = d.emailStatuses?.[e.id] ?? 'sent'
                  return (
                    <tr key={e.id}>
                      <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{e.id}</td>
                      <td>{e.title}{e.firstName} {e.lastName}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{e.email}</td>
                      <td><span className="badge badge-approved">✓ สร้างแล้ว</span></td>
                      <td><span className={`badge ${es === 'sent' ? 'badge-approved' : es === 'failed' ? 'badge-rejected' : 'badge-pending'}`}>{es === 'sent' ? '✓ ส่งสำเร็จ' : es === 'failed' ? '✕ ส่งไม่สำเร็จ' : '◔ รอส่ง'}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.approvedAt ? new Date(d.approvedAt).toLocaleDateString('th-TH') : '–'}</td>
                      <td>
                        <div className="flex gap-1">
                          <button className="btn btn-ghost btn-xs">ดูสลิป</button>
                          <button className="btn btn-ghost btn-xs">⬇ PDF</button>
                          {es === 'failed' && <button className="btn btn-secondary btn-xs">ส่งซ้ำ</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
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
          <select className="inp" style={{ maxWidth: 220 }} value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}>
            {periods.map(p => <option key={p.id} value={p.id}>{periodLabel(p)}</option>)}
          </select>
          <button className="btn btn-secondary btn-sm">แสดงผล</button>
          <div className="flex gap-2 ml-auto">
            <button className="btn btn-secondary btn-sm">⬇ Export Excel</button>
            <button className="btn btn-secondary btn-sm">⬇ Export PDF</button>
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

function AdminUsers({ users }: { users: UserAccount[] }) {
  const roleLabel: Record<Role, string> = { hr: 'HR Officer', director: 'Director', admin: 'Administrator' }
  return (
    <div className="anim">
      <PageHeader title="จัดการผู้ใช้งาน" subtitle="บัญชีผู้ใช้งานทั้งหมดในระบบ" actions={<button className="btn btn-primary">+ เพิ่มผู้ใช้งาน</button>} />
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr><th>Username</th><th>ชื่อ</th><th>Role</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{u.username}</td>
                <td style={{ fontWeight: 500 }}>{u.name}</td>
                <td><span style={{ background: 'var(--purple-100)', color: 'var(--purple-600)', borderRadius: 99, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{roleLabel[u.role]}</span></td>
                <td><span className={`badge ${u.active ? 'badge-approved' : 'badge-rejected'}`}>{u.active ? '● ใช้งานอยู่' : '● ปิดการใช้งาน'}</span></td>
                <td>
                  <div className="flex gap-1">
                    <button className="btn btn-ghost btn-xs">แก้ไข</button>
                    <button className="btn btn-ghost btn-xs">รีเซ็ตรหัสผ่าน</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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





export default function App() {
  const [departments, setDepartments] = useState<Department[]>([])
  const [databaseEmployees, setDatabaseEmployees] = useState<DatabaseEmployee[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [employeeLoading, setEmployeeLoading] = useState(true)
  const [employeeError, setEmployeeError] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [role, setRole] = useState<Role>('hr')
  const [userName, setUserName] = useState('')
  const [userDepartment, setUserDepartment] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [periods, setPeriods] = useState<PayrollPeriod[]>(SEED_PERIODS)
  const [users] = useState<UserAccount[]>(SEED_USERS)
  const [activePeriodId, setActivePeriodId] = useState<string>(SEED_PERIODS[0].id)
  const [activeDeptId, setActiveDeptId] = useState<string>(SEED_PERIODS[0].depts[0].id)
  const [editEmpId, setEditEmpId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ msg: string; type?: 'success' | 'error'; key: number } | null>(null)
  const toastKey = useRef(0)

  const loadEmployeeData = useCallback(async () => {
      try {
        setEmployeeLoading(true)
        setEmployeeError('')
        const [employeeData, departmentData, positionData] = await Promise.all([
          getEmployees(),
          getDepartments(),
          getPositions(),
        ])
        setDatabaseEmployees(employeeData)
        setDepartments(departmentData)
        setPositions(positionData)
      } catch (loadError) {
        setEmployeeError(loadError instanceof Error ? loadError.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล')
      } finally {
        setEmployeeLoading(false)
      }
  }, [])

  useEffect(() => {
    loadEmployeeData()
  }, [loadEmployeeData])

  const showToast = useCallback((msg: string, type?: 'success' | 'error') => {
    setToast({ msg, type, key: ++toastKey.current })
  }, [])

  const handleLogin = (username: string, name: string, r: Role, department: string | null) => {
    setUserName(name); setRole(r); setUserDepartment(department); setLoggedIn(true); setPage('dashboard')
  }

  const handleLogout = () => { setLoggedIn(false); setPage('login' as Page) }

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
    reports: 'รายงาน', 'director-approvals': 'อนุมัติเงินเดือน',
    'admin-users': 'จัดการผู้ใช้งาน', 'admin-settings': 'ตั้งค่าระบบ',
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Background />
      <Sidebar role={role} name={userName} department={userDepartment} page={page} setPage={setPage} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Topbar */}
        <header style={{ background: 'rgba(255,255,255,0.80)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(0,0,0,0.06)', padding: '0 28px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A' }}>{pageTitle[page] ?? ''}</div>
          <div className="flex items-center gap-3">
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>รอบปัจจุบัน: <strong style={{ color: '#1A1A1A' }}>{periodLabel(visiblePeriods[0])}</strong></div>
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--text-secondary)', fontSize: 13 }} onClick={handleLogout}>ออกจากระบบ</button>
          </div>
        </header>

        {/* Content */}
        <main style={{ flex: 1, padding: '28px 32px', overflowY: 'auto' }}>
          {page === 'dashboard' && (
            <Dashboard role={role} userName={userName} userDepartment={userDepartment} periods={visiblePeriods} setPage={setPage}
              setActivePeriodId={setActivePeriodId} setActiveDeptId={setActiveDeptId} />
          )}
          {page === 'periods' && (
            <PeriodsPage periods={visiblePeriods} setPeriods={setPeriods} setPage={setPage} setActivePeriodId={setActivePeriodId} setActiveDeptId={setActiveDeptId} role={role} userDepartment={userDepartment} />
          )}
          {page === 'period-detail' && activePeriod && role !== 'hr' && (
            <PeriodDetail period={activePeriod} setPage={setPage} setActiveDeptId={setActiveDeptId} role={role} />
          )}
          {(page === 'dept-table' || (page === 'period-detail' && role === 'hr')) && activePeriod && activeDept && (
            <DeptPayrollTable period={activePeriod} dept={activeDept} setPeriods={setPeriods} setPage={setPage} showToast={showToast} />
          )}
          {page === 'director-approvals' && (
            <DirectorApprovals periods={visiblePeriods} setPage={setPage} setActivePeriodId={setActivePeriodId} setActiveDeptId={setActiveDeptId} />
          )}
          {page === 'director-detail' && activePeriod && activeDept && (
            <DirectorDetail period={activePeriod} dept={activeDept} setPeriods={setPeriods} setPage={setPage} showToast={showToast} />
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
            />
          )}
          {page === 'employee-form' && (
            <EmployeeForm empId={editEmpId} employees={visibleEmployees} departments={visibleDepartments} positions={positions}
              setPage={setPage} showToast={showToast} onSaved={loadEmployeeData} />
          )}
          {page === 'payslip-status' && <PayslipStatus periods={visiblePeriods} />}
          {page === 'reports' && <ReportsPage periods={visiblePeriods} />}
          {page === 'admin-users' && <AdminUsers users={users} />}
          {page === 'admin-settings' && (
            <div className="anim">
              <PageHeader title="ตั้งค่าระบบ" />
              <div className="card" style={{ padding: 32, maxWidth: 560 }}>
                <div className="flex flex-col gap-4">
                  <FormField label="ชื่อหน่วยงาน"><input className="inp" defaultValue="เทศบาลตำบลสมุทร" /></FormField>
                  <FormField label="SMTP Server"><input className="inp" defaultValue="smtp.muni.go.th" /></FormField>
                  <FormField label="อีเมลผู้ส่ง"><input className="inp" defaultValue="payroll@muni.go.th" /></FormField>
                  <div className="flex gap-3 justify-end mt-2">
                    <button className="btn btn-primary" onClick={() => showToast('บันทึกการตั้งค่าแล้ว', 'success')}>บันทึก</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
