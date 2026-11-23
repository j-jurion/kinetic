// Minimal random-access ZIP reader for large local files (an Apple Health export can be
// several gigabytes). It reads the central directory, including ZIP64 records, and streams
// single entries through the browser's own DecompressionStream, so nothing is loaded whole.

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  localOffset: number
}

const EOCD = 0x06054b50
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_EOCD = 0x06064b50
const CENTRAL = 0x02014b50
const MAX = 0xffffffff

async function read(file: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await file.slice(start, end).arrayBuffer())
}

function u64(view: DataView, offset: number): number {
  return view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 2 ** 32
}

export async function listZip(file: Blob): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, file.size - (65535 + 22))
  const tail = await read(file, tailStart, file.size)
  let eocd = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file')

  let count = tail.getUint16(eocd + 10, true)
  let cdSize = tail.getUint32(eocd + 12, true)
  let cdOffset = tail.getUint32(eocd + 16, true)
  if (count === 0xffff || cdSize === MAX || cdOffset === MAX) {
    const locator = eocd - 20
    if (locator < 0 || tail.getUint32(locator, true) !== ZIP64_LOCATOR) throw new Error('Unsupported ZIP file')
    const zip64Offset = u64(tail, locator + 8)
    const record = await read(file, zip64Offset, zip64Offset + 56)
    if (record.getUint32(0, true) !== ZIP64_EOCD) throw new Error('Unsupported ZIP file')
    count = u64(record, 32)
    cdSize = u64(record, 40)
    cdOffset = u64(record, 48)
  }

  const directory = await read(file, cdOffset, cdOffset + cdSize)
  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  let p = 0
  for (let n = 0; n < count && p + 46 <= directory.byteLength; n++) {
    if (directory.getUint32(p, true) !== CENTRAL) throw new Error('Corrupt ZIP directory')
    const method = directory.getUint16(p + 10, true)
    let compressedSize = directory.getUint32(p + 20, true)
    let size = directory.getUint32(p + 24, true)
    const nameLength = directory.getUint16(p + 28, true)
    const extraLength = directory.getUint16(p + 30, true)
    const commentLength = directory.getUint16(p + 32, true)
    let localOffset = directory.getUint32(p + 42, true)
    const name = decoder.decode(
      new Uint8Array(directory.buffer, directory.byteOffset + p + 46, nameLength),
    )
    // ZIP64 extra field: only the values that overflowed are present, in this order
    let e = p + 46 + nameLength
    const extraEnd = e + extraLength
    while (e + 4 <= extraEnd) {
      const id = directory.getUint16(e, true)
      const length = directory.getUint16(e + 2, true)
      if (id === 0x0001) {
        let q = e + 4
        if (size === MAX) {
          size = u64(directory, q)
          q += 8
        }
        if (compressedSize === MAX) {
          compressedSize = u64(directory, q)
          q += 8
        }
        if (localOffset === MAX) localOffset = u64(directory, q)
      }
      e += 4 + length
    }
    entries.push({ name, method, compressedSize, size, localOffset })
    p = extraEnd + commentLength
  }
  return entries
}

/** The uncompressed bytes of one entry, as a stream. */
export async function openEntry(file: Blob, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  const header = await read(file, entry.localOffset, entry.localOffset + 30)
  const start = entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true)
  const raw = file.slice(start, start + entry.compressedSize).stream()
  if (entry.method === 0) return raw
  if (entry.method !== 8) throw new Error(`Unsupported compression in ${entry.name}`)
  return raw.pipeThrough(new DecompressionStream('deflate-raw'))
}

export async function readEntryText(file: Blob, entry: ZipEntry): Promise<string> {
  return new Response(await openEntry(file, entry)).text()
}
