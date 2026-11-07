// Feature switches that close or reopen whole experience rooms without deleting their code.
// Flip a flag back to true to turn that room on again; media and modules stay in the repo either way.

// Session film (room → city) + highlight reel (room → city, and city/exit → menu).
// When false: leaving a room goes straight to the city picker; leaving the city / Exit to menu
// goes straight on – no film UI, no "Making your film…", no highlight offer, no MediaRecorder
// on those paths, and no background film/highlight event logging.
// REVERT: set FILMS_ENABLED to true.
export const FILMS_ENABLED = false;
