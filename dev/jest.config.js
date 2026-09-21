/** @type {import('jest').Config} */
const config = {
  rootDir: '..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/test/tsconfig.json' }],
  },
  transformIgnorePatterns: ['/node_modules/(?!@drillcoder/ethers-rpc-pool/)'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts', '!<rootDir>/src/**/*.d.ts'],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  moduleNameMapper: {
    '^@drillcoder/ethers-rpc-pool$': '<rootDir>/node_modules/@drillcoder/ethers-rpc-pool/dist/index.js',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};

export default config;
