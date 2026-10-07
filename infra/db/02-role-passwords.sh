#!/bin/sh
set -eu

for service in inventory pricing ancillaries reservation ticketing operations webhooks gateway; do
  upper=$(printf '%s' "$service" | tr '[:lower:]' '[:upper:]')
  password=$(printenv "ROLE_PASSWORD_${upper}")
  test -n "$password"
  psql -v ON_ERROR_STOP=1 -U postgres -d "$POSTGRES_DB" \
    -v "role=svc_${service}" -v "password=${password}" \
    -f /opt/flight/role-passwords.sql
done

psql -v ON_ERROR_STOP=1 -U postgres -d "$POSTGRES_DB" \
  -v "password=${POSTGRES_PASSWORD}" \
  -f /opt/flight/postgres-password.sql
