import { sniffImageExtension } from "../../extract/engine/read/documentText.js";
import { IMAGE_MEDIA } from "../../extract/engine/shared/constants.js";
import type { SourceAdapter } from "../types.js";

/** Images rely on Claude vision for values; coordinate OCR is not installed. */
export const imageAdapter: SourceAdapter = {
  id: "image",
  canHandle: ({ fileName, mimeType, buffer }) => {
    const lower = fileName.toLowerCase();
    const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
    return Boolean(
      IMAGE_MEDIA[ext] ||
        (mimeType ?? "").toLowerCase().startsWith("image/") ||
        sniffImageExtension(fileName, buffer),
    );
  },
  extractSpans: async () => [],
};
