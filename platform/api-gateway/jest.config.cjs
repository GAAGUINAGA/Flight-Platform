module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/generated/'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '../../tsconfig.base.json' }] },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }
};
