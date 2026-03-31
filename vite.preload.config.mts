import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig(() => {
  return {
    define: {
      __APPLYRON_E2E__: JSON.stringify(process.env.APPLYRON_E2E === '1'),
    },
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), './src'),
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        external: ['better-sqlite3', 'keytar'],
      },
    },
  };
});
