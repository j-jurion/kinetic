import { describe, expect, it } from 'vitest'
import { ndjsonParser, type StreamMessage } from '../src/stream'

describe('ndjson progress stream', () => {
  it('emits complete lines and waits for the rest of a split line', () => {
    const messages: StreamMessage[] = []
    const feed = ndjsonParser((m) => messages.push(m))
    feed('{"type":"progress","done":1}\n{"type":"pro')
    expect(messages).toEqual([{ type: 'progress', done: 1 }])
    feed('gress","done":2}\n\n   \n{"type":"result","imported":3}')
    expect(messages).toHaveLength(2)
    feed('\n')
    expect(messages.at(-1)).toEqual({ type: 'result', imported: 3 })
  })

  it('keeps multi-byte text intact across chunks', () => {
    const messages: StreamMessage[] = []
    const feed = ndjsonParser((m) => messages.push(m))
    const line = '{"type":"progress","message":"Fetching 01-01 → 31-01…"}\n'
    for (const char of line) feed(char)
    expect(messages).toEqual([{ type: 'progress', message: 'Fetching 01-01 → 31-01…' }])
  })

  it('throws on a corrupt line instead of skipping it', () => {
    const feed = ndjsonParser(() => {})
    expect(() => feed('not json\n')).toThrow(SyntaxError)
  })
})
