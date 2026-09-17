import { useMemo, useState } from 'react'
import takhliLogo from './imports/takhli_logo_color.jpeg'

type Role = 'hr' | 'director' | 'admin'
type Page = 'dashboard' | 'periods' | 'period-detail' | 'payroll' | 'employees' | 'employee-form' | 'payslip' | 'annual' | 'users'

const accounts: Record<string, { password: string; role: Role; name: string }> = {
  hr_demo: { password: 'demo1234', role: 'hr', name: 'นางสาวพิมพ์ชนก เจ้าหน้าที่ธุรการ' },
  director_demo: { password: 'demo1234', role: 'director', name: 'นายบริหาร งานเทศบาล' },
  admin_demo: { password: 'demo1234', role: 'admin', name: 'ผู้ดูแลระบบ PayFlow' },
}
const roleLabel: Record<Role, string> = { hr: 'พนักงานฝ่ายธุรการ', director: 'ผู้บริหาร', admin: 'แอดมิน' }
const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const people = [
  { name: 'นางสาวจณิสตา กันนิ่ม', org: 'เทศบาลเมืองตาคลี', position: 'นักวิชาการเงินและบัญชี', values: [520,520,520,520,520,520,520,520,550,0,0,0] },
  { name: 'นายสมชาย ใจดี', org: 'เทศบาลเมืองตาคลี', position: 'เจ้าพนักงานธุรการ', values: [380,380,380,380,380,380,380,380,400,0,0,0] },
  { name: 'นางสาวกมลชนก รักเรียน', org: 'ศูนย์พัฒนาเด็กเล็ก', position: 'ครู', values: [450,450,450,450,450,450,450,450,480,0,0,0] },
]
const money = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Login({ onLogin }: { onLogin: (role: Role, name: string) => void }) {
  const [username, setUsername] = useState('hr_demo')
  const [password, setPassword] = useState('demo1234')
  const [error, setError] = useState('')
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); const account = accounts[username]
    if (!account || account.password !== password) return setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    onLogin(account.role, account.name)
  }
  return <div className="demo-login-wrap"><form className="demo-login" onSubmit={submit}>
    <div className="demo-ribbon">ข้อมูลสาธิต — ไม่เชื่อมต่อฐานข้อมูลจริง</div>
    <img src={takhliLogo} /><h1><span>Pay</span>Flow</h1><p>ระบบจัดทำเงินเดือนและส่งสลิปเงินเดือน</p>
    <label>ชื่อผู้ใช้</label><input value={username} onChange={e => setUsername(e.target.value)} />
    <label>รหัสผ่าน</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} />
    {error && <div className="demo-error">{error}</div>}<button>เข้าสู่ระบบสาธิต</button>
    <div className="demo-accounts"><strong>บัญชีสำหรับเข้าชม</strong><code>hr_demo / demo1234</code><code>director_demo / demo1234</code><code>admin_demo / demo1234</code></div>
  </form></div>
}

function Dashboard({ role }: { role: Role }) {
  return <>
    <div className="demo-filter"><strong>ข้อมูลที่แสดง</strong><select><option>กันยายน</option></select><select><option>2569</option></select>{role !== 'hr' && <select><option>ทุกฝ่าย</option><option>กองคลัง</option><option>กองการศึกษา</option></select>}</div>
    <section className="demo-summary"><div><small>ยอดรับสุทธิรวม</small><b>128,570.00</b><span>บาท</span></div><ul><li>ฐานเงินเดือนรวม <b>150,000.00 บาท</b></li><li>รายการรับรวม <b>156,800.00 บาท</b></li><li>รายการหักรวม <b className="red">28,230.00 บาท</b></li></ul></section>
    <div className="demo-grid"><section className="demo-card"><h3>แนวโน้มค่าใช้จ่ายรายเดือน</h3><p>ข้อมูลย้อนหลัง 7 เดือน (บาท)</p><div className="bars">{[58,65,61,72,69,80,76].map((h,i)=><i key={i} style={{height:`${h}%`}} />)}</div><div className="axis"><span>มี.ค.</span><span>เม.ย.</span><span>พ.ค.</span><span>มิ.ย.</span><span>ก.ค.</span><span>ส.ค.</span><span>ก.ย.</span></div></section><section className="demo-card"><h3>รายการรับสะสมตามประเภท</h3><div className="donut"><strong>156,800</strong><span>รวมทั้งหมด</span></div><div className="legend">● ฐานเงินเดือน&nbsp;&nbsp; ● เงินเพิ่ม&nbsp;&nbsp; ● เงินประจำตำแหน่ง</div></section></div>
    <section className="demo-card annual-chart"><div><h3>ภาษีหัก ณ ที่จ่ายสะสมรายปี</h3><p>กองคลัง · เฉพาะรอบเงินเดือนที่อนุมัติแล้ว</p></div><b>4,230.00 <small>บาท</small></b><div className="tax-bars">{[45,48,44,52,55,58,61,64,70,0,0,0].map((h,i)=><span key={i}><i style={{height:`${h}%`}}></i><em>{months[i]}</em></span>)}</div></section>
  </>
}

