/* global __dirname */
const { cpSync, existsSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const source = join(__dirname, '..', 'generated', 'prisma-client');
const target = join(__dirname, '..', 'dist', 'generated', 'prisma-client');
if (!existsSync(source)) throw new Error('Generated Prisma client is missing');
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
