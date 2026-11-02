// Copyright © 2026 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Reads snippet package zips with yauzl and writes them with yazl.

import yauzl from 'yauzl';
import yazl from 'yazl';

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** One entry of a zip archive, as listed in its central directory. */
export interface ZipEntry {
  /** Path inside the archive, with `/` separators. Directories end with `/`. */
  readonly path: string;
  readonly isDirectory: boolean;
  /** True when the entry was stored with Unix symlink permissions. */
  readonly isSymlink: boolean;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  /** Decompress and return the entry's content. Fails if it doesn't match its listed size. */
  read(): Promise<Buffer>;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * List a zip archive's entries. Content is only decompressed when an entry is
 * read. Rejects archives with absolute paths, `..` segments or backslashes in
 * entry names, and encrypted entries.
 */
export async function readZip(buf: Buffer): Promise<ZipEntry[]> {
  const zipfile = await yauzl.fromBufferPromise(buf, { lazyEntries: true, autoClose: false, strictFileNames: true });
  const entries = await new Promise<yauzl.Entry[]>((resolve, reject) => {
    const listed: yauzl.Entry[] = [];
    zipfile.on('entry', (entry: yauzl.Entry) => {
      listed.push(entry);
      zipfile.readEntry();
    });
    zipfile.on('end', () => resolve(listed));
    zipfile.on('error', reject);
    zipfile.readEntry();
  });
  return entries.map((entry) => {
    const unixMode = entry.versionMadeBy >> 8 === 3 ? entry.externalFileAttributes >>> 16 : 0;
    return {
      path: entry.fileName,
      isDirectory: entry.fileName.endsWith('/'),
      isSymlink: (unixMode & S_IFMT) === S_IFLNK,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
      read: async () => readStream(await zipfile.openReadStreamPromise(entry)),
    };
  });
}

/** A file to write into a zip archive. */
export interface ZipInput {
  path: string;
  content: Buffer;
}

// Constructed in local time, as yazl converts it to the zip's local DOS time, so
// every timezone writes 1980-01-01 00:00. Only the DOS time is written: the
// extended timestamp yazl adds by default is in UTC, which differs by timezone.
const FIXED_MTIME = new Date(1980, 0, 1);

/**
 * Write a zip archive. Entries are written in path order with a fixed
 * timestamp, so the same files always give the same archive.
 */
export async function writeZip(files: ZipInput[]): Promise<Buffer> {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const zipfile = new yazl.ZipFile();
  for (const { path, content } of sorted) {
    zipfile.addBuffer(content, path, { mtime: FIXED_MTIME, mode: 0o100644, forceDosTimestamp: true });
  }
  zipfile.end();
  return readStream(zipfile.outputStream);
}