function Periods({ onOpen }: { onOpen: () => void }) {
  return <><div className="demo-title"><div><h2>รอบเงินเดือน</h2><p>จัดการและติดตามรอบเงินเดือนทั้งหมด</p></div><button>+ สร้างรอบเงินเดือน</button></div><section className="demo-period clickable" onClick={onOpen}><div><h3>กันยายน 2569</h3><p>วันที่จ่าย 30/09/2569 · สร้างโดย พนักงานฝ่ายธุรการ กองคลัง</p></div><div><small>ยอดรับสุทธิรวม</small><b>128,570.00 บาท</b></div><span className="approved">✓ อนุมัติแล้ว 1/1 ฝ่าย</span><span>›</span></section></>
}

function PeriodDetail({ role, onTable }: { role: Role; onTable: () => void }) {
  return <><div className="demo-title"><div><p>รอบเงินเดือน › กันยายน 2569</p><h2>รายละเอียดรอบเงินเดือน</h2></div></div><section className="demo-card period-head"><div><small>วันที่จ่าย</small><b>30 กันยายน 2569</b></div><div><small>จำนวนพนักงาน</small><b>3 คน</b></div><div><small>ยอดรับสุทธิรวม</small><b>128,570.00 บาท</b></div></section><h3 className="section-label">สถานะการอนุมัติแต่ละฝ่าย</h3><section className="demo-period clickable" onClick={onTable}><div><h3>กองคลัง</h3><p>แก้ไขล่าสุดโดย นางสาวพิมพ์ชนก เจ้าหน้าที่ธุรการ · 17 ก.ย. 2569 13:42</p></div><div><small>ยอดรับสุทธิ</small><b>128,570.00 บาท</b></div><span className="approved">✓ อนุมัติแล้ว</span><span>ดู ›</span></section>{role !== 'hr' && <section className="demo-period"><div><h3>กองการศึกษา</h3><p>พนักงาน 2 คน</p></div><div><small>ยอดรับสุทธิ</small><b>72,400.00 บาท</b></div><span className="pending">● รออนุมัติ</span><span>ดู ›</span></section>}</>
}

function PayrollTable({ role }: { role: Role }) {
  const payroll = [
    ['นางสาวจณิสตา กันนิ่ม','นักวิชาการเงินและบัญชี','เทศบาลเมืองตาคลี',30000,1200,500,31700,550,1100,30050],
    ['นายสมชาย ใจดี','เจ้าพนักงานธุรการ','เทศบาลเมืองตาคลี',22000,800,0,22800,400,760,21640],
    ['นางสาวกมลชนก รักเรียน','ครู','ศูนย์พัฒนาเด็กเล็ก',28000,1000,3000,32000,480,900,30620],
  ]
  return <><div className="demo-title"><div><p>รอบเงินเดือน › กันยายน 2569 › กองคลัง</p><h2>กองคลัง</h2></div><button>{role==='director'?'อนุมัติรายการ':'✏️ แก้ไขข้อมูล'}</button></div><div className="payroll-tools"><input placeholder="ค้นหาชื่อพนักงาน"/><button>🗂️ ดูประวัติฉบับก่อน</button><button>🖨️ พิมพ์ตาราง</button><button>📥 ส่งออก Excel</button></div><div className="payroll-meta"><span>📅 วันที่จ่าย 30/09/2569</span><span>👥 3 คน</span><span>🕘 แก้ไขล่าสุดโดย นางสาวพิมพ์ชนก เจ้าหน้าที่ธุรการ</span><span className="approved">✓ อนุมัติแล้ว</span></div><section className="demo-report"><div className="table-scroll"><table className="payroll-table"><thead><tr><th rowSpan={2}>ที่</th><th rowSpan={2}>ชื่อ-นามสกุล</th><th rowSpan={2}>ตำแหน่ง</th><th rowSpan={2}>หน่วยงาน</th><th colSpan={4}>รายการรับ</th><th colSpan={3}>รายการหัก</th><th rowSpan={2}>รับสุทธิ</th></tr><tr><th>ฐานเงินเดือน</th><th>เงินเพิ่ม</th><th>เงินประจำตำแหน่ง</th><th>รวมรายการรับ</th><th>ภาษี</th><th>ประกันสังคม</th><th>รวมรายการหัก</th></tr></thead><tbody>{payroll.map((r,i)=><tr key={String(r[0])}><td>{i+1}</td><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td>{r.slice(3).map((v,j)=><td className="num" key={j}>{money(Number(v))}</td>)}</tr>)}</tbody><tfoot><tr><td colSpan={4}>รวมทั้งสิ้น</td><td className="num">80,000.00</td><td className="num">3,000.00</td><td className="num">3,500.00</td><td className="num">86,500.00</td><td className="num">1,430.00</td><td className="num">2,760.00</td><td className="num">4,190.00</td><td className="num">82,310.00</td></tr></tfoot></table></div></section></>
}

