/* global __dirname */
const { cpSync, existsSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const source = join(__dirname, '..', 'src', 'infrastructure', 'persistence', 'prisma-client');
const destination = join(__dirname, '..', '..', '..', 'dist', 'microservices', 'pricing-service', 'src', 'infrastructure', 'persistence', 'prisma-client');

if (!existsSync(source)) throw new Error('Generated Prisma client is missing');
rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
