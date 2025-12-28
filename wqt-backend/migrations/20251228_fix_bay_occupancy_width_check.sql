-- Replace float width constraint with integer unit constraint (Euro=2, UK=3, capacity=6).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'bay_occupancy'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%1.5%'
  LOOP
    EXECUTE format('ALTER TABLE bay_occupancy DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE bay_occupancy
  DROP CONSTRAINT IF EXISTS bay_occupancy_width_check;

ALTER TABLE bay_occupancy
  ADD CONSTRAINT bay_occupancy_width_check
  CHECK ((euro_count * 2 + uk_count * 3) <= 6);
