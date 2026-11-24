import { Icon } from "@iconify/react";

const FILE_TYPES: Record<string, { label: string; icon: string }> = {
  pdf: { label: "PDF", icon: "vscode-icons:file-type-pdf2" },
  doc: { label: "Word", icon: "vscode-icons:file-type-word" },
  docx: { label: "Word", icon: "vscode-icons:file-type-word" },
  xls: { label: "Excel", icon: "vscode-icons:file-type-excel" },
  xlsx: { label: "Excel", icon: "vscode-icons:file-type-excel" },
  csv: { label: "CSV", icon: "vscode-icons:file-type-excel2" },
  ppt: { label: "PowerPoint", icon: "vscode-icons:file-type-powerpoint" },
  pptx: { label: "PowerPoint", icon: "vscode-icons:file-type-powerpoint" },
  png: { label: "Image", icon: "vscode-icons:file-type-image" },
  jpg: { label: "Image", icon: "vscode-icons:file-type-image" },
  jpeg: { label: "Image", icon: "vscode-icons:file-type-image" },
};

const FALLBACK = { label: "File", icon: "vscode-icons:default-file" };

function getFileType(fileName = "") {
  const dot = fileName.lastIndexOf(".");
  if (dot === -1) return FALLBACK;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return FILE_TYPES[ext] ?? FALLBACK;
}

type DocTypeIconProps = {
  fileName?: string;
  size?: number;
  className?: string;
};

export default function DocTypeIcon({ fileName = "", size = 32, className = "" }: DocTypeIconProps) {
  const { label, icon } = getFileType(fileName);
  return (
    <span
      title={label}
      aria-label={label}
      className={`doc-type-icon inline-flex shrink-0 items-center justify-center leading-none ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      <Icon
        icon={icon}
        width={size}
        height={size}
        style={{ display: "block", width: size, height: size, flexShrink: 0 }}
      />
    </span>
  );
}
