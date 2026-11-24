import { describe, expect, it } from 'vitest'
import { entryDataRange, listZip, type ReadRange } from '../src/zip'

const encoder = new TextEncoder()
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** Little-endian byte writer. */
class Bytes {
  parts: number[] = []
  u16(v: number) { this.parts.push(v & 0xff, (v >>> 8) & 0xff); return this }
  u32(v: number) { for (let i = 0; i < 4; i++) this.parts.push((v >>> (8 * i)) & 0xff); return this }
  u64(v: number) { return this.u32(v % 2 ** 32).u32(Math.floor(v / 2 ** 32)) }
  bytes(b: Uint8Array | number[]) { for (const v of b) this.parts.push(v); return this }
  get length() { return this.parts.length }
}

interface FileSpec { name: string; data: Uint8Array; method?: number; comment?: string }

/**
 * A ZIP file (stored data; the reader never checks CRCs). With `zip64`, sizes, offsets and the
 * entry count are written as ZIP64 records, as tools do for exports over 4 GB.
 */
function makeZip(files: FileSpec[], { zip64 = false, archiveComment = '' } = {}): Uint8Array {
  const out = new Bytes()
  const offsets: number[] = []
  for (const f of files) {
    offsets.push(out.length)
    const name = encoder.encode(f.name)
    out.u32(0x04034b50).u16(20).u16(0).u16(f.method ?? 0).u16(0).u16(0).u32(0)
      .u32(f.data.length).u32(f.data.length).u16(name.length).u16(3).bytes(name).bytes([1, 2, 3]).bytes(f.data)
  }
  const cdOffset = out.length
  files.forEach((f, i) => {
    const name = encoder.encode(f.name)
    const comment = encoder.encode(f.comment ?? '')
    const extra = new Bytes()
    if (zip64) extra.u16(0x0001).u16(24).u64(f.data.length).u64(f.data.length).u64(offsets[i])
    const big = (v: number) => (zip64 ? 0xffffffff : v)
    out.u32(0x02014b50).u16(45).u16(45).u16(0).u16(f.method ?? 0).u16(0).u16(0).u32(0)
      .u32(big(f.data.length)).u32(big(f.data.length)).u16(name.length).u16(extra.length).u16(comment.length)
      .u16(0).u16(0).u32(0).u32(big(offsets[i])).bytes(name).bytes(extra.parts).bytes(comment)
  })
  const cdSize = out.length - cdOffset
  if (zip64) {
    const record = out.length
    out.u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0).u64(files.length).u64(files.length).u64(cdSize).u64(cdOffset)
    out.u32(0x07064b50).u32(0).u64(record).u32(1)
  }
  const comment = encoder.encode(archiveComment)
  out.u32(0x06054b50).u16(0).u16(0)
    .u16(zip64 ? 0xffff : files.length).u16(zip64 ? 0xffff : files.length)
    .u32(zip64 ? 0xffffffff : cdSize).u32(zip64 ? 0xffffffff : cdOffset).u16(comment.length).bytes(comment)
  return Uint8Array.from(out.parts)
}

/** A range reader over the bytes that records what was read. */
function reader(zip: Uint8Array) {
  const reads: [number, number][] = []
  const read: ReadRange = async (start, end) => {
    reads.push([start, end])
    return zip.slice(start, end)
  }
  return { read, reads }
}

const files: FileSpec[] = [
  { name: 'export/activities.csv', data: encoder.encode('Filename\nactivities/1.fit.gz\n'), comment: 'csv' },
  { name: 'export/activities/1.fit.gz', data: Uint8Array.from([0x1f, 0x8b, 9, 9, 9]), method: 8 },
  { name: 'export/naïve – ünïcode.gpx', data: encoder.encode('<gpx/>') },
]

describe('ZIP directory reader', () => {
  for (const zip64 of [false, true]) {
    it(`lists entries and finds their data${zip64 ? ' (ZIP64)' : ''}`, async () => {
      const zip = makeZip(files, { zip64, archiveComment: 'Strava export' })
      const { read } = reader(zip)
      const entries = await listZip(read, zip.length, decode)
      expect(entries.map((e) => [e.name, e.method, e.size, e.compressedSize])).toEqual(
        files.map((f) => [f.name, f.method ?? 0, f.data.length, f.data.length]),
      )
      for (const [i, entry] of entries.entries()) {
        const [start, end] = await entryDataRange(read, entry)
        expect(zip.slice(start, end)).toEqual(files[i].data)
      }
    })
  }

  it('reads only the tail and the directory, not the whole file', async () => {
    const padding = { name: 'big.bin', data: new Uint8Array(200_000) }
    const zip = makeZip([padding, ...files])
    const { read, reads } = reader(zip)
    await listZip(read, zip.length, decode)
    const bytesRead = reads.reduce((sum, [s, e]) => sum + (e - s), 0)
    expect(bytesRead).toBeLessThan(70_000)
  })

  it('rejects files that are not ZIPs', async () => {
    const junk = encoder.encode('definitely not a zip file')
    await expect(listZip(reader(junk).read, junk.length, decode)).rejects.toThrow('Not a ZIP file')
  })

  it('rejects unsupported compression', async () => {
    const zip = makeZip([{ name: 'x.bz2', data: Uint8Array.from([1]), method: 12 }])
    const { read } = reader(zip)
    const [entry] = await listZip(read, zip.length, decode)
    await expect(entryDataRange(read, entry)).rejects.toThrow('Unsupported compression in x.bz2')
  })
})
