# Payroll

## Development

Backend:

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Environment files are intentionally excluded from Git. Copy the required
PostgreSQL connection values into `backend/.env` and set `VITE_API_URL` in
`frontend/.env` when the API is not running at `http://127.0.0.1:8000/api`.

## ก่อน Deploy

1. สร้าง `backend/.env` จาก `backend/.env.example` และกำหนดค่า secret ทุกตัวใหม่
   โดยเฉพาะ `JWT_SECRET` และ `PASSWORD_VAULT_KEY` ห้ามนำค่าจากเครื่องพัฒนาไปใช้ซ้ำ
   กับระบบอื่น
2. ตั้ง `APP_ENV=production`, `ALLOWED_ORIGINS` และ `TRUSTED_HOSTS` ให้เป็น domain
   จริงเท่านั้น แล้วตรวจว่า `VITE_API_URL` ใช้ HTTPS ของ API จริง
3. สำรองฐานข้อมูลก่อน แล้วใช้ migration ใน `backend/migrations/` ตามลำดับกับ
   ฐานข้อมูลปลายทางเพียงครั้งเดียว โดยต้องรวม `011`, `012`, `013` สำหรับระบบ
   ฉบับแก้ไขรอบเงินเดือน
4. ติดตั้ง backend ด้วย `pip install -r backend/requirements.txt`, build frontend
   ด้วย `npm --prefix frontend run build`, และตั้ง reverse proxy ตาม
   `deploy/nginx.conf.example`
5. ตรวจ `/healthz`, ล็อกอินหนึ่งบัญชีต่อ role, การเพิ่ม/แก้ไข/ปิดใช้งานพนักงาน,
   ส่งอนุมัติ, อนุมัติ, สร้างฉบับแก้ไข, ดู PDF และส่งอีเมล ก่อนเปิดให้ผู้ใช้จริง
