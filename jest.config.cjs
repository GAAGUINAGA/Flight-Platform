module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.base.json' }] },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }
};
