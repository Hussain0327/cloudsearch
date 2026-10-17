/**
 * Minimal, spec-faithful Server-Sent Events frame parsing shared by the
 * search and crawl stream hooks. Works on raw text chunks from fetch +
 * getReader(); EventSource cannot POST and cannot carry an AbortSignal.
 */

/** One parsed frame: an `event:` name plus its joined `data:` payload. */
export interface SseFrame {
  event: string;
  /** null for events that carried no data line (e.g. "done"). */
  data: string | null;
}

/**
 * Parse one frame (the text between blank-line delimiters). Strips exactly
 * one leading space after "data:" and joins multiple data lines with "\n".
 */
export function parseSseFrame(raw: string): SseFrame | null {
  let event = "message";
  const dataLines: string[] = [];
  let sawData = false;

  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") {
      event = value;
    } else if (field === "data") {
      sawData = true;
      dataLines.push(value);
    }
  }

  if (event === "message" && !sawData) return null;
  return { event, data: sawData ? dataLines.join("\n") : null };
}

/**
 * Split a buffer into complete frames (delimited by a blank line) plus the
 * trailing incomplete remainder. Handles LF and CRLF.
 */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;

  for (;;) {
    const lf = rest.indexOf("\n\n");
    const crlf = rest.indexOf("\r\n\r\n");
    if (lf === -1 && crlf === -1) break;
    let idx: number;
    let sepLen: number;
    if (crlf !== -1 && (lf === -1 || crlf < lf)) {
      idx = crlf;
      sepLen = 4;
    } else {
      idx = lf;
      sepLen = 2;
    }
    frames.push(rest.slice(0, idx));
    rest = rest.slice(idx + sepLen);
  }

  return { frames, rest };
}

/**
 * Drive a fetch Response body through the frame parser, invoking `onFrame`
 * for each complete frame. Resolves when the stream ends; rejects on abort
 * or network error exactly like reader.read() would.
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SseFrame) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { frames, rest } = splitSseFrames(buffer);
    buffer = rest;
    for (const raw of frames) {
      const frame = parseSseFrame(raw);
      if (frame) onFrame(frame);
    }
  }

  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) {
    const frame = parseSseFrame(tail);
    if (frame) onFrame(frame);
  }
}
