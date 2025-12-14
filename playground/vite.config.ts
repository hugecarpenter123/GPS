import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
  root: __dirname,
  plugins: [preact()],
  resolve: {
    alias: {
      '~': resolve(__dirname, '../src'),
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  optimizeDeps: {
    include: ['preact', 'preact/hooks'],
  },
});
