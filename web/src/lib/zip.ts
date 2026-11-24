// The browser side of the shared ZIP reader: byte ranges come from Blob.slice and entries are
// streamed through the browser's own DecompressionStream, so nothing is loaded whole.
import { entryDataRange, listZip as listZipEntries, type ReadRange, type ZipEntry } from '@kinetic/shared/zip'

export type { ZipEntry }

function reader(file: Blob): ReadRange {
  return async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer())
}

export function listZip(file: Blob): Promise<ZipEntry[]> {
  const decoder = new TextDecoder()
  return listZipEntries(reader(file), file.size, (bytes) => decoder.decode(bytes))
}

/** The uncompressed bytes of one entry, as a stream. */
export async function openEntry(file: Blob, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  const [start, end] = await entryDataRange(reader(file), entry)
  const raw = file.slice(start, end).stream()
  if (entry.method === 0) return raw
  return raw.pipeThrough(new DecompressionStream('deflate-raw'))
}

export async function readEntryText(file: Blob, entry: ZipEntry): Promise<string> {
  return new Response(await openEntry(file, entry)).text()
}
