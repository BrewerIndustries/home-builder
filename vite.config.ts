import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH is set by CI: '/' for main (prod) and '/dev/' for dev, so both build from
// the same source into one Pages site. See .github/workflows/pages.yml.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { host: true, port: Number(process.env.PORT ?? 5180), strictPort: true },
  preview: { host: true, port: Number(process.env.PORT ?? 5180), strictPort: true },
  build: { target: 'es2022', outDir: 'dist' },
});
