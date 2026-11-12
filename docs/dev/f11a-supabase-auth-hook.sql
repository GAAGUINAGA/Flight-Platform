-- Ejecutar manualmente en el SQL Editor de Supabase.
-- F12c (ADR-F12c-02): además de app_role y scope, agrega el claim de nivel superior `email_verified` (true solo si auth.users.email_confirmed_at
-- no es nulo). El Gateway exige ese claim para vender por el canal WEB; user_metadata no sirve porque el usuario puede editarla.
-- Vuelve a ejecutarlo y renueva la sesión de los usuarios para que el token lo traiga.
create or replace function public.flight_platform_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event->'claims';
  app_role text := claims->'app_metadata'->>'app_role';
  scopes text := 'flights:read flights:hold flights:book flights:cancel';
  confirmed boolean;
begin
  -- Solo app_metadata, controlada por el administrador, puede conceder admin o partner.
  if app_role = 'admin' then
    scopes := scopes || ' flights:webhooks flights:admin';
  elsif app_role = 'partner' then
    scopes := scopes || ' flights:webhooks';
  else
    app_role := 'customer';
  end if;
  claims := jsonb_set(claims, '{app_role}', to_jsonb(app_role), true);
  claims := jsonb_set(claims, '{scope}', to_jsonb(scopes), true);
  -- Solo esta consulta lleva manejo de errores: este hook corre en cada inicio de sesión. Si falla (permisos, esquema, id inválido),
  -- el login sigue funcionando con app_role y scope como siempre y confirmed queda en false: solo la venta WEB queda bloqueada (falla cerrado).
  begin
    select (u.email_confirmed_at is not null) into confirmed from auth.users u where u.id = (event->>'user_id')::uuid;
  exception when others then
    confirmed := false;
  end;
  claims := jsonb_set(claims, '{email_verified}', to_jsonb(coalesce(confirmed, false)), true);
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.flight_platform_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.flight_platform_access_token_hook(jsonb) from public, anon, authenticated;
