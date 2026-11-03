import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  docxPlainText,
  excelPlainText,
  pdfRowText,
} from "../src/extraction/read/documentText.js";

const require = createRequire(import.meta.url);
const JSZip = require("jszip") as typeof import("jszip");
const XLSX = require("xlsx") as {
  utils: {
    aoa_to_sheet: (rows: string[][]) => unknown;
    book_new: () => { SheetNames: string[]; Sheets: Record<string, unknown> };
    book_append_sheet: (book: unknown, sheet: unknown, name: string) => void;
  };
  write: (book: unknown, opts: { type: "buffer"; bookType: "xlsx" }) => Buffer;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../samples");

const headerRows: [string, string][] = [
  ["Document Number", "INV-2026-1048"],
  ["Invoice Number", "INV-2026-1048"],
  ["Document Title", "Supply of gate valves, gaskets and spare seat rings"],
  ["Event Type", "INVOICE"],
  ["Invoice Date", "12 March 2026"],
  ["Issue Date", "12 March 2026"],
  ["Due Date", "11 April 2026"],
  ["Closing Date", "2026-04-11"],
  ["Closing Time", "17:00"],
  ["Customer", "Harbour Mechanical LLC"],
  ["Billing Address", "18 Tuas Avenue 8, Singapore 639224"],
  ["Vendor Name", "Northwind Industrial Supplies Pte Ltd"],
  ["Buyer", "Elena Marsh"],
  ["Buyer Email", "elena.marsh@harbourmech.example"],
  ["PR / Requisition Number", "PR-88421"],
  ["Purchase Order Number", "PO-4500198821"],
  ["Project", "JURONG YARD PHASE 2"],
  ["External Reference", "EXT-REF-7712"],
  ["Currency", "USD"],
  ["Incoterm", "DAP"],
  ["Delivery Location", "Berth 4 Stores, Jurong Yard, Singapore"],
  ["Payment Terms", "Net 30"],
  ["Payment Status", "UNPAID"],
  ["Discount Percentage", "5"],
  ["Bid Validity", "30 days"],
  [
    "Special Instructions",
    "Supply the materials below against purchase order PO-4500198821. Include EN 10204 3.1 certificates with the shipment.",
  ],
];

const totals: [string, string][] = [
  ["Subtotal", "4860.00"],
  ["Discount Percentage", "5"],
  ["Discount Amount", "243.00"],
  ["Tax Amount", "230.85"],
  ["Total Amount", "4847.85"],
];

const lineColumns = [
  "Item",
  "Material Number",
  "Description",
  "Quantity",
  "Unit",
  "Currency",
  "Manufacturer",
  "Manufacturer Part Number",
  "Manufacturer number",
  "Item Scope",
  "Material Class",
  "Technical specification",
  "Standards",
  "Drawing Number",
  "Tag Number",
  "Requested Delivery Date",
  "Ship To",
  "Inspection",
  "Unit Price",
  "Amount",
];

const lines: string[][] = [
  [
    "10",
    "120005020889",
    "Gate valve, 2 inch, class 150, flanged RF, carbon steel body, rising stem",
    "4",
    "PCS",
    "USD",
    "L&T Valves Limited",
    "GV-2-150-CS",
    "0020000929",
    "FULL",
    "VALVE,GATE",
    "Nominal size 2 inch. Pressure rating class 150. Body material carbon steel.",
    "ASME B16.5; API 600",
    "DWG-4412",
    "0751-FV-1009",
    "28 March 2026",
    "Berth 4 Stores, Jurong Yard, Singapore",
    "EN 10204 3.1 material certificate",
    "980.00",
    "3920.00",
  ],
  [
    "20",
    "120005088441",
    "Spiral wound gasket, 2 inch, class 150, SS316 with graphite filler",
    "12",
    "PCS",
    "USD",
    "Flexitallic",
    "SWG-2-150-316",
    "0020001144",
    "FULL",
    "GASKET",
    "Nominal size 2 inch. Pressure rating class 150. Filler graphite. Inner ring SS316.",
    "ASME B16.20",
    "DWG-4412",
    "0751-FV-1009",
    "28 March 2026",
    "Berth 4 Stores, Jurong Yard, Singapore",
    "Certificate of Conformity",
    "36.50",
    "438.00",
  ],
  [
    "30",
    "120005091002",
    "Seat ring, spare component for 2 inch class 150 gate valve",
    "4",
    "PCS",
    "USD",
    "L&T Valves Limited",
    "SR-2-150-CS",
    "0020000929",
    "PART",
    "VALVE,GATE",
    "Spare seat ring for parent equipment gate valve. OEM model GV-2-150.",
    "API 600",
    "DWG-4418",
    "0751-FV-1009",
    "28 March 2026",
    "Berth 4 Stores, Jurong Yard, Singapore",
    "EN 10204 3.1 material certificate",
    "125.50",
    "502.00",
  ],
];

const intro = [
  "TAX INVOICE",
  "Harbour Mechanical LLC",
  "Customer document. Requested materials to supply.",
  "File name: sample-invoice.",
  "",
  "Vendor: Northwind Industrial Supplies Pte Ltd, 42 Pioneer Road, Singapore 628428.",
  "This invoice is addressed to the customer Harbour Mechanical LLC. The vendor is the supplier, not the customer.",
];

const narrative = () => {
  const rows = [
    ...intro,
    "",
    ...headerRows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Buy lines",
    lineColumns.join("\t"),
    ...lines.map((line) => line.join("\t")),
    "",
    ...lines.map((line, index) => {
      const value = (name: string) => line[lineColumns.indexOf(name)];
      return [
        `Item ${value("Item")}`,
        `Material Number: ${value("Material Number")}`,
        `Description: ${value("Description")}`,
        `Quantity: ${value("Quantity")}`,
        `Unit: ${value("Unit")}`,
        `Currency: ${value("Currency")}`,
        `Manufacturer: ${value("Manufacturer")}`,
        `Manufacturer Part Number: ${value("Manufacturer Part Number")}`,
        `Manufacturer number: ${value("Manufacturer number")}`,
        `Item Scope: ${value("Item Scope")}`,
        `Material Class: ${value("Material Class")}`,
        `Technical specification: ${value("Technical specification")}`,
        `Standards: ${value("Standards")}`,
        `Drawing Number: ${value("Drawing Number")}`,
        `Tag Number: ${value("Tag Number")}`,
        `Requested Delivery Date: ${value("Requested Delivery Date")}`,
        `Ship To: ${value("Ship To")}`,
        `Inspection: ${value("Inspection")}`,
        `Unit Price: ${value("Unit Price")}`,
        `Amount: ${value("Amount")}`,
        index === lines.length - 1 ? "" : "",
      ].join("\n");
    }),
    "",
    ...totals.map(([label, value]) => `${label}: ${value} USD`),
  ];
  return rows;
};

const xml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const buildPdf = async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  const size = 10;
  const leading = 14;
  let page = pdf.addPage([595, 842]);
  let y = 800;

  const draw = (text: string, strong = false) => {
    const face = strong ? bold : font;
    const maxWidth = 595 - margin * 2;
    const words = text.split(" ");
    let line = "";
    const flush = (value: string) => {
      if (y < 48) {
        page = pdf.addPage([595, 842]);
        y = 800;
      }
      page.drawText(value, {
        x: margin,
        y,
        size,
        font: face,
        color: rgb(0.1, 0.16, 0.22),
      });
      y -= leading;
    };
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (face.widthOfTextAtSize(next, size) > maxWidth && line) {
        flush(line);
        line = word;
      } else {
        line = next;
      }
    });
    flush(line);
  };

  draw("TAX INVOICE", true);
  draw("Harbour Mechanical LLC", true);
  y -= 6;
  narrative()
    .slice(2)
    .flatMap((row) => row.split("\n"))
    .forEach((row) => {
      if (!row) {
        y -= 6;
        return;
      }
      if (row === "Buy lines") {
        draw(row, true);
        return;
      }
      draw(row.replace(/\t/g, " | "), row.startsWith("Item "));
    });

  pdf.setTitle("Sample invoice INV-2026-1048");
  pdf.setAuthor("Harbour Mechanical LLC");
  return Buffer.from(await pdf.save());
};

