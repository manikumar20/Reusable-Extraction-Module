import type { SourceLocation } from "@/types";
import { boxesForPage } from "@/lib/sourceHighlight";

type Props = {
  locations: SourceLocation[] | null | undefined;
  page: number;
  selected?: boolean;
};

/** Absolute percent boxes over a page-sized relative container. */
export const SourceHighlightLayer = ({ locations, page, selected = false }: Props) => {
  const boxes = boxesForPage(locations, page);
  if (!boxes.length) return null;
  return (
    <div className="src-hl-layer" aria-hidden="true">
      {boxes.map((box, index) => {
        // Slight pad so thin PDF glyph boxes still wrap the ink clearly.
        const padX = 0.35;
        const padY = 0.45;
        const rawW = Math.max(box.w ?? 2, 1.6);
        const rawH = Math.max(box.h ?? 1.4, 1.3);
        const left = Math.max(0, (box.x ?? 0) - padX);
        const top = Math.max(0, (box.y ?? 0) - padY);
        const width = Math.min(100 - left, rawW + padX * 2);
        const height = Math.min(100 - top, rawH + padY * 2);
        return (
          <span
            key={`${box.page}-${box.x}-${box.y}-${index}`}
            className={selected ? "src-hl src-hl-active" : "src-hl"}
            data-src-hl={selected ? "active" : "idle"}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${width}%`,
              height: `${height}%`,
            }}
          />
        );
      })}
    </div>
  );
};
