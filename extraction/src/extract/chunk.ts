import {
  CHUNK_CHARS,
  CHUNK_CHARS_FEW_FIELDS,
  CHUNK_CHARS_MANY_FIELDS,
  CHUNK_OVERLAP,
  CHUNK_PREAMBLE,
  FEW_EXTRA_FIELDS,
  MAX_TEXT_CHARS,
} from "../shared/constants.js";

export { MAX_TEXT_CHARS };

export const snapBack = (text: string, index: number) => {
  if (index >= text.length) return text.length;
  const newline = text.lastIndexOf("\n", index);
  return newline > 0 ? newline + 1 : index;
};

export const snapForward = (text: string, index: number) => {
  if (index <= 0) return 0;
  if (index >= text.length) return text.length;
  const newline = text.indexOf("\n", index);
  return newline === -1 ? text.length : newline + 1;
};

export const chunkPlainText = (
  text: string,
  maxChars = CHUNK_CHARS,
): string[] => {
  const limit = Math.min(maxChars, MAX_TEXT_CHARS);
  if (text.length <= limit) return [text];
  const preamble = text.slice(0, Math.min(CHUNK_PREAMBLE, limit));
  const header = `${preamble}\n`;
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const isFirst = chunks.length === 0;
    const budget = isFirst ? limit : Math.max(1_000, limit - header.length);
    let end = Math.min(text.length, start + budget);
    if (end < text.length) {
      const snapped = snapBack(text, end);
      if (snapped > start) end = snapped;
    }
    const body = text.slice(start, end);
    chunks.push(isFirst ? body : `${header}${body}`);
    if (end >= text.length) break;
    const next = snapForward(text, end - CHUNK_OVERLAP);
    start = next > start ? next : end;
  }
  return chunks;
};

export const tailAfterLastItem = (
  text: string,
  items: { customerItemNumber: string }[],
) => {
  const token = [...items]
    .reverse()
    .map((item) => item.customerItemNumber.trim())
    .find((value) => value.length > 0);
  if (!token) return "";
  const at = text.lastIndexOf(`${token}\t`);
  if (at < 0) return "";
  const nextLine = text.indexOf("\n", at);
  if (nextLine < 0 || nextLine + 1 >= text.length) return "";
  return text.slice(nextLine + 1);
};

export const runPool = async (
  items: string[],
  limit: number,
  worker: (item: string) => Promise<void>,
) => {
  let index = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        const item = items[current];
        if (item === undefined) return;
        await worker(item);
      }
    },
  );
  await Promise.all(workers);
};

/** More optional fields means more output per item, so use smaller chunks. */
export const chunkCharsFor = (extraFieldCount: number) => {
  if (extraFieldCount === 0) return CHUNK_CHARS;
  return extraFieldCount <= FEW_EXTRA_FIELDS
    ? CHUNK_CHARS_FEW_FIELDS
    : CHUNK_CHARS_MANY_FIELDS;
};
