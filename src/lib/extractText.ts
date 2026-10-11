// Client-side text extraction for PDF, DOCX, and plain text files.
// PDFs use pdfjs-dist; DOCX uses mammoth. Both run in the browser.

export type ExtractProgressCallback = (current: number, total: number, stage?: string) => void;

const cleanWhitespace = (s: string) =>
  s.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

async function extractPdf(file: File, onProgress?: ExtractProgressCallback): Promise<string> {
  // Dynamic import keeps the heavy worker out of the main bundle.
  const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs");
  // Vite-friendly worker URL
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const out: string[] = [];
  // Support large lecture handouts and textbooks up to 500 pages
  const maxPages = Math.min(doc.numPages, 500);

  for (let i = 1; i <= maxPages; i++) {
    if (onProgress && (i === 1 || i % 5 === 0 || i === maxPages)) {
      onProgress(i, maxPages, `Reading page ${i} of ${maxPages}`);
    }
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it: any) => it.str ?? "")
      .join(" ")
      .trim();

    if (pageText.length > 0) {
      out.push(`[Page ${i}]\n${pageText}`);
    }
  }

  return cleanWhitespace(out.join("\n\n"));
}

async function extractDocx(file: File, onProgress?: ExtractProgressCallback): Promise<string> {
  onProgress?.(1, 1, "Extracting Word document text");
  const mammoth: any = await import("mammoth/mammoth.browser");
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return cleanWhitespace(result.value ?? "");
}

export async function extractTextFromFile(
  file: File,
  onProgress?: ExtractProgressCallback
): Promise<string> {
  const name = file.name.toLowerCase();
  const ext = name.split(".").pop() ?? "";

  if (file.type.startsWith("text/") || ext === "txt" || ext === "md") {
    onProgress?.(1, 1, "Reading text file");
    return cleanWhitespace(await file.text());
  }
  if (ext === "pdf" || file.type === "application/pdf") {
    return extractPdf(file, onProgress);
  }
  if (
    ext === "docx" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocx(file, onProgress);
  }
  // Unknown type — try plain text as a fallback
  try {
    return cleanWhitespace(await file.text());
  } catch {
    return "";
  }
}
