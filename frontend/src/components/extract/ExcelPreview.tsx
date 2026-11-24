import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Minus, Plus, RotateCcw, Search } from "lucide-react";
import {
  columnLabel,
  excelCellKey,
  parseExcelWorkbook,
  type ExcelSheetModel,
  type ExcelWorkbookModel,
} from "@/lib/excelWorkbook";
import type { SourceLocation } from "@/types";

type Props = {
  file: File;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  locations?: SourceLocation[] | null;
  selectedLabel?: string | null;
};

const HEADER = 28;
const GUTTER = 48;
const OVERSCAN = 6;
const DEFAULT_ROW = 24;
const roundZoom = (value: number) => Math.round(value * 10) / 10;

const toolBtn =
  "grid h-7 w-7 place-items-center rounded-md border border-[var(--line)] bg-[var(--sheet)] text-[var(--ink)] transition hover:bg-[var(--hover)] disabled:opacity-40";

const locationsForSheet = (locations: SourceLocation[] | null | undefined, sheetName: string) =>
  (locations ?? []).filter((loc) => {
    if (loc.sheet) return loc.sheet === sheetName;
    return Boolean(loc.cell || loc.row || loc.quote);
  });

export const ExcelPreview = ({
  file,
  zoom,
  onZoomChange,
  locations,
  selectedLabel,
}: Props) => {
  const [workbook, setWorkbook] = useState<ExcelWorkbookModel | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewport, setViewport] = useState({ width: 640, height: 480 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const jumpToken = useRef("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setWorkbook(null);
    setSheetIndex(0);
    setSelected(null);
    void file
      .arrayBuffer()
      .then((buffer) => parseExcelWorkbook(buffer))
      .then((model) => {
        if (cancelled) return;
        setWorkbook(model);
        setLoading(false);
      })
      .catch((reason) => {
        if (cancelled) return;
        setLoading(false);
        setError(
          reason instanceof Error
            ? reason.message
            : "This Excel file could not be previewed. Try saving it as .xlsx.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;
    const measure = () => {
      setViewport({
        width: Math.max(240, node.clientWidth),
        height: Math.max(200, node.clientHeight),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [loading, workbook]);

  const sheet: ExcelSheetModel | null = workbook?.sheets[sheetIndex] ?? null;

  // Prefer the worksheet named in source locations.
  useEffect(() => {
    if (!workbook || !locations?.length) return;
    const preferred = locations.find((loc) => loc.sheet)?.sheet;
    if (!preferred) return;
    const index = workbook.sheets.findIndex((entry) => entry.name === preferred);
    if (index >= 0 && index !== sheetIndex) setSheetIndex(index);
  }, [workbook, locations, sheetIndex]);

  const highlightCells = useMemo(() => {
    if (!sheet) return [] as { row: number; col: number; address: string }[];
    const hits: { row: number; col: number; address: string }[] = [];
    const seen = new Set<string>();
    for (const loc of locationsForSheet(locations, sheet.name)) {
      if (typeof loc.row === "number" && typeof loc.col === "number") {
        const key = excelCellKey(loc.row, loc.col);
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          row: loc.row,
          col: loc.col,
          address: loc.cell || `${columnLabel(loc.col)}${loc.row}`,
        });
        continue;
      }
      if (loc.cell) {
        const match = /^([A-Z]+)(\d+)$/i.exec(loc.cell.trim());
        if (!match) continue;
        let col = 0;
        const letters = match[1]!.toUpperCase();
        for (let i = 0; i < letters.length; i += 1) col = col * 26 + (letters.charCodeAt(i) - 64);
        const row = Number(match[2]);
        const key = excelCellKey(row, col);
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ row, col, address: loc.cell.toUpperCase() });
        continue;
      }
      const quote = loc.quote?.trim();
      if (!quote) continue;
      for (const cell of sheet.cells.values()) {
        if (cell.text !== quote && !cell.text.includes(quote)) continue;
        const key = excelCellKey(cell.row, cell.col);
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ row: cell.row, col: cell.col, address: cell.address });
      }
    }
    return hits;
  }, [sheet, locations]);

  useEffect(() => {
    if (!sheet || !highlightCells.length || !scrollRef.current) return;
    const target = highlightCells[0]!;
    const token = `${sheet.name}:${target.address}:${selectedLabel ?? ""}`;
    if (jumpToken.current === token) return;
    jumpToken.current = token;
    setSelected({ row: target.row, col: target.col });
    const top = sheet.rowHeights.slice(1, target.row).reduce((sum, value) => sum + value, 0) * zoom;
    const left = sheet.colWidths.slice(1, target.col).reduce((sum, value) => sum + value, 0) * zoom;
    const frame = window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: Math.max(0, top - 80),
        left: Math.max(0, left - 120),
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightCells, sheet, zoom, selectedLabel]);

  const searchHits = useMemo(() => {
    if (!sheet || !query.trim()) return [] as { row: number; col: number }[];
    const needle = query.trim().toLowerCase();
    const hits: { row: number; col: number }[] = [];
    for (const cell of sheet.cells.values()) {
      if (!cell.text.toLowerCase().includes(needle)) continue;
      hits.push({ row: cell.row, col: cell.col });
      if (hits.length >= 200) break;
    }
    return hits;
  }, [sheet, query]);

  const selectedCell = useMemo(() => {
    if (!sheet || !selected) return null;
    return sheet.cells.get(excelCellKey(selected.row, selected.col)) ?? null;
  }, [sheet, selected]);

  if (loading) {
    return <p className="p-8 text-center text-sm text-[var(--muted)]">Opening spreadsheet…</p>;
  }
  if (error || !workbook || !sheet) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--sheet)] px-6 py-8 text-center">
        <p className="text-sm font-bold text-[var(--ink-strong)]">Excel preview unavailable</p>
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          {error || "This workbook could not be opened. Save as .xlsx and try again."}
        </p>
      </div>
    );
  }

  const scale = zoom;
  const bodyWidth = sheet.colWidths.slice(1).reduce((sum, value) => sum + value, 0) * scale;
  const bodyHeight = sheet.rowHeights.slice(1).reduce((sum, value) => sum + value, 0) * scale;
  const visibleWidth = Math.max(120, viewport.width - GUTTER);
  const visibleHeight = Math.max(120, viewport.height - HEADER - 44);

  let rowStart = 1;
  let used = 0;
  while (rowStart < sheet.rowCount && used + (sheet.rowHeights[rowStart] ?? DEFAULT_ROW) * scale < scrollTop) {
    used += (sheet.rowHeights[rowStart] ?? DEFAULT_ROW) * scale;
    rowStart += 1;
  }
  rowStart = Math.max(1, rowStart - OVERSCAN);
  let rowEnd = rowStart;
  let covered = 0;
  while (rowEnd <= sheet.rowCount && covered < visibleHeight + OVERSCAN * DEFAULT_ROW) {
    covered += (sheet.rowHeights[rowEnd] ?? DEFAULT_ROW) * scale;
    rowEnd += 1;
  }
  rowEnd = Math.min(sheet.rowCount, rowEnd + OVERSCAN);

  let colStart = 1;
  used = 0;
  while (colStart < sheet.colCount && used + (sheet.colWidths[colStart] ?? 96) * scale < scrollLeft) {
    used += (sheet.colWidths[colStart] ?? 96) * scale;
    colStart += 1;
  }
  colStart = Math.max(1, colStart - OVERSCAN);
  let colEnd = colStart;
  covered = 0;
  while (colEnd <= sheet.colCount && covered < visibleWidth + OVERSCAN * 96) {
    covered += (sheet.colWidths[colEnd] ?? 96) * scale;
    colEnd += 1;
  }
  colEnd = Math.min(sheet.colCount, colEnd + OVERSCAN);

  const rowOffset = (row: number) =>
    sheet.rowHeights.slice(1, row).reduce((sum, value) => sum + value, 0) * scale;
  const colOffset = (col: number) =>
    sheet.colWidths.slice(1, col).reduce((sum, value) => sum + value, 0) * scale;

  const mergeHidden = new Set<string>();
  for (const merge of sheet.merges) {
    for (let row = merge.top; row <= merge.bottom; row += 1) {
      for (let col = merge.left; col <= merge.right; col += 1) {
        if (row === merge.top && col === merge.left) continue;
        mergeHidden.add(excelCellKey(row, col));
      }
    }
  }

  const highlightSet = new Set(highlightCells.map((hit) => excelCellKey(hit.row, hit.col)));
  const searchSet = new Set(searchHits.map((hit) => excelCellKey(hit.row, hit.col)));

  return (
    <div
      ref={shellRef}
      className="excel-preview flex h-full min-h-[28rem] flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[#e8edf3] shadow-lg"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--soft)] px-2.5 py-1.5">
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find in sheet…"
            className="h-7 w-full rounded-md border border-[var(--line)] bg-[var(--sheet)] pl-7 pr-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            className={toolBtn}
            onClick={() => onZoomChange(Math.max(0.6, roundZoom(zoom - 0.1)))}
            aria-label="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-11 text-center text-xs font-semibold">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className={toolBtn}
            onClick={() => onZoomChange(Math.min(1.8, roundZoom(zoom + 0.1)))}
            aria-label="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" className={toolBtn} onClick={() => onZoomChange(1)} aria-label="Reset zoom">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {selectedLabel && highlightCells.length ? (
        <div className="src-hl-banner src-hl-banner-info" role="status">
          Source for “{selectedLabel}”:{" "}
          {highlightCells.map((hit) => `${sheet.name}!${hit.address}`).join(", ")}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="excel-scroll relative min-h-0 flex-1 overflow-auto bg-[#f3f6fa]"
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          setScrollLeft(event.currentTarget.scrollLeft);
        }}
      >
        <div style={{ width: GUTTER + bodyWidth, height: HEADER + bodyHeight, position: "relative" }}>
          <div
            className="excel-corner"
            style={{ width: GUTTER, height: HEADER, top: scrollTop, left: scrollLeft }}
          />

          {Array.from({ length: colEnd - colStart + 1 }, (_, index) => {
            const col = colStart + index;
            return (
              <div
                key={`col-${col}`}
                className="excel-col-head"
                style={{
                  top: scrollTop,
                  left: GUTTER + colOffset(col),
                  width: (sheet.colWidths[col] ?? 96) * scale,
                  height: HEADER,
                }}
              >
                {columnLabel(col)}
              </div>
            );
          })}

          {Array.from({ length: rowEnd - rowStart + 1 }, (_, rowIndex) => {
            const row = rowStart + rowIndex;
            const top = HEADER + rowOffset(row);
            const height = (sheet.rowHeights[row] ?? DEFAULT_ROW) * scale;
            return (
              <div key={`row-${row}`}>
                <div
                  className="excel-row-head"
                  style={{ top, left: scrollLeft, width: GUTTER, height }}
                >
                  {row}
                </div>
                {Array.from({ length: colEnd - colStart + 1 }, (_, colIndex) => {
                  const col = colStart + colIndex;
                  const key = excelCellKey(row, col);
                  if (mergeHidden.has(key)) return null;
                  const merge = sheet.merges.find((item) => item.top === row && item.left === col);
                  const widthCols = merge ? merge.right - merge.left + 1 : 1;
                  const heightRows = merge ? merge.bottom - merge.top + 1 : 1;
                  let width = 0;
                  let heightPx = 0;
                  for (let c = col; c < col + widthCols; c += 1) width += sheet.colWidths[c] ?? 96;
                  for (let r = row; r < row + heightRows; r += 1) heightPx += sheet.rowHeights[r] ?? DEFAULT_ROW;
                  width *= scale;
                  heightPx *= scale;
                  const model = sheet.cells.get(key);
                  const isSelected = selected?.row === row && selected?.col === col;
                  const isSource = highlightSet.has(key);
                  const isSearch = searchSet.has(key);
                  const style: CSSProperties = {
                    top,
                    left: GUTTER + colOffset(col),
                    width,
                    height: heightPx,
                    fontWeight: model?.style.bold ? 700 : 500,
                    fontStyle: model?.style.italic ? "italic" : "normal",
                    textDecoration: model?.style.underline ? "underline" : "none",
                    fontSize: Math.max(10, (model?.style.fontSize ?? 11) * scale * 0.95),
                    color: model?.style.fontColor || "#111827",
                    background: model?.style.fill || "#ffffff",
                    textAlign: model?.style.align || "left",
                    justifyContent:
                      model?.style.vertical === "middle"
                        ? "center"
                        : model?.style.vertical === "bottom"
                          ? "flex-end"
                          : "flex-start",
                  };
                  return (
                    <button
                      key={key}
                      type="button"
                      className={[
                        "excel-cell",
                        isSelected ? "excel-cell-selected" : "",
                        isSource ? "excel-cell-source" : "",
                        isSearch ? "excel-cell-search" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={style}
                      onClick={() => setSelected({ row, col })}
                      title={model?.address || `${columnLabel(col)}${row}`}
                    >
                      <span className="excel-cell-text">{model?.text ?? ""}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] bg-[var(--soft)] px-2 py-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1 overflow-x-auto">
          {workbook.sheets.map((entry, index) => (
            <button
              key={`${entry.name}-${index}`}
              type="button"
              className={index === sheetIndex ? "excel-sheet-tab excel-sheet-tab-active" : "excel-sheet-tab"}
              onClick={() => {
                setSheetIndex(index);
                setSelected(null);
                setScrollTop(0);
                setScrollLeft(0);
                scrollRef.current?.scrollTo({ top: 0, left: 0 });
              }}
            >
              {entry.name}
            </button>
          ))}
        </div>
        <div className="shrink-0 text-[11px] font-semibold text-[var(--muted)]">
          {selected
            ? `${sheet.name}!${columnLabel(selected.col)}${selected.row}${
                selectedCell?.text ? ` = ${selectedCell.text.slice(0, 80)}` : ""
              }`
            : `${sheet.rowCount} rows · ${sheet.colCount} cols`}
        </div>
      </div>
    </div>
  );
};
