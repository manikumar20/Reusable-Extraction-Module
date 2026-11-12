import { pdfjs } from "react-pdf";
import workerUrl from "../node_modules/react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url";

// Match the pdfjs-dist copy bundled with react-pdf. The app's own pdfjs-dist
// is a newer build, and a mismatched worker never finishes opening the file.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
