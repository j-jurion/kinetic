// The backend streams progress of long jobs (Garmin sync, training analysis) as one JSON
// message per line. Shared by the web and mobile apps.

export interface StreamMessage {
  type: 'progress' | 'result' | 'error' | string
  [key: string]: unknown
}

/**
 * A parser that takes text as it arrives and calls onMessage for every complete line,
 * keeping an unfinished last line until the rest of it arrives.
 */
export function ndjsonParser(onMessage: (message: StreamMessage) => void): (chunk: string) => void {
  let buffer = ''
  return (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) onMessage(JSON.parse(line))
    }
  }
}
