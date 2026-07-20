#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get component path from CLI argument
const componentPathRaw = process.argv[2];

if (!componentPathRaw) {
  console.error('❌ Error: Component path is required');
  console.log('\nUsage:');
  console.log('  npm run play -- src/service/my-component.tsx');
  console.log('  npm run play -- src/service/master-queue-rework/master-queue-table.tsx');
  process.exit(1);
}

// Convert raw path to absolute path with /@fs/ prefix for Vite dynamic imports
// Example: "src/service/..." -> "/@fs/C:/Users/.../GPS/src/service/..."
const absoluteComponentPath = resolve(process.cwd(), componentPathRaw).replace(/\\/g, '/');

console.log('🚀 Starting playground with component:', componentPathRaw);
console.log('   Resolved absolute path for Vite:', absoluteComponentPath);

// Set env variable and run Vite
const viteProcess = spawn('npx', ['vite', 'playground'], {
  env: {
    ...process.env,
    VITE_COMPONENT_PATH: absoluteComponentPath, // Pass absolute path
  },
  stdio: 'inherit',
  shell: true,
});

viteProcess.on('exit', code => {
  process.exit(code || 0);
});
