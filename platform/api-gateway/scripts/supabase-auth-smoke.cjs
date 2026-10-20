const process = require('node:process');
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

async function main() {
  const base = required('BASE_URL').replace(/\/$/, '');
  const supabase = required('SUPABASE_URL').replace(/\/$/, '');
  const login = await globalThis.fetch(`${supabase}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: required('SUPABASE_ANON_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email: required('SUPABASE_TEST_EMAIL'), password: required('SUPABASE_TEST_PASSWORD') })
  });
  if (!login.ok) throw new Error(`Supabase login status ${login.status}`);
  const { access_token: token } = await login.json();
  if (typeof token !== 'string') throw new Error('Supabase login returned no access token');
  const headers = { authorization: `Bearer ${token}` };
  const bookings = await globalThis.fetch(`${base}/flights/v1/bookings`, { headers });
  if (bookings.status !== 200) throw new Error(`bookings status ${bookings.status}`);
  process.stdout.write('OK   customer bookings\n');
  const adminPath = process.env.SUPABASE_TEST_ADMIN_PATH || '/flights/v1/admin/flights';
  if (!adminPath.startsWith('/flights/v1/admin/')) throw new Error('Invalid SUPABASE_TEST_ADMIN_PATH');
  const admin = await globalThis.fetch(`${base}${adminPath}`, { headers });
  if (admin.status !== 403) throw new Error(`admin status ${admin.status}`);
  process.stdout.write('OK   customer denied admin\n');
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
