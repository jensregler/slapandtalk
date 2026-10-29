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
  toCity: '🏙 Visit the City', toCityTitle: 'The shared room everyone can visit',
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
  natureTitle: 'Nature stickers (full version)', natureAria: 'Nature stickers', natureLocked: '🔒 Nature · Full version', natureListTitle: '🌿 Nature', natureLockNote: ' · 🔒 Full version',
  libTitle: 'All stickers', // the whole library, under my own uploads (desktop panel + the phone's sticker book)
  pickThis: 'Pick this sticker',
  favAdd: 'Favourite (kept when you clear)', favRemove: 'Unfavourite',
  removeDesign: 'Remove from my stickers (stickers on the walls stay)',
  designRemovedToast: 'Removed', undo: 'Undo',
  designLoadFailed: 'Could not load the design right now.',
  uploadFirst: 'Upload a sticker first.',
  onlyOneDesign: 'You only have one design. Upload more to switch with R/F.',
  designLost: (n) => (n === 1 ? 'An old design was gone from the server and could not be restored. Please upload it again.'
    : `${n} old designs were gone from the server and could not be restored. Please upload them again.`),
  designRestored: (n) => (n === 1 ? 'A design had vanished from the server and was uploaded again.' : `${n} designs had vanished from the server and were uploaded again.`),
  maxSize: (m) => `Max size: ${m} m`,
  fileType: 'Only PNG, JPG or WebP, please.',
  fileTooBig: 'The file is too big (max 5 MB after shrinking).',
  uploading: 'Uploading…',
  uploadFailed: 'Upload failed, please try again.',
  uploadedTouch: 'Done! Tap a surface to slap it.',
  uploadedDesktop: 'Done! Enter the room and click to slap it.',
  pickFirst: 'Upload or pick a sticker first.',
  slapFailed: 'Could not slap right now, try again.',
  designHud: 'R/F: next/prev design',
  designBtn: 'Next design',
  size: 'Size', rotation: 'Rotation', jitter: 'A little random tilt (like for real)',
  artist: 'Your artist name (optional)', artistPlaceholder: 'e.g. Ulla K',
  artistLink: 'Your link (optional)', artistLinkPlaceholder: '@handle or https://…',
  artistLinkHint: 'An Instagram @handle, or an X, TikTok, YouTube or https:// link. People see it when they look at your stickers.',
  artistLinkBad: "That link won't work. Try @handle or an https:// link.",
  artistLinkOk: (label) => `Shows as: ${label}`,

  // ---------- Artist credit (Look mode) ----------
  creditOpenKey: 'L or click again: open link',
  creditOpenTap: 'Tap the link to open it',
  linkTitle: 'Open this link?',
  linkNote: 'It opens in a new tab.',
  linkOpen: 'Open', linkCancel: 'Cancel',

  // ---------- Modes ----------
  slapMode: 'Slap mode', lookMode: 'Look mode', natureMode: '🌿 Nature',
  // m = 'slap' | 'nature' | 'look'. V = Slap ⇄ Nature, G = Look mode (the demo, no nature: V = Look mode).
  modeHud: (m, touch, demo) => ({ slap: 'Slap mode', nature: '🌿 Nature mode', look: 'Look mode' }[m] || 'Slap mode') + (touch ? '' : m === 'look' && !demo ? ' · G' : ' · V'),
  modeBtnToSlap: 'Back to slap mode', modeBtnToLook: 'Look mode: hide the pointer and just look',
  modeToastLook: (touch, demo) => (touch ? 'Look mode: just look around.' : `Look mode: just look around. ${demo ? 'V' : 'G'} = slap again.`),
  modeToastNature: (touch) => (touch ? 'Nature mode: slapping nature stickers.' : 'Nature mode: slapping nature stickers. V = slap mode.'),
  modeToastSlap: (touch) => (touch ? 'Slap mode: tap where you want to slap.' : 'Slap mode: click to slap.'),
  modeSwitch: 'Mode',
  // ---------- 1st / 3rd person ----------
  secView: 'View', viewSwitch: 'Camera view',
  viewFirst: '1st person', viewThird: '3rd person',
  viewFirstTitle: 'See through your own eyes (C)', viewThirdTitle: 'See your avatar from behind (C)',
  viewBtnAria: '1st / 3rd person view', viewBtnToFirst: 'Back to 1st person', viewBtnToThird: '3rd person: see yourself from behind',
  viewToastThird: (touch) => (touch ? '3rd person: you see yourself from behind. Sticker stack → 👤 switches back.' : '3rd person: you see yourself from behind. C = 1st person.'),
  viewToastFirst: (touch) => (touch ? '1st person' : '1st person · C = 3rd person'),

  // ---------- Peel and history ----------
  myslaps: 'My slaps in this room',
  historyEmpty: 'No slaps of yours here yet.',
  historyLimit: (n) => `You can peel your last ${n} slaps in this room.`,
  historyItemTitle: 'Point or tap to see where it is',
  peelThis: 'Peel this one', peelThisAria: 'Peel this sticker',
  peelLast: '↩ Peel last', peelLastTitle: 'Peel your last sticker (Z)',
  peelAll: 'Peel all', peelAllConfirm: (n) => `Sure? Tap again (${n})`,
  peeled: 'Peeled', peeledN: (n) => `Peeled ${n} sticker${n === 1 ? '' : 's'}`,
  nothingToPeel: 'No more of your stickers here',
  // The dialog when you peel past the end of your history
  endTitle: 'End of slap history',
  endResetQ: 'Reset this room?', endResetText: 'This removes ALL stickers in this room, for everyone.',
  endFreshQ: 'Start a fresh room?', endFreshText: 'You’ve peeled all the slaps you can here. Want an empty room of your own?',
  resetRoom: 'Reset room', newRoomShort: 'New room', keepSlapping: 'Keep slapping',
  roomReset: (by) => `${by} reset the room`, resetFailed: 'Could not reset the room right now.',
  // Clear hidden stickers (the room's creator): stickers fully covered by newer ones go, the visible ones stay.
  clearHidden: '✨ Clear hidden stickers', clearHiddenTitle: 'Remove the stickers that are completely covered by newer ones. Everything you can see stays.',
  clearQ: (n) => (n ? `Remove ${n} hidden sticker${n === 1 ? '' : 's'}? Visible ones stay.` : 'Nothing is hidden right now. Every sticker can still be seen.'),
  clearCounting: 'Counting hidden stickers…',
  clearText: 'What you see becomes the new base layer. Peel history in this room starts over, for everyone.',
  clearGo: 'Remove them', clearFailed: 'Could not clear hidden stickers right now.',
  clearedN: (by, n) => `${by} cleared ${n} hidden sticker${n === 1 ? '' : 's'}`,
  slowDown: 'Easy now – wait a moment.',
  peelFailed: 'Could not peel right now, try again.',
  peelBtnAria: 'Peel my last sticker', peelBtnTitle: 'Peel (undo) my last sticker',
  modeBtnAria: 'Look mode on/off',
  natureModeLocked: 'Nature mode is part of the full version',

  // ---------- Desktop / touch help ----------
  enter: 'Enter the room',
  resumeHint: 'Click to enter',
  quickHelp: 'Click to enter · WASD walk · click = slap · R/F next/prev design · Z peel · V nature mode · G look mode · C 3rd person · T chat',
  helpDesktopHtml: '<b>Desktop:</b> click to enter. WASD = walk, mouse = look, click = slap, scroll wheel = size, Q/E = rotate, '
    + 'R = next design, F = previous design (cycles through your uploads), Z (or Ctrl+Z) = peel your last sticker, V = Slap mode / 🌿 Nature mode (nature stickers), G = look mode on/off '
    + '(hides the pointer, clicks do nothing; G again = slap mode), C = 1st/3rd person (see your avatar from behind), P = 📷 photo of what you see, Esc = menu (Esc again = back into the room). '
    + '<b>Rooms:</b> ＋ New quick room gives you your own room with a short code, 🔗 Share link sends it to friends, 🏙 Visit the City opens the shared room (the plain address takes you to your most recent room). '
    + '<b>Together:</b> everyone in the same room sees each other and each other’s stickers right away. T or Enter = chat (Enter sends, Esc closes). '
    + '<b>Recording:</b> the room’s creator can record and place cameras. ● REC shows for everyone while recording.',
  helpTouchHtml: '<b>Phone:</b> joystick bottom left = walk, drag = look. The sticker stack bottom right: tap it for the menu (📒 Stickers, 🧍 Character, 🏠 Room, ↩ Undo, 👤 3rd person, 📷 Photo, 💬 Talk, 🎙 Mic), swipe it up/down for the next/previous sticker, or sideways to turn the sticker wheel. '
    + 'The sticker in your hand sits in its holder in the middle: tap it to slap it there, drag it out and let go where it should go, or put a finger on a wall: it follows your finger and slaps where you let go; two fingers pinch it bigger/smaller and twist it round; 📒 🧍 🏠 stay at the bottom. Left untouched for 2 s it fades away and one finger just looks around – tap the screen to get it back (that tap does not slap). '
    + '<b>Rooms:</b> ＋ New quick room gives you your own room, 🔗 Share link sends it to friends. '
    + '<b>Together:</b> everyone in the same room sees each other right away. 💬 = chat. '
    + '<b>Recording:</b> the room’s creator can record and place cameras. ● REC shows for everyone while recording.',
  panelToggle: '☰ Stickers',
  stripAria: 'Your stickers', stripTitle: 'Your sticker wheel – click one to pick it (R/F: next/previous; scroll or drag to turn it – it goes round)',
  // ---------- Touch: the sticker stack menu (stackmenu.js) ----------
  stackBtnAria: 'Your stickers: tap for the menu, swipe up/down for the next/previous sticker, swipe sideways to turn the sticker wheel',
  smAria: 'Menu', smBook: 'Stickers', smAvatar: 'Character', smRoom: 'Room', smUndo: 'Undo', smView: '3rd person', smViewFirst: '1st person',
  smPhoto: 'Photo', smTalk: 'Talk', smMic: 'Mic', smTalkAria: 'Talk and microphone',
  smBookTitle: 'Your stickers', smBookHint: 'Tap one to hold it, then tap a wall to slap it.',
  heldWake: 'Tap a wall to slap it.',

  // ---------- More panel ----------
  more: '⚙ More', moreTitle: 'Sticker settings, your slaps, avatar, room look, sound, recording',
  moreHeading: 'More', close: 'Close',
  secSticker: 'Sticker', secPeople: 'People here', secRoom: 'Room', secSound: 'Sound', secHelp: 'Help',
  grooveLabel: 'Groove', grooveTitle: 'How far apart the footsteps are – everyone in the room hears the same groove',
  grooveReset: '1×', grooveResetTitle: 'Back to the normal walking groove',
  grooveHint: 'Everyone’s footsteps share one beat. Left = faster, until the steps buzz; right = slower, until they breathe. Keys [ and ] (Shift: bigger jumps).',
  grooveValue: (scale, bar) => `${scale} · bar ${bar}`, grooveChip: (scale) => `Groove ${scale}`,
  aslapLabel: 'Auto-slap', aslapModeTitle: 'On the beat: the steps share the room’s Groove bar. Free rate: your own speed.',
  aslapModeBar: 'On the beat', aslapModeFree: 'Free rate', aslapBarsTitle: 'How long the sequence loop is, in Groove bars',
  aslapBars: (b) => (b === 1 ? '1 bar' : b < 1 ? `1/${Math.round(1 / b)} bar` : `${b} bars`),
  aslapRateTitle: 'Slaps per second (free rate)', aslapSeq: 'Sequence', aslapLenTitle: 'Steps in the loop (1–32)',
  aslapStepTitle: (n, what) => `Step ${n} – ${what}. Click: on/off · Shift+click: pick · wheel: volume`, aslapStepN: (n) => `Step ${n}`,
  aslapEffective: (rate, capped) => `up to ${rate}${capped ? ' (max)' : ''}`,
  aslapHint: 'The sticker slaps by itself at the crosshair – look around to paint. H on/off; , and . slower/faster. Standing still slaps nothing; Z peels the whole run. Esc turns it off.',
  aslapChip: (what, paused) => `Auto-slap ${what}${paused ? ' · paused' : ''}`, aslapOnToast: 'Auto-slap on (H)', aslapOffToast: 'Auto-slap off',
  soundDesign: 'Sound settings…', soundDesignTitle: 'Design your own sounds and effects', soundSaved: 'Sound settings saved', soundTooBig: 'Too much sound data – remove a layer or two.',
  sound: 'Sounds', soundOn: '🔊', soundOff: '🔇', soundToggleTitle: 'Sound on/off (M)', soundOnToast: 'Sound on', soundOffToast: 'Sound off',

  // ---------- Together ----------
  myAvatar: '🧍 My avatar', myAvatarTitle: 'Choose how you look to others in the room',
  presenceOnline: (n) => (n === 1 ? 'Just you here right now' : `${n} here right now`),
  presenceFull: (n) => `The room is full (${n} of ${n}) – you are watching`,
  presenceConnecting: 'Connecting…', presenceOffline: 'No connection – retrying…',
  you: 'You', youSuffix: (name) => `${name} (you)`,
  joined: (name) => `${name} joined`, left: (name) => `${name} left`, renamed: (a, b) => `${a} is now ${b}`,
  chatPlaceholder: (touch) => (touch ? 'Say something…' : 'Say something… (Enter sends, Esc closes)'),
  chatPlaceholderFull: 'The room is full – you can read but not write yet',
  chatPlaceholderOffline: 'No connection right now…',
  noConnection: 'No connection right now.',
  chatAria: 'Chat', chatMessageAria: 'Chat message', send: 'Send', closeChat: 'Close chat', chatHint: 'T = chat',
  fullBanner: 'This room is full – one wall each. You can watch and read the chat, but not slap or talk yet. You get in automatically when someone leaves.',
  fullBannerMax: (n) => `This room is full – ${n} people max, one wall each. You can watch and read the chat, but not slap or talk yet. You get in automatically when someone leaves.`,
  fullNoSlap: 'The room is full – you can slap as soon as someone leaves.',
  avatarLoadFailed: 'Could not load the avatar right now.',
  avatarSaved: 'Your avatar is saved. Others see it right away.',
  avatarHeading: 'My avatar', avatarPreview: 'Preview of your avatar',
  avatarName: 'Name (shown above your head)', avatarNamePlaceholder: 'e.g. Jens',
  outfit: 'Outfit', hair: 'Hair', shirt: 'Top', pants: 'Trousers', hairColor: 'Hair colour', skin: 'Skin', cap: 'Cap',
  capColour: 'Cap colour',
  // Peels (backing paper on the floor)
  peelsToggle: '🧻 Peels: backing paper falls to the floor', peelsTitle: 'Every slap drops the sticker’s backing paper on the floor, like for real',
  peelsClear: '🧹 Sweep up the peels', peelsOnToast: 'Peels on: the backing paper lands on the floor.', peelsOffToast: 'Peels off.', peelsCleared: 'The floor is swept.',
  // Fabrics: an image repeated over a body part instead of the colour
  fabColour: 'Colour', fabFabric: 'Fabric', fabModeAria: (part) => `${part}: colour or fabric`,
  fabUpload: '📷 Upload image', fabUploadTitle: 'Use a picture from your device as fabric (it gets repeated)',
  fabPickHint: 'or pick one of these (your stickers, recent fabrics, patterns):',
  fabBaseHint: 'Colour under the fabric (shows through transparent parts):',
  fabNone: 'Pick an image to wear.',
  fabScale: 'Scale', fabRotation: 'Rotation', fabHue: 'Hue', fabCycleHue: 'Cycle hue', fabSpin: 'Spin', fabSpeed: 'Speed', fabScroll: 'Scroll',
  fabPreview: 'Fabric preview',
  fabMine: 'Your sticker', fabRecent: 'Recent fabric', fabPreset: (name) => `Pattern: ${name}`,
  fabUploading: 'Making fabric…', fabFailed: (msg) => `Could not use that image: ${msg}`,
  randomize: '🌀 Randomize', randomizeTitle: 'Roll a wild outfit with fabrics on everything',
  randomizing: 'Rolling a wild outfit…',

  // ---------- Recording and cameras ----------
  recHeading: '🎬 Recording',
  recHint: 'Records the room (avatars, where people look, stickers, chat, and how loudly people talk – never the sound itself) so it can be replayed and filmed. Everyone in the room sees ● REC.',
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
  // 📷 Photo (client/src/photo.js, server/photos.js)
  photoBtn: '📷 Photo', photoTitle: 'Take a photo of what you see (P) – downloaded and saved with a link',
  photoSaved: (url) => `📷 Saved. Link: ${url}`, photoSaving: '📷 Click!', photoFailed: (msg) => `The photo was downloaded, but not saved online: ${msg}`,
  photos: 'Photos',
  // The auto cameraman (shared/autocam.mjs): walks the room along a preset path, zooms gently.
  autoPaths: { perimeter: 'Perimeter', diagonal: 'Diagonal sweep', pushin: 'Push-in', seeded: 'Automatic', loop: 'Loop' },
  camAuto: '🎥 Auto cameraman', camAutoTitle: 'A camera that walks the room by itself and zooms gently – nothing to set. In the replay it is a take of its own.',
  camAutoOn: 'Auto cameraman on. It walks and films by itself.',
  camAutoName: (c) => `🎥 ${c.name}${c.auto && c.auto !== 'seeded' ? ' · ' + (EN.autoPaths[c.auto] || c.auto) : ''}`,
  camAutoAdd: '＋ Add cameraman', camAutoAddTitle: 'Then click the floor where it should start – it walks and films by itself from there',
  camAutoPlace: (touch) => (touch ? 'Tap the floor where the cameraman should start.' : 'Aim at the floor where the cameraman should start and click. Esc = cancel.'),
  camAutoPlaced: (name) => `${name} started. ✕ removes it.`,
  camAutoPath: 'Path (Automatic = from where it started)',
  camAutoMissed: 'Aim at the floor (or a wall) inside the room.',

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
  // The auto-director (shared/director.mjs): cuts to whoever is talking.
  viewDirector: '🎬 Director (follows who talks)',
  viewAuto: (path) => `🎥 Auto cameraman: ${EN.autoPaths[path] || path}`,
  autoLabel: (path, mm) => `🎥 Auto cameraman · ${EN.autoPaths[path] || path} · ${Math.round(mm)} mm`,
  viewCrew: (name, path, here) => `🎥 ${name} (${EN.autoPaths[path] || path})${here ? '' : ' (off now)'}`,
  crewLabel: (name, mm) => `🎥 ${name} · ${Math.round(mm)} mm`,
  // One cameraman per participant (shared/personcam.mjs): that person is the subject all the time.
  viewPerson: (name, here) => `🎥 Cameraman: ${name}${here ? '' : ' (not here now)'}`,
  personLabel: (name, size, mm) => `🎥 Cameraman: ${name} · ${({ close: 'close-up', medium: 'medium', wide: 'wide' })[size] || size} · ${Math.round(mm)} mm`,
  viewAngle: (kind, name) => `${{ close: '😮 Close-up', medium: '🧍 Medium', rear: '🔙 Over the shoulder' }[kind] || kind}: ${name}`,
  shotLabel: (kind, name) => (kind === 'room' || !name ? '🎬 The room' : `🎬 ${{ close: 'Close-up', medium: 'Medium', rear: 'Over the shoulder' }[kind] || kind} · ${name}`),
  shotList: '🎬 Shot list',
  shotListTitle: 'Who talks when and which camera angle (JSON), for editing the video by hand',
  notHereNow: 'Not in the room right now – free camera',
  recordVideo: '⏺ Record video', recordVideoTitle: 'Make a video: the logo intro, then what you see. You get a link to share.',
  stopVideo: '⏹ Stop video', downloadVideo: (mb) => `⬇ Download video (${mb} MB)`,
  noVideo: 'This browser cannot record video.',
  videoFailed: 'The video could not start. Try again, or another browser.',
  videoUploading: (pct) => `Saving the video… ${pct}%`, videoUploadFailed: 'The video could not be saved. You can still download it.',
  videoTooBig: (mb) => `The video is larger than ${mb} MB, so it can’t be saved online. Download it instead.`,
  videoSaved: 'Your video is ready:', videoOpen: 'Open', copyLink: 'Copy link', linkCopied: 'Link copied',
  videoKept: (days) => `The link works for ${days} days.`,
  videoSaveLink: (days) => `Save this link now – it works for ${days} days and we can’t send it to you later.`,
  emailMeLabel: 'Email me the link', emailPlaceholder: 'you@example.com', emailSend: 'Send',
  videoEmailed: 'Sent. Your address is not kept.', videoEmailFailed: 'The email could not be sent. Copy the link instead.',
  shareLinkAria: 'Link to your video', recVideos: (n) => `🎞 ${n} video${n === 1 ? '' : 's'}`,
  replayChat: 'Chat in the recording',

  // ---------- Full version (pay what you want, Lemon Squeezy) ----------
  fullEntry: '★ Full version', fullEntryTitle: 'What the full version adds, and how to unlock it',
  fullTitle: 'Full version', fullThanksTitle: 'Thank you!',
  fullIntro: 'Slap and Talk is free to use. The full version adds a few deeper toys on top:',
  fullActive: 'The full version is on in this browser. Thank you for supporting Slap and Talk.',
  fullThanksIntro: 'Your key is in the receipt e-mail from Lemon Squeezy. Paste it below to unlock the full version in this browser.',
  fullThanksDone: 'The full version is on in this browser. Your key is also in the receipt e-mail, for your other devices.',
  fullFeaturesHtml: '<li><b>Fabrics</b> – your own images as patterns on your avatar</li><li><b>Sound design</b> – a synth and effects for your own slap, peel and step sounds</li><li><b>Big stickers</b> – larger than 1 m</li><li><b>🌿 Nature mode</b> – the Nature wheel (80 nature stickers, 5 cm – 4 m) on V</li><li><b>Clean videos</b> – finished videos without the channel logo and link ticker</li><li>…and more as it comes</li>',
  fullPrice: 'Pay what you want, from $1. One payment, no subscription.',
  fullBuy: 'Get the full version', fullBuyNote: 'Opens Lemon Squeezy (card, PayPal, Apple Pay, Google Pay).',
  fullHaveKey: 'I have a key', fullKeyPlaceholder: 'Paste your key', fullKeyOk: 'Unlock',
  fullChecking: 'Checking…', fullUnlocked: 'Unlocked. Enjoy!',
  fullKeyBad: 'That key does not unlock the full version. Check the receipt e-mail and try again.',
  fullKeySlow: 'Easy now – wait a minute and try again.', fullKeyOffline: 'Could not reach the server. Try again in a moment.',
  fullStatus: '✓ Full version on', fullForget: 'Forget the key in this browser', fullForgotten: 'The key is forgotten in this browser.',

  // ---------- Admin ----------
  adminBanner: 'ADMIN MODE – click/tap a sticker to delete it',
  adminPrompt: 'Admin key:', adminWrong: 'Wrong admin key.', noStickerThere: 'No sticker there.',
  adminInfo: (order, artist, when) => `Sticker #${order} · ${artist || 'unknown artist'} · ${when}`,
  adminDeleted: 'Deleted.', adminConfirmImage: 'Delete the image and ALL its stickers in every room?',
  adminImageDeleted: (n) => `Image deleted (${n} stickers).`,
  adminDelStamp: 'Delete this sticker', adminDelImage: 'Delete the image everywhere',

  // ---------- Demo profile (the free version for the Thursday demo) ----------
  nameTitle: 'What’s your name?',
  nameHint: 'It shows above your character.',
  namePlaceholder: 'Your name',
  nameOk: 'Enter',
  demoRoomHud: (id) => `Room · ${id}`,
  demoTimer: (ms) => { const m = Math.ceil(ms / 60_000); if (ms <= 0) return 'closing'; if (ms < 5 * 60_000) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`; } return `${m} min left`; },
  demoTimerTitle: 'This room is temporary: it closes after an hour.',
  demoWarn: (min) => (min <= 1 ? 'This room closes in a minute. Thanks for being here.' : `This room closes in ${min} minutes.`),
  demoNote: (min) => `A temporary room for you and a few friends. It closes after ${min} minutes and everything in it goes away.`,
  closedTitle: 'This room has closed',
  closedText: 'Rooms here last an hour. Thanks for slapping.',
  closedNew: 'Start a new room',
  deniedInvite: 'This room is invite-only. Ask someone inside for an invite link.',
  deniedUsed: 'This invite link has already been used.',
  deniedFull: 'This room is full.',
  deniedGone: 'This room has closed.',
  invite: '✉ Invite a friend', inviteTitle: 'A link that lets one friend in',
  inviteCopied: 'Invite link copied. It works once.',
  inviteShareTitle: 'Come slap with me',
  inviteOpen: 'Your invite link is ready. It works once.',
  inviteUsed: (name) => (name ? `${name} came in with your invite.` : 'Your invite has been used.'),
  inviteFull: 'The room is full.',
  inviteNone: 'You can invite one friend.',
  quickHelpDemo: 'Click to enter · WASD walk · click = slap · R/F next/prev sticker · Z peel · V look mode · C 3rd person · T chat · B talk',
  helpDemoDesktopHtml: '<b>Desktop:</b> click to enter. WASD = walk, mouse = look, click = slap, scroll wheel = size, Q/E = rotate, '
    + 'R/F = next/previous sticker from the library, Z = peel your last sticker, V = look mode (click a sticker to see who made it), C = 1st/3rd person, Esc = menu. '
    + '<b>Together:</b> invite one friend with ✉ Invite a friend (the link works once). T or Enter = chat, 🎙 or B = talk (B again mutes). '
    + '<b>Your room</b> is temporary: it closes after an hour and everything in it goes away.',
  helpDemoTouchHtml: '<b>Phone:</b> joystick bottom left = walk, drag = look, tap = slap. The round button shows your sticker: tap it for the next one. '
    + 'The eye 👁 = look mode (tap a sticker to see who made it). 👤 = 1st/3rd person. ↩ peels your last sticker. '
    + '<b>Together:</b> ✉ Invite a friend (the link works once). 💬 = chat, 🎙 = talk. Your room closes after an hour.',
  // ---------- Voice ----------
  micOff: '🎙', micTitleOff: 'Talk: turn your microphone on', micTitleOn: 'Mute your microphone', micTitleMuted: 'Unmute your microphone',
  micOnToast: 'Microphone on – the others can hear you.', micMutedToast: 'Microphone muted.',
  micDenied: 'No microphone (permission was not given).',
  micUnsupported: 'Voice does not work in this browser.',
  voiceNear: 'Voices fade with distance',
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
