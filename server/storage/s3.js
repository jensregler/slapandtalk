// S3-kompatibel lagring, t.ex. Cloudflare R2 (gratis upp till 10 GB), Backblaze B2 eller AWS S3.
// Slås på med STORAGE=s3 och S3_*-variablerna (se storage/index.js). Inget konto skapas
// automatiskt: skapa en bucket och en API-nyckel hos leverantören och fyll i variablerna.
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');

// Städar S3_ENDPOINT: tar bort avslutande snedstreck och en bucket-sökväg som någon råkat
// klistra in (t.ex. https://<konto>.r2.cloudflarestorage.com/slapandtalk), och lägger till https://
// om det saknas. Bucketen skickas alltid separat (S3_BUCKET).
function normalizeEndpoint(endpoint, bucket) {
  if (!endpoint) return undefined;
  let e = String(endpoint).trim();
  if (!e) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(e)) e = 'https://' + e;
  try {
    const u = new URL(e);
    // Bucket som subdomän (slapandtalk.<konto>.r2...) -> kontots värd.
    if (bucket && u.hostname.toLowerCase().startsWith(bucket.toLowerCase() + '.') && /r2\.cloudflarestorage\.com$/i.test(u.hostname)) {
      u.hostname = u.hostname.slice(bucket.length + 1);
    }
    return `${u.protocol}//${u.host}`; // sökväg, query och hash bort
  } catch { return e.replace(/\/+$/, ''); }
}

// Klientinställningar som fungerar mot Cloudflare R2 (och andra S3-kompatibla tjänster):
// - forcePathStyle: https://<konto>.r2.cloudflarestorage.com/<bucket>/<nyckel> i stället för
//   bucketen som subdomän, så TLS-certifikatet alltid matchar kontots värd.
// - region "auto" (R2) om inget annat anges.
// - Nyare @aws-sdk/client-s3 (>= 3.729) skickar CRC-checksummor som standard; R2 och flera
//   andra S3-kloner klarar inte alla, så bara när det krävs.
function buildS3Config({ bucket, endpoint, region, accessKeyId, secretAccessKey } = {}) {
  const ep = normalizeEndpoint(endpoint, bucket);
  return {
    region: (region && String(region).trim()) || 'auto',
    endpoint: ep,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
    credentials: { accessKeyId, secretAccessKey },
  };
}

class S3Adapter {
  // client kan skickas in (används i testerna med en låtsas-S3).
  constructor({ bucket, endpoint, region, accessKeyId, secretAccessKey, prefix = '', client } = {}) {
    if (!bucket) throw new Error('STORAGE=s3 kräver S3_BUCKET');
    if (!client && (!accessKeyId || !secretAccessKey)) throw new Error('STORAGE=s3 kräver S3_ACCESS_KEY_ID och S3_SECRET_ACCESS_KEY');
    this.kind = 's3';
    this.bucket = bucket;
    this.prefix = prefix || '';
    this.client = client || new S3Client(buildS3Config({ bucket, endpoint, region, accessKeyId, secretAccessKey }));
  }
  k(key) { return this.prefix + key; }
  async get(key) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
      return Buffer.from(await r.Body.transformToByteArray());
    } catch (e) {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
  async put(key, buf, contentType = 'application/octet-stream') {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.k(key), Body: buf, ContentType: contentType }));
  }
  async delete(key) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.k(key) })); }
  async exists(key) {
    try { await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.k(key) })); return true; } catch (e) {
      if (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return false;
      throw e;
    }
  }
  async list(prefix) {
    const keys = [];
    let token;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.k(prefix), ContinuationToken: token }));
      for (const o of r.Contents || []) keys.push(o.Key.slice(this.prefix.length));
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
}

module.exports = { S3Adapter, buildS3Config, normalizeEndpoint };
