import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

export default defineConfig({
  root: __dirname,
  plugins: [
    preact(),
    {
      name: 'html-loader',
      load(id) {
        if (id.endsWith('.html')) {
          return `export default ${JSON.stringify(readFileSync(id, 'utf-8'))}`;
        }
      },
    },
    {
      name: 'raw-loader',
      load(id) {
        // Handle ?raw query for CSS and HTML files
        if (id.includes('?raw')) {
          const filePath = id.replace('?raw', '');
          if ((filePath.endsWith('.css') || filePath.endsWith('.html')) && !filePath.includes('node_modules')) {
            try {
              return `export default ${JSON.stringify(readFileSync(filePath, 'utf-8'))}`;
            } catch (e) {
              return null;
            }
          }
        }
      },
    },
  ],
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
