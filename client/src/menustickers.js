// Menu stickers (Jens, 31 Oct 2026: "vi skall ändra menysystemet så att vi växlar till menyklibborna").
// Jens's six icon stickers (library, f852abd) are ordinary stickers – picked, slapped, peeled like
// any other – but a click/tap on one that is up in the room opens its menu:
//   character → My avatar (the camera zooms in on your turning avatar, the panel with every choice)
//   redio     → Sound settings (with the Music vol slider)
//   room      → the room info panel (name, lifetime, visitors, stickers; clear your stickers, ask for visitors)
//   camera    → the next camera view (the same as C)
//   exit      → leave the room, back to the start card
//   door      → enter the city (pick 3 slaps + the Priority Mail pac; the city is a stub) or back
//   editor    → the "my name is" name-tag drawing tool (the sticker roll)
//   menue     → like exit: exit to menu / back
//   stickerpac→ like the door: the city pac
// The pictures are Jens's own (Dropbox /Ulla/knappar, 2 Nov 2026).
// The icons are known by their image id (= a hash of the picture, library/manifest.json), so a
// re-upload of the same picture is the same icon. main.js maps the action names to what they do.
export const MENU_STICKERS = Object.freeze({
  '697fceb275175f0c': 'character', // character.png
  '14ea2304625a5827': 'radio',     // redio.png
  'e8a93272e6311b69': 'room',      // room.png
  '910d8ca0408dcec8': 'camera',    // camera.png
  'a03b0ba5768979e6': 'exit',      // exit.png
  'fe62d4b007728d63': 'door',      // city.png (the door "TO THE CITY"; replaced door.png 3260f7449c2321d0)
  'f79189b79546d64a': 'nametag',   // editor.png (the roll of "my name is" tags)
  'c70d4436a5b53efc': 'menu',      // menue.png (the Priority Mail card)
  '20c9aed10d5a98e8': 'pac',       // stickerpac.png (the Priority Mail package)
});
// Right of the middle of the sticker wheel at start (shared/wheelorder.mjs), in this order.
export const MENU_ORDER = Object.freeze(['character', 'radio', 'room', 'door', 'exit', 'camera', 'nametag', 'menu', 'pac']);
export const MENU_IDS = Object.freeze(MENU_ORDER.map((n) => Object.keys(MENU_STICKERS).find((id) => MENU_STICKERS[id] === n)));
// Which menu does this picked sticker ({ stamp, image } from stamps.pick) open? null = none.
export function menuOf(hit) {
  const id = hit && (hit.image?.id || hit.stamp?.imageId);
  return (id && MENU_STICKERS[id]) || null;
}
// Click/tap → action, if the sticker under it is a menu sticker and the action is wired.
// actions = { character: () => …, … }; returns the action name that ran, or null (then the click
// does what it always did: slap, credit, …).
export function runMenuSticker(hit, actions) {
  const name = menuOf(hit);
  if (!name || typeof actions[name] !== 'function') return null;
  actions[name]();
  return name;
}
