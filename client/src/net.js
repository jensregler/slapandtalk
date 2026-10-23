// FÖRBEREDELSE FÖR FLERSPELARLÄGE (inte byggt i v1).
// I v2 öppnar connect() en WebSocket mot servern (se server/realtime.js).
// Då skickas våra stämplar, position och chatt ut, och vi tar emot andras.
// main.js anropar redan de här funktionerna, så v2 behöver bara fylla i dem.
export function connect(roomId, handlers) {
  // handlers: { onStampAdd(stamp, image), onStampRemove(id), onPlayer(p), onChat(msg) }
  return {
    sendMove(/* position, yaw */) {},
    sendChat(/* text */) {},
    close() {},
  };
}
