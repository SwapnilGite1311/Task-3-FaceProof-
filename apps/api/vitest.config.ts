import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The face model warm-up and the integration pipeline test are slow on a
    // cold CPU backend, so give them room instead of flaking.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});
