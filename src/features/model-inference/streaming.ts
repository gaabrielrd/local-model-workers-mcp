/**
 * Parses a Server-Sent Events (SSE) stream from a Web ReadableStream,
 * invoking `onChunk` for each received `data:` payload.
 */
export async function parseSseStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: (data: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) {
          const data = trimmed.slice(5).trim();
          if (data.length > 0 && data !== "[DONE]") {
            onChunk(data);
          }
        }
      }
    }

    if (buffer.trim().length > 0) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data:")) {
        const data = trimmed.slice(5).trim();
        if (data.length > 0 && data !== "[DONE]") {
          onChunk(data);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
