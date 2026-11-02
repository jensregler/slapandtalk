// Which part of the app starts? ?replay=<id> = the replay page, otherwise the room itself.
// The page text is filled in from strings.js first. The server's config (config.js) decides if
// this is the demo profile: then the name question and the room routing (demo.js) come first;
// otherwise the plain address goes to your most recently used room (landing.js).
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
  } else {
    const q = new URLSearchParams(location.search);
    if (!q.has('room') && !q.has('admin')) {
      // The plain address and ?start=1 (the exit sticker's "Exit to menu"): the Priority Mail start
      // card (startcard.js; Jens, 31 Oct 2026) – it loads the chosen room itself.
      const { showStartCard } = await import('./startcard.js');
      await showStartCard();
      return;
    }
    const { land } = await import('./landing.js');
    await land();
  }
  await import('./main.js');
}
