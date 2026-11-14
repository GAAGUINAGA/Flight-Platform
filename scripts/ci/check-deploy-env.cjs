'use strict';
/* global __dirname, process, URL */
/**
 * Compara lo que cada servicio exige en la nube (F12b-2) con lo que declara su workflow de despliegue.
 * deploy-service.yml usa `gcloud run deploy --set-secrets/--set-env-vars`, que REEMPLAZAN los secretos y variables del servicio:
 * todo lo necesario debe estar en `extra_secrets` / `extra_env_vars` del workflow del servicio (audit-12 H1).
 * deploy-esb.yml usa `--update-secrets/--update-env-vars` (conserva lo configurado a mano): ahí los secretos son manuales y se exige
 * que el workflow no use --set-*.
 * Uso: node scripts/ci/check-deploy-env.cjs  (sale con código 1 y lista lo que falta).
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const workflows = path.join(root, '.github', 'workflows');

// secrets/env: lo que el servicio necesita en producción y debe declarar su workflow (modo set).
// manual: solo servicios con --update-*; deben existir en el servicio de Cloud Run por configuración manual (guía f12b2-despliegue.md).
const SERVICES = [
  { name: 'webhooks', workflow: 'deploy-webhooks.yml', src: 'microservices/webhooks-service/src', mode: 'set', secrets: ['DATABASE_URL', 'WEBHOOK_SECRET_ENCRYPTION_KEY', 'RABBITMQ_URL'], env: [] },
  { name: 'inventory', workflow: 'deploy-inventory.yml', src: 'microservices/inventory-service/src', mode: 'set', secrets: ['DATABASE_URL'], env: ['ESB_URL', 'GRPC_TLS'] },
  { name: 'reservation', workflow: 'deploy-reservation.yml', src: 'microservices/reservation-service/src', mode: 'set', secrets: ['DATABASE_URL', 'BOOKING_PAYMENTS_AUTH_VALUE'], env: ['ESB_URL', 'GRPC_TLS', 'BOOKING_PAYMENTS_BASE_URL', 'BOOKING_PAYMENTS_AUTH_HEADER', 'WEB_PAYMENT_MODE'] },
  { name: 'operations', workflow: 'deploy-operations.yml', src: 'microservices/operations-service/src', mode: 'set', secrets: ['DATABASE_URL'], env: ['ESB_URL', 'GRPC_TLS'] },
  { name: 'esb', workflow: 'deploy-esb.yml', src: 'microservices/esb-service/src', mode: 'update', secrets: ['INTERNAL_API_KEY'], manual: ['DATABASE_URL', 'DIRECT_URL', 'RABBITMQ_URL'], env: ['GRPC_TLS'] }
];

// El Gateway se despliega en Render (sin workflow de despliegue: las variables se configuran en el panel de Render). Lo que se puede verificar
// aquí es que cada variable del canal WEB (ADR-F12c-02) siga usándose en su código y esté documentada en .env.example y en la guía de despliegue.
const GATEWAY_RENDER = { src: 'platform/api-gateway/src', envExample: 'platform/api-gateway/.env.example', guide: 'docs/dev/f12c-backend-previo-despliegue.md', env: ['WEB_PAYMENT_MODE', 'WEB_MAX_ACTIVE_BOOKINGS', 'WEB_MAX_PASSENGERS_PER_DAY'] };

// Servicio GraphQL (F12c-1, Cloud Run, sin secretos propios): su workflow usa --update-env-vars (conserva lo configurado a mano) y NUNCA --set-*;
// cada variable que exige debe seguir usándose en su código y estar documentada en la guía de despliegue.
const GRAPHQL = { workflow: 'deploy-graphql.yml', src: 'platform/graphql/src', guide: 'docs/dev/f12c1-graphql-despliegue.md', env: ['GATEWAY_BASE_URL', 'JWT_ISSUERS', 'CORS_ORIGINS'] };

// Web (F12c-2a, sitio estático en Render): sus variables son PÚBLICAS (VITE_*, se incrustan en el bundle). Cada variable de render.yaml debe
// seguir usándose en el código de la web y estar documentada en .env.example y en la guía; render.yaml no puede declarar nada que no sea VITE_*
// (ni secretos), y los orígenes de connect-src de su CSP deben ser los de VITE_GRAPHQL_URL y VITE_SUPABASE_URL.
const WEB = { render: 'render.yaml', src: 'platform/web/src', envExample: 'platform/web/.env.example', guide: 'docs/dev/f12c2a-web-despliegue.md', required: ['VITE_GRAPHQL_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] };

const read = (file) => fs.readFileSync(file, 'utf8');
const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const field = (text, key) => { const m = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm').exec(text); return m ? m[1].trim() : ''; };
const names = (value) => value.split(',').map((part) => part.split('=')[0].trim()).filter(Boolean);

function check() {
  const problems = [];
  const guide = read(path.join(root, 'docs', 'dev', 'f12b2-despliegue.md'));
  for (const svc of SERVICES) {
    const text = read(path.join(workflows, svc.workflow));
    if (svc.mode === 'set') {
      const declaredSecrets = names(field(text, 'extra_secrets'));
      const declaredEnv = names(field(text, 'extra_env_vars'));
      for (const s of svc.secrets) if (!declaredSecrets.includes(s)) problems.push(`${svc.name}: el secreto ${s} no está en extra_secrets de ${svc.workflow} (--set-secrets lo borraría)`);
      for (const v of svc.env) if (!declaredEnv.includes(v)) problems.push(`${svc.name}: la variable ${v} no está en extra_env_vars de ${svc.workflow} (--set-env-vars la borraría)`);
      for (const entry of field(text, 'extra_secrets').split(',')) {
        const [name, ref] = entry.split('=');
        if (name === 'RABBITMQ_URL' && !guide.includes(ref.replace(/:latest$/, ''))) problems.push(`${svc.name}: el secreto ${ref} de RABBITMQ_URL no figura en la guía f12b2-despliegue.md`);
      }
    } else {
      if (/--set-(secrets|env-vars)/.test(text)) problems.push(`${svc.name}: ${svc.workflow} usa --set-*, que borraría los secretos configurados a mano; debe usar --update-*`);
      for (const s of svc.secrets) if (!new RegExp(`--update-secrets[^\\n]*${s}=`).test(text)) problems.push(`${svc.name}: ${svc.workflow} no declara ${s} en --update-secrets`);
      for (const v of svc.env) if (!new RegExp(`--update-env-vars[^\\n]*${v}=`).test(text)) problems.push(`${svc.name}: ${svc.workflow} no declara ${v} en --update-env-vars`);
      for (const m of svc.manual) if (!guide.includes(m)) problems.push(`${svc.name}: el secreto manual ${m} no figura en la guía f12b2-despliegue.md`);
    }
    // El manifiesto no debe quedar obsoleto: cada variable que exige debe seguir usándose en el código del servicio (o ser de plataforma).
    const code = listFiles(path.join(root, svc.src)).filter((f) => f.endsWith('.ts')).map(read).join('\n');
    const pkgs = listFiles(path.join(root, 'packages', 'shared', 'src')).map(read).join('\n');
    for (const v of [...svc.secrets, ...(svc.manual ?? []), ...svc.env]) {
      if (v === 'DIRECT_URL') continue; // solo la usa Prisma Migrate
      if (!code.includes(v) && !pkgs.includes(v) && !['DATABASE_URL', 'INTERNAL_API_KEY'].includes(v)) problems.push(`${svc.name}: ${v} figura en el manifiesto pero el código ya no la usa (actualiza scripts/ci/check-deploy-env.cjs)`);
    }
  }
  const gwCode = listFiles(path.join(root, GATEWAY_RENDER.src)).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')).map(read).join('\n');
  const gwExample = read(path.join(root, GATEWAY_RENDER.envExample)); const gwGuide = read(path.join(root, GATEWAY_RENDER.guide));
  for (const v of GATEWAY_RENDER.env) {
    if (!gwCode.includes(v)) problems.push(`gateway: ${v} figura en el manifiesto pero el código ya no la usa (actualiza scripts/ci/check-deploy-env.cjs)`);
    if (!new RegExp(`^#?\\s*${v}=`, 'm').test(gwExample)) problems.push(`gateway: ${v} no está declarada en ${GATEWAY_RENDER.envExample}`);
    if (!gwGuide.includes(v)) problems.push(`gateway: ${v} no figura en la guía ${GATEWAY_RENDER.guide} (variables de Render)`);
  }
  const gqlWorkflow = read(path.join(workflows, GRAPHQL.workflow)); const gqlGuide = read(path.join(root, GRAPHQL.guide));
  const gqlCode = listFiles(path.join(root, GRAPHQL.src)).filter((f) => f.endsWith('.ts')).map(read).join('\n');
  if (/--set-(secrets|env-vars)/.test(gqlWorkflow)) problems.push(`graphql: ${GRAPHQL.workflow} usa --set-*, que borraría las variables configuradas a mano; debe usar --update-*`);
  if (!/--update-env-vars/.test(gqlWorkflow)) problems.push(`graphql: ${GRAPHQL.workflow} no usa --update-env-vars`);
  for (const v of GRAPHQL.env) {
    if (!gqlCode.includes(v)) problems.push(`graphql: ${v} figura en el manifiesto pero el código ya no la usa (actualiza scripts/ci/check-deploy-env.cjs)`);
    if (!gqlGuide.includes(v)) problems.push(`graphql: ${v} no figura en la guía ${GRAPHQL.guide}`);
  }
  const render = read(path.join(root, WEB.render)); const webExample = read(path.join(root, WEB.envExample)); const webGuide = read(path.join(root, WEB.guide));
  const webCode = listFiles(path.join(root, WEB.src)).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map(read).join('\n');
  const renderVars = [...render.matchAll(/- key: ([A-Z0-9_]+)\s*\n\s*(value|sync):\s*(.+)/g)].map((m) => ({ key: m[1], kind: m[2], value: m[3].trim().replace(/^"(.*)"$/, '$1') }));
  for (const v of WEB.required) if (!renderVars.some((entry) => entry.key === v)) problems.push(`web: ${v} no está declarada en ${WEB.render}`);
  for (const entry of renderVars) {
    if (entry.key === 'NODE_VERSION') continue;
    if (!entry.key.startsWith('VITE_')) { problems.push(`web: ${WEB.render} declara ${entry.key}; la web solo admite variables públicas VITE_*`); continue; }
    if (!webCode.includes(entry.key)) problems.push(`web: ${entry.key} figura en ${WEB.render} pero el código de la web ya no la usa`);
    if (!new RegExp(`^#?\\s*${entry.key}=`, 'm').test(webExample)) problems.push(`web: ${entry.key} no está declarada en ${WEB.envExample}`);
    if (!webGuide.includes(entry.key)) problems.push(`web: ${entry.key} no figura en la guía ${WEB.guide}`);
  }
  if (/service_role|SECRET|PASSWORD/i.test(render)) problems.push(`web: ${WEB.render} no debe contener secretos`);
  const anon = renderVars.find((entry) => entry.key === 'VITE_SUPABASE_ANON_KEY');
  if (anon && anon.kind !== 'sync') problems.push(`web: VITE_SUPABASE_ANON_KEY debe ir con «sync: false» en ${WEB.render} (su valor se configura en Render)`);
  const connect = (/connect-src ([^;"]+)/.exec(render) ?? [])[1];
  const origins = ['VITE_GRAPHQL_URL', 'VITE_SUPABASE_URL'].map((key) => { const entry = renderVars.find((item) => item.key === key); try { return entry ? new URL(entry.value).origin : ''; } catch { return ''; } });
  if (!connect || connect.trim() !== origins.join(' ')) problems.push(`web: connect-src de la CSP de ${WEB.render} debe ser exactamente el origen de VITE_GRAPHQL_URL y el de VITE_SUPABASE_URL`);
  if (!/source: \/\*\s*\n\s*destination: \/index\.html/.test(render)) problems.push(`web: ${WEB.render} no reescribe todas las rutas a /index.html`);
  return problems;
}

const problems = check();
if (problems.length > 0) {
  process.stderr.write(`check-deploy-env: ${problems.length} problema(s)\n${problems.map((p) => ` - ${p}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`check-deploy-env: OK (${SERVICES.length} servicios)\n`);
