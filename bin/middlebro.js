#!/usr/bin/env node
// Thin launcher — delegates to compiled output.
// During development, use: npm start  (runs via tsx directly)
import('../dist/cli/index.js').catch((err) => {
  console.error('middlebro: failed to start —', err.message);
  console.error('Did you run `npm run build` first?');
  process.exit(1);
});
