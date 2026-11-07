// Feature switches (shared/features.mjs): closed rooms stay in the repo but off.
import { FILMS_ENABLED } from '../shared/features.mjs';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
console.log('features');
check('FILMS_ENABLED is a boolean', typeof FILMS_ENABLED === 'boolean', FILMS_ENABLED);
check('FILMS_ENABLED is currently false (closed room: no filmed sequences room↔city)', FILMS_ENABLED === false, FILMS_ENABLED);
console.log(`\nfeatures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
