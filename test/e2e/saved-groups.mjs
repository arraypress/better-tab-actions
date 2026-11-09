/**
 * Chrome's saved tab groups, read from a closed profile: no extension API lists them and their
 * UI (the saved groups bar, the Tab groups menu) is native, so e2e checks read the store itself.
 *
 * Chromium keeps them in the profile's `Sync Data/LevelDB` (a DataTypeStore, kept even when
 * signed out), one record per group and one per tab, keyed `saved_tab_group-dt-<guid>`. Each
 * value is a `SavedTabGroupData` proto whose field 2 is the `SavedTabGroupSpecifics`
 * (components/sync/protocol/saved_tab_group_specifics.proto): 1 guid, 4 group (2 title,
 * 3 colour, 4 pinned position: present when pinned to the bar), 5 tab (1 group guid, 2 position,
 * 3 url). A fresh test profile never fills a LevelDB log (4 MB) so everything is in `*.log`
 * files, which this reads; it refuses a store that has compacted tables.
 *
 * Read only after the browser has closed, so every write is on disk.
 *
 * @module test/e2e/saved-groups
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * A saved group as Chrome keeps it.
 *
 * @typedef {object} SavedGroup
 * @property {string} title Its title.
 * @property {boolean} pinned Whether it's pinned to the saved groups bar.
 * @property {string[]} urls Its tabs' addresses, in order.
 */

/**
 * One protobuf field: its number and value (a number for varints, the bytes for the rest).
 *
 * @typedef {{field: number, value: number | Buffer}} ProtoField
 */

const KEY_PREFIX = 'saved_tab_group-dt-';
/** LevelDB log blocks: 32 KB, each record with a 7-byte header (checksum, length, type). */
const BLOCK = 32768;
const HEADER = 7;
/** Record types: a whole batch, or its first, middle or last fragment. */
const FULL = 1;
const FIRST = 2;
const MIDDLE = 3;
const LAST = 4;

/**
 * Read a varint (LevelDB lengths, protobuf keys and values). Numbers past 2^53 lose precision,
 * which only affects timestamps this never reads.
 *
 * @param {Buffer} buf - The bytes.
 * @param {number} at - Where it starts.
 * @returns {[value: number, next: number]} Its value and the offset after it.
 */
function varint(buf, at) {
  let value = 0;
  let scale = 1;
  let byte;
  do {
    byte = buf[at++];
    value += (byte & 0x7f) * scale;
    scale *= 128;
  } while (byte & 0x80);
  return [value, at];
}

/**
 * The write batches in one LevelDB log file, fragments joined.
 *
 * @param {Buffer} buf - The file.
 * @returns {Buffer[]} Its batches, in order.
 */
function batches(buf) {
  /** @type {Buffer[]} */
  const out = [];
  /** @type {Buffer[]} */
  let pending = [];
  let at = 0;
  while (at + HEADER <= buf.length) {
    const left = BLOCK - (at % BLOCK);
    if (left < HEADER) {
      at += left; // Block trailer: zero padding.
      continue;
    }
    const length = buf.readUInt16LE(at + 4);
    const type = buf[at + 6];
    if (type === 0 && length === 0) {
      at += left; // Pre-allocated, unwritten space.
      continue;
    }
    const data = buf.subarray(at + HEADER, at + HEADER + length);
    at += HEADER + length;
    if (type === FULL) out.push(data);
    else if (type === FIRST) pending = [data];
    else if (type === MIDDLE) pending.push(data);
    else if (type === LAST) out.push(Buffer.concat([...pending, data]));
  }
  return out;
}

/**
 * Apply one batch to the live keys: puts set a key, deletes remove it.
 *
 * @param {Buffer} batch - Sequence (8 bytes), count (4), then each tagged put or delete.
 * @param {Map<string, Buffer>} live - The keys, changed in place.
 */
function apply(batch, live) {
  const count = batch.readUInt32LE(8);
  let at = 12;
  for (let i = 0; i < count; i++) {
    const put = batch[at++] === 1;
    let length;
    [length, at] = varint(batch, at);
    const key = batch.subarray(at, at + length).toString('latin1');
    at += length;
    if (!put) {
      live.delete(key);
      continue;
    }
    [length, at] = varint(batch, at);
    live.set(key, batch.subarray(at, at + length));
    at += length;
  }
}

/**
 * The fields of one protobuf message (one level).
 *
 * @param {Buffer} buf - The message.
 * @returns {ProtoField[]} Its fields, in order.
 */
function fields(buf) {
  /** @type {ProtoField[]} */
  const out = [];
  let at = 0;
  while (at < buf.length) {
    let key;
    [key, at] = varint(buf, at);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) {
      let value;
      [value, at] = varint(buf, at);
      out.push({ field, value });
    } else if (wire === 2) {
      let length;
      [length, at] = varint(buf, at);
      out.push({ field, value: buf.subarray(at, at + length) });
      at += length;
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      out.push({ field, value: buf.subarray(at, at + size) });
      at += size;
    } else {
      throw new Error(`Unexpected protobuf wire type ${wire}`);
    }
  }
  return out;
}

/**
 * A field's bytes.
 *
 * @param {ProtoField[]} message - The message's fields.
 * @param {number} field - The field number.
 * @returns {Buffer | undefined} Its bytes, when present and not a number.
 */
const bytesOf = (message, field) => {
  const value = message.find((f) => f.field === field)?.value;
  return Buffer.isBuffer(value) ? value : undefined;
};

/**
 * Chrome's saved tab groups in a closed profile.
 *
 * @param {string} profile - The profile folder (as `extensionProfile` gives it).
 * @returns {Promise<SavedGroup[]>} The saved groups, in no particular order.
 * @throws {Error} When the store has compacted tables this doesn't read.
 */
export async function savedGroups(profile) {
  const dir = path.join(profile, 'Default', 'Sync Data', 'LevelDB');
  const files = await readdir(dir).catch(() => /** @type {string[]} */ ([]));
  if (files.some((file) => file.endsWith('.ldb'))) throw new Error(`${dir} has compacted tables; only logs are read`);
  /** @type {Map<string, Buffer>} */
  const live = new Map();
  for (const file of files.filter((name) => name.endsWith('.log')).sort()) {
    for (const batch of batches(await readFile(path.join(dir, file)))) apply(batch, live);
  }

  /** @type {Map<string, SavedGroup>} */
  const groups = new Map();
  /** @type {{group: string, position: number, url: string}[]} */
  const tabs = [];
  for (const [key, value] of live) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const specifics = bytesOf(fields(value), 2);
    if (!specifics) continue;
    const spec = fields(specifics);
    const guid = bytesOf(spec, 1)?.toString('utf8') ?? '';
    const group = bytesOf(spec, 4);
    const tab = bytesOf(spec, 5);
    if (group) {
      const g = fields(group);
      groups.set(guid, { title: bytesOf(g, 2)?.toString('utf8') ?? '', pinned: g.some((f) => f.field === 4), urls: [] });
    } else if (tab) {
      const t = fields(tab);
      const position = t.find((f) => f.field === 2)?.value;
      tabs.push({
        group: bytesOf(t, 1)?.toString('utf8') ?? '',
        position: typeof position === 'number' ? position : 0,
        url: bytesOf(t, 3)?.toString('utf8') ?? '',
      });
    }
  }
  for (const tab of tabs.sort((a, b) => a.position - b.position)) groups.get(tab.group)?.urls.push(tab.url);
  return [...groups.values()];
}
