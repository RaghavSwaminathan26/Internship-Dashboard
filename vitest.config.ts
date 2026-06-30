import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@interniq/shared': path.resolve(__dirname, 'packages/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./packages/frontend/src/test-setup.ts'],
    include: ['packages/*/src/**/*.{test,spec}.ts', 'packages/*/src/**/*.{test,spec}.tsx', 'tests/**/*.{test,spec}.ts'],
  },
});
