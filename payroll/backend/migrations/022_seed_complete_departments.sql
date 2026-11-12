-- Keep every department selector backed by the complete municipal structure.
INSERT INTO public.departments (code, name, is_active)
SELECT 'DISASTER_PREVENTION', 'งานป้องกันและบรรเทาสาธารณภัย', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.departments WHERE LOWER(BTRIM(name)) = LOWER('งานป้องกันและบรรเทาสาธารณภัย')
);

INSERT INTO public.departments (code, name, is_active)
SELECT 'WELFARE', 'กองสวัสดิการสังคม', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.departments WHERE LOWER(BTRIM(name)) IN (LOWER('กองสวัสดิการ'), LOWER('กองสวัสดิการสังคม'))
);

UPDATE public.departments
SET is_active = TRUE
WHERE LOWER(BTRIM(name)) IN (LOWER('งานป้องกันและบรรเทาสาธารณภัย'), LOWER('กองสวัสดิการ'), LOWER('กองสวัสดิการสังคม'));

UPDATE public.departments
SET name = 'กองสวัสดิการสังคม', code = 'WELFARE', is_active = TRUE
WHERE LOWER(BTRIM(name)) = LOWER('กองสวัสดิการ');
