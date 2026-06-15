import { useMemo, useRef, useState } from 'react';
import { sankey, sankeyLinkHorizontal, sankeyJustify } from 'd3-sankey';
import type { SankeyGraph } from '../lib/types';
import { thb, pct } from '../lib/format';

const TYPE_LABEL: Record<string, string> = {
  income: 'รายรับ',
  wallet: 'กระเป๋าเงิน',
  expense: 'หมวดรายจ่าย',
  savings: 'ออม/ลงทุน',
  leftover: 'เงินคงเหลือ',
  carryover: 'ยอดยกมา',
};

interface Tip {
  kind: 'node' | 'link';
  data: any;
  x: number;
  y: number;
  flip: boolean;
}

export default function SankeyChart({ graph }: { graph: SankeyGraph }) {
  const W = 900;
  const H = Math.max(520, graph.nodes.length * 46);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverLink, setHoverLink] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => {
    const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
    const nodes = graph.nodes.map((n) => ({ ...n }));
    const links = graph.links.map((l) => ({
      source: index.get(l.source)!,
      target: index.get(l.target)!,
      value: l.value,
    }));
    if (nodes.length === 0 || links.length === 0) return null;
    try {
      const gen = sankey<any, any>()
        .nodeWidth(16)
        .nodePadding(26)
        .nodeAlign(sankeyJustify)
        .iterations(64)
        .extent([
          [4, 12],
          [W - 4, H - 12],
        ]);
      const result = gen({ nodes, links });

      // ดัน "กระเป๋ารอง" (ที่รับโอนมา = อยู่คอลัมน์ขวากว่ากระเป๋าหลัก) ไปกองล่างสุดด้วยกัน
      // เพื่อไม่ให้โดนเส้นที่กระเป๋าหลักจ่ายตรงไปยังหมวดต่างๆ พาดทับ (อัตโนมัติทุกกระเป๋า)
      const wallets = result.nodes.filter((n: any) => n.type === 'wallet').sort((a: any, b: any) => a.x0 - b.x0);
      const primaryX = wallets[0]?.x0 ?? -1;
      const secondary = wallets.filter((n: any) => n.x0 > primaryX);
      if (secondary.length > 0) {
        let y = H - 14;
        for (const n of [...secondary].sort((a: any, b: any) => a.value - b.value)) {
          const h = n.y1 - n.y0;
          n.y1 = y;
          n.y0 = y - h;
          y = n.y0 - 30;
        }
      }

      // จัดลำดับจุดต่อเส้นที่ขอบแต่ละโนดให้ตรงกับตำแหน่งแนวตั้งของปลายทางจริง
      // => เส้นโอนเข้ากระเป๋ารอง (ที่อยู่ล่าง) จะออกจาก "ด้านล่าง" ของ KBank รวมกันเอง ไม่ตัดข้ามเส้นจ่ายหมวด
      for (const n of result.nodes as any[]) {
        n.sourceLinks.sort((a: any, b: any) => a.target.y0 - b.target.y0);
        n.targetLinks.sort((a: any, b: any) => a.source.y0 - b.source.y0);
      }
      gen.update(result); // คำนวณตำแหน่ง/ความกว้างเส้นใหม่ตามที่จัดเรียง
      return result;
    } catch {
      return null; // กันแอปพังกรณีกราฟซับซ้อนเกินวาด
    }
  }, [graph, H]);

  // เงินเข้ารวม (ผลรวมของโนดรายรับทั้งหมด) ใช้เป็นฐานคิด % ของแต่ละปลายทาง
  const totalIncome = useMemo(() => {
    if (!layout) return 0;
    return layout.nodes.filter((n: any) => n.type === 'income').reduce((s: number, n: any) => s + n.value, 0);
  }, [layout]);

  if (!layout) return <div className="muted center">ไม่มีข้อมูลพอสำหรับวาดแผนภาพ</div>;

  const linkOpacity = (l: any, i: number) => {
    if (hoverNode) return l.source.id === hoverNode || l.target.id === hoverNode ? 0.62 : 0.04;
    if (hoverLink !== null) return hoverLink === i ? 0.72 : 0.06;
    return 0.26;
  };
  const nodeDim = (n: any) => {
    if (!hoverNode) return 1;
    if (n.id === hoverNode) return 1;
    const connected = layout.links.some(
      (l: any) => (l.source.id === hoverNode && l.target.id === n.id) || (l.target.id === hoverNode && l.source.id === n.id),
    );
    return connected ? 1 : 0.28;
  };

  // อัปเดตตำแหน่ง tooltip ตามเมาส์ (พิกัดเทียบกับกล่องครอบ ไม่ใช่พิกัด SVG)
  const moveTip = (e: React.MouseEvent, kind: 'node' | 'link', data: any) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTip({ kind, data, x, y, flip: x > rect.width * 0.58 });
  };

  return (
    <>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        💡 ชี้เมาส์ที่กล่องกระเป๋า/หมวด หรือที่ปลายเส้นทาง เพื่อดูรายละเอียดและไฮไลต์เส้นทางของเงิน
      </div>
      <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }}>
        {layout.links.map((l: any, i: number) => (
          <path
            key={i}
            d={sankeyLinkHorizontal()(l) ?? ''}
            fill="none"
            stroke={l.source.color}
            strokeOpacity={linkOpacity(l, i)}
            strokeWidth={Math.max(1.5, l.width)}
            style={{ transition: 'stroke-opacity 0.15s', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              setHoverLink(i);
              moveTip(e, 'link', l);
            }}
            onMouseMove={(e) => moveTip(e, 'link', l)}
            onMouseLeave={() => {
              setHoverLink(null);
              setTip(null);
            }}
          />
        ))}
        {layout.nodes.map((n: any, i: number) => {
          const leftSide = n.x0 < W / 2;
          return (
            <g
              key={i}
              style={{ opacity: nodeDim(n), transition: 'opacity 0.15s', cursor: 'pointer' }}
              onMouseEnter={(e) => {
                setHoverNode(n.id);
                moveTip(e, 'node', n);
              }}
              onMouseMove={(e) => moveTip(e, 'node', n)}
              onMouseLeave={() => {
                setHoverNode(null);
                setTip(null);
              }}
            >
              <rect x={n.x0} y={n.y0} width={n.x1 - n.x0} height={Math.max(2, n.y1 - n.y0)} fill={n.color} rx={3} />
              <text
                x={leftSide ? n.x1 + 8 : n.x0 - 8}
                y={(n.y0 + n.y1) / 2}
                textAnchor={leftSide ? 'start' : 'end'}
                dominantBaseline="middle"
                style={{ fontSize: 12.5, fill: 'var(--text)', fontWeight: 500, pointerEvents: 'none' }}
              >
                {n.label}
                <tspan style={{ fill: 'var(--muted)', fontSize: 11 }}> · {thb(n.value)}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
      {tip &&
        (() => {
          // เตรียมเนื้อหาการ์ดให้ใช้ร่วมกันได้ทั้งกรณีชี้ที่ "กล่อง" (node) และชี้ที่ "เส้น" (link)
          type Row = { label: string; color: string; right: string; barPct: number };
          let title: string;
          let titleColor: string;
          let subtitle: string;
          let value: number;
          let rowsTitle = '';
          let rows: Row[] = [];
          let restCount = 0;

          if (tip.kind === 'link') {
            const l = tip.data;
            value = l.value;
            title = `${l.source.label} → ${l.target.label}`;
            titleColor = l.source.color;
            subtitle = 'เส้นทางการเงิน';
            const srcOut = (l.source.sourceLinks ?? []).reduce((s: number, x: any) => s + x.value, 0) || value;
            const tgtIn = (l.target.targetLinks ?? []).reduce((s: number, x: any) => s + x.value, 0) || value;
            const pctOut = (value / srcOut) * 100;
            const pctIn = (value / tgtIn) * 100;
            rowsTitle = 'สัดส่วนของเส้นทางนี้';
            rows = [
              { label: `ของเงินที่ออกจาก ${l.source.label}`, color: l.source.color, right: pct(pctOut), barPct: pctOut },
              { label: `ของเงินที่เข้า ${l.target.label}`, color: l.target.color, right: pct(pctIn), barPct: pctIn },
            ];
          } else {
            const n = tip.data;
            value = n.value;
            title = n.label;
            titleColor = n.color;
            subtitle = TYPE_LABEL[n.type] ?? n.type;
            const inflows = [...(n.targetLinks ?? [])]
              .map((l: any) => ({ label: l.source.label, color: l.source.color, value: l.value }))
              .sort((a, b) => b.value - a.value);
            const outflows = [...(n.sourceLinks ?? [])]
              .map((l: any) => ({ label: l.target.label, color: l.target.color, value: l.value }))
              .sort((a, b) => b.value - a.value);
            const isEnd = outflows.length === 0; // ปลายทาง (ขวาสุด): หมวด/ออม/คงเหลือ
            const base = isEnd ? inflows : outflows;
            rowsTitle = isEnd ? 'มาจากกระเป๋า' : 'กระจายไปยัง';
            const maxVal = base.reduce((m, r) => Math.max(m, r.value), 0) || 1;
            const shown = base.slice(0, 6);
            restCount = base.length - shown.length;
            rows = shown.map((r) => ({ label: r.label, color: r.color, right: thb(r.value), barPct: (r.value / maxVal) * 100 }));
          }
          const share = totalIncome > 0 ? (value / totalIncome) * 100 : null;

          return (
            <div
              style={{
                position: 'absolute',
                left: tip.x,
                top: tip.y,
                transform: `translate(${tip.flip ? 'calc(-100% - 16px)' : '16px'}, -50%)`,
                pointerEvents: 'none',
                zIndex: 20,
                width: 248,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                boxShadow: 'var(--shadow)',
                padding: '11px 13px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: titleColor, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text)' }}>{title}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{subtitle}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)' }}>{thb(value)}</span>
                {share !== null && (
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{pct(share)} ของเงินเข้าทั้งหมด</span>
                )}
              </div>
              {rows.length > 0 && (
                <>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: 0.4,
                      marginBottom: 6,
                    }}
                  >
                    {rowsTitle}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {rows.map((r, ri) => (
                      <div key={ri}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: r.color, flexShrink: 0 }} />
                          <span
                            style={{
                              flex: 1,
                              fontSize: 12,
                              color: 'var(--text)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {r.label}
                          </span>
                          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>{r.right}</span>
                        </div>
                        <div style={{ height: 3, borderRadius: 2, background: 'var(--border)' }}>
                          <div
                            style={{
                              height: '100%',
                              borderRadius: 2,
                              width: `${Math.min(100, r.barPct)}%`,
                              background: r.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {restCount > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>+ อีก {restCount} รายการ</div>
                  )}
                </>
              )}
            </div>
          );
        })()}
      </div>
    </>
  );
}
