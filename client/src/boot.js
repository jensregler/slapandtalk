// Which part of the app starts? ?replay=<id> = the replay page, otherwise the room itself.
// The page text is filled in from strings.js first. The server's config (config.js) decides if
// this is the demo profile: then the name question and the room routing (demo.js) come first.
import { applyStrings } from './strings.js';
import { loadConfig, config } from './config.js';
applyStrings();
if (new URLSearchParams(location.search).has('replay')) import('./replay.js');
else start();
async function start() {
  await loadConfig();
  if (config.demo) {
    const { demoGate } = await import('./demo.js');
    if (!(await demoGate())) return;
  }
  await import('./main.js');
}
