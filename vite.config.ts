import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/ui',
  publicDir: '../../public',
  server: {
    port: 4201,
    strictPort: true,
    cors: { origin: /^http:\/\/localhost:\d+$/ },
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
});
