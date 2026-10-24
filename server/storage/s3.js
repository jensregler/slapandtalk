// S3-kompatibel lagring, t.ex. Cloudflare R2 (gratis upp till 10 GB), Backblaze B2 eller AWS S3.
// Slås på med STORAGE=s3 och S3_*-variablerna (se storage/index.js). Inget konto skapas
// automatiskt: skapa en bucket och en API-nyckel hos leverantören och fyll i variablerna.
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');

class S3Adapter {
  // client kan skickas in (används i testerna med en låtsas-S3).
  constructor({ bucket, endpoint, region, accessKeyId, secretAccessKey, prefix = '', client } = {}) {
    if (!bucket) throw new Error('STORAGE=s3 kräver S3_BUCKET');
    if (!client && (!accessKeyId || !secretAccessKey)) throw new Error('STORAGE=s3 kräver S3_ACCESS_KEY_ID och S3_SECRET_ACCESS_KEY');
    this.kind = 's3';
    this.bucket = bucket;
    this.prefix = prefix || '';
    this.client = client || new S3Client({
      region: region || 'auto', endpoint: endpoint || undefined, forcePathStyle: !!endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
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

module.exports = { S3Adapter };
