import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = process.cwd();

export default defineConfig({
  resolve: {
    alias: [
      // Prisma client is generated outside src (tsconfig maps @/generated/* there too).
      { find: /^@\/generated\//, replacement: path.join(root, 'generated') + '/' },
      { find: '@generated', replacement: path.join(root, 'generated') },
      { find: '@', replacement: path.join(root, 'src') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
    setupFiles: ['src/test/setup.ts'],
  },
});
