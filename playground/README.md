# 🎮 GPS Component Playground

Isolated development environment for testing GPS components with Vite + HMR.

## 🚀 Quick Start

```bash
# Test default component (MasterQueueTable)
npm run play

# Test specific component with cross-env (cross-platform):
cross-env VITE_COMPONENT_PATH=src/service/recruiter/recruiter.tsx npm run play

# Or directly (Windows PowerShell):
$env:VITE_COMPONENT_PATH="src/service/scheduler/scheduler-table.tsx"; npm run play

# Or directly (Linux/Mac):
VITE_COMPONENT_PATH=src/service/recruiter/recruiter.tsx npm run play
```

**Note:** Default component is `master-queue-table.tsx`. You can override it with the `VITE_COMPONENT_PATH` environment variable.

This will:

- Start Vite dev server on http://localhost:3000
- Open browser automatically
- Load component dynamically
- Enable instant HMR for component changes
- Load test data from corresponding `.data.ts` file

## 📁 Structure

```
playground/
├── vite.config.ts           # Vite configuration
├── index.html               # HTML template
├── main.tsx                 # Entry point (dynamic loader)
└── test-data/               # Test data for components
    └── master-queue-table.data.ts
```

## 🎯 How to Use

### 1. Create test data file:

For component: `src/service/my-component.tsx`

Create: `playground/test-data/my-component.data.ts`

```typescript
import type { MyComponentProps } from '../../src/service/my-component';

export const props: MyComponentProps = {
  // Your test props here
  onAction: () => console.log('Action!'),
  data: [...],
};
```

### 2. Start playground:

```bash
# Default component
npm run play

# Specific component
COMPONENT_PATH=src/service/my-component.tsx npm run play
```

### 3. Edit your component:

Changes appear in browser within ~200ms with HMR (no reload!)

## 🔥 Features

- ⚡ **Instant HMR** - See changes in <200ms
- 🎨 **Tailwind CSS** - Full Tailwind support with JIT
- 🔍 **TypeScript** - Full type checking
- 🎭 **Isolated** - Doesn't affect main webpack build
- 🎮 **Dynamic** - Test any component via CLI
- 📦 **Smart detection** - Works with hooks or components
- ❌ **Error handling** - Clear error messages

## 🧪 Testing Different Components

### Method 1: Environment Variable

```bash
# Linux/Mac:
VITE_COMPONENT_PATH=src/service/recruiter/recruiter.tsx npm run play

# Windows PowerShell:
$env:VITE_COMPONENT_PATH="src/service/recruiter/recruiter.tsx"; npm run play

# Windows CMD:
set VITE_COMPONENT_PATH=src/service/recruiter/recruiter.tsx && npm run play

# Cross-platform (with cross-env):
cross-env VITE_COMPONENT_PATH=src/service/recruiter/recruiter.tsx npm run play
```

### Method 2: Edit default in main.tsx

```typescript
// playground/main.tsx
const componentPathRaw = import.meta.env.VITE_COMPONENT_PATH || '../src/service/YOUR-COMPONENT.tsx'; // ← Change this
```

## 📝 Test Data Format

The playground expects test data to export `props`:

```typescript
// playground/test-data/component-name.data.ts
export const props = {
  // All props your component needs
};
```

### For Hook-based Components (like useMasterQueueTable):

```typescript
export const props = {
  initialQueue: [...],
  onRunAll: () => console.log('Run all'),
  // ... other callbacks
};
```

### For Regular Preact Components:

```typescript
export const props = {
  title: 'Hello',
  onClose: () => console.log('Close'),
  // ... all component props
};
```

## 💡 Tips

- Console logs from component actions appear in browser DevTools
- Use Preact DevTools browser extension for debugging
- Test data is type-safe - TypeScript will catch errors
- Component state persists during HMR (unless you force reload)
- First load shows "Loading..." (~100ms), then HMR is instant

## 🛠️ Troubleshooting

**"Component module must have a default export"**

- Make sure your component has `export default`

**"Test data module must export props"**

- Check that test data file exports `export const props = {...}`

**Port 3000 already in use:**

```typescript
// Change in playground/vite.config.ts:
server: {
  port: 3001, // ← Change this
}
```

**HMR not working:**

- Check browser console for errors
- Try hard refresh (Ctrl+Shift+R)
- Restart dev server

**Import errors:**

- Check path aliases in vite.config.ts
- Ensure component exports are correct
