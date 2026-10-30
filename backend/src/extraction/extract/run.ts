import fs from "node:fs/promises";
import { OPTIONAL_LINE_FIELDS } from "../shared/fields.js";
import {
  officePlainText,
  pdfRowText,
  splitPdfParts,
  textIsUsable,
} from "../read/documentText.js";
import {
  type ExtraFieldValue,
} from "../cleaner/clean.js";
import {
  addTokenUsage,
  emptyTokenUsage,
  type ExtractionTokenUsage,
} from "../shared/tokens.js";
import {
  chunkCharsFor,
  chunkPlainText,
  runPool,
  snapBack,
  tailAfterLastItem,
} from "./chunk.js";
import { extractHeaderFields } from "./documentFields.js";
import {
  extractLineItemsWithClaude,
  type ExtractedLine,
} from "./records.js";
import {
  CHUNK_CONCURRENCY,
  MAX_CONTINUATION_DEPTH,
  MIN_CONTINUATION_CHARS,
  READ_SHARE,
} from "../shared/constants.js";

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  return fileName.slice(dot).toLowerCase();
};

const lineCount = (text: string) =>
  text.split("\n").filter((line) => line.trim()).length;

export class ExtractionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = "ExtractionError";
    this.status = status;
    this.code = code;
  }
}

export type ExtractDocumentInput = {
  filePath: string;
  fileName: string;
  /** This app's Anthropic key. The module does not read the environment. */
  apiKey: string;
  /** Line-item model, for example "claude-sonnet-4-5". */
  recordModel: string;
  /** Header model, for example "claude-haiku-5-5". */
  documentModel: string;
  /** Called with each batch of buy lines as soon as those objects are complete. */
  onRecords?: (records: ExtractedLine[]) => void | Promise<void>;
  /** 0–99 while the file is read and the lines are extracted. */
  onProgress?: (percent: number) => void | Promise<void>;
};

export type ExtractDocumentResult = {
  /** Document-level values. Empty when the document does not show them. */
  header: Record<string, ExtraFieldValue>;
  /** Tokens spent on buy lines. */
  usage: ExtractionTokenUsage;
  /** Tokens spent on the header call. Kept separate so each model is priced on its own. */
  headerUsage: ExtractionTokenUsage;
};

/**
 * Read one customer file and return its header and buy lines.
 * The caller sends the file. The module reads fields.ts and prompt.ts itself.
 */
export const extractDocument = async (
  input: ExtractDocumentInput,
): Promise<ExtractDocumentResult> => {
  const {
    filePath,
    fileName,
    apiKey,
    recordModel,
    documentModel,
    onRecords,
    onProgress,
  } = input;
  if (!apiKey) {
    throw new ExtractionError(
      503,
      "AI API key is not configured.",
      "CLAUDE_NOT_CONFIGURED",
    );
  }

  const extraFields = OPTIONAL_LINE_FIELDS;
  const usage = emptyTokenUsage();
  usage.model = recordModel;

  const report = async (percent: number) => {
    if (!onProgress) return;
    const shown =
      percent <= 0 ? 0 : Math.min(99, Math.max(1, Math.ceil(percent)));
    await onProgress(shown);
  };

  const buffer = await fs.readFile(filePath);
  const ext = extensionOf(fileName) || extensionOf(filePath);
  await report(0);
  const officeText =
    ext === ".txt"
      ? buffer.toString("utf8")
      : ext === ".pdf"
        ? (
            await pdfRowText(buffer, async (done, total) => {
              await report((done / Math.max(total, 1)) * READ_SHARE);
            })
          ).text
        : await officePlainText(buffer, ext);
  if (ext !== ".pdf") await report(READ_SHARE);
  const sendText = ext !== ".pdf" || textIsUsable(officeText);
  const jobs = sendText
    ? chunkPlainText(officeText, chunkCharsFor(extraFields.length)).map(
        (text) => ({ buffer, text }),
      )
    : (await splitPdfParts(buffer)).map((part) => ({
        buffer: part,
        text: "",
      }));
  const workShare = 100 - READ_SHARE;
  const done = jobs.map(() => 0);
  const publish = async () => {
    const finished = done.reduce((sum, value) => sum + value, 0);
    await report(READ_SHARE + (finished / Math.max(jobs.length, 1)) * workShare);
  };

  let persistLock = Promise.resolve();
  const persistFor = (index: number) => (items: ExtractedLine[]) => {
    persistLock = persistLock
      .then(async () => {
        if (onRecords) await onRecords(items);
        const rows = Math.max(1, lineCount(jobs[index]?.text ?? ""));
        const step = jobs[index]?.text ? items.length / rows : 0.2;
        done[index] = Math.min(1, (done[index] ?? 0) + step);
        await publish();
      })
      .catch((error) => {
        console.error("Failed to persist extracted line items.", error);
      });
    return persistLock;
  };

  const extractTextPiece = async (
    piece: { buffer: Buffer; text: string },
    index: number,
    depth: number,
  ) => {
    const result = await extractLineItemsWithClaude({
      buffer: piece.buffer,
      originalName: fileName,
      ext,
      officeText: piece.text,
      apiKey,
      model: recordModel,
      onBatch: persistFor(index),
    });
    addTokenUsage(usage, result.usage);
    if (result.stopReason !== "max_tokens" || depth >= MAX_CONTINUATION_DEPTH) return;
    const tail = tailAfterLastItem(piece.text, result.items);
    if (
      tail.length > MIN_CONTINUATION_CHARS &&
      tail.length < piece.text.length - 50
    ) {
      await extractTextPiece(
        { buffer: piece.buffer, text: tail },
        index,
        depth + 1,
      );
      return;
    }
    if (result.items.length === 0 && piece.text.length > 8_000) {
      const mid = snapBack(piece.text, Math.floor(piece.text.length / 2));
      if (
        mid <= MIN_CONTINUATION_CHARS ||
        mid >= piece.text.length - MIN_CONTINUATION_CHARS
      ) {
        return;
      }
      await extractTextPiece(
        { buffer: piece.buffer, text: piece.text.slice(0, mid) },
        index,
        depth + 1,
      );
      await extractTextPiece(
        { buffer: piece.buffer, text: piece.text.slice(mid) },
        index,
        depth + 1,
      );
    }
  };

  await publish();
  await runPool(
    jobs.map((_, index) => String(index)),
    CHUNK_CONCURRENCY,
    async (indexText) => {
      const index = Number(indexText);
      const job = jobs[index];
      if (!job) return;
      done[index] = Math.max(done[index] ?? 0, 0.08);
      await publish();
      await extractTextPiece(job, index, 0);
      done[index] = 1;
      await publish();
    },
  );
  await persistLock;

  let header: Record<string, ExtraFieldValue> = {};
  let headerUsage: ExtractionTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    model: documentModel,
  };
  try {
    const extracted = await extractHeaderFields({
      filePath,
      originalName: fileName,
      apiKey,
      model: documentModel,
    });
    header = extracted.fields;
    headerUsage = extracted.usage;
  } catch (error) {
    console.error("Header extraction failed.", error);
  }

  return { header, usage, headerUsage };
};
