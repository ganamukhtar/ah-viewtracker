import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

export const SNAPSHOT_PATH = path.join(process.cwd(), 'data', 'snapshot.json');
const BLOB_PATH = 'views/snapshot.json';

export async function readSeedSnapshot() {
  try {
    const text = await readFile(SNAPSHOT_PATH, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeSeedSnapshot(snapshot) {
  await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
}

async function blobModule() {
  return import('@vercel/blob');
}

export async function readBlobSnapshot() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { head } = await blobModule();
    const meta = await head(BLOB_PATH, { token: process.env.BLOB_READ_WRITE_TOKEN });
    if (!meta?.url) return null;
    const response = await fetch(meta.url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    if (error?.name === 'BlobNotFoundError' || error?.message?.includes('not found') || error?.code === 'ERR_MODULE_NOT_FOUND') return null;
    console.error('Blob read failed:', error.message);
    return null;
  }
}

export async function writeBlobSnapshot(snapshot) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { persisted: false, where: null };
  try {
    const { put } = await blobModule();
    await put(BLOB_PATH, JSON.stringify(snapshot), {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
    return { persisted: true, where: 'blob' };
  } catch (error) {
    console.error('Blob write failed:', error.message);
    return { persisted: false, where: null, error: error.message };
  }
}

export async function readSnapshot() {
  const blob = await readBlobSnapshot();
  if (blob?.schemaVersion) return { snapshot: blob, source: 'blob' };
  const seed = await readSeedSnapshot();
  if (seed?.schemaVersion) return { snapshot: seed, source: 'file' };
  return { snapshot: null, source: null };
}

export async function writeSnapshot(snapshot) {
  const blob = await writeBlobSnapshot(snapshot);
  let file = false;
  let fileError = null;
  try {
    await access(path.dirname(SNAPSHOT_PATH));
    await writeSeedSnapshot(snapshot);
    file = true;
  } catch (error) {
    fileError = error.message;
  }
  return {
    persisted: blob.persisted || file,
    blob: blob.persisted,
    file,
    blobError: blob.error || null,
    fileError,
  };
}
