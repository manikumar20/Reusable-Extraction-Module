/** Percent-of-page box (0–100), text offsets, or Excel sheet/cell coordinates. */
export type SourceLocation = {
  adapter: "pdf" | "text" | "office" | "excel" | "image" | "unknown";
  page: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  start?: number;
  end?: number;
  quote?: string;
  confidence: "exact" | "normalized";
  /** Excel worksheet name when adapter is excel. */
  sheet?: string;
  /** Excel A1 cell address when adapter is excel. */
  cell?: string;
  /** 1-based Excel row. */
  row?: number;
  /** 1-based Excel column. */
  col?: number;
};

export type TextSpan = {
  page: number;
  text: string;
  start: number;
  end: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Glyph/token parts for a joined line span — used to refine highlight boxes. */
  parts?: TextSpan[];
  sheet?: string;
  cell?: string;
  row?: number;
  col?: number;
};

export type SourceAdapter = {
  id: SourceLocation["adapter"];
  canHandle: (input: { fileName: string; mimeType?: string; buffer: Buffer }) => boolean;
  extractSpans: (input: {
    fileName: string;
    mimeType?: string;
    buffer: Buffer;
  }) => Promise<TextSpan[]>;
};
