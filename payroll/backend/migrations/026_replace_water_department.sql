-- Preserve the existing department id and all foreign-key relationships while
-- replacing the obsolete waterworks label everywhere it is displayed.
UPDATE public.departments
SET code = 'DISASTER_PREVENTION',
    name = 'งานป้องกันและบรรเทาสาธารณภัย',
    is_active = TRUE
WHERE code = 'WATER'
   OR LOWER(BTRIM(name)) = LOWER('กองการประปา');

INSERT INTO public.departments (code, name, is_active)
SELECT 'DISASTER_PREVENTION', 'งานป้องกันและบรรเทาสาธารณภัย', TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM public.departments
  WHERE LOWER(BTRIM(name)) = LOWER('งานป้องกันและบรรเทาสาธารณภัย')
);
