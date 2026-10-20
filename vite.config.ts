import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Port 3000 cocok dengan Client URL bawaan Nhost (tautan verifikasi email kembali ke sini).
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, strictPort: true },
  preview: { port: 3000 },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