function Employees({ onForm }: { onForm: () => void }) {
  return <><div className="demo-title"><div><h2>พนักงาน</h2><p>จัดการข้อมูลพนักงานและข้อมูลสำหรับจัดทำเงินเดือน</p></div><div><button className="light">🖨️ พิมพ์</button><button className="light">📥 ส่งออก Excel</button><button onClick={onForm}>+ เพิ่มพนักงาน</button></div></div><div className="payroll-tools"><input placeholder="ค้นหาชื่อพนักงาน"/><select><option>ทุกหน่วยงาน</option></select><span>พนักงานทั้งหมด 3 คน</span></div><section className="demo-report"><table className="employee-table"><thead><tr><th>ชื่อ-นามสกุล</th><th>ฝ่าย</th><th>หน่วยงาน</th><th>ตำแหน่ง</th><th>อีเมล</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead><tbody>{people.map((p,i)=><tr key={p.name}><td><b>{p.name}</b></td><td>กองคลัง</td><td>{p.org}</td><td>{p.position}</td><td>employee{i+1}@example.go.th</td><td><span className="approved">● ปฏิบัติงาน</span></td><td><button className="text-btn" onClick={onForm}>แก้ไข</button></td></tr>)}</tbody></table></section></>
}

function EmployeeForm() {
  const fields = ['คำนำหน้า *','ชื่อ *','นามสกุล *','เลขประจำตัวประชาชน *','วันเดือนปีเกิด *','อีเมล','ฝ่าย *','หน่วยงาน','ตำแหน่ง','ประเภทพนักงาน *','วันที่เริ่มงาน','ฐานเงินเดือน (บาท) *','ธนาคาร','เลขบัญชีธนาคาร']
  return <><div className="demo-title"><div><h2>เพิ่มข้อมูลพนักงาน</h2><p>กรอกข้อมูลให้ครบถ้วน ช่องที่มี * จำเป็นต้องกรอก</p></div></div><section className="demo-form"><h3>ข้อมูลส่วนบุคคล</h3><div>{fields.map((field,i)=><label key={field}>{field}<input value={i===0?'นางสาว':i===1?'ตัวอย่าง':i===2?'พนักงาน':''} readOnly placeholder={field.replace(' *','')}/></label>)}</div><footer><button className="light">ยกเลิก</button><button>บันทึกข้อมูลพนักงาน</button></footer></section></>
}

function Payslip() {
  return <><div className="demo-title"><div><h2>สถานะการส่งอีเมล</h2><p>ติดตามและส่งใบแจ้งยอดเงินเดือนให้พนักงาน</p></div></div><section className="payslip-period"><header><div><small>รอบเงินเดือน</small><h2>กันยายน 2569</h2><p>วันที่จ่าย 30/09/2569 · 1 ฝ่ายที่อนุมัติแล้ว</p></div><button>📨 ส่งอีเมลทั้งหมด</button></header><div className="payslip-dept"><div><h3>กองคลัง</h3><p>อนุมัติโดย ผู้บริหาร · 17/09/2569</p></div><b>ส่งสำเร็จ 2/3</b></div><table className="employee-table"><thead><tr><th>ชื่อ-นามสกุล</th><th>อีเมล</th><th>สถานะ PDF</th><th>สถานะอีเมล</th><th>วันที่ส่ง</th><th>ดำเนินการ</th></tr></thead><tbody>{people.map((p,i)=><tr key={p.name}><td>{p.name}</td><td>employee{i+1}@example.go.th ✎</td><td><span className="approved">✓ สร้างแล้ว</span></td><td><span className={i===2?'pending':'approved'}>{i===2?'● รอส่ง':'✓ ส่งสำเร็จ'}</span></td><td>{i===2?'–':'17 ก.ย. 2569 14:20'}</td><td><button className="text-btn">ดูสลิป</button> <button className="mini-btn">{i===2?'ส่ง':'ส่งอีกครั้ง'}</button></td></tr>)}</tbody></table></section></>
}

