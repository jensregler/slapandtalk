// Unit: the session film's planner (shared/film.mjs, pt536u) – events → scenes, the pack last, the dialog's choices, the file type.
import { planFilm, sceneAt, filmChoice, pickFilmMime, FILM, FILM_CHOICES, spread, groupBy } from '../shared/film.mjs';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 500) : '')); } };
const st = (t, url = 'u' + t) => ({ t, e: 'stick', url, aspect: 1 });
console.log('film');
// empty / start only
let p = planFilm([{ t: 0, e: 'start', room: 'r1', name: 'Jens' }]);
check('just coming in → title + end card', p.scenes.map((s) => s.kind).join() === 'open,end' && p.scenes[0].room === 'r1' && p.scenes[0].name === 'Jens' && !p.hasPack, p);
// a full session
const ev = [{ t: 0, e: 'start', room: 'r1', name: 'Jens' }, st(1000), st(2500), st(4000), st(5000), { t: 30000, e: 'radio', what: 'open' }, { t: 31000, e: 'radio', what: 'dial' }, { t: 60000, e: 'peel' }, st(90000), { t: 120000, e: 'pack', name: 'Malmö pac', bag: 4 }, st(130000), { t: 131000, e: 'radio' }];
p = planFilm(ev);
const kinds = p.scenes.map((s) => s.kind).join();
check('scenes in order: open, stick (merged), radio (merged), cut (peel), stick, pack', kinds === 'open,stick,radio,cut,stick,pack', kinds);
const s1 = p.scenes[1];
check('4 rapid stickers merge into one scene: 3 shown, count 4, longer', s1.count === 4 && s1.stickers.length === FILM.stickShow && s1.dur === FILM.stickOne + 2 * FILM.stickExtra, s1);
check('two radio touches 1 s apart → one radio scene (touches 2)', p.scenes[2].touches === 2);
check('the pack is LAST, with its name and bag; nothing after it (later events dropped)', p.scenes.at(-1).kind === 'pack' && p.scenes.at(-1).name === 'Malmö pac' && p.scenes.at(-1).bag === 4 && p.stickers === 4 && p.hasPack, p.scenes.at(-1));
check('the sticker indexes run on (first) across stick scenes', p.scenes[4].first === 3);
check('times add up (t0 and length)', p.scenes.every((s, i) => i === 0 ? s.t0 === 0 : Math.abs(s.t0 - (p.scenes[i - 1].t0 + p.scenes[i - 1].dur)) < 1e-6) && Math.abs(p.length - p.scenes.reduce((a, s) => a + s.dur, 0)) < 1e-6);
// the pack comes last even if its event has an earlier time than something unsorted
p = planFilm([{ t: 50, e: 'pack', name: 'x' }, st(10), { t: 0, e: 'start' }]);
check('unsorted events: sorted, the pack still last', p.scenes.map((s) => s.kind).join() === 'open,stick,pack');
// throttle
const many = []; for (let i = 0; i < 40; i++) many.push(st(i * 20000)); for (let i = 0; i < 20; i++) many.push({ t: i * 40000 + 7000, e: 'radio' });
for (let i = 0; i < 30; i++) many.push({ t: i * 1000 + 2_000_000, e: 'peel' });
p = planFilm(many);
const cnt = (k) => p.scenes.filter((s) => s.kind === k).length;
check(`a long session is throttled: ≤${FILM.maxStick} stick, ≤${FILM.maxRadio} radio, ≤${FILM.maxCut} cut`, cnt('stick') <= FILM.maxStick && cnt('radio') <= FILM.maxRadio && cnt('cut') <= FILM.maxCut && cnt('cut') >= 1, { s: cnt('stick'), r: cnt('radio'), c: cnt('cut') });
check('…and the film stays short (< 40 s)', p.length < 40, p.length);
check('a cut never sits next to a sticker/radio moment', planFilm([st(1000), { t: 3000, e: 'peel' }]).scenes.every((s) => s.kind !== 'cut'));
check('junk events are ignored', planFilm([null, { e: 'stick' }, { t: 'x', e: 'stick' }, 5]).scenes.length === 2);
check('spread keeps first and last', spread([1, 2, 3, 4, 5, 6, 7], 3).join() === '1,4,7' && groupBy([st(0), st(100), st(9000)], 8000).length === 2);
// sceneAt
p = planFilm(ev);
const a = sceneAt(p, p.scenes[2].t0 + p.scenes[2].dur / 2);
check('sceneAt: the right scene and u ≈ .5', a.i === 2 && Math.abs(a.u - 0.5) < 1e-6);
check('sceneAt: past the end → the last scene at u = 1', sceneAt(p, p.length + 5).scene.kind === 'pack' && sceneAt(p, p.length + 5).u > 0.9999);
// the dialog
check('three choices: watch, download, discard', FILM_CHOICES.join() === 'watch,download,discard');
check('watch → play, stay on the dialog', JSON.stringify(filmChoice('watch', { canDownload: true })) === JSON.stringify({ action: 'play', stay: true }));
check('download → download (or nothing when the browser can’t record)', filmChoice('download', { canDownload: true }).action === 'download' && filmChoice('download', { canDownload: false }).action === 'none');
check('discard → continue into the city (discard unless downloaded)', filmChoice('discard', {}).action === 'continue' && filmChoice('discard', {}).discard === true && filmChoice('discard', { downloaded: true }).discard === false);
// mime
const chrome = (m) => /webm/.test(m), safari = (m) => /mp4/.test(m), both = () => true;
check('Chrome: webm', pickFilmMime(chrome)?.ext === 'webm');
check('Safari (iPhone): mp4', pickFilmMime(safari)?.ext === 'mp4' && pickFilmMime(both, { prefer: 'mp4' })?.ext === 'mp4');
check('no recorder support → null (watch live only)', pickFilmMime(() => false) === null);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
