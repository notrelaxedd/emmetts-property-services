/**
 * A one-page PDF holding a single JPEG that fills the page. Just enough PDF for a print-ready flyer
 * without a PDF library: catalog, pages, page, image XObject (DCTDecode = the JPEG bytes as-is) and
 * a content stream that draws it.
 */

/** US Letter in PDF points (1/72 in). */
export const LETTER = { width: 612, height: 792 } as const;

export function jpegPagePdf(
  jpeg: Buffer,
  image: { width: number; height: number },
  page: { width: number; height: number } = LETTER,
): Buffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b;
    parts.push(buf);
    length += buf.length;
  };
  const object = (n: number, body: string, stream?: Buffer) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  const draw = Buffer.from(`q ${page.width} 0 0 ${page.height} 0 0 cm /Im0 Do Q`, "latin1");
  // The binary comment line marks the file as binary for transfer tools.
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
      "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
  );
  object(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg,
  );
  object(5, `<< /Length ${draw.length} >>`, draw);

  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let n = 1; n <= 5; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}