function Users() {
  return <><div className="demo-title"><div><h2>จัดการผู้ใช้งาน</h2><p>สร้างบัญชีและกำหนดสิทธิ์จากข้อมูลพนักงานจริง</p></div><div><button className="light">↻ รีเฟรช</button><button className="light">✉ สร้างคำเชิญ</button><button>+ เพิ่มผู้ใช้งาน</button></div></div><section className="demo-report"><table className="employee-table"><thead><tr><th>Username</th><th>ชื่อ</th><th>รหัสผ่าน</th><th>Role</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead><tbody><tr><td>admin_demo</td><td>ผู้ดูแลระบบ PayFlow</td><td>•••••••• ◉</td><td><span className="role-tag">แอดมิน</span></td><td><span className="approved">● ใช้งานอยู่</span></td><td><button className="text-btn">รีเซ็ตรหัสผ่าน</button> <button className="danger-btn">ลบ</button></td></tr><tr><td>hr_demo</td><td>นางสาวพิมพ์ชนก เจ้าหน้าที่ธุรการ</td><td>•••••••• ◉</td><td><span className="role-tag">พนักงานฝ่ายธุรการ</span></td><td><span className="approved">● ใช้งานอยู่</span></td><td><button className="text-btn">ปิดการใช้งาน</button> <button className="danger-btn">ลบ</button></td></tr><tr><td>director_demo</td><td>นายบริหาร งานเทศบาล</td><td>•••••••• ◉</td><td><span className="role-tag">ผู้บริหาร</span></td><td><span className="approved">● ใช้งานอยู่</span></td><td><button className="text-btn">รีเซ็ตรหัสผ่าน</button> <button className="danger-btn">ลบ</button></td></tr></tbody></table></section><h3 className="section-label">คำขอเข้าใช้งานที่รอตรวจสอบ</h3><section className="demo-period"><div><h3>นางสาวตัวอย่าง ผู้สมัคร</h3><p>applicant@example.go.th · ขอสิทธิ์พนักงานฝ่ายธุรการ</p></div><span className="pending">● รอตรวจสอบ</span><button className="mini-btn">ตรวจสอบและอนุมัติ</button><button className="danger-btn">ไม่อนุมัติ</button></section></>
}

function Annual({ role }: { role: Role }) {
  const [kind, setKind] = useState<'tax'|'income'>('tax')
  const rows = useMemo(() => people.map(person => ({...person, values: kind === 'tax' ? person.values : person.values.map((v,i) => i <= 8 ? v * 45 : 0)})), [kind])
  const totals = months.map((_,i)=>rows.reduce((sum,row)=>sum+row.values[i],0))
  return <><div className="demo-title"><div><h2>รายงานประจำปี</h2><p>สรุปรายการนำส่งภาษีหรือรายได้รวมจากรอบเงินเดือนที่อนุมัติแล้ว</p></div><div><button className="light">🖨️ พิมพ์รายงาน</button><button>📥 ส่งออก Excel</button></div></div>
    <div className="demo-filter"><label>ประเภทรายงาน<select value={kind} onChange={e=>setKind(e.target.value as 'tax'|'income')}><option value="tax">รายการนำส่งภาษี</option><option value="income">รายได้รวมทั้งปี</option></select></label><label>ปี (พ.ศ.)<select><option>2569</option></select></label><label>หน่วยงาน<select disabled={role==='hr'}><option>{role==='hr'?'กองคลัง':'ทุกฝ่าย'}</option></select></label><span>แสดงเฉพาะรอบเงินเดือนที่อนุมัติแล้ว</span></div>
    <section className="demo-report"><header><div><h3>{kind==='tax'?'รายการนำส่งภาษี':'รายได้รวมทั้งปี'}</h3><p>ปี พ.ศ. 2569 · {role==='hr'?'กองคลัง':'ทุกฝ่าย'}</p></div><b>รวม {money(totals.reduce((a,b)=>a+b,0))} บาท</b></header><div className="table-scroll"><table><thead><tr><th rowSpan={2}>ที่</th><th rowSpan={2}>ชื่อ-นามสกุล</th><th rowSpan={2}>หน่วยงาน</th><th rowSpan={2}>ตำแหน่ง</th><th colSpan={12}>{kind==='tax'?'ยอดหักภาษี':'รายได้รวม'}</th><th rowSpan={2}>รวม</th></tr><tr>{months.map(m=><th key={m}>{m}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={row.name}><td>{index+1}</td><td>{row.name}</td><td>{row.org}</td><td>{row.position}</td>{row.values.map((v,i)=><td key={i} className="num">{i<=8?money(v):'–'}</td>)}<td className="num total">{money(row.values.reduce((a,b)=>a+b,0))}</td></tr>)}</tbody><tfoot><tr><td colSpan={4}>รวมทั้งสิ้น</td>{totals.map((v,i)=><td key={i} className="num">{i<=8?money(v):'–'}</td>)}<td className="num">{money(totals.reduce((a,b)=>a+b,0))}</td></tr></tfoot></table></div></section></>
}

