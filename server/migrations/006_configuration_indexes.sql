-- UNIQUE(hospital_id, code) already supplies these exact lookup indexes.
-- Keep the original migration immutable for installations that applied it.
DROP INDEX configuration_department_search;
DROP INDEX configuration_service_search;
