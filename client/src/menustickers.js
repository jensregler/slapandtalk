// Former menu stickers (Jens, 31 Oct – 2 Nov 2026) – REMOVED from the menu system (Nov 2026).
// The Esc button menu (client/src/escmenu.js: SOUND / AVATAR / ROOM / CITY / EXIT / NAME) replaces
// them. These image ids stay listed only so:
//   - they are kept OFF the sticker wheel (WHEEL_EXCLUDE), and
//   - already-placed copies in old rooms behave as ordinary stickers (a click is Look/credit, never
//     opens a menu).
// Mapping that used to live here (for the report / git archaeology):
//   character (697fceb…) → Esc AVATAR  → together.openAvatarPanel()
//   radio/redio (14ea230…) → Esc SOUND → soundUi.open()
//   room (e8a9327…) → Esc ROOM → openRoomPanel()
//   exit (a03b0ba…) → Esc EXIT → exitChoices() / leaveWithHighlight
//   door/city (fe62d4b…) → Esc CITY → openDoorPick / enter city
//   nametag/editor (f79189b…) → Esc NAME → openNameTag()
// Retired earlier (t471u): camera, menue, stickerpac – also off the wheel.
export const FORMER_MENU_IDS = Object.freeze([
  '697fceb275175f0c', // character.png
  '14ea2304625a5827', // redio.png
  'e8a93272e6311b69', // room.png
  'a03b0ba5768979e6', // exit.png
  'fe62d4b007728d63', // city.png
  'f79189b79546d64a', // editor.png
]);
export const RETIRED_MENU_IDS = Object.freeze([
  '910d8ca0408dcec8', // camera.png
  'c70d4436a5b53efc', // menue.png
  '20c9aed10d5a98e8', // stickerpac.png
]);
// Everything that must never sit on the sticker wheel.
export const WHEEL_EXCLUDE = Object.freeze([...FORMER_MENU_IDS, ...RETIRED_MENU_IDS]);
// Back-compat aliases (tests / older call sites during the transition). Empty menus = none on wheel.
export const MENU_STICKERS = Object.freeze({});
export const MENU_ORDER = Object.freeze([]);
export const MENU_IDS = Object.freeze([]);
export function menuOf() { return null; }
export function runMenuSticker() { return null; }
