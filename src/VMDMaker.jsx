import { useState, useEffect, useRef, useCallback } from "react";
import polygonClipping from "polygon-clipping";
import { storeList, storeGet, storeSet, storeDel } from "./store";

/* =========================================================================
   VMD 제작 — 도형(사각형/자유 다각형) 기반 매대 설계
   - 병합(union) / 중첩 제외(difference) → 하나의 확정 도형으로 저장
   - 정면/후면/좌측/우측 4면도, 각 면은 독립 도면
   - 구간·도형별 상세 치수 자동 표기 · PNG 내보내기
   ========================================================================= */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const round = (v, n = 1) => { const p = Math.pow(10, n); return Math.round(v * p) / p; };
const VIEWS = ["front", "back", "left", "right"];
const VIEW_KR = { front: "정면", back: "후면", left: "좌측", right: "우측" };
const FIX_KEY = (id) => "vmd:fixture:" + id;

/* geometry ---------------------------------------------------------------- */
const rectMP = (x0, y0, x1, y1) => { const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1); return [[[[ax, ay], [bx, ay], [bx, by], [ax, by], [ax, ay]]]]; };
const polyMP = (pts) => [[[...pts, pts[0]]]];
function bboxMP(mp) { let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity; for (const poly of mp) for (const ring of poly) for (const [x, y] of ring) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; } return { minx, miny, maxx, maxy, w: maxx - minx, h: maxy - miny }; }
const translateMP = (mp, dx, dy) => mp.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x + dx, y + dy])));
function insideMP(mp, x, y) {
  for (const poly of mp) { let c = false; for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } if (c) return true; } return false;
}
function allX(shapes) { const s = new Set(); for (const sh of shapes) for (const poly of sh.mp) for (const ring of poly) for (const p of ring) s.add(round(p[0], 1)); return [...s].sort((a, b) => a - b); }
function allY(shapes) { const s = new Set(); for (const sh of shapes) for (const poly of sh.mp) for (const ring of poly) for (const p of ring) s.add(round(p[1], 1)); return [...s].sort((a, b) => a - b); }

/* =========================================================================
   루트
   ========================================================================= */
