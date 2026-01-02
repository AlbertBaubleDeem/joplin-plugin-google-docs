module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  modulePathIgnorePatterns: ['dist/'],
  roots: ['<rootDir>/src'],
  // Transform ESM modules that Jest can't handle natively
  transformIgnorePatterns: [
    'node_modules/(?!(marked)/)',
  ],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.m?js$': 'ts-jest',
  },
};

