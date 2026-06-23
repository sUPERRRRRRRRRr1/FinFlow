import { config } from '../config.js';

/**
 * ถอดรหัส + ดึงข้อความจาก PDF (รองรับ PDF ที่ใส่รหัส) ด้วย pdfjs-dist
 * คืน null ถ้าเปิด/อ่านไม่ได้ (รหัสผิด/ไฟล์เสีย) ให้ผู้เรียกข้ามไป
 */
export async function extractPdfText(
  buf: Buffer,
  password = config.statement.pdfPassword,
): Promise<string | null> {
  try {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      password: password || undefined,
      useSystemFonts: true,
      // ปิด worker ในฝั่ง Node (ดึงเฉพาะข้อความไม่ต้องเรนเดอร์)
      isEvalSupported: false,
    }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      text += tc.items.map((it: any) => it.str).join(' ') + '\n';
    }
    return text;
  } catch (err) {
    // รหัสผิด/ต้องใส่รหัส = เรื่องปกติตอนไล่ลองหลายรหัส ไม่ต้อง log รก (log เฉพาะ error จริง เช่น ไฟล์เสีย)
    if ((err as Error).name !== 'PasswordException') {
      console.error('[pdf] extract failed:', (err as Error).message);
    }
    return null;
  }
}
