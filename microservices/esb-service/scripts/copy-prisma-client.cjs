/* global __dirname */
const { cpSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const source = join(__dirname, '..', 'src', 'infrastructure', 'persistence', 'prisma-client');
const destination = join(__dirname, '..', 'dist', 'infrastructure', 'persistence', 'prisma-client');
if (!existsSync(source)) throw new Error('Prisma client was not generated');
cpSync(source, destination, { recursive: true });
