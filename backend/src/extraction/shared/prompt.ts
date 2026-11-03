import { HEADER_TOOL_NAME } from "./constants.js";

export { HEADER_TOOL_NAME };

/**
 * Structural extraction instructions.
 * Per-field wording lives in fields.ts (tool schema descriptions).
 * lineUserText only inserts the file name and the active catalog key list.
 */

export const SYSTEM_PROMPT =
  "You are a line-item extractor. Inspect the file and keep only rows that request a material, spare, or service. Write one compact buy line then the next, until every buy line in this part is written. Do not paste long specifications. Do not write item-number-only objects. Map whatever labels this file uses. Do not invent values. Manufacturer is the company name only. Skip questions, instructions, attachments, and commercial terms. Fill every property on each item from the tool schema; use an empty string or empty array when the row does not show the value.";

export const headerUserText = (originalName: string) =>
  [
    `File name: "${originalName}".`,
    `Read the header of this customer document and call ${HEADER_TOOL_NAME} once.`,
    "Use an empty string for any field the document does not show. Never guess.",
    "Fields the bidder must fill in (blank boxes, questionnaire answers) are not values.",
    "Our own company appears as the supplier or vendor on some forms; it is never the customer.",
  ].join(" ");

export const lineUserText = (input: {
  originalName: string;
  ext: string;
  hasText: boolean;
  fieldKeys: string[];
  identityKey: string;
}) => {
  const { originalName, ext, hasText, fieldKeys, identityKey } = input;
  return [
    ext === ".txt"
      ? `Extract every requested buy line from this customer email body ("${originalName}"). If this is only a part of the message, extract every buy line in this part.`
      : `Extract every requested buy line from this customer file named "${originalName}". If this is only a part of the file, extract every buy line in this part.`,
    ext === ".txt"
      ? "This text is the customer email. Buy lines may be written in the message. Read them in order."
      : hasText
        ? "The rows below are the file text. Read them in order."
        : [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)
          ? "This attachment is an image of a customer document. Read every visible buy-line row with vision/OCR. Map printed columns to the tool fields. Do not invent values."
          : "These are buyer requests, not vendor quotes. Use OCR on scans and embedded images.",
    "Layouts vary (RFX printouts, Excel bid sheets, PDF tables, Word specs, enquiry workbooks). The attachment may be HTML, Word XML, or a table dump — read the visible labels and values yourself, including HTML entities. Map whatever labels and columns this file uses. Do not invent values.",
    "A buy line is a material, spare, or service the supplier must quote. A numbered row is not a buy line when it is a question, instruction, attachment, commercial term, or bid-form field.",
    "Treat each buy line as one block: from its item number (or table row) until the next item. Collect quantity, unit, manufacturers, part numbers, and notes from that whole block. Do not stop at the title. Do not write an item object until that block's core fields are filled. Then write the complete object and move on.",
    fieldKeys.length
      ? `Fill the tool properties for each item (${fieldKeys.length} fields). Prefer values that appear on that buy line; omit a property when the line does not show it.`
      : "Fill every tool property for each item from that buy line.",
    `${identityKey}: the printed item/line/position number only. Keep every dot and leading zero. If the title starts with that number, put the number in ${identityKey} and the rest in the description field. Never use the document, PR, event, or file number. Do not invent a number. A digit inside a product code is not an item number.`,
    "For manufacturer list fields: one object per manufacturer option on this buy line. Company name only — not vendor id, city, country, or street. Do not invent a maker or part number. Never emit a manufacturer as its own line.",
    "For quantity and unit fields: keep the number and the unit code in separate properties. Convert printed unit words to short codes (Pieces, EA, Nos → PCS).",
    "For currency fields: a 3-letter ISO code. Convert a printed name yourself (US Dollar → USD). If the file has one header currency, put that ISO code on every buy line unless a line shows a different currency.",
    "Never copy a value from another line or guess.",
    "Keep every buy line that has a description, manufacturer, or part number.",
    "Never output placeholders such as UNKNOWN, N/A, None, or null.",
    "Put items in file order. Keep every object compact and emit every buy line in this part. A numbered row with a material number, quantity, and unit is its own buy line even when a long specification follows it.",
  ].join(" ");
};