const buildDocx = async () => {
  const paragraphs = narrative()
    .map((row) => {
      const text = xml(row || " ");
      return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    })
    .join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", types);
  zip.folder("_rels")?.file(".rels", rels);
  zip.folder("word")?.file("document.xml", document);
  return zip.generateAsync({ type: "nodebuffer" });
};

const buildXlsx = () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["TAX INVOICE"],
      ["Customer", "Harbour Mechanical LLC"],
      ["Note", "Requested materials to supply. The vendor is the supplier, not the customer."],
      [],
      ["Field", "Value"],
      ...headerRows,
      [],
      ["Field", "Value"],
      ...totals,
    ]),
    "Invoice",
  );
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([lineColumns, ...lines]),
    "Buy lines",
  );
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
};

const assertReadable = async (name: string, text: string) => {
  const compact = text.replace(/\s/g, "");
  const needed = [
    "INV-2026-1048",
    "Harbour Mechanical",
    "Northwind",
    "PO-4500198821",
    "Gate valve",
    "Flexitallic",
    "4847.85",
  ];
  const missing = needed.filter((part) => !text.includes(part));
  if (compact.length < 200 || missing.length) {
    throw new Error(`${name} is not readable (${compact.length} chars, missing ${missing.join(", ")})`);
  }
  console.log(`${name}: ${compact.length} chars`);
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });
  const pdf = await buildPdf();
  const docx = await buildDocx();
  const xlsx = buildXlsx();
  const pdfPath = path.join(outDir, "sample-invoice.pdf");
  const docxPath = path.join(outDir, "sample-invoice.docx");
  const xlsxPath = path.join(outDir, "sample-invoice.xlsx");
  await fs.writeFile(pdfPath, pdf);
  await fs.writeFile(docxPath, docx);
  await fs.writeFile(xlsxPath, xlsx);
  const pdfText = (await pdfRowText(pdf)).text;
  await assertReadable("pdf", pdfText);
  await assertReadable("docx", await docxPlainText(docx));
  await assertReadable("xlsx", excelPlainText(xlsx));
};

main();
