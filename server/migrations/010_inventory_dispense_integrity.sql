-- Additive hardening for installations that already applied migration009.
-- The original CHECK accepted SQL UNKNOWN when movement_id was NULL.
ALTER TABLE inventory_dispenses ADD CONSTRAINT inventory_dispense_movement_required
  CHECK(kind <> 'dispense' OR movement_id IS NOT NULL);