export default function DemoApp() {
  const [session, setSession] = useState<{role:Role;name:string}|null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [profileOpen, setProfileOpen] = useState(false)
  if (!session) return <Login onLogin={(role,name)=>setSession({role,name})} />
  const menu: {id:Page;label:string;icon:string}[] = [{id:'dashboard',label:'หน้าหลัก',icon:'🏠'},{id:'periods',label:'รอบเงินเดือน',icon:'📅'},{id:'employees',label:'พนักงาน',icon:'👥'},{id:'payslip',label:'สถานะการส่งอีเมล',icon:'📨'},{id:'annual',label:'รายงานประจำปี',icon:'📊'}]
  if (session.role==='admin') menu.push({id:'users',label:'จัดการผู้ใช้งาน',icon:'👤'})
  const periodActive = ['periods','period-detail','payroll'].includes(page)
  const employeeActive = ['employees','employee-form'].includes(page)
  const goBack: Page|null = page==='period-detail'?'periods':page==='payroll'?'period-detail':page==='employee-form'?'employees':null
  const content = page==='dashboard'?<Dashboard role={session.role}/>:page==='periods'?<Periods onOpen={()=>setPage(session.role==='hr'?'payroll':'period-detail')}/>:page==='period-detail'?<PeriodDetail role={session.role} onTable={()=>setPage('payroll')}/>:page==='payroll'?<PayrollTable role={session.role}/>:page==='employees'?<Employees onForm={()=>setPage('employee-form')}/>:page==='employee-form'?<EmployeeForm/>:page==='payslip'?<Payslip/>:page==='annual'?<Annual role={session.role}/>:<Users/>
  return <div className="demo-shell"><aside><div className="demo-brand"><img src={takhliLogo}/><div><b><span>Pay</span>Flow</b><small>ระบบจัดทำเงินเดือน</small></div></div><nav>{menu.map(item=><button key={item.id} className={(page===item.id||(item.id==='periods'&&periodActive)||(item.id==='employees'&&employeeActive))?'active':''} onClick={()=>setPage(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav></aside><div className="demo-main"><header>{goBack?<button className="back" onClick={()=>setPage(goBack)}>← ย้อนกลับ</button>:<div className="demo-mode">DEMO · ข้อมูลสาธิต</div>}<div>รอบปัจจุบัน: <b>กันยายน 2569</b></div><button className="avatar" title="เมนูผู้ใช้งาน" onClick={()=>setProfileOpen(v=>!v)}>♙</button>{profileOpen&&<div className="profile-menu"><b>{session.name}</b><small>{roleLabel[session.role]}</small><button>ข้อมูลของฉัน</button><button>รีเซ็ตรหัสผ่าน</button><button onClick={()=>setSession(null)}>ออกจากระบบ</button></div>}</header><main><div className="demo-welcome"><div><small>เข้าสู่ระบบในฐานะ</small><h1>{roleLabel[session.role]}</h1><p>{session.name}{session.role==='hr'?' · กองคลัง':''}</p></div><button onClick={()=>setSession(null)}>ออกจาก Demo</button></div>{content}</main></div></div>
}
