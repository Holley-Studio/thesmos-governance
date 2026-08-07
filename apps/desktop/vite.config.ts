import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Fixed port: `tauri dev` waits on a known devUrl rather than guessing.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5273, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
