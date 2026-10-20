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

// Just enough of the ZIP format to read and write snippet packages, using
// Node's zlib, so neither the CLI nor the TypeScript provider image needs a zip
// library. Supports stored and deflated entries; no encryption, no ZIP64.

import { crc32, deflateRawSync, inflateRawSync } from 'zlib';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const UNIX_HOST = 3;
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
  /** Decompress and return the entry's content. */
  read(): Buffer;
}

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // The record is at least 22 bytes, followed by a comment of up to 65535 bytes.
  const earliest = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= earliest; i--) {
    if (buf.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      return i;
    }
  }
  throw new ZipFormatError('not a zip archive: no end of central directory record');
}

/** List a zip archive's entries. Content is only decompressed when an entry is read. */
export function readZip(buf: Buffer): ZipEntry[] {
  if (buf.length < 22) {
    throw new ZipFormatError('not a zip archive: too short');
  }
  const eocd = findEndOfCentralDirectory(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    throw new ZipFormatError('ZIP64 archives are not supported');
  }
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_DIRECTORY_HEADER) {
      throw new ZipFormatError('corrupt zip archive: bad central directory entry');
    }
    const versionMadeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const externalAttributes = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    const path = buf.toString('utf8', p + 46, p + 46 + nameLength);
    const unixMode = (versionMadeBy >> 8) === UNIX_HOST ? externalAttributes >>> 16 : 0;
    if (flags & 0x1) {
      throw new ZipFormatError(`encrypted entries are not supported: ${path}`);
    }
    entries.push({
      path,
      isDirectory: path.endsWith('/'),
      isSymlink: (unixMode & S_IFMT) === S_IFLNK,
      compressedSize,
      uncompressedSize,
      read: () => {
        if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
          throw new ZipFormatError(`corrupt zip archive: bad local header for ${path}`);
        }
        const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
        const data = buf.subarray(dataStart, dataStart + compressedSize);
        if (method === METHOD_STORED) {
          return Buffer.from(data);
        }
        if (method === METHOD_DEFLATE) {
          return inflateRawSync(data, { maxOutputLength: Math.max(uncompressedSize, 1) });
        }
        throw new ZipFormatError(`unsupported compression method ${method} for ${path}`);
      },
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** A file to write into a zip archive. */
export interface ZipInput {
  path: string;
  content: Buffer;
}

// 1980-01-01 00:00, the earliest DOS time, so the same input gives the same bytes.
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = (0 << 9) | (1 << 5) | 1;

/**
 * Write a zip archive. Entries are written in path order with a fixed
 * timestamp, so the same files always give the same archive.
 */
export function writeZip(files: ZipInput[]): Buffer {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { path, content } of sorted) {
    const name = Buffer.from(path, 'utf8');
    const deflated = deflateRawSync(content);
    const useDeflate = deflated.length < content.length;
    const data = useDeflate ? deflated : content;
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? METHOD_DEFLATE : METHOD_STORED, 8);
    local.writeUInt16LE(FIXED_DOS_TIME, 10);
    local.writeUInt16LE(FIXED_DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
    central.writeUInt16LE((UNIX_HOST << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? METHOD_DEFLATE : METHOD_STORED, 10);
    central.writeUInt16LE(FIXED_DOS_TIME, 12);
    central.writeUInt16LE(FIXED_DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}
