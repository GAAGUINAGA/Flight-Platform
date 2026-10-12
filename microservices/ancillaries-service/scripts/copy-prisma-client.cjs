const { cpSync, existsSync, mkdirSync } = require('node:fs');
const source = 'src/infrastructure/persistence/prisma-client';
const target = 'dist/infrastructure/persistence/prisma-client';
if (existsSync(source)) { mkdirSync('dist/infrastructure/persistence', { recursive: true }); cpSync(source, target, { recursive: true }); }
