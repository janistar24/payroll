-- Add the internal audit unit to every department selector.
INSERT INTO public.departments (code, name, is_active)
SELECT 'INTERNAL_AUDIT', 'หน่วยตรวจสอบภายใน', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.departments
  WHERE LOWER(BTRIM(name)) = LOWER('หน่วยตรวจสอบภายใน')
);

UPDATE public.departments
SET code = 'INTERNAL_AUDIT', is_active = TRUE
WHERE LOWER(BTRIM(name)) = LOWER('หน่วยตรวจสอบภายใน');
