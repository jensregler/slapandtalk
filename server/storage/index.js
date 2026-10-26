// Lagringslagret. Resten av servern pratar bara med ett "adapter"-objekt med
// fem enkla funktioner, så vi kan byta var saker sparas utan att skriva om appen:
//
//   get(key)                 -> Buffer eller null om den inte finns
//   put(key, buffer, type)   -> sparar (skriver över)
//   delete(key)              -> tar bort (inget fel om den inte finns)
//   list(prefix)             -> alla nycklar som börjar med prefix
//   exists(key)              -> true/false
// … and for big files (videos), streamed instead of held in memory:
//   putFile(key, path, type) -> copies a local temp file in
//   stat(key)                -> { size } or null
//   getStream(key, {start,end}) -> a Readable (byte range, inclusive) or null
//
// Nycklar ser ut som sökvägar: "rooms/stad.json", "images/<id>.json", "uploads/<id>.webp".
//
// Välj med miljövariabeln STORAGE:
//   STORAGE=local (standard)  sparar i mappen DATA_DIR (standard: ./data)
//   STORAGE=s3                S3-kompatibel lagring, t.ex. Cloudflare R2. Kräver:
//     S3_BUCKET, S3_ENDPOINT (t.ex. https://<konto-id>.r2.cloudflarestorage.com),
//     S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, valfritt S3_REGION (standard "auto")
//     och S3_PREFIX (t.ex. "slapandtalk/").
const path = require('path');
const { LocalAdapter } = require('./local');

function createAdapter(env = process.env) {
  const kind = (env.STORAGE || 'local').toLowerCase();
  if (kind === 's3' || kind === 'r2') {
    const { S3Adapter } = require('./s3');
    return new S3Adapter({
      bucket: env.S3_BUCKET, endpoint: env.S3_ENDPOINT, region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, prefix: env.S3_PREFIX,
    });
  }
  if (kind !== 'local') throw new Error(`Okänd STORAGE=${kind} (använd local eller s3)`);
  return new LocalAdapter(env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
}

module.exports = { createAdapter };
