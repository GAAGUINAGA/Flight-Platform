/* global __dirname, console, process */
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const leaked = ['microservices', 'platform', 'packages'].filter((directory) =>
  existsSync(join(root, 'dist', directory)));

const workspaceConfigs = [
  'packages/contracts/tsconfig.json', 'packages/shared/tsconfig.json',
  'platform/api-gateway/tsconfig.json', 'platform/hello/tsconfig.json', 'platform/web/tsconfig.json',
  ...['ancillaries-service', 'inventory-service', 'operations-service', 'pricing-service', 'reservation-service', 'ticketing-service', 'webhooks-service']
    .map((service) => `microservices/${service}/tsconfig.json`)
];
const invalidConfigs = workspaceConfigs.filter((file) => {
  const config = JSON.parse(readFileSync(join(root, file), 'utf8'));
  const output = config.compilerOptions?.outDir;
  return output !== 'dist';
});

if (leaked.length || invalidConfigs.length) {
  if (leaked.length) console.error(`Workspace build artifacts leaked into root dist/: ${leaked.join(', ')}`);
  if (invalidConfigs.length) console.error(`Workspace tsconfig without local outDir=dist: ${invalidConfigs.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('workspace dist layout verified');
}
