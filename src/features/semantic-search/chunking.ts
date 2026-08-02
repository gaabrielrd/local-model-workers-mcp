export interface TextChunk {
  readonly text: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly chunkOffset: number;
  readonly chunkLength: number;
}

const DEFAULT_CHUNK_SIZE_CHARS = 2_000;
const DEFAULT_CHUNK_OVERLAP_CHARS = 200;

export function chunkText(
  content: string,
  chunkSizeChars = DEFAULT_CHUNK_SIZE_CHARS,
  overlapChars = DEFAULT_CHUNK_OVERLAP_CHARS,
): readonly TextChunk[] {
  if (content.trim().length === 0) {
    return [];
  }

  const lines = content.split("\n");
  const chunks: TextChunk[] = [];
  let currentPos = 0;

  let chunkStartPos = 0;
  let chunkStartLine = 1;
  let currentChunkLines: string[] = [];
  let currentChunkLength = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const lineLength = line.length + 1; // +1 for newline

    if (
      currentChunkLength + lineLength > chunkSizeChars &&
      currentChunkLines.length > 0
    ) {
      const chunkTextContent = currentChunkLines.join("\n");
      chunks.push({
        text: chunkTextContent,
        lineStart: chunkStartLine,
        lineEnd: chunkStartLine + currentChunkLines.length - 1,
        chunkOffset: chunkStartPos,
        chunkLength: chunkTextContent.length,
      });

      // Calculate overlap
      let overlapLen = 0;
      let overlapLineCount = 0;
      for (let j = currentChunkLines.length - 1; j >= 0; j -= 1) {
        const lLen = currentChunkLines[j]!.length + 1;
        if (overlapLen + lLen > overlapChars) {
          break;
        }
        overlapLen += lLen;
        overlapLineCount += 1;
      }

      if (overlapLineCount > 0 && overlapLineCount < currentChunkLines.length) {
        chunkStartLine = i + 1 - overlapLineCount;
        currentChunkLines = currentChunkLines.slice(-overlapLineCount);
        currentChunkLength = overlapLen;
        chunkStartPos = currentPos - overlapLen;
      } else {
        chunkStartLine = i + 1;
        currentChunkLines = [];
        currentChunkLength = 0;
        chunkStartPos = currentPos;
      }
    }

    currentChunkLines.push(line);
    currentChunkLength += lineLength;
    currentPos += lineLength;
  }

  if (currentChunkLines.length > 0) {
    const chunkTextContent = currentChunkLines.join("\n");
    chunks.push({
      text: chunkTextContent,
      lineStart: chunkStartLine,
      lineEnd: chunkStartLine + currentChunkLines.length - 1,
      chunkOffset: chunkStartPos,
      chunkLength: chunkTextContent.length,
    });
  }

  return chunks;
}
