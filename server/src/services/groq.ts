import { config, flags } from '../config.js';

/**
 * เรียก Groq (groq.com) ผ่าน REST endpoint แบบ OpenAI-compatible (/chat/completions)
 * ใช้ global fetch ของ Node — ไม่ต้องเพิ่ม dependency
 * base URL ตั้งผ่าน GROQ_BASE_URL ได้ (ชี้ไป provider OpenAI-compatible เจ้าอื่น เช่น xAI Grok ก็ได้)
 * คืน null ถ้าไม่มี key หรือเรียกพลาด เพื่อให้ผู้เรียกถอยไปใช้ provider/fallback ตัวถัดไป
 */
export async function groqGenerate(prompt: string): Promise<string | null> {
  if (!flags.groqEnabled) return null;
  try {
    const res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.groq.apiKey}`,
      },
      body: JSON.stringify({
        model: config.groq.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      console.error('[groq] http', res.status, await res.text().catch(() => ''));
      return null;
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    console.error('[groq] error:', (err as Error).message);
    return null;
  }
}

/**
 * Groq vision (multimodal) สำหรับ OCR สลิป — ส่งรูป base64 + prompt, เปิด JSON mode
 * คืน content (สตริง JSON) หรือ null ให้ผู้เรียกถอยไป provider ถัดไป
 */
export async function groqVision(
  imageBase64: string,
  mimeType: string,
  prompt: string,
): Promise<string | null> {
  if (!flags.groqEnabled) return null;
  try {
    const res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.groq.apiKey}`,
      },
      body: JSON.stringify({
        model: config.groq.visionModel,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error('[groq-vision] http', res.status, await res.text().catch(() => ''));
      return null;
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[groq-vision] error:', (err as Error).message);
    return null;
  }
}
