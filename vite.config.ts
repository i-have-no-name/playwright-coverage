import { defineConfig } from 'vite';
import istanbul from 'vite-plugin-istanbul';

export default defineConfig({
  plugins: [istanbul({ include: 'src/**', extension: ['.ts', '.tsx'], requireEnv: true })],
});
