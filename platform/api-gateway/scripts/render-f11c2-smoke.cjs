const process = require('node:process');
const { randomUUID } = require('node:crypto');

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const fail = (step, status) => { throw new Error(`${step} status ${status}`); };

async function main() {
  const base = `${required('BASE_URL').replace(/\/$/, '')}/flights/v1`;
  // El token de admin de Supabase solo se lee de la variable de entorno y nunca se imprime.
  const admin = { authorization: `Bearer ${required('SMOKE_ADMIN_TOKEN')}`, 'content-type': 'application/json' };
  const hookUrl = process.env.SMOKE_WEBHOOK_URL || 'https://example.com/flight-platform-smoke';
  const call = async (step, path, expected, options = {}) => {
    const response = await globalThis.fetch(`${base}${path}`, options);
    if (response.status !== expected) fail(step, response.status);
    process.stdout.write(`OK   ${step}\n`);
    return response.status === 204 ? undefined : response.json();
  };

  await call('admin sin token', '/admin/flights', 401);
  await call('webhooks sin token', '/webhooks', 401);
  await call('admin vuelos', '/admin/flights?limit=1', 200, { headers: admin });
  await call('admin tarifas', '/admin/fares', 200, { headers: admin });
  await call('admin cuerpo con campo desconocido', '/admin/flights', 400, { method: 'POST', headers: admin, body: JSON.stringify({ unexpected: true }) });

  const secret = `smoke-${randomUUID()}`;
  const created = await call('webhook registrado', '/webhooks', 201, { method: 'POST', headers: admin, body: JSON.stringify({ url: hookUrl, events: ['booking.confirmed'], secret }) });
  try {
    if (created.secret === secret || !String(created.secret).startsWith('****')) throw new Error('webhook secret is not masked');
    const listed = await call('webhooks listados', '/webhooks', 200, { headers: admin });
    if (!listed.some((item) => item.id === created.id && item.secret !== secret)) throw new Error('webhook missing from list or secret exposed');
    process.stdout.write('OK   secreto enmascarado\n');
  } finally {
    await call('webhook eliminado', `/webhooks/${created.id}`, 204, { method: 'DELETE', headers: admin });
  }
  await call('webhook ajeno o inexistente', `/webhooks/${randomUUID()}`, 404, { method: 'DELETE', headers: admin });
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