export default function VMDMaker() {
  const [fixtures, setFixtures] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { (async () => { const fs = (await Promise.all((await storeList("vmd:fixture:")).map(storeGet))).filter(Boolean); setFixtures(fs); setLoaded(true); })(); }, []);

  const save = useCallback((f) => { setFixtures((prev) => { const i = prev.findIndex((x) => x.id === f.id); return i < 0 ? [...prev, f] : prev.map((x) => x.id === f.id ? f : x); }); storeSet(FIX_KEY(f.id), f); }, []);
  const remove = useCallback((id) => { setFixtures((p) => p.filter((x) => x.id !== id)); storeDel(FIX_KEY(id)); setActiveId((a) => a === id ? null : a); }, []);

  const active = fixtures.find((f) => f.id === activeId) || null;
  const blank = () => ({ id: uid(), name: "", memo: "", area: { front: { w: 120, h: 200 }, back: { w: 120, h: 200 }, left: { w: 45, h: 200 }, right: { w: 45, h: 200 } }, views: { front: { shapes: [] }, back: { shapes: [] }, left: { shapes: [] }, right: { shapes: [] } } });

  if (!loaded) return <div className="loading">불러오는 중…</div>;
  if (active) return <FixtureEditor fixture={active} onSave={save} onClose={() => setActiveId(null)} />;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="h1">VMD 제작</h1><p className="muted">도형으로 매대를 설계하고 정면·후면·좌·우 규격을 뽑아내는 도구.</p></div>
        <button className="btn primary" onClick={() => { const f = blank(); save(f); setActiveId(f.id); }}>+ 새 VMD</button>
      </div>
      {fixtures.length === 0 && <div className="empty">아직 없음. 새 VMD로 도형 설계를 시작.</div>}
      <div className="proj-grid">
        {fixtures.map((f) => (
          <div className="card proj-card" key={f.id}>
            <div className="proj-body">
              <div className="proj-name">{f.name || "(이름 없음)"}</div>
              <div className="muted sm">{f.memo || "—"}</div>
              <div className="spec-chip">4면도 · 도형 {VIEWS.reduce((n, v) => n + (f.views?.[v]?.shapes?.length || 0), 0)}개</div>
            </div>
            <div className="proj-actions">
              <button className="btn primary sm" onClick={() => setActiveId(f.id)}>열기</button>
              <button className="btn danger-ghost sm" onClick={() => { if (confirm("삭제할까요?")) remove(f.id); }}>삭제</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================================
   편집기
   ========================================================================= */
function FixtureEditor({ fixture, onSave, onClose }) {
  const [name, setName] = useState(fixture.name || "");
  const [area, setArea] = useState(fixture.area);
  const [views, setViews] = useState(fixture.views);
  const [view, setView] = useState("front");
  const [tool, setTool] = useState("rect");   // select | rect | poly
  const [grid, setGrid] = useState(5);
  const [sel, setSel] = useState([]);
  const [draft, setDraft] = useState(null);    // rect drag or poly points
  const boardRef = useRef(null);
  const [boardW, setBoardW] = useState(680);
  const dragRef = useRef(null);

  const shapes = views[view].shapes;
  const aw = area[view].w, ah = area[view].h;

  useEffect(() => { const measure = () => { if (boardRef.current) setBoardW(boardRef.current.clientWidth); }; measure(); const ro = new ResizeObserver(measure); if (boardRef.current) ro.observe(boardRef.current); return () => ro.disconnect(); }, []);
  useEffect(() => { const t = setTimeout(() => onSave({ ...fixture, name, area, views }), 350); return () => clearTimeout(t); }, [name, area, views]); // eslint-disable-line

  const maxH = 520, padPx = 46;
  const ppc = Math.max(0.6, Math.min((boardW - padPx * 2) / aw, (maxH - padPx) / ah));
  const X = (cm) => padPx + cm * ppc;
  const Y = (cm) => padPx + (ah - cm) * ppc;      // y-up
  const toCm = (px, py, rect) => ({ x: (px - rect.left - padPx) / ppc, y: ah - (py - rect.top - padPx) / ppc });
  const snap = (v) => Math.round(v / grid) * grid;

  const setShapes = (fn) => setViews((vs) => ({ ...vs, [view]: { shapes: fn(vs[view].shapes) } }));
  const addShape = (mp) => { const id = uid(); setShapes((s) => [...s, { id, mp }]); setSel([id]); };
  const delSel = () => { setShapes((s) => s.filter((x) => !sel.includes(x.id))); setSel([]); };

  const boolOp = (kind) => {
    const chosen = shapes.filter((s) => sel.includes(s.id));
    if (chosen.length < 2) { alert("도형을 2개 이상 선택하세요."); return; }
    try {
      let res;
      if (kind === "union") res = polygonClipping.union(chosen[0].mp, ...chosen.slice(1).map((s) => s.mp));
      else res = polygonClipping.difference(chosen[0].mp, ...chosen.slice(1).map((s) => s.mp));
      if (!res || !res.length) { alert("결과가 비었습니다. (완전히 지워졌거나 겹침이 없음)"); return; }
      const nid = uid();
      setShapes((s) => [...s.filter((x) => !sel.includes(x.id)), { id: nid, mp: res }]);
      setSel([nid]);
    } catch (e) { alert("연산 실패: 도형이 유효한지 확인하세요."); }
  };

  /* pointer -------------------------------------------------------------- */
  const onDown = (e) => {
    const rect = boardRef.current.getBoundingClientRect();
    const p = toCm(e.clientX, e.clientY, rect);
    const sx = snap(p.x), sy = snap(p.y);
    if (tool === "rect") { dragRef.current = { mode: "rect", x0: sx, y0: sy }; setDraft({ type: "rect", x0: sx, y0: sy, x1: sx, y1: sy }); e.currentTarget.setPointerCapture?.(e.pointerId); return; }
    if (tool === "poly") { setDraft((d) => { const pts = d && d.type === "poly" ? d.pts : []; return { type: "poly", pts: [...pts, [sx, sy]] }; }); return; }
    // select
    const hit = [...shapes].reverse().find((s) => insideMP(s.mp, p.x, p.y));
    if (hit) {
      if (e.shiftKey) setSel((s) => s.includes(hit.id) ? s.filter((x) => x !== hit.id) : [...s, hit.id]);
      else if (!sel.includes(hit.id)) setSel([hit.id]);
      const group = (sel.includes(hit.id) && sel.length > 1) ? sel : [hit.id];
      dragRef.current = { mode: "move", startX: p.x, startY: p.y, group, orig: {} };
      group.forEach((id) => { const sh = shapes.find((x) => x.id === id); if (sh) dragRef.current.orig[id] = sh.mp; });
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } else if (!e.shiftKey) setSel([]);
  };
  const onMoveEvt = (e) => {
    const dg = dragRef.current; if (!dg) return;
    const rect = boardRef.current.getBoundingClientRect();
    const p = toCm(e.clientX, e.clientY, rect);
    if (dg.mode === "rect") setDraft({ type: "rect", x0: dg.x0, y0: dg.y0, x1: snap(p.x), y1: snap(p.y) });
    else if (dg.mode === "move") { const dx = snap(p.x - dg.startX), dy = snap(p.y - dg.startY); setShapes((s) => s.map((sh) => dg.group.includes(sh.id) ? { ...sh, mp: translateMP(dg.orig[sh.id], dx, dy) } : sh)); }
  };
  const onUp = () => {
    const dg = dragRef.current; dragRef.current = null; if (!dg) return;
    if (dg.mode === "rect" && draft && draft.type === "rect") { if (Math.abs(draft.x1 - draft.x0) >= grid && Math.abs(draft.y1 - draft.y0) >= grid) addShape(rectMP(draft.x0, draft.y0, draft.x1, draft.y1)); setDraft(null); }
  };
  const finishPoly = () => { if (draft && draft.type === "poly" && draft.pts.length >= 3) addShape(polyMP(draft.pts)); setDraft(null); };

  /* draw ----------------------------------------------------------------- */
  const canvasRef = useRef(null);
  useEffect(() => { drawAll(); }); // redraw every render
  function drawAll() {
    const cv = canvasRef.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = X(aw) + padPx, chp = Y(0) + padPx;
    cv.width = cw * dpr; cv.height = chp * dpr; cv.style.width = cw + "px"; cv.style.height = chp + "px";
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, chp);
    const css = getComputedStyle(document.documentElement);
    const ink = (css.getPropertyValue("--text-primary") || "#1c2b2d").trim();
    const muted = (css.getPropertyValue("--text-secondary") || "#6b7b7d").trim();
    const accent = (css.getPropertyValue("--text-accent") || "#0f8a7e").trim();
    const line = (css.getPropertyValue("--border") || "#dde3e3").trim();
    // area frame + grid
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (let gx = 0; gx <= aw + 0.01; gx += grid) { ctx.globalAlpha = (Math.round(gx) % 10 === 0) ? 0.5 : 0.2; ctx.beginPath(); ctx.moveTo(X(gx), Y(0)); ctx.lineTo(X(gx), Y(ah)); ctx.stroke(); }
    for (let gy = 0; gy <= ah + 0.01; gy += grid) { ctx.globalAlpha = (Math.round(gy) % 10 === 0) ? 0.5 : 0.2; ctx.beginPath(); ctx.moveTo(X(0), Y(gy)); ctx.lineTo(X(aw), Y(gy)); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.strokeStyle = muted; ctx.lineWidth = 1.5; ctx.strokeRect(X(0), Y(ah), aw * ppc, ah * ppc);
    // shapes
    for (const sh of shapes) {
      const on = sel.includes(sh.id);
      ctx.beginPath();
      for (const poly of sh.mp) for (const ring of poly) { ring.forEach(([x, y], i) => { const px = X(x), py = Y(y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); }
      ctx.fillStyle = accent; ctx.globalAlpha = on ? 0.26 : 0.15; ctx.fill("evenodd"); ctx.globalAlpha = 1;
      ctx.strokeStyle = accent; ctx.lineWidth = on ? 2.5 : 1.5; ctx.stroke();
      const bb = bboxMP(sh.mp);
      ctx.fillStyle = ink; ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(round(bb.w) + "×" + round(bb.h), X((bb.minx + bb.maxx) / 2), Y((bb.miny + bb.maxy) / 2));
    }
    // draft
    if (draft && draft.type === "rect") { ctx.setLineDash([5, 4]); ctx.strokeStyle = accent; ctx.strokeRect(X(Math.min(draft.x0, draft.x1)), Y(Math.max(draft.y0, draft.y1)), Math.abs(draft.x1 - draft.x0) * ppc, Math.abs(draft.y1 - draft.y0) * ppc); ctx.setLineDash([]); }
    if (draft && draft.type === "poly") { ctx.setLineDash([5, 4]); ctx.strokeStyle = accent; ctx.beginPath(); draft.pts.forEach((p, i) => { const px = X(p[0]), py = Y(p[1]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke(); ctx.setLineDash([]); draft.pts.forEach((p) => { ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 3, 0, 7); ctx.fill(); }); }
    // dimensions (구간·도형별 상세)
    drawDims(ctx, muted);
  }
  function dimH(ctx, c, x1, x2, y, label) { ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.moveTo(x1, y - 4); ctx.lineTo(x1, y + 4); ctx.moveTo(x2, y - 4); ctx.lineTo(x2, y + 4); ctx.stroke(); ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(label, (x1 + x2) / 2, y - 2); }
  function dimV(ctx, c, y1, y2, x, label) { ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.moveTo(x - 4, y1); ctx.lineTo(x + 4, y1); ctx.moveTo(x - 4, y2); ctx.lineTo(x + 4, y2); ctx.stroke(); ctx.save(); ctx.translate(x - 3, (y1 + y2) / 2); ctx.rotate(-Math.PI / 2); ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(label, 0, 0); ctx.restore(); }
  function drawDims(ctx, c) {
    if (!shapes.length) return;
    const xs = allX(shapes), ys = allY(shapes);
    const bb = { minx: xs[0], maxx: xs[xs.length - 1], miny: ys[0], maxy: ys[ys.length - 1] };
    // overall
    dimH(ctx, c, X(bb.minx), X(bb.maxx), Y(bb.maxy) - 26, "전체 " + round(bb.maxx - bb.minx));
    dimV(ctx, c, Y(bb.maxy), Y(bb.miny), X(bb.minx) - 26, "전체 " + round(bb.maxy - bb.miny));
    // segment chains (rectilinear detail) — 과밀 방지 상한
    if (xs.length <= 14) for (let i = 1; i < xs.length; i++) dimH(ctx, c, X(xs[i - 1]), X(xs[i]), Y(bb.maxy) - 10, round(xs[i] - xs[i - 1]) + "");
    if (ys.length <= 14) for (let i = 1; i < ys.length; i++) dimV(ctx, c, Y(ys[i]), Y(ys[i - 1]), X(bb.minx) - 10, round(ys[i] - ys[i - 1]) + "");
  }

  const exportPng = () => { const cv = canvasRef.current; if (!cv) return; const a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = `VMD_${name || "fixture"}_${VIEW_KR[view]}.png`; a.click(); };

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn ghost sm" onClick={onClose}>← 목록</button>
          <input className="inp" style={{ width: 220 }} placeholder="VMD 이름" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="btn primary sm" onClick={exportPng}>이 면 PNG 저장</button>
      </div>

      <div className="seg" style={{ marginBottom: 12 }}>
        {VIEWS.map((v) => <button key={v} className={"seg-btn" + (view === v ? " on" : "")} onClick={() => { setView(v); setSel([]); setDraft(null); }}>{VIEW_KR[v]}</button>)}
      </div>

      <div className="vmk-toolbar">
        <div className="seg sm">
          <button className={"seg-btn" + (tool === "select" ? " on" : "")} onClick={() => { setTool("select"); setDraft(null); }}>선택/이동</button>
          <button className={"seg-btn" + (tool === "rect" ? " on" : "")} onClick={() => { setTool("rect"); setDraft(null); }}>사각형</button>
          <button className={"seg-btn" + (tool === "poly" ? " on" : "")} onClick={() => { setTool("poly"); setDraft(null); }}>다각형</button>
        </div>
        {tool === "poly" && <button className="btn ghost sm" onClick={finishPoly} disabled={!draft || draft.type !== "poly" || draft.pts.length < 3}>다각형 닫기</button>}
        <span className="muted xs">격자</span>
        <select className="tier-select" value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
          <option value={1}>1cm</option><option value={5}>5cm</option><option value={10}>10cm</option>
        </select>
        <button className="btn ghost sm" onClick={() => boolOp("union")}>병합</button>
        <button className="btn ghost sm" onClick={() => boolOp("subtract")}>중첩 제외</button>
        <button className="btn danger-ghost sm" onClick={delSel} disabled={!sel.length}>삭제</button>
        <span className="muted xs" style={{ marginLeft: "auto" }}>도면 {VIEW_KR[view]}(cm)</span>
        <input className="inp sm" style={{ width: 64 }} type="number" value={aw} onChange={(e) => setArea((a) => ({ ...a, [view]: { ...a[view], w: Math.max(10, Number(e.target.value) || 10) } }))} title="도면 폭" />
        <input className="inp sm" style={{ width: 64 }} type="number" value={ah} onChange={(e) => setArea((a) => ({ ...a, [view]: { ...a[view], h: Math.max(10, Number(e.target.value) || 10) } }))} title="도면 높이" />
      </div>

      <div className="vmk-board" ref={boardRef}>
        <canvas ref={canvasRef} style={{ touchAction: "none", cursor: tool === "select" ? "default" : "crosshair" }}
          onPointerDown={onDown} onPointerMove={onMoveEvt} onPointerUp={onUp} onPointerLeave={onUp} onDoubleClick={finishPoly} />
      </div>
      <div className="muted xs" style={{ marginTop: 8 }}>
        사각형: 끌어서 그림 · 다각형: 클릭으로 점 찍고 “닫기”(또는 더블클릭) · 선택 후 병합/중첩 제외 → 하나의 도형으로 확정. 각 면(정면·후면·좌·우)은 독립 도면이라 따로 그려요.
      </div>
    </div>
  );
}
