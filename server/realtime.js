// FÖRBEREDELSE FÖR FLERSPELARLÄGE (inte byggt än i v1)
//
// Tanken: när någon stämplar eller när admin tar bort något anropar servern
// broadcast(roomId, händelse). I v1 gör den ingenting. I v2 kopplar vi in en
// WebSocket-server (paketet "ws") här:
//   - varje besökare ansluter till  wss://.../ws?room=stad
//   - servern håller en lista med anslutna per rum (max ~8)
//   - händelser: 'stamp:add', 'stamp:remove', 'player:move', 'chat:message'
//   - röstchatt via WebRTC: servern skickar bara vidare "signal"-meddelanden
//     (offer/answer/ice) mellan spelarna, ljudet går direkt mellan dem.
// Klienten har en motsvarande stubbe i client/src/net.js.

const listeners = new Set();

function broadcast(roomId, event) {
  for (const fn of listeners) fn(roomId, event);
}
function onBroadcast(fn) { listeners.add(fn); return () => listeners.delete(fn); }

module.exports = { broadcast, onBroadcast };
