import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfPasswordError extends Error {
  constructor(public needsPassword: boolean) {
    super(needsPassword ? 'ไฟล์นี้ใส่รหัสผ่าน' : 'รหัสผ่านไม่ถูกต้อง');
  }
}

/**
 * ปลดล็อค + สกัดข้อความจาก PDF "ในเครื่องผู้ใช้" (client-side)
 * รหัสผ่านไม่ออกนอกเบราว์เซอร์ ไม่ถูกส่งไปเซิร์ฟเวอร์
 * คืนข้อความที่จัดเรียงเป็นบรรทัด (พร้อมส่งให้ parser ฝั่งเซิร์ฟเวอร์)
 */
export async function extractPdfText(file: File, password?: string): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await pdfjs.getDocument({ data, password }).promise;
  } catch (err: any) {
    if (err?.name === 'PasswordException') {
      // code 1 = ต้องใส่รหัส, code 2 = รหัสผิด
      throw new PdfPasswordError(err.code === 1);
    }
    throw err;
  }

  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // จัดกลุ่ม text items ตามพิกัด y เพื่อประกอบกลับเป็นบรรทัด
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items as any[]) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      const key = Math.round(y / 3) * 3; // รวม y ที่ใกล้กัน
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push({ x, s: item.str });
    }
    const sortedRows = [...rows.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, items] of sortedRows) {
      const line = items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.s)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) lines.push(line);
    }
  }
  return lines.join('\n');
}
