/// <reference types="./vite-env.d.ts" />
import { h, render } from 'preact';
import '../src/styles/tailwind.css';

const componentPathRaw = import.meta.env.VITE_COMPONENT_PATH;
if (!componentPathRaw) throw new Error('No component path specified');

// Convert absolute path to Vite's /@fs/ format for dynamic imports
const componentPath = componentPathRaw.startsWith('/@fs/')
  ? componentPathRaw
  : `/@fs/${componentPathRaw.replace(/\\/g, '/')}`;

// Extract filename from component path and build test-data path
const componentFileName = componentPath.split('/').pop()!.replace('.tsx', '').replace('.jsx', '');
const testDataPath = `./test-data/${componentFileName}.data.ts`;

async function main() {
  const root = document.getElementById('root')!;

  // Simple loading indicator
  // root.innerHTML = '<div style="padding: 20px; font-size: 18px;">⚡ Loading component...</div>';

  try {
    // Dynamic imports - Vite will resolve these paths
    const [componentModule, testDataModule] = await Promise.all([
      import(/* @vite-ignore */ componentPath),
      import(/* @vite-ignore */ testDataPath),
    ]);

    const Component = componentModule.default || componentModule;
    const props = testDataModule.props || testDataModule.default;

    if (!Component) {
      throw new Error('Component module must have a default export');
    }

    if (!props) {
      throw new Error('Test data module must export "props" or have default export');
    }

    // Clear loading
    // root.innerHTML = '';

    // Check if it's a hook-based component (like useMasterQueueTable)
    if (typeof Component === 'function' && Component.name.startsWith('use')) {
      // It's a hook - mount manually
      const utility = Component();

      utility.mount(root, props);

      // Auto-show if available
      // setTimeout(() => {
      //   utility?.show();
      // }, 100);
    } else {
      // It's a regular component - render with Preact
      render(h(Component, props), root);
    }

    console.log('✅ Component loaded:', componentPath);
    console.log('✅ Test data loaded:', testDataPath);
  } catch (err: any) {
    console.error('❌ Failed to load component:', err);
    root.innerHTML = `
      <div style="padding: 20px; font-family: Arial, sans-serif;">
        <h1 style="color: #e74c3c; margin-bottom: 20px;">❌ Error Loading Component</h1>
        <div style="background: #ffe6e6; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <strong>Error:</strong> ${err.message}
        </div>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 10px;">
          <strong>Component path:</strong><br/>
          <code>${componentPath}</code>
        </div>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px;">
          <strong>Test data path:</strong><br/>
          <code>${testDataPath}</code>
        </div>
        <p style="margin-top: 20px; color: #666;">
          Check console for more details.
        </p>
      </div>
    `;
  }
}

main();
