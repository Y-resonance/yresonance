export class BodyTooLargeError extends Error {
  constructor() {
    super('The request body is too large.');
  }
}

/** Bound actual bytes, including chunked bodies and misleading Content-Length headers. */
export async function readRequestBytes(
  request: Request,
  maximumBytes: number,
  signal = request.signal,
) {
  if (Number(request.headers.get('content-length')) > maximumBytes) throw new BodyTooLargeError();
  signal.throwIfAborted();
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBytes) throw new BodyTooLargeError();
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
