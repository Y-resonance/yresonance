const environment = process.argv[2];
if (!['development', 'preview', 'production'].includes(environment ?? '')) {
  console.error('Usage: bun run reset <development|preview|production>');
  process.exit(1);
}

const token = process.env.RESET_ADMIN_TOKEN;
if (!token) {
  console.error('RESET_ADMIN_TOKEN is required.');
  process.exit(1);
}

const endpoint = {
  development: process.env.YRESONANCE_DEVELOPMENT_URL ?? 'http://localhost:3000',
  preview: process.env.YRESONANCE_PREVIEW_URL,
  production: process.env.YRESONANCE_PRODUCTION_URL ?? 'https://yresonance.com',
}[environment!];
if (!endpoint) {
  console.error(`Set YRESONANCE_${environment!.toUpperCase()}_URL before running this reset.`);
  process.exit(1);
}

const response = await fetch(new URL('/api/admin/reset', endpoint), {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ environment }),
});
const body = await response.text();
let parsed: unknown;
try {
  parsed = JSON.parse(body) as unknown;
  console.log(JSON.stringify(parsed, null, 2));
} catch {
  console.error(`Reset returned HTTP ${response.status}: ${body.slice(0, 500) || '<empty body>'}`);
}
if (!response.ok) {
  console.error(`Reset failed with HTTP ${response.status}.`);
  process.exit(1);
}
