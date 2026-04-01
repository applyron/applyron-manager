import { defineConfig, loadEnv } from 'vite';
import path from 'path';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const googleClientId =
    process.env.APPLYRON_GOOGLE_CLIENT_ID ?? env.APPLYRON_GOOGLE_CLIENT_ID ?? '';
  const googleClientSecret =
    process.env.APPLYRON_GOOGLE_CLIENT_SECRET ?? env.APPLYRON_GOOGLE_CLIENT_SECRET ?? '';

  return {
    define: {
      'globalThis.__APPLYRON_GOOGLE_CLIENT_ID__': JSON.stringify(googleClientId),
      'globalThis.__APPLYRON_GOOGLE_CLIENT_SECRET__': JSON.stringify(googleClientSecret),
    },
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), './src'),
        kafkajs: path.resolve(process.cwd(), './src/mocks/empty.ts'),
        mqtt: path.resolve(process.cwd(), './src/mocks/empty.ts'),
        amqplib: path.resolve(process.cwd(), './src/mocks/empty.ts'),
        'amqp-connection-manager': path.resolve(process.cwd(), './src/mocks/empty.ts'),
        nats: path.resolve(process.cwd(), './src/mocks/empty.ts'),
        ioredis: path.resolve(process.cwd(), './src/mocks/empty.ts'),
        '@fastify/static': path.resolve(process.cwd(), './src/mocks/empty.ts'),
        '@fastify/view': path.resolve(process.cwd(), './src/mocks/empty.ts'),
        '@nestjs/microservices': path.resolve(process.cwd(), './src/mocks/nestjs-microservices'),
        '@nestjs/websockets': path.resolve(process.cwd(), './src/mocks/nestjs-websockets'),
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
