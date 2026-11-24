import { pdfjs } from "react-pdf";
// Vite resolves this to a stable served URL (avoids broken /public worker fetches).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
