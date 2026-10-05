import { defineConfig } from 'tsup';

// Shared exports point to workspace TypeScript. Bundle both the domain and catalog
// so the compiled server runs in Node without a TypeScript loader.
export default defineConfig({ noExternal: [/^@guigs\/shared(?:\/|$)/] });
