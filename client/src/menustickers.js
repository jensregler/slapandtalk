// Menu stickers (Jens, 31 Oct 2026: "vi skall ändra menysystemet så att vi växlar till menyklibborna").
// Jens's six icon stickers (library, f852abd) are ordinary stickers – picked, slapped, peeled like
// any other – but a click/tap on one that is up in the room opens its menu:
//   character → My avatar (the camera zooms in on your turning avatar, the panel with every choice)
//   redio     → Sound settings (with the Music vol slider)
//   room      → the room info panel (name, lifetime, visitors, stickers; clear your stickers, ask for visitors)
//   exit      → leave the room, back to the start card
//   door      → enter the city (pick 3 slaps + the Priority Mail pac; the city is a stub) or back
//   editor    → the "my name is" name-tag drawing tool (the sticker roll)
// Jens, 2 Nov 2026 (t471u): only these six are active. camera, menue, rita and stickerpac are no
// menu stickers any more and are NOT on the sticker wheel (RETIRED_MENU_IDS). menue.png is still the
// start card's background art (client/public/start/card.webp), not a wheel sticker. The city pac
// goes through city (door) only. Already-placed retired stickers in old rooms stay as plain stickers
// (a click does what a click on any sticker does).
// The pictures are Jens's own (Dropbox /Ulla/knappar, 2 Nov 2026).
// The icons are known by their image id (= a hash of the picture, library/manifest.json), so a
// re-upload of the same picture is the same icon. main.js maps the action names to what they do.
export const MENU_STICKERS = Object.freeze({
  '697fceb275175f0c': 'character', // character.png
  '14ea2304625a5827': 'radio',     // redio.png
  'e8a93272e6311b69': 'room',      // room.png
  'a03b0ba5768979e6': 'exit',      // exit.png
  'fe62d4b007728d63': 'door',      // city.png (the door "TO THE CITY"; replaced door.png 3260f7449c2321d0)
  'f79189b79546d64a': 'nametag',   // editor.png (the roll of "my name is" tags)
});
// Off the wheel and inert (t471u). Since the 4 Nov 2026 refresh (Dropbox "Teammapp för Ulla o co")
// camera.png and stickerpac.png are no longer in the library at all (the knappar folder has only the
// seven others; the bag designs are client/public/stickerpacks, door.js); their ids stay here so an
// old room's placed ones (still in storage) are never treated as menu stickers or put on the wheel. rita.png is not in the library (library/manifest.json, 2 Nov
// 2026), so it has no id here; if it is ever imported, add its image id to this list.
export const RETIRED_MENU_IDS = Object.freeze([
  '910d8ca0408dcec8', // camera.png
  'c70d4436a5b53efc', // menue.png (the Priority Mail card – still the start card's art)
  '20c9aed10d5a98e8', // stickerpac.png (the Priority Mail package)
]);
// Right of the middle of the sticker wheel at start (shared/wheelorder.mjs), in this order.
export const MENU_ORDER = Object.freeze(['character', 'radio', 'room', 'door', 'exit', 'nametag']);
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
