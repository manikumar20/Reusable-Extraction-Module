import fs from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import {
  officePlainText,
  pdfRowText,
  sniffImageExtension,
  splitPdfParts,
  textIsUsable,
} from "../extract/engine/read/documentText.js";
import { IMAGE_MEDIA, MAX_IMAGE_BYTES, SCAN_PAGES } from "../extract/engine/shared/constants.js";
import { HttpError } from "../../utils/httpError.js";

/** Keep samples small so template suggest stays as fast as extract-page header reads. */
const SAMPLE_CHARS = 8_000;
const TEXT_PAGES = 8;
/** Vision path: enough pages for forms/scans without shipping the whole file. */
const VISION_PAGES = Math.max(SCAN_PAGES, 5);
const SHEET_HEAD_CHARS = 1_200;
const CHUNK_CHARS = 1_200;

const ITEM_WORDS =
  /\b(qty|quantity|uom|unit|units|item|items|sr\.?\s?no|s\/n|description|material|part\s?no|mpn|pcs|nos|each|ea|sets?|meters?|sq\/?\s?meter)\b/gi;
const NUMBERED_ROW = /^\s*\d+(\.\d+)*[.)]?\s+\S/gm;
const CONTENTS_LINE = /\.{5,}/;

export type SampleDocument = {
  block: Anthropic.ContentBlockParam;
  text: string;
  /** True when Claude must read pixels/PDF pages (no plain-text layer). */
  vision: boolean;
};

export type ReadSampleOptions = {
  /** Skip the text layer and always send PDF pages / image pixels. */
  forceVision?: boolean;
};

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
};

const itemScore = (chunk: string) => {
  const body = chunk
    .split("\n")
    .filter((line) => !CONTENTS_LINE.test(line))
    .join("\n");
  return (body.match(ITEM_WORDS)?.length ?? 0) + (body.match(NUMBERED_ROW)?.length ?? 0);
};

const chunksOf = (text: string) => {
  const chunks: string[] = [];
  let current = "";
  text.split("\n").forEach((line) => {
    if (current && current.length + line.length > CHUNK_CHARS) {
      chunks.push(current);
      current = "";
    }
    current += `${line}\n`;
  });
  if (current) chunks.push(current);
  return chunks;
};

const itemFocusedText = (text: string) => {
  if (text.length <= SAMPLE_CHARS) return text;
  const chunks = chunksOf(text);
  const picked = new Set([0]);
  let used = chunks[0]?.length ?? 0;
  [...chunks.keys()]
    .slice(1)
    .sort((a, b) => itemScore(chunks[b] ?? "") - itemScore(chunks[a] ?? ""))
    .forEach((index) => {
      const size = chunks[index]?.length ?? 0;
      if (used + size > SAMPLE_CHARS) return;
      picked.add(index);
      used += size;
    });
  return [...picked]
    .sort((a, b) => a - b)
    .map((index, position, list) =>
      position > 0 && index !== (list[position - 1] ?? 0) + 1
        ? `[...]\n${chunks[index]}`
        : chunks[index],
    )
    .join("");
};

const sampleText = (text: string) => {
  const sheets = text.split(/(?=^# )/m);
  if (sheets.length <= 1) return itemFocusedText(text);
  const take = sheets.map((sheet) => Math.min(sheet.length, SHEET_HEAD_CHARS));
  let left = SAMPLE_CHARS - take.reduce((sum, value) => sum + value, 0);
  [...sheets.keys()]
    .sort((a, b) => (sheets[b]?.length ?? 0) - (sheets[a]?.length ?? 0))
    .forEach((index) => {
      const extra = Math.max(0, Math.min(left, (sheets[index]?.length ?? 0) - (take[index] ?? 0)));
      take[index] = (take[index] ?? 0) + extra;
      left -= extra;
    });
  return sheets.map((sheet, index) => sheet.slice(0, take[index])).join("\n");
};

const textSample = (title: string, fullText: string): SampleDocument => {
  const text = sampleText(fullText);
  return {
    block: {
      type: "document",
      title,
      source: { type: "text", media_type: "text/plain", data: text },
    },
    text,
    vision: false,
  };
};

const pdfVisionSample = async (
  buffer: Buffer,
  originalName: string,
): Promise<SampleDocument | null> => {
  const [firstPages] = await splitPdfParts(buffer, VISION_PAGES);
  if (!firstPages) return null;
  return {
    block: {
      type: "document",
      title: originalName,
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: firstPages.toString("base64"),
      },
    },
    text: "",
    vision: true,
  };
};

/** Load a template-sample file as Claude text or vision content. */
export const readSampleDocument = async (
  filePath: string,
  originalName: string,
  options?: ReadSampleOptions,
): Promise<SampleDocument | null> => {
  const buffer = await fs.readFile(filePath);
  const pathExt = extensionOf(originalName) || extensionOf(filePath);
  const imageExt = sniffImageExtension(originalName || filePath, buffer);
  const ext = imageExt || pathExt;
  const imageMedia = IMAGE_MEDIA[ext];
  if (imageMedia) {
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new HttpError(
        413,
        "Images must be 5 MB or smaller for field suggestions.",
        "IMAGE_TOO_LARGE",
      );
    }
    return {
      block: {
        type: "image",
        source: { type: "base64", media_type: imageMedia, data: buffer.toString("base64") },
      },
      text: "",
      vision: true,
    };
  }
  if (ext === ".pdf") {
    if (!options?.forceVision) {
      const [textPages] = await splitPdfParts(buffer, TEXT_PAGES);
      if (textPages) {
        let text = "";
        try {
          text = (await pdfRowText(textPages)).text;
        } catch (error) {
          console.error(`PDF text read failed for ${originalName}:`, error);
        }
        if (textIsUsable(text)) return textSample(originalName, text);
      }
    }
    return pdfVisionSample(buffer, originalName);
  }
  if (ext === ".txt") {
    const text = buffer.toString("utf8");
    return text.trim() ? textSample(originalName, text) : null;
  }
  const text = await officePlainText(buffer, ext);
  return text.trim() ? textSample(originalName, text) : null;
};
