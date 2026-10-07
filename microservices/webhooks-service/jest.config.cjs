/* global __dirname */
const { resolve } = require('node:path');
const rootDir = resolve(__dirname, '../..');
module.exports = {
  rootDir,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/microservices/webhooks-service/test/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: resolve(rootDir, 'tsconfig.base.json') }] },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }
};
