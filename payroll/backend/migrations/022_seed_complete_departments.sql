-- Keep every department selector backed by the complete municipal structure.
INSERT INTO public.departments (code, name, is_active)
SELECT 'WATER', 'กองการประปา', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.departments WHERE LOWER(BTRIM(name)) = LOWER('กองการประปา')
);

INSERT INTO public.departments (code, name, is_active)
SELECT 'WELFARE', 'กองสวัสดิการ', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.departments WHERE LOWER(BTRIM(name)) IN (LOWER('กองสวัสดิการ'), LOWER('กองสวัสดิการสังคม'))
);

UPDATE public.departments
SET is_active = TRUE
WHERE LOWER(BTRIM(name)) IN (LOWER('กองการประปา'), LOWER('กองสวัสดิการ'));
