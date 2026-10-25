// All text the visitor sees, in one place. The site ships in English only for now.
// To add a language later: copy EN, translate it, and pick it in `S` below.
// Functions are used for text with numbers or names in it.
// In index.html, elements with data-t="key" get their text from here (data-t-html for markup,
// data-t-title / data-t-placeholder / data-t-aria for attributes, data-t-empty for the text shown
// when a list is empty), see applyStrings().
export const EN = {
  // ---------- Page ----------
  pageTitle: 'Slap and Talk',
  brand: 'Slap and Talk',

  // ---------- Room ----------
  roomTypes: { stad: 'The City', quick: 'Quick room', profile: 'Profile room' },
  roomLabel: 'Room',
  stickersWord: (n) => (n === 1 ? 'sticker' : 'stickers'),
  roomMenu: 'Room ▾',
  roomMenuTitle: 'New room, share link, back to the City',
  newRoom: '＋ New quick room', newRoomTitle: 'Make your own room with a short code you can share',
  shareRoom: '🔗 Share link', shareRoomTitle: 'Copy or share the link to this room',
  toCity: '🏙 Back to the City', toCityTitle: 'Back to the shared room',
  editStyle: '🎨 Change room look',
  roomNoteQuick: (h) => `Your own room. Share the link to invite people. It is deleted when nobody has visited for ${h} hours.`,
  roomNoteProfile: (owner) => `Saved room${owner ? ` owned by ${owner}` : ''}.`,
  roomHud: (type, id) => (type === 'stad' ? 'The City' : `${EN.roomTypes[type] || type} · ${id}`),
  roomStyleLine: (name, seed) => `Look: ${name}${seed ? ` · code ${seed}` : ''}`,
  shareTitle: (id) => (id === 'stad' ? 'Slap and Talk – The City' : `Slap and Talk – room ${id}`),
  linkCopied: (url) => `Link copied: ${url}`,
  copyLink: 'Copy the link:',
  roomLoadFailed: (msg) => `Could not load the room: ${msg}`,
  texturesFailed: 'Could not load the room textures.',
  styleSaved: 'Room look saved.',
  styleChanged: 'The room look changed.',

  // ---------- Room look panel ----------
  styleCreateTitle: 'New quick room', styleEditTitle: 'Change room look',
  styleCreateOk: 'Create room', styleEditOk: 'Save',
  styleHint: 'Pick a floor and walls. The room behind changes right away. All walls look the same.',
  floor: 'Floor', walls: 'Walls', wallColor: 'Wall colour', ceiling: 'Ceiling', code: 'Code', codePlaceholder: 'custom',
  random: '🎲 Random', randomTitle: 'Roll a random room', cancel: 'Cancel', save: 'Save',
  styleName: (floor, wall, color) => `${floor} floor · ${wall}${color ? ` ${color.toLowerCase()}` : ''} walls`,

  // ---------- Stickers ----------
  upload: '⬆ Upload sticker',
  uploadHint: 'PNG, JPG or WebP, max 5 MB. Transparency is kept.',
  trayEmpty: 'No sticker picked yet.',
  pickThis: 'Pick this sticker',
  designLoadFailed: 'Could not load the design right now.',
  uploadFirst: 'Upload a sticker first.',
  onlyOneDesign: 'You only have one design. Upload more to switch with R.',
  designLost: (n) => (n === 1 ? 'An old design was gone from the server and could not be restored. Please upload it again.'
    : `${n} old designs were gone from the server and could not be restored. Please upload them again.`),
  designRestored: (n) => (n === 1 ? 'A design had vanished from the server and was uploaded again.' : `${n} designs had vanished from the server and were uploaded again.`),
  maxSize: (m) => `Max size: ${m} m (wall height)`,
  fileType: 'Only PNG, JPG or WebP, please.',
  fileTooBig: 'The file is too big (max 5 MB after shrinking).',
  uploading: 'Uploading…',
  uploadedTouch: 'Done! Tap a surface to slap it.',
  uploadedDesktop: 'Done! Enter the room and click to slap it.',
  pickFirst: 'Upload or pick a sticker first.',
  slapFailed: 'Could not slap right now, try again.',
  designHud: 'R: next design',
  designBtn: 'Next design',
  size: 'Size', rotation: 'Rotation', jitter: 'A little random tilt (like for real)',
  artist: 'Your artist name (optional)', artistPlaceholder: 'e.g. @yourname',

  // ---------- Modes ----------
  slapMode: 'Slap mode', lookMode: 'Look mode',
  modeHud: (view, touch) => (view ? 'Look mode' : 'Slap mode') + (touch ? '' : ' · V'),
  modeBtnToSlap: 'Back to slap mode', modeBtnToLook: 'Look mode: hide the pointer and just look',
  modeToastLook: (touch) => (touch ? 'Look mode: just look around. Tap 👁 to slap again.' : 'Look mode: just look around. V = slap again.'),
  modeToastSlap: (touch) => (touch ? 'Slap mode: tap where you want to slap.' : 'Slap mode: click to slap.'),
  modeSwitch: 'Mode',

  // ---------- Peel and history ----------
  myslaps: 'My slaps in this room',
  historyEmpty: 'No slaps of yours here yet.',
  historyItemTitle: 'Point or tap to see where it is',
  peelThis: 'Peel this one', peelThisAria: 'Peel this sticker',
  peelLast: '↩ Peel last', peelLastTitle: 'Peel your last sticker (Z)',
  peelAll: 'Peel all', peelAllConfirm: (n) => `Sure? Tap again (${n})`,
  peeled: 'Peeled', peeledN: (n) => `Peeled ${n} sticker${n === 1 ? '' : 's'}`,
  nothingToPeel: 'No more of your stickers here',
  slowDown: 'Easy now – wait a moment.',
  peelFailed: 'Could not peel right now, try again.',
  peelBtnAria: 'Peel my last sticker', peelBtnTitle: 'Peel (undo) my last sticker',
  modeBtnAria: 'Look mode on/off',

  // ---------- Desktop / touch help ----------
  enter: 'Enter the room',
  quickHelp: 'Click to enter · WASD walk · click = slap · R next design · Z peel · V look mode · T chat',
  helpDesktopHtml: '<b>Desktop:</b> click to enter. WASD = walk, mouse = look, click = slap, scroll wheel = size, Q/E = rotate, '
    + 'R = next design (cycles through your uploads), Z (or Ctrl+Z) = peel your last sticker, V = look mode on/off '
    + '(hides the pointer, clicks do nothing; V again = slap mode), Esc = back to the menu. '
    + '<b>Rooms:</b> ＋ New quick room gives you your own room with a short code, 🔗 Share link sends it to friends, 🏙 Back to the City takes you back. '
    + '<b>Together:</b> everyone in the same room sees each other and each other’s stickers right away. T or Enter = chat (Enter sends, Esc closes). '
    + '<b>Recording:</b> the room’s creator can record and place cameras. ● REC shows for everyone while recording.',
  helpTouchHtml: '<b>Phone:</b> joystick bottom left = walk, drag = look, tap = slap. The round button bottom right shows your design: tap it for the next one. '
    + 'The eye 👁 turns look mode on (taps do nothing), tap again to slap. ↩ peels your last sticker. '
    + '<b>Rooms:</b> ＋ New quick room gives you your own room, 🔗 Share link sends it to friends. '
    + '<b>Together:</b> everyone in the same room sees each other right away. 💬 = chat. '
    + '<b>Recording:</b> the room’s creator can record and place cameras. ● REC shows for everyone while recording.',
  panelToggle: '☰ Stickers',

  // ---------- More panel ----------
  more: '⚙ More', moreTitle: 'Sticker settings, your slaps, avatar, room look, sound, recording',
  moreHeading: 'More', close: 'Close',
  secSticker: 'Sticker', secPeople: 'People here', secRoom: 'Room', secSound: 'Sound', secHelp: 'Help',
  sound: 'Sounds', soundOn: '🔊', soundOff: '🔇', soundToggleTitle: 'Sound on/off (M)', soundOnToast: 'Sound on', soundOffToast: 'Sound off',

  // ---------- Together ----------
  myAvatar: '🧍 My avatar', myAvatarTitle: 'Choose how you look to others in the room',
  presenceOnline: (n) => (n === 1 ? 'Just you here right now' : `${n} here right now`),
  presenceFull: (n) => `The room is full (${n}) – you are watching`,
  presenceConnecting: 'Connecting…', presenceOffline: 'No connection – retrying…',
  you: 'You', youSuffix: (name) => `${name} (you)`,
  joined: (name) => `${name} joined`, left: (name) => `${name} left`, renamed: (a, b) => `${a} is now ${b}`,
  chatPlaceholder: (touch) => (touch ? 'Say something…' : 'Say something… (Enter sends, Esc closes)'),
  chatPlaceholderFull: 'The room is full – you can read but not write yet',
  chatPlaceholderOffline: 'No connection right now…',
  noConnection: 'No connection right now.',
  chatAria: 'Chat', chatMessageAria: 'Chat message', send: 'Send', closeChat: 'Close chat', chatHint: 'T = chat',
  fullBanner: 'The room is full right now. You can watch and read the chat – you get in automatically when someone leaves.',
  avatarLoadFailed: 'Could not load the avatar right now.',
  avatarSaved: 'Your avatar is saved. Others see it right away.',
  avatarHeading: 'My avatar', avatarPreview: 'Preview of your avatar',
  avatarName: 'Name (shown above your head)', avatarNamePlaceholder: 'e.g. Jens',
  outfit: 'Outfit', hair: 'Hair', shirt: 'Top', pants: 'Trousers', hairColor: 'Hair colour', skin: 'Skin', cap: 'Cap',

  // ---------- Recording and cameras ----------
  recHeading: '🎬 Recording',
  recHint: 'Records the room (avatars, where people look, stickers, chat) so it can be replayed and filmed from the cameras. Everyone in the room sees ● REC.',
  recStart: '● Start recording', recStop: '■ Stop recording',
  recStarted: '● Recording started – this room is being recorded', recStartedToast: '● Recording started. This room is being recorded.',
  recStopped: (reason) => `■ Recording stopped${reason ? ` (${reason})` : ''}`, recStoppedToast: '■ Recording stopped.',
  recReasons: { time: 'max length reached', size: 'max size reached', empty: 'the room was empty', shutdown: 'the server restarted' },
  recJoined: '● This room is being recorded',
  recNoticeTitle: '● This room is being recorded',
  recNoticeText: 'What you do and write here (avatar, movement, stickers and chat) is recorded by the room’s creator. Voice is not recorded.',
  ok: 'OK', recBadgeTitle: 'This room is being recorded',
  recordings: 'Recordings', recItemInfo: (people, kb, status) => ` ${people} ${people === 1 ? 'person' : 'people'} · ${kb} kB${status === 'recording' ? ' · in progress' : status === 'interrupted' ? ' · interrupted' : ''}`,
  fmtLen: (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; },
  cameras: 'Cameras', camerasEmpty: 'No cameras yet.',
  camAdd: '🎥 Place camera here', camAddTitle: 'Put a camera where you stand, facing where you look',
  camShow: 'Show cameras in the room',
  camNameAria: 'Camera name', camFov: 'Field of view', camAspect: 'Format',
  camAspects: { '': 'Free', '16:9': '16:9', '9:16': '9:16' },
  camAspectTitles: { '': 'Free format', '16:9': '16:9 (landscape)', '9:16': '9:16 (portrait, Reels)' },
  camLook: 'Look through the camera (Esc = back)', camMove: 'Move the camera here (where you stand, facing where you look)', camDel: 'Remove the camera',
  camPlaced: (name) => `${name} placed. 👁 = look through it.`,
  camViewLabel: (c) => `📷 ${c.name}${c.aspect ? ' · ' + c.aspect : ''} · ${c.fov}°`,
  camViewEsc: '· Esc = back', back: 'Back',
  cameraDefault: 'Camera',

  // ---------- Replay ----------
  replayBack: '← Back to the room', replayLoading: 'Loading the recording…',
  replayTitle: (room, when, len, live) => `Replay · ${room === 'stad' ? 'The City' : 'room ' + room} · ${when} · ${len}${live ? ' (in progress – showing what has been recorded so far)' : ''}`,
  replayFailed: (msg) => `Could not play: ${msg}`,
  replayNone: 'No recording chosen.',
  replayMissing: 'The recording does not exist (maybe it vanished when the server restarted).',
  replayError: (status) => `Error ${status}`,
  play: 'Play (space)', pause: 'Pause (space)', seek: 'Seek', speed: 'Speed', view: 'View',
  viewFree: '🎥 Free camera (drag to look, WASD = walk)',
  viewCam: (c) => `📷 ${c.name}${c.aspect ? ' · ' + c.aspect : ''}`,
  viewPov: (name, here) => `👀 ${name}’s eyes${here ? '' : ' (not here now)'}`,
  povLabel: (name) => `${name}’s eyes`,
  notHereNow: 'Not in the room right now – free camera',
  recordVideo: '⏺ Record video', recordVideoTitle: 'Record what you see to a video file (.webm)',
  stopVideo: '⏹ Stop video', downloadVideo: (mb) => `⬇ Download video (${mb} MB)`,
  noVideo: 'This browser cannot record video.',
  replayChat: 'Chat in the recording',

  // ---------- Admin ----------
  adminBanner: 'ADMIN MODE – click/tap a sticker to delete it',
  adminPrompt: 'Admin key:', adminWrong: 'Wrong admin key.', noStickerThere: 'No sticker there.',
  adminInfo: (order, artist, when) => `Sticker #${order} · ${artist || 'unknown artist'} · ${when}`,
  adminDeleted: 'Deleted.', adminConfirmImage: 'Delete the image and ALL its stickers in every room?',
  adminImageDeleted: (n) => `Image deleted (${n} stickers).`,
  adminDelStamp: 'Delete this sticker', adminDelImage: 'Delete the image everywhere',
};

export const S = EN;
export const LOCALE = 'en-GB'; // dates and times

// Fill in text in the static page (index.html).
export function applyStrings(root = document) {
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = S[el.dataset.t];
  for (const el of root.querySelectorAll('[data-t-html]')) el.innerHTML = S[el.dataset.tHtml];
  for (const el of root.querySelectorAll('[data-t-title]')) el.title = S[el.dataset.tTitle];
  for (const el of root.querySelectorAll('[data-t-placeholder]')) el.placeholder = S[el.dataset.tPlaceholder];
  for (const el of root.querySelectorAll('[data-t-empty]')) el.dataset.empty = S[el.dataset.tEmpty];
  for (const el of root.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', S[el.dataset.tAria]);
  document.title = S.pageTitle;
}
