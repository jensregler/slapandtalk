// Which part of the app starts? ?replay=<id> = the replay page, otherwise the room itself.
// The page text is filled in from strings.js first.
import { applyStrings } from './strings.js';
applyStrings();
if (new URLSearchParams(location.search).has('replay')) import('./replay.js');
else import('./main.js');
