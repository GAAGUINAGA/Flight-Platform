module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  // Runtime artifacts copied by workspace builds are not source modules.
  // Ignoring them keeps `npx jest platform/api-gateway --runInBand` usable
  // after the Gateway build has copied Prisma's generated package.
  modulePathIgnorePatterns: ['<rootDir>/platform/api-gateway/(dist|generated)/'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.base.json' }] },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }
};
