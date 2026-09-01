ALTER TYPE public.employee_type ADD VALUE IF NOT EXISTS 'GENERAL_EMPLOYEE';
ALTER TYPE public.employee_type ADD VALUE IF NOT EXISTS 'CONTRACT_EMPLOYEE';
ALTER TYPE public.employee_type ADD VALUE IF NOT EXISTS 'POLITICAL_OFFICIAL';
ALTER TYPE public.employee_type ADD VALUE IF NOT EXISTS 'REGULAR_PENSIONER';
ALTER TYPE public.employee_type ADD VALUE IF NOT EXISTS 'TEACHER_PENSIONER';
ALTER TYPE public.employee_type ADD VALUE IF NOT EXISTS 'PERMANENT_WORKER_MONTHLY_PENSION';
ALTER TYPE public.employee_type ADD VALUE IF NOT EXISTS 'OTHER';

WITH required_departments(code, name) AS (
    VALUES
        ('SPL', 'สำนักปลัดเทศบาล'),
        ('FIN', 'กองคลัง'),
        ('ENG', 'กองช่าง'),
        ('HEALTH', 'กองสาธารณสุขและสิ่งแวดล้อม'),
        ('STRATEGY', 'กองยุทธศาสตร์และงบประมาณ'),
        ('EDU', 'กองการศึกษา'),
        ('WATER', 'กองการประปา'),
        ('WELFARE', 'กองสวัสดิการสังคม')
)
UPDATE public.departments AS department
SET name = required.name,
    is_active = TRUE
FROM required_departments AS required
WHERE department.code = required.code;

WITH required_departments(code, name) AS (
    VALUES
        ('SPL', 'สำนักปลัดเทศบาล'),
        ('FIN', 'กองคลัง'),
        ('ENG', 'กองช่าง'),
        ('HEALTH', 'กองสาธารณสุขและสิ่งแวดล้อม'),
        ('STRATEGY', 'กองยุทธศาสตร์และงบประมาณ'),
        ('EDU', 'กองการศึกษา'),
        ('WATER', 'กองการประปา'),
        ('WELFARE', 'กองสวัสดิการสังคม')
)
INSERT INTO public.departments (code, name, is_active)
SELECT required.code, required.name, TRUE
FROM required_departments AS required
WHERE NOT EXISTS (
    SELECT 1
    FROM public.departments AS department
    WHERE department.code = required.code OR department.name = required.name
);
