-- Ejecutar manualmente en el SQL Editor de Supabase.
create or replace function public.flight_platform_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event->'claims';
  app_role text := claims->'app_metadata'->>'app_role';
  scopes text := 'flights:read flights:hold flights:book flights:cancel';
begin
  -- Solo app_metadata, controlada por el administrador, puede conceder admin.
  if app_role = 'admin' then
    scopes := scopes || ' flights:webhooks flights:admin';
  else
    app_role := 'customer';
  end if;
  claims := jsonb_set(claims, '{app_role}', to_jsonb(app_role), true);
  claims := jsonb_set(claims, '{scope}', to_jsonb(scopes), true);
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.flight_platform_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.flight_platform_access_token_hook(jsonb) from public, anon, authenticated;
