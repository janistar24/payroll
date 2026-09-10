ALTER TABLE public.employees
ADD COLUMN IF NOT EXISTS birth_date date;

COMMENT ON COLUMN public.employees.birth_date IS
'วันเดือนปีเกิด ค.ศ. ใช้เป็นรหัสเปิดสลิป PDF ที่ส่งทางอีเมล';
