DO $$
DECLARE
  service_name text;
BEGIN
  FOREACH service_name IN ARRAY ARRAY['inventory', 'pricing', 'ancillaries', 'reservation', 'ticketing', 'operations', 'webhooks', 'gateway']
  LOOP
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', service_name);
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', service_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM anon', service_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM authenticated', service_name);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_' || service_name) THEN
      EXECUTE format('CREATE ROLE %I LOGIN', 'svc_' || service_name);
    END IF;
  END LOOP;
END $$;

DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO svc_inventory, svc_pricing, svc_ancillaries, svc_reservation, svc_ticketing, svc_operations, svc_webhooks, svc_gateway', current_database());
END $$;
GRANT USAGE, CREATE ON SCHEMA inventory TO svc_inventory;
GRANT USAGE, CREATE ON SCHEMA pricing TO svc_pricing;
GRANT USAGE, CREATE ON SCHEMA ancillaries TO svc_ancillaries;
GRANT USAGE, CREATE ON SCHEMA reservation TO svc_reservation;
GRANT USAGE, CREATE ON SCHEMA ticketing TO svc_ticketing;
GRANT USAGE, CREATE ON SCHEMA operations TO svc_operations;
GRANT USAGE, CREATE ON SCHEMA webhooks TO svc_webhooks;
GRANT USAGE, CREATE ON SCHEMA gateway TO svc_gateway;
