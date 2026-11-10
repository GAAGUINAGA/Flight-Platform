'use strict';
/* global __dirname, process */
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
  { name: 'reservation', workflow: 'deploy-reservation.yml', src: 'microservices/reservation-service/src', mode: 'set', secrets: ['DATABASE_URL', 'BOOKING_PAYMENTS_AUTH_VALUE'], env: ['ESB_URL', 'GRPC_TLS', 'BOOKING_PAYMENTS_BASE_URL', 'BOOKING_PAYMENTS_AUTH_HEADER'] },
  { name: 'operations', workflow: 'deploy-operations.yml', src: 'microservices/operations-service/src', mode: 'set', secrets: ['DATABASE_URL'], env: ['ESB_URL', 'GRPC_TLS'] },
  { name: 'esb', workflow: 'deploy-esb.yml', src: 'microservices/esb-service/src', mode: 'update', secrets: ['INTERNAL_API_KEY'], manual: ['DATABASE_URL', 'DIRECT_URL', 'RABBITMQ_URL'], env: ['GRPC_TLS'] }
];

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
  return problems;
}

const problems = check();
if (problems.length > 0) {
  process.stderr.write(`check-deploy-env: ${problems.length} problema(s)\n${problems.map((p) => ` - ${p}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`check-deploy-env: OK (${SERVICES.length} servicios)\n`);
