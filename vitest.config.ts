import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = process.cwd();

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
      '@generated': path.join(root, 'generated'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
