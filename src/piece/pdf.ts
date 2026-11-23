import {
  getDocument,
  GlobalWorkerOptions,
  InvalidPDFException,
  PasswordException,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url&no-inline';
import jbig2Url from 'pdfjs-dist/wasm/jbig2.wasm?url&no-inline';
import openjpegUrl from 'pdfjs-dist/wasm/openjpeg.wasm?url&no-inline';
import jbig2Licence from 'pdfjs-dist/wasm/LICENSE_JBIG2?url&no-inline';
import openjpegLicence from 'pdfjs-dist/wasm/LICENSE_OPENJPEG?url&no-inline';
import { pageScale, paperCanvas } from './pages';

/**
 * PDF pages drawn in this browser with pdf.js (pdfjs-dist, version pinned in package.json). This module is loaded only
 * when the owner chooses a PDF for the reader, so the Pieces page does not carry pdf.js. Its worker and its image
 * decoders (JBIG2 and JPEG 2000, common in scanned sheet music) are bundled with the app; nothing comes from a CDN.
 */
GlobalWorkerOptions.workerSrc = workerUrl;

const WASM: Record<string, string> = { 'jbig2.wasm': jbig2Url, 'openjpeg.wasm': openjpegUrl };
/** The decoders' own licences (PDFium's JBIG2 and OpenJPEG, both BSD), published next to them. */
export const DECODER_LICENCES = [jbig2Licence, openjpegLicence];

/** Hands pdf.js its decoders from this app's own files. Fonts and character maps it does not get fall back quietly. */
class BundledData {
  constructor(_options: unknown) {}
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = kind === 'wasmUrl' ? WASM[filename] : undefined;
    if (!url) throw new Error(`Not bundled: ${kind} ${filename}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${filename}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

export interface PdfFile {
  pages: number;
  /** Draw page n (from 1) on white, sized for cutting. */
  page: (n: number) => Promise<HTMLCanvasElement>;
  close: () => Promise<void>;
}

/** Open a PDF, or say in a sentence why it cannot be read. */
export async function openPdf(data: ArrayBuffer, name: string): Promise<PdfFile | string> {
  const task = getDocument({
    data: new Uint8Array(data),
    BinaryDataFactory: BundledData,
    useWorkerFetch: false,
    enableXfa: false,
    verbosity: 0,
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    void task.destroy();
    if (error instanceof PasswordException)
      return `“${name}” is locked with a password, so its pages cannot be drawn here.`;
    if (error instanceof InvalidPDFException) return `“${name}” could not be read as a PDF.`;
    return `“${name}” could not be opened.`;
  }
  return {
    pages: doc.numPages,
    page: async (n) => {
      const page = await doc.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 }),
          viewport = page.getViewport({ scale: pageScale(base.width, base.height, true) }),
          canvas = paperCanvas(viewport.width, viewport.height);
        await page.render({ canvas, viewport, background: '#fff' }).promise;
        return canvas;
      } finally {
        page.cleanup();
      }
    },
    close: () => task.destroy(),
  };
}
