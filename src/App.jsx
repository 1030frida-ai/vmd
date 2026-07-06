import { useState, useEffect, useRef, useCallback } from "react";
import { storeList, storeGet, storeSet, storeDel, storeImage, seedIfEmpty, hasCloud } from "./store";
import VMDMaker from "./VMDMaker.jsx";

/* =========================================================================
   약국 VMD 시뮬레이터 v4
   - 정면/측면 뷰 전환 (측면: 깊이 방향 진열 수 확인·조절)
   - 깊이 진열 수(facing)를 정면에 뒤로 쌓인 모습으로 반영
   - 정면에서 단 높이 안에 제품 세로 적층(아래 제품 윗면에 스냅)
   - 진열장 규격: 단별 높이 + 간격 높이(선반판 두께) + 하단/헤더 옵션
   - 제품 라이브러리(공용) + 약국 처별 프로젝트 / 시안 PNG 내보내기
   - window.storage 영구 저장(미지원 시 세션 메모리)
   ========================================================================= */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const FACES = ["front", "back", "left", "right"];
const FACE_KR = { front: "정면", back: "후면", left: "좌측", right: "우측" };

function normShelf(s) {
  s = s || {};
  const tiers = clamp(parseInt(s.tiers) || 5, 1, 12);
  const uniformH = s.uniformH ?? s.gap ?? (s.h ? Math.round(s.h / tiers) : 30);
  let th = Array.isArray(s.tierHeights) ? s.tierHeights.slice() : null;
  if (!th) th = Array.from({ length: tiers }, () => uniformH);
  if (th.length !== tiers) th = Array.from({ length: tiers }, (_, i) => th[i] ?? uniformH);
  return {
    w: s.w ?? 90, d: s.d ?? 35, tiers, uniformH, tierHeights: th,
    boardH: s.boardH ?? 3,
    hasBottom: !!s.hasBottom, bottomH: s.bottomH ?? 18,
    hasHeader: !!s.hasHeader, headerH: s.headerH ?? 20,
  };
}
function shelfGeom(s) {
  const tiers = clamp(parseInt(s.tiers) || 1, 1, 12);
  const base = s.hasBottom ? num(s.bottomH, 0) : 0;
  const header = s.hasHeader ? num(s.headerH, 0) : 0;
  const board = num(s.boardH, 0);
  const boards = [], floors = [];
  let acc = base;
  for (let i = 0; i < tiers; i++) { boards.push({ bottom: acc, h: board }); const f = acc + board; floors.push(f); acc = f + num(s.tierHeights[i], 0); }
  const mainTop = acc, totalH = mainTop + header;
  return { base, header, board, boards, floors, mainTop, totalH, w: num(s.w, 90), d: num(s.d, 35), tiers };
}

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = src; });

const ITEM_KEY = (id) => "vmd:item:" + id;
const PROJ_KEY = (id) => "vmd:project:" + id;

/* =========================================================================
   루트
   ========================================================================= */
export default function App() {
  const [view, setView] = useState("projects");
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      await seedIfEmpty();
      const its = (await Promise.all((await storeList("vmd:item:")).map(storeGet))).filter(Boolean);
      const prs = (await Promise.all((await storeList("vmd:project:")).map(storeGet))).filter(Boolean);
      setItems(its); setProjects(prs); setLoaded(true);
    })();
  }, []);

  const saveItem = useCallback((it) => { setItems((p) => { const i = p.findIndex((x) => x.id === it.id); return i < 0 ? [...p, it] : p.map((x) => x.id === it.id ? it : x); }); storeSet(ITEM_KEY(it.id), it); }, []);
  const removeItem = useCallback((id) => { setItems((p) => p.filter((x) => x.id !== id)); storeDel(ITEM_KEY(id)); }, []);
  const saveProject = useCallback((p) => { setProjects((prev) => { const i = prev.findIndex((x) => x.id === p.id); return i < 0 ? [...prev, p] : prev.map((x) => x.id === p.id ? p : x); }); storeSet(PROJ_KEY(p.id), p); }, []);
  const removeProject = useCallback((id) => { setProjects((p) => p.filter((x) => x.id !== id)); storeDel(PROJ_KEY(id)); setActiveId((a) => a === id ? null : a); }, []);

  const active = projects.find((p) => p.id === activeId) || null;

  return (
    <div className="vmd-root">
      <StyleTag />
      <header className="topbar">
        <div className="brand">
          <span className="logo-dot" />
          <div><div className="brand-title">약국 VMD 시뮬레이터</div><div className="brand-sub">진열장 규격에 맞춰 매대를 꾸며보는 도구</div></div>
        </div>
        <nav className="tabs">
          <button className={"tab" + (view === "projects" ? " on" : "")} onClick={() => setView("projects")}>프로젝트</button>
          <button className={"tab" + (view === "library" ? " on" : "")} onClick={() => setView("library")}>제품 라이브러리</button>
          <button className={"tab" + (view === "vmdmaker" ? " on" : "")} onClick={() => setView("vmdmaker")}>VMD 제작</button>
          {active && <button className={"tab" + (view === "editor" ? " on" : "")} onClick={() => setView("editor")}>편집: {active.pharmacy || active.name}</button>}
        </nav>
        {!hasCloud && <span className="warn-pill">로컬 저장 모드 (클라우드 미설정)</span>}
      </header>

      <main className="stage">
        {!loaded && <div className="loading">불러오는 중…</div>}
        {loaded && view === "projects" && <ProjectsView projects={projects} onSave={saveProject} onRemove={removeProject} onOpen={(id) => { setActiveId(id); setView("editor"); }} />}
        {loaded && view === "library" && <LibraryView items={items} onSave={saveItem} onRemove={removeItem} />}
        {loaded && view === "vmdmaker" && <VMDMaker />}
        {loaded && view === "editor" && active && <EditorView key={active.id} project={active} items={items} onSave={saveProject} goLibrary={() => setView("library")} />}
        {loaded && view === "editor" && !active && <div className="empty">열린 프로젝트가 없음. 프로젝트 탭에서 선택.</div>}
      </main>
    </div>
  );
}

/* =========================================================================
   진열장 규격 입력
   ========================================================================= */
function ShelfFields({ shelf, set }) {
  const g = shelfGeom(shelf);
  const setTiers = (v) => { const n = clamp(parseInt(v) || 1, 1, 12); set({ ...shelf, tiers: n, tierHeights: Array.from({ length: n }, (_, i) => shelf.tierHeights[i] ?? shelf.uniformH) }); };
  const setUniform = (v) => set({ ...shelf, uniformH: v, tierHeights: shelf.tierHeights.map(() => v) });
  const setTierH = (idx, v) => { const th = shelf.tierHeights.slice(); th[idx] = v; set({ ...shelf, tierHeights: th }); };

  return (
    <>
      <div className="spec-grid">
        <Field label="폭 W (cm)"><input className="inp" type="number" value={shelf.w} onChange={(e) => set({ ...shelf, w: e.target.value })} /></Field>
        <Field label="깊이 D (cm)"><input className="inp" type="number" value={shelf.d} onChange={(e) => set({ ...shelf, d: e.target.value })} /></Field>
        <Field label="단 수"><input className="inp" type="number" value={shelf.tiers} onChange={(e) => setTiers(e.target.value)} /></Field>
        <Field label="높이(일괄)"><input className="inp" type="number" value={shelf.uniformH} onChange={(e) => setUniform(e.target.value)} /></Field>
        <Field label="간격 높이(일괄)"><input className="inp" type="number" value={shelf.boardH} title="제품을 올려두는 선반판 두께" onChange={(e) => set({ ...shelf, boardH: e.target.value })} /></Field>
      </div>
      <div className="hint">‘높이’는 제품이 들어가는 공간, ‘간격 높이’는 선반판 두께. 단별로 다르면 아래에서 직접 입력.</div>
      <div className="sub-label">단별 높이 (cm · 위→아래)</div>
      <div className="tier-h-grid">
        {Array.from({ length: shelf.tiers }).map((_, k) => {
          const idx = shelf.tiers - 1 - k;
          return <label className="tier-h" key={k}><span>{k + 1}단</span><input className="inp sm" type="number" value={shelf.tierHeights[idx]} onChange={(e) => setTierH(idx, e.target.value)} /></label>;
        })}
      </div>
      <div className="opt-row">
        <label className="check"><input type="checkbox" checked={shelf.hasHeader} onChange={(e) => set({ ...shelf, hasHeader: e.target.checked })} /> 헤더 추가 (상단 돌출)</label>
        {shelf.hasHeader && <input className="inp sm w90" type="number" value={shelf.headerH} onChange={(e) => set({ ...shelf, headerH: e.target.value })} title="헤더 높이(cm)" />}
        {shelf.hasHeader && <span className="muted xs">cm</span>}
      </div>
      <div className="opt-row">
        <label className="check"><input type="checkbox" checked={shelf.hasBottom} onChange={(e) => set({ ...shelf, hasBottom: e.target.checked })} /> 하단 추가 (받침/수납부)</label>
        {shelf.hasBottom && <input className="inp sm w90" type="number" value={shelf.bottomH} onChange={(e) => set({ ...shelf, bottomH: e.target.value })} title="하단 높이(cm)" />}
        {shelf.hasBottom && <span className="muted xs">cm</span>}
      </div>
      <div className="total-readout">전체 높이 <b>{Math.round(g.totalH)}cm</b> · 폭 {g.w}cm · 깊이 {g.d}cm</div>
    </>
  );
}

/* =========================================================================
   프로젝트 목록 / 생성
   ========================================================================= */
function ProjectsView({ projects, onSave, onRemove, onOpen }) {
  const [form, setForm] = useState(null);
  const newDraft = () => ({ id: uid(), name: "", pharmacy: "", memo: "", shelf: normShelf({ w: 90, d: 35, tiers: 5, uniformH: 30, boardH: 3 }), placements: [] });

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="h1">프로젝트</h1><p className="muted">약국 처별로 하나씩. 각 처가 요청한 진열장 규격을 등록.</p></div>
        {!form && <button className="btn primary" onClick={() => setForm(newDraft())}>+ 새 프로젝트</button>}
      </div>

      {form && (
        <div className="card form-card">
          <div className="grid2">
            <Field label="약국명 (처)"><input className="inp" value={form.pharmacy} placeholder="예) OO온누리약국" onChange={(e) => setForm({ ...form, pharmacy: e.target.value })} /></Field>
            <Field label="프로젝트명 (선택)"><input className="inp" value={form.name} placeholder="예) 2026 가정의 달 매대" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          </div>
          <div className="sub-label">진열장 규격</div>
          <ShelfFields shelf={form.shelf} set={(sh) => setForm({ ...form, shelf: sh })} />
          <Field label="메모 (선택)"><input className="inp" value={form.memo} placeholder="요청 사항, 입점 조건 등" onChange={(e) => setForm({ ...form, memo: e.target.value })} /></Field>
          <div className="row-end">
            <button className="btn ghost" onClick={() => setForm(null)}>취소</button>
            <button className="btn primary" disabled={!form.pharmacy && !form.name} onClick={() => { onSave(form); setForm(null); }}>만들기</button>
          </div>
        </div>
      )}

      {projects.length === 0 && !form && <div className="empty">등록된 프로젝트가 없음. 새 프로젝트로 약국 진열장을 만들기.</div>}

      <div className="proj-grid">
        {projects.map((p) => {
          const sh = normShelf(p.shelf), g = shelfGeom(sh);
          return (
            <div className="card proj-card" key={p.id}>
              <div className="proj-mini"><MiniShelf shelf={sh} count={p.placements?.length || 0} /></div>
              <div className="proj-body">
                <div className="proj-name">{p.pharmacy || "(처 미입력)"}</div>
                <div className="muted sm">{p.name || "—"}</div>
                <div className="spec-chip">{g.w}×{Math.round(g.totalH)}×{g.d}cm · {sh.tiers}단{sh.hasHeader ? " · 헤더" : ""}{sh.hasBottom ? " · 하단" : ""}</div>
              </div>
              <div className="proj-actions">
                <button className="btn primary sm" onClick={() => onOpen(p.id)}>편집</button>
                <button className="btn danger-ghost sm" onClick={() => { if (confirm("이 프로젝트를 삭제할까요?")) onRemove(p.id); }}>삭제</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniShelf({ shelf, count }) {
  const g = shelfGeom(shelf);
  const W = 100, pad = 6, innerW = W - pad * 2;
  const ppc = clamp(innerW / g.w, 0.3, 120 / Math.max(1, g.totalH));
  const headerH = g.header * ppc, mainH = g.mainTop * ppc, baseH = g.base * ppc, fullH = g.totalH * ppc;
  return (
    <svg width={W} height={fullH + pad * 2}>
      {g.header > 0 && <rect x={pad - 1} y={pad - 1} width={innerW + 2} height={headerH} rx="2" className="mini-header" />}
      <rect x={pad - 2} y={pad + headerH} width={innerW + 4} height={mainH} rx="3" className="mini-frame" />
      {g.base > 0 && <rect x={pad} y={pad + headerH + mainH - baseH} width={innerW} height={baseH} className="mini-base" />}
      {g.boards.map((b, i) => <rect key={i} x={pad} y={pad + headerH + (g.mainTop - (b.bottom + b.h)) * ppc} width={innerW} height={Math.max(1.2, b.h * ppc)} className="mini-tier" />)}
      {Array.from({ length: Math.min(count, shelf.tiers * 3) }).map((_, i) => {
        const tier = Math.floor(i / 3), slot = i % 3;
        const fy = g.floors[Math.min(tier, g.floors.length - 1)];
        const bw = innerW / 3.4, bh = Math.min(12, num(shelf.tierHeights[tier], 20) * ppc * 0.6);
        return <rect key={"b" + i} x={pad + 3 + slot * (bw + 4)} y={pad + headerH + (g.mainTop - fy) * ppc - bh} width={bw} height={bh} rx="1.5" className="mini-box" />;
      })}
    </svg>
  );
}

/* =========================================================================
   제품 라이브러리
   ========================================================================= */
function LibraryView({ items, onSave, onRemove }) {
  const [edit, setEdit] = useState(null);
  const [tab, setTab] = useState("product");
  const [q, setQ] = useState("");
  const blank = (type) => ({ id: uid(), type, name: "", brand: "", w: 6, h: 9, d: 3, images: { front: null, back: null, left: null, right: null } });
  const dup = (it) => onSave({ ...it, id: uid(), name: (it.name || (it.type === "posm" ? "POSM" : "제품")) + " 사본", images: { ...it.images } });
  const shown = items.filter((i) => i.type === tab).filter((it) => { const s = q.trim().toLowerCase(); return !s || (it.name || "").toLowerCase().includes(s) || (it.brand || "").toLowerCase().includes(s); });

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="h1">제품 라이브러리</h1><p className="muted">규격과 면별 이미지를 등록해두면 모든 프로젝트에서 재사용.</p></div>
        {!edit && <div className="row"><button className="btn ghost" onClick={() => setEdit(blank("posm"))}>+ POSM</button><button className="btn primary" onClick={() => setEdit(blank("product"))}>+ 제품</button></div>}
      </div>
      {edit && <ItemEditor draft={edit} onCancel={() => setEdit(null)} onSave={(it) => { onSave(it); setEdit(null); }} />}
      {!edit && (
        <>
          <div className="lib-toolbar">
            <div className="seg">
              <button className={"seg-btn" + (tab === "product" ? " on" : "")} onClick={() => setTab("product")}>제품 ({items.filter(i => i.type === "product").length})</button>
              <button className={"seg-btn" + (tab === "posm" ? " on" : "")} onClick={() => setTab("posm")}>POSM ({items.filter(i => i.type === "posm").length})</button>
            </div>
            <input className="inp sm lib-search" placeholder="이름·브랜드 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {shown.length === 0 && <div className="empty">{q ? "검색 결과 없음." : `${tab === "product" ? "제품" : "POSM"}이 없음. 위 버튼으로 추가.`}</div>}
          <div className="lib-grid">
            {shown.map((it) => (
              <div className="card lib-card" key={it.id}>
                <div className="lib-thumb">{it.images?.front ? <img src={it.images.front} alt={it.name} /> : <div className="thumb-ph">{it.name?.slice(0, 4) || "?"}</div>}</div>
                <div className="lib-name">{it.name || "(이름 없음)"}</div>
                <div className="muted sm">{it.brand || (it.type === "posm" ? "POSM" : "제품")} · {it.w}×{it.h}×{it.d}cm</div>
                <div className="row-end gap6">
                  <button className="btn ghost sm" onClick={() => setEdit({ ...it, images: { ...it.images } })}>수정</button>
                  <button className="btn ghost sm" onClick={() => dup(it)}>사본</button>
                  <button className="btn danger-ghost sm" onClick={() => { if (confirm("삭제할까요?")) onRemove(it.id); }}>삭제</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ItemEditor({ draft, onCancel, onSave }) {
  const [d, setD] = useState(draft);
  const setImg = async (face, file) => { if (!file) return; try { const url = await storeImage(file); setD((p) => ({ ...p, images: { ...p.images, [face]: url } })); } catch { alert("이미지를 불러오지 못했습니다."); } };
  return (
    <div className="card form-card">
      <div className="grid2">
        <Field label={d.type === "posm" ? "POSM 이름" : "제품명"}><input className="inp" value={d.name} placeholder={d.type === "posm" ? "예) 가정의 달 포스터" : "예) 우루사 정"} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label={d.type === "posm" ? "구분 (선택)" : "브랜드 (선택)"}><input className="inp" value={d.brand} placeholder={d.type === "posm" ? "포스터 / 웨블러 / 쇼카드" : "예) 우루사"} onChange={(e) => setD({ ...d, brand: e.target.value })} /></Field>
      </div>
      <div className="sub-label">규격 (cm)</div>
      <div className="grid3">
        <Field label="가로 W"><input className="inp" type="number" value={d.w} onChange={(e) => setD({ ...d, w: num(e.target.value, 1) })} /></Field>
        <Field label="세로 H"><input className="inp" type="number" value={d.h} onChange={(e) => setD({ ...d, h: num(e.target.value, 1) })} /></Field>
        <Field label="깊이 D"><input className="inp" type="number" value={d.d} onChange={(e) => setD({ ...d, d: num(e.target.value, 1) })} /></Field>
      </div>
      <div className="sub-label">면별 이미지 (배경 투명 PNG 권장)</div>
      <div className="grid4">
        {FACES.map((f) => (
          <div className="img-slot" key={f}>
            <div className="img-slot-label">{FACE_KR[f]}</div>
            <label className="img-drop">
              {d.images?.[f] ? <img src={d.images[f]} alt={f} /> : <span className="img-plus">＋</span>}
              <input type="file" accept="image/*" hidden onChange={(e) => setImg(f, e.target.files?.[0])} />
            </label>
            {d.images?.[f] && <button className="link-btn" onClick={() => setD((p) => ({ ...p, images: { ...p.images, [f]: null } }))}>제거</button>}
          </div>
        ))}
      </div>
      <div className="row-end">
        <button className="btn ghost" onClick={onCancel}>취소</button>
        <button className="btn primary" disabled={!d.name} onClick={() => onSave(d)}>저장</button>
      </div>
    </div>
  );
}

/* =========================================================================
   에디터 (시뮬레이터)
   ========================================================================= */
function EditorView({ project, items, onSave, goLibrary }) {
  const [shelf, setShelf] = useState(normShelf(project.shelf));
  const [placements, setPlacements] = useState((project.placements || []).map((p) => ({ depthCount: 1, colCount: 1, sideXCm: 0, depthStartCm: 0, ...p })));
  const [selIds, setSelIds] = useState([]);
  const [paletteTab, setPaletteTab] = useState("product");
  const [snap, setSnap] = useState(true);
  const [vmode, setVmode] = useState("front"); // front | side
  const [focusTier, setFocusTier] = useState(null);
  const [palQuery, setPalQuery] = useState("");
  const [marquee, setMarquee] = useState(null);
  const boardRef = useRef(null);
  const [boardW, setBoardW] = useState(720);
  const [busy, setBusy] = useState(false);
  const dragRef = useRef(null);

  const itemsById = Object.fromEntries(items.map((i) => [i.id, i]));
  const g = shelfGeom(shelf);
  const isFront = vmode === "front";
  const viewW = isFront ? g.w : g.d;
  const ft = (focusTier != null && focusTier >= 0 && focusTier < g.tiers) ? focusTier : null;
  const vpBot = ft != null ? g.boards[ft].bottom : 0;
  const vpTop = ft != null ? (ft < g.tiers - 1 ? g.boards[ft + 1].bottom : g.mainTop) : g.totalH;
  const vpH = Math.max(1, vpTop - vpBot);
  const maxH = 540;
  const ppc = Math.max(1.1, Math.min((boardW - 8) / Math.max(1, viewW), maxH / Math.max(1, vpH)));

  const frontW = (it, face) => (face === "front" || face === "back") ? num(it.w) : num(it.d);
  const blockW = (it, face, col) => frontW(it, face) * Math.max(1, col || 1);
  const maxFitP = (it, start) => Math.max(1, Math.floor((g.d - num(start, 0)) / Math.max(1, num(it.d, 1))));
  const maxColFit = (it, face) => Math.max(1, Math.floor(g.w / Math.max(1, frontW(it, face))));
  const horizField = (it) => isFront ? "xCm" : (it.type === "posm" ? "sideXCm" : "depthStartCm");
  const getH = (p) => num(p[horizField(itemsById[p.itemId])], 0);
  const itemW = (p) => { const it = itemsById[p.itemId]; return isFront ? blockW(it, p.face, p.colCount) : (it.type === "posm" ? num(it.d) : num(it.d) * Math.max(1, p.depthCount || 1)); };

  useEffect(() => {
    const measure = () => { if (boardRef.current) setBoardW(boardRef.current.clientWidth); };
    measure();
    const ro = new ResizeObserver(measure);
    if (boardRef.current) ro.observe(boardRef.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { const t = setTimeout(() => onSave({ ...project, shelf, placements }), 300); return () => clearTimeout(t); }, [shelf, placements]); // eslint-disable-line

  const addItem = (it) => {
    const w = frontW(it, "front");
    const xCm = clamp(g.w / 2 - w / 2, 0, Math.max(0, g.w - w));
    const yCm = it.type === "posm"
      ? (g.header > 0 ? clamp(g.mainTop + (g.header - num(it.h)) / 2, 0, g.totalH - num(it.h)) : clamp(g.totalH - num(it.h) - 4, 0, g.totalH - num(it.h)))
      : g.floors[0];
    const z = placements.reduce((m, p) => Math.max(m, p.z), 0) + 1;
    const np = { id: uid(), itemId: it.id, face: "front", xCm, yCm, z, depthCount: 1, colCount: 1, sideXCm: 0, depthStartCm: 0 };
    setPlacements((p) => [...p, np]); setSelIds([np.id]);
  };
  const updateP = (id, patch) => setPlacements((ps) => ps.map((p) => p.id === id ? { ...p, ...patch } : p));
  const removeP = (id) => { setPlacements((ps) => ps.filter((p) => p.id !== id)); setSelIds((s) => s.filter((x) => x !== id)); };
  const removeSel = () => { setPlacements((ps) => ps.filter((p) => !selIds.includes(p.id))); setSelIds([]); };
  const bringFront = (id) => updateP(id, { z: placements.reduce((m, p) => Math.max(m, p.z), 0) + 1 });
  const sendBack = (id) => updateP(id, { z: placements.reduce((m, p) => Math.min(m, p.z), 0) - 1 });
  const duplicateP = (id) => { const s = placements.find((p) => p.id === id); if (!s) return; const z = placements.reduce((m, p) => Math.max(m, p.z), 0) + 1; const np = { ...s, id: uid(), xCm: clamp(num(s.xCm, 0) + 3, 0, g.w), z }; setPlacements((p) => [...p, np]); setSelIds([np.id]); };
  const cycleFace = (id) => { const p = placements.find((x) => x.id === id); if (!p) return; const it = itemsById[p.itemId]; if (!it) return; const next = FACES[(FACES.indexOf(p.face) + 1) % 4]; updateP(id, { face: next, xCm: clamp(num(p.xCm, 0), 0, Math.max(0, g.w - blockW(it, next, p.colCount))) }); };
  const setDepth = (id, v) => { const p = placements.find((x) => x.id === id); if (!p) return; const it = itemsById[p.itemId]; updateP(id, { depthCount: clamp(v, 1, maxFitP(it, p.depthStartCm)) }); };
  const setCol = (id, v) => { const p = placements.find((x) => x.id === id); if (!p) return; const it = itemsById[p.itemId]; const c = clamp(v, 1, maxColFit(it, p.face)); updateP(id, { colCount: c, xCm: clamp(num(p.xCm, 0), 0, Math.max(0, g.w - c * frontW(it, p.face))) }); };
  const fillRow = (id) => { const p = placements.find((x) => x.id === id); if (!p) return; const it = itemsById[p.itemId]; updateP(id, { colCount: maxColFit(it, p.face), xCm: 0 }); };
  const moveBy = (id, dir) => {
    const sorted = [...placements].sort((a, b) => b.z - a.z);
    const i = sorted.findIndex((p) => p.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    const n = sorted.length, zmap = {}; sorted.forEach((p, idx) => { zmap[p.id] = n - idx; });
    setPlacements((prev) => prev.map((p) => ({ ...p, z: zmap[p.id] ?? p.z })));
  };
  const clickSelect = (e, id) => { if (e.shiftKey || e.ctrlKey || e.metaKey) setSelIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]); else setSelIds([id]); };

  const nearestOf = (arr, v) => arr.reduce((b, f) => Math.abs(f - v) < Math.abs(b - v) ? f : b, arr[0]);

  const startDrag = (e, p, mode) => {
    e.stopPropagation();
    const it = itemsById[p.itemId];
    const rect = boardRef.current.getBoundingClientRect();
    if (e.shiftKey || e.ctrlKey || e.metaKey) { setSelIds((s) => s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]); return; }
    if (mode === "count") {
      setSelIds([p.id]);
      dragRef.current = { mode: "count", id: p.id, it, depthStart: num(p.depthStartCm || 0) };
      e.currentTarget.setPointerCapture?.(e.pointerId); return;
    }
    const group = selIds.includes(p.id) && selIds.length > 1 ? selIds : [p.id];
    if (!(selIds.includes(p.id) && selIds.length > 1)) setSelIds([p.id]);
    const starts = {};
    for (const id of group) { const q = placements.find((x) => x.id === id); if (!q) continue; starts[id] = { h: getH(q), y: num(q.yCm, 0), it: itemsById[q.itemId], w: itemW(q) }; }
    const h = num(it.h), left0 = getH(p), dimW = itemW(p);
    dragRef.current = { mode: "body", id: p.id, it, dim: { w: dimW, h }, group, starts, grabX: (e.clientX - rect.left) - left0 * ppc, grabY: (e.clientY - rect.top) - (vpTop - num(p.yCm, 0) - h) * ppc, lastH: left0, lastY: num(p.yCm, 0) };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onBoardDown = (e) => {
    const rect = boardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) setSelIds([]);
    dragRef.current = { mode: "marquee" };
    setMarquee({ x0: x, y0: y, x1: x, y1: y });
  };

  const onMove = (e) => {
    const dg = dragRef.current; if (!dg) return;
    const rect = boardRef.current.getBoundingClientRect();
    if (dg.mode === "marquee") { setMarquee((m) => m && { ...m, x1: e.clientX - rect.left, y1: e.clientY - rect.top }); return; }
    if (dg.mode === "count") {
      const unit = Math.max(1, num(dg.it.d, 1)), start = dg.depthStart || 0;
      const depthCm = (e.clientX - rect.left) / ppc;
      const mx = Math.max(1, Math.floor((g.d - start) / unit));
      updateP(dg.id, { depthCount: clamp(Math.round((depthCm - start) / unit), 1, mx) });
      return;
    }
    const newH = clamp(((e.clientX - rect.left) - dg.grabX) / ppc, 0, Math.max(0, viewW - dg.dim.w));
    const newY = clamp(vpTop - ((e.clientY - rect.top) - dg.grabY) / ppc - dg.dim.h, vpBot, Math.max(vpBot, vpTop - dg.dim.h));
    const dH = newH - dg.starts[dg.id].h, dY = newY - dg.starts[dg.id].y;
    for (const id of dg.group) { const st = dg.starts[id]; if (!st) continue; const f = horizField(st.it); updateP(id, { [f]: clamp(st.h + dH, 0, Math.max(0, viewW - st.w)), yCm: clamp(st.y + dY, vpBot, Math.max(vpBot, vpTop - num(st.it.h))) }); }
    dg.lastH = newH; dg.lastY = newY;
  };

  const onUp = () => {
    const dg = dragRef.current; if (!dg) { return; }
    if (dg.mode === "marquee") {
      const m = marquee;
      if (m && (Math.abs(m.x1 - m.x0) > 4 || Math.abs(m.y1 - m.y0) > 4)) {
        const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
        const ids = [];
        for (const p of placements) { const it = itemsById[p.itemId]; if (!it) continue; const w = itemW(p) * ppc, left = getH(p) * ppc, top = (vpTop - num(p.yCm, 0) - num(it.h)) * ppc, ht = num(it.h) * ppc; if (left < x1 && left + w > x0 && top < y1 && top + ht > y0) ids.push(p.id); }
        setSelIds(ids);
      }
      setMarquee(null); dragRef.current = null; return;
    }
    if (dg.mode === "body" && snap) {
      const it = dg.it, h = num(it.h), isGroup = dg.group.length > 1;
      let snapY = dg.lastY, snapH = dg.lastH;
      const exclude = new Set(dg.group);
      const floorsV = ft != null ? g.floors.filter((f) => f >= vpBot - 0.5 && f <= vpTop + 0.5) : g.floors;
      const floorsUse = floorsV.length ? floorsV : g.floors;
      if (isFront) {
        if (it.type === "product") {
          const sup = [...floorsUse];
          for (const q of placements) { if (exclude.has(q.id)) continue; const qi = itemsById[q.itemId]; if (!qi) continue; const qw = blockW(qi, q.face, q.colCount); if (num(q.xCm, 0) < dg.lastH + dg.dim.w && num(q.xCm, 0) + qw > dg.lastH) sup.push(num(q.yCm, 0) + num(qi.h)); }
          snapY = clamp(nearestOf(sup, dg.lastY), vpBot, Math.max(vpBot, vpTop - h));
        } else { const nf = nearestOf(floorsUse, dg.lastY); if (Math.abs(nf - dg.lastY) <= 6) snapY = clamp(nf, vpBot, Math.max(vpBot, vpTop - h)); }
        if (!isGroup) {
          const others = [];
          for (const q of placements) { if (exclude.has(q.id)) continue; const qi = itemsById[q.itemId]; if (!qi) continue; const qy = num(q.yCm, 0), qh = num(qi.h); if (qy < snapY + h && qy + qh > snapY) others.push({ xL: num(q.xCm, 0), xR: num(q.xCm, 0) + blockW(qi, q.face, q.colCount) }); }
          let x = dg.lastH; const thr = 5, w = dg.dim.w, cands = [0, g.w - w];
          for (const o of others) { cands.push(o.xR); cands.push(o.xL - w); }
          let best = null, bestD = thr; for (const c of cands) { const d = Math.abs(c - x); if (d < bestD) { bestD = d; best = c; } }
          if (best != null) x = best;
          for (let i = 0; i < 8; i++) { let moved = false; for (const o of others) { if (x < o.xR && x + w > o.xL) { const tl = o.xL - w, tr = o.xR; x = Math.abs(tl - x) <= Math.abs(tr - x) ? tl : tr; moved = true; } } if (!moved) break; }
          snapH = clamp(x, 0, Math.max(0, g.w - w));
        }
      } else {
        if (it.type === "product") {
          const sup = [...floorsUse];
          for (const q of placements) { if (exclude.has(q.id)) continue; const qi = itemsById[q.itemId]; if (!qi) continue; sup.push(num(q.yCm, 0) + num(qi.h)); }
          snapY = clamp(nearestOf(sup, dg.lastY), vpBot, Math.max(vpBot, vpTop - h));
        }
      }
      const dH = snapH - dg.lastH, dY = snapY - dg.lastY;
      if (dH || dY) {
        setPlacements((ps) => ps.map((p) => {
          if (!dg.group.includes(p.id)) return p;
          const st = dg.starts[p.id]; const f = horizField(st.it);
          return { ...p, [f]: clamp(num(p[f], 0) + dH, 0, Math.max(0, viewW - st.w)), yCm: clamp(num(p.yCm, 0) + dY, vpBot, Math.max(vpBot, vpTop - num(st.it.h))) };
        }));
      }
    }
    dragRef.current = null;
  };

  const exportPng = async () => {
    setBusy(true);
    try {
      const sc = 3, W = Math.round(g.w * sc), H = Math.round(g.totalH * sc);
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      const headerPx = g.header * sc, basePx = g.base * sc;
      if (g.header > 0) { ctx.fillStyle = "#0f8a7e"; ctx.fillRect(0, 0, W, headerPx); ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(0, headerPx - 4 * sc, W, 4 * sc); }
      ctx.fillStyle = "#efe7d6"; ctx.fillRect(0, headerPx, W, H - headerPx);
      g.boards.forEach((b) => { const top = (g.totalH - (b.bottom + b.h)) * sc; ctx.fillStyle = "#cbb083"; ctx.fillRect(0, top, W, Math.max(2, b.h * sc)); ctx.fillStyle = "rgba(0,0,0,.16)"; ctx.fillRect(0, top + Math.max(2, b.h * sc), W, 3 * sc); });
      if (g.base > 0) { ctx.fillStyle = "#b89a6b"; ctx.fillRect(0, H - basePx, W, basePx); ctx.strokeStyle = "rgba(0,0,0,.2)"; ctx.lineWidth = sc; ctx.strokeRect(W * 0.08, H - basePx + basePx * 0.25, W * 0.84, basePx * 0.5); }
      ctx.strokeStyle = "#8a6d43"; ctx.lineWidth = 5 * sc; ctx.strokeRect(0, headerPx, W, H - headerPx);
      for (const p of [...placements].sort((a, b) => a.z - b.z)) {
        const it = itemsById[p.itemId]; if (!it) continue;
        const fw = frontW(it, p.face), dw = fw * sc, dh = num(it.h) * sc, col = Math.max(1, p.colCount || 1);
        const left = num(p.xCm, 0) * sc, top = (g.totalH - num(p.yCm, 0) - num(it.h)) * sc;
        const src = it.images?.[p.face];
        const drawUnit = async (x, y, alpha) => {
          ctx.globalAlpha = alpha;
          if (src) { try { ctx.drawImage(await loadImg(src), x, y, dw, dh); ctx.globalAlpha = 1; return; } catch {} }
          ctx.fillStyle = it.type === "posm" ? "#dceee9" : "#fff"; ctx.strokeStyle = "#0f8a7e"; ctx.lineWidth = 1.5 * sc;
          ctx.fillRect(x, y, dw, dh); ctx.strokeRect(x, y, dw, dh);
          ctx.fillStyle = "#1c2b2d"; ctx.font = `${Math.max(10, dw * 0.18)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText((it.name || "").slice(0, 6), x + dw / 2, y + dh / 2); ctx.globalAlpha = 1;
        };
        const drawRow = async (dx, dy, alpha) => { for (let cc = 0; cc < col; cc++) await drawUnit(left + cc * dw + dx, top + dy, alpha); };
        const back = Math.min((p.depthCount || 1) - 1, 5);
        const off = Math.max(3, Math.min(11, dh * 0.09));
        for (let k = back; k >= 1; k--) await drawRow(off * k * 0.8, -off * k, Math.max(0.25, 0.6 - k * 0.08));
        await drawRow(0, 0, 1);
      }
      const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = `VMD_${project.pharmacy || project.name || "mockup"}.png`; a.click();
    } finally { setBusy(false); }
  };

  const selId = selIds.length === 1 ? selIds[0] : null;
  const sel = placements.find((p) => p.id === selId);
  const selItem = sel ? itemsById[sel.itemId] : null;
  const paletteItems = items.filter((i) => i.type === paletteTab).filter((it) => { const q = palQuery.trim().toLowerCase(); return !q || (it.name || "").toLowerCase().includes(q) || (it.brand || "").toLowerCase().includes(q); });

  const renderPlacement = (p) => {
    const it = itemsById[p.itemId]; if (!it) return null;
    const h = num(it.h), top = (vpTop - num(p.yCm, 0) - h) * ppc, sel0 = selIds.includes(p.id);
    if (isFront) {
      const w = frontW(it, p.face), col = Math.max(1, p.colCount || 1), src = it.images?.[p.face];
      const back = Math.min((p.depthCount || 1) - 1, 5);
      const off = Math.max(3, Math.min(11, h * ppc * 0.09));
      const rowUnits = (cls, key) => (
        <div className={cls} key={key}>
          {Array.from({ length: col }).map((_, c) => (
            <div className="col-unit" style={{ left: c * w * ppc, width: w * ppc }} key={c}>
              {src ? <img src={src} alt="" draggable={false} /> : <div className="pl-ph">{it.name?.slice(0, 5)}</div>}
            </div>
          ))}
        </div>
      );
      return (
        <div key={p.id} className={"placement" + (sel0 ? " sel" : "") + (it.type === "posm" ? " posm" : "") + (back > 0 ? " has-depth" : "")}
          style={{ left: num(p.xCm, 0) * ppc, top, width: w * col * ppc, height: h * ppc, zIndex: 100 + p.z }}
          onPointerDown={(e) => startDrag(e, p, "body")}>
          {Array.from({ length: back }).map((_, k) => { const o = back - k; return (
            <div key={"bh" + k} className="behind" style={{ transform: `translate(${off * o * 0.8}px, ${-off * o}px)`, opacity: Math.max(0.22, 0.55 - o * 0.07) }}>{rowUnits("behind-row", k)}</div>); })}
          {rowUnits("frontface", "f")}
        </div>
      );
    } else {
      if (it.type === "posm") {
        const sw = num(it.d), src = it.images?.left || it.images?.right;
        return (
          <div key={p.id} className={"placement side-posm posm" + (sel0 ? " sel" : "")}
            style={{ left: num(p.sideXCm || 0) * ppc, top, width: sw * ppc, height: h * ppc, zIndex: 100 + p.z }}
            onPointerDown={(e) => startDrag(e, p, "body")}>
            <div className="frontface">{src ? <img src={src} alt={it.name} draggable={false} /> : <div className="pl-ph">{it.name?.slice(0, 3)}</div>}</div>
          </div>
        );
      }
      const unit = Math.max(1, num(it.d, 1)), cnt = p.depthCount || 1;
      const sideSrc = it.images?.left || it.images?.right || it.images?.front;
      return (
        <div key={p.id} className={"placement side" + (sel0 ? " sel" : "")}
          style={{ left: num(p.depthStartCm || 0) * ppc, top, width: unit * cnt * ppc, height: h * ppc, zIndex: 100 + p.z }}
          onPointerDown={(e) => startDrag(e, p, "body")}>
          {Array.from({ length: cnt }).map((_, k) => (
            <div key={k} className="depth-unit" style={{ left: k * unit * ppc, width: unit * ppc }}>
              {sideSrc ? <img src={sideSrc} alt="" draggable={false} /> : <div className="pl-ph">{it.name?.slice(0, 3)}</div>}
            </div>
          ))}
          <div className="depth-handle" onPointerDown={(e) => startDrag(e, p, "count")} title="끌어서 깊이 진열 수 조절" />
        </div>
      );
    }
  };

  return (
    <div className="editor">
      <aside className="palette">
        <div className="pal-head"><span>구성 요소</span><button className="link-btn" onClick={goLibrary}>+ 라이브러리</button></div>
        <div className="seg sm">
          <button className={"seg-btn" + (paletteTab === "product" ? " on" : "")} onClick={() => setPaletteTab("product")}>제품</button>
          <button className={"seg-btn" + (paletteTab === "posm" ? " on" : "")} onClick={() => setPaletteTab("posm")}>POSM</button>
        </div>
        <input className="inp sm pal-search" placeholder="이름·브랜드 검색" value={palQuery} onChange={(e) => setPalQuery(e.target.value)} />
        <div className="pal-list">
          {paletteItems.length === 0 && <div className="pal-empty">{palQuery ? "검색 결과 없음." : `라이브러리에 ${paletteTab === "product" ? "제품" : "POSM"}이 없음.`}</div>}
          {paletteItems.map((it) => (
            <button className="pal-item" key={it.id} onClick={() => addItem(it)} title="클릭해서 매대에 추가">
              <div className="pal-thumb">{it.images?.front ? <img src={it.images.front} alt="" /> : <span>{it.name?.slice(0, 2)}</span>}</div>
              <div className="pal-meta"><div className="pal-name">{it.name}</div><div className="muted xs">{it.w}×{it.h}×{it.d}</div></div>
            </button>
          ))}
        </div>
      </aside>

      <section className="canvas-col">
        <div className="canvas-toolbar">
          <div className="ct-left">
            <div className="seg sm view-toggle">
              <button className={"seg-btn" + (isFront ? " on" : "")} onClick={() => setVmode("front")}>정면</button>
              <button className={"seg-btn" + (!isFront ? " on" : "")} onClick={() => setVmode("side")}>측면</button>
            </div>
            <span className="spec-chip">{isFront ? `폭 ${g.w}` : `깊이 ${g.d}`}×{Math.round(g.totalH)}cm · {g.tiers}단</span>
            <select className="tier-select" value={ft == null ? "all" : ft} onChange={(e) => setFocusTier(e.target.value === "all" ? null : Number(e.target.value))}>
              <option value="all">전체 보기</option>
              {Array.from({ length: g.tiers }).map((_, k) => { const i = g.tiers - 1 - k; return <option key={i} value={i}>{k + 1}단 확대</option>; })}
            </select>
            <label className="check"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> 자석 정렬</label>
          </div>
          <button className="btn primary sm" disabled={busy} onClick={exportPng}>{busy ? "생성 중…" : "시안 PNG 저장"}</button>
        </div>
        <div className="board-wrap" ref={boardRef}>
          <div className={"board" + (isFront ? "" : " side-dim") + (ft != null ? " zoom" : "")} style={{ width: viewW * ppc, height: vpH * ppc }}
            onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onPointerDown={onBoardDown}>
            {g.header > 0 && <div className="topper" style={{ bottom: (g.mainTop - vpBot) * ppc, height: g.header * ppc }}>{isFront ? "HEADER" : "측면"}</div>}
            <div className="frame" style={{ bottom: (0 - vpBot) * ppc, height: g.mainTop * ppc }}>
              {g.base > 0 && <div className="base" style={{ height: g.base * ppc }}><span className="base-handle" /></div>}
              {g.boards.map((b, i) => <div key={i} className="board-plate" style={{ bottom: b.bottom * ppc, height: Math.max(2, b.h * ppc) }} />)}
            </div>
            {[...placements].sort((a, b) => a.z - b.z).map(renderPlacement)}
            {marquee && <div className="marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />}
            {placements.length === 0 && <div className="board-hint">왼쪽에서 제품/POSM을 클릭해 매대에 올리기</div>}
            {!isFront && <div className="side-axis">◀ 앞　　　뒤 ▶</div>}
          </div>
        </div>
      </section>

      <aside className="inspector">
        <div className="insp-block">
          <div className="insp-title">진열장 규격</div>
          <ShelfFields shelf={shelf} set={setShelf} />
        </div>
        {selIds.length > 1 ? (
          <div className="insp-block">
            <div className="insp-title">그룹 선택 · {selIds.length}개</div>
            <div className="muted sm">매대에서 끌면 함께 이동. 드롭 시 단에 맞춰 정렬.</div>
            <button className="btn danger-ghost sm full" onClick={removeSel}>선택 항목 모두 삭제</button>
          </div>
        ) : (
          <div className="insp-block">
            <div className="insp-title">선택 요소</div>
            {!sel && <div className="muted sm">매대에서 요소를 선택. (Shift·드래그로 여러 개)</div>}
            {sel && selItem && (
              <>
                <div className="sel-name">{selItem.name}</div>
                <div className="muted xs">{FACE_KR[sel.face]} · {frontW(selItem, sel.face)}×{selItem.h}cm · 깊이 {selItem.d}cm</div>
                <div className="readout"><span>{isFront ? "좌측" : "앞에서"} {Math.round(getH(sel))}cm</span><span>바닥 {Math.round(num(sel.yCm, 0))}cm</span></div>
                {selItem.type === "product" && (
                  <div className="depth-box">
                    <div className="depth-line"><span>가로 진열</span>
                      <div className="depth-ctrl">
                        <button className="btn ghost sm" onClick={() => setCol(sel.id, (sel.colCount || 1) - 1)}>−</button>
                        <span className="cnt">{sel.colCount || 1}</span>
                        <button className="btn ghost sm" onClick={() => setCol(sel.id, (sel.colCount || 1) + 1)}>＋</button>
                        <button className="btn ghost sm" onClick={() => fillRow(sel.id)}>꽉</button>
                      </div>
                    </div>
                    <div className="muted xs">폭 {(sel.colCount || 1) * frontW(selItem, sel.face)}/{g.w}cm · 최대 {maxColFit(selItem, sel.face)}개</div>
                  </div>
                )}
                {selItem.type === "product" && (
                  <div className="depth-box">
                    <div className="depth-line"><span>깊이 진열</span>
                      <div className="depth-ctrl">
                        <button className="btn ghost sm" onClick={() => setDepth(sel.id, (sel.depthCount || 1) - 1)}>−</button>
                        <span className="cnt">{sel.depthCount || 1}</span>
                        <button className="btn ghost sm" onClick={() => setDepth(sel.id, (sel.depthCount || 1) + 1)}>＋</button>
                        <button className="btn ghost sm" onClick={() => setDepth(sel.id, maxFitP(selItem, sel.depthStartCm))}>최대</button>
                      </div>
                    </div>
                    <div className="muted xs">깊이 {Math.round(num(sel.depthStartCm, 0) + (sel.depthCount || 1) * num(selItem.d))}/{g.d}cm · 남은공간 최대 {maxFitP(selItem, sel.depthStartCm)}개</div>
                  </div>
                )}
                <div className="ctrl-grid">
                  <button className="btn ghost sm" onClick={() => cycleFace(sel.id)}>면 회전 ↻</button>
                  <button className="btn ghost sm" onClick={() => duplicateP(sel.id)}>복제</button>
                  <button className="btn ghost sm" onClick={() => bringFront(sel.id)}>맨 앞</button>
                  <button className="btn ghost sm" onClick={() => sendBack(sel.id)}>맨 뒤</button>
                </div>
                <button className="btn danger-ghost sm full" onClick={() => removeP(sel.id)}>삭제</button>
              </>
            )}
          </div>
        )}
        <div className="insp-block">
          <div className="insp-title">배치 목록 ({placements.length})</div>
          <div className="place-list">
            {placements.length === 0 && <div className="muted sm">없음</div>}
            {[...placements].sort((a, b) => b.z - a.z).map((p, idx, arr) => {
              const it = itemsById[p.itemId];
              return (
                <div key={p.id} className={"place-row" + (selIds.includes(p.id) ? " on" : "")}>
                  <button className="pr-main" onClick={(e) => clickSelect(e, p.id)}>
                    <span className="pr-name">{it?.name || "(삭제됨)"}</span>
                    <span className="muted xs">{[(p.colCount || 1) > 1 ? `가로${p.colCount}` : null, (p.depthCount || 1) > 1 ? `깊이${p.depthCount}` : null].filter(Boolean).join(" ") || FACE_KR[p.face]}</span>
                  </button>
                  <div className="pr-arrows">
                    <button disabled={idx === 0} onClick={() => moveBy(p.id, -1)} title="앞으로">▲</button>
                    <button disabled={idx === arr.length - 1} onClick={() => moveBy(p.id, 1)} title="뒤로">▼</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }) { return <label className="field"><span className="field-label">{label}</span>{children}</label>; }

/* =========================================================================
   스타일
   ========================================================================= */
function StyleTag() {
  return (
    <style>{`
:root{
  --bg:#eceef0; --panel:#fff; --ink:#1c2b2d; --muted:#6b7b7d;
  --line:#dde3e3; --accent:#0f8a7e; --accent-d:#0b6f65; --accent-soft:#e3f2ef;
  --danger:#c0492f; --wood-edge:#8a6d43; --wood-line:#c2a376;
  --shadow:0 1px 3px rgba(20,40,40,.08),0 6px 18px rgba(20,40,40,.06);
}
*{box-sizing:border-box}
.vmd-root{font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',-apple-system,system-ui,sans-serif;color:var(--ink);background:var(--bg);min-height:100vh;font-size:14px;-webkit-font-smoothing:antialiased}
.vmd-root button{font-family:inherit;cursor:pointer}
h1,p{margin:0}
.topbar{display:flex;align-items:center;gap:20px;padding:12px 20px;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:50;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:11px}
.logo-dot{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--accent-d));box-shadow:inset 0 0 0 3px rgba(255,255,255,.35);flex:none}
.brand-title{font-weight:700;letter-spacing:-.01em} .brand-sub{font-size:11.5px;color:var(--muted)}
.tabs{display:flex;gap:4px;margin-left:8px}
.tab{border:none;background:transparent;padding:8px 14px;border-radius:9px;color:var(--muted);font-weight:600;font-size:13px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tab:hover{color:var(--ink);background:var(--bg)} .tab.on{color:var(--accent-d);background:var(--accent-soft)}
.warn-pill{margin-left:auto;font-size:11px;color:var(--danger);background:#fbe9e4;padding:4px 10px;border-radius:20px;font-weight:600}
.loading,.empty{padding:60px 20px;text-align:center;color:var(--muted)}
.empty{margin:24px 20px;background:var(--panel);border:1px dashed var(--line);border-radius:14px}
.page{max-width:1120px;margin:0 auto;padding:28px 24px 60px}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:20px;flex-wrap:wrap}
.h1{font-size:22px;font-weight:750;letter-spacing:-.02em}
.muted{color:var(--muted)} .sm{font-size:12.5px} .xs{font-size:11px}
.btn{border:1px solid transparent;padding:9px 16px;border-radius:10px;font-weight:650;font-size:13px;transition:.12s}
.btn.sm{padding:6px 12px;font-size:12.5px;border-radius:8px} .btn.full{width:100%;margin-top:8px}
.btn.primary{background:var(--accent);color:#fff} .btn.primary:hover{background:var(--accent-d)} .btn.primary:disabled{background:#a9c6c1;cursor:not-allowed}
.btn.ghost{background:var(--panel);border-color:var(--line);color:var(--ink)} .btn.ghost:hover{border-color:var(--accent);color:var(--accent-d)}
.btn.danger-ghost{background:transparent;color:var(--danger)} .btn.danger-ghost:hover{background:#fbe9e4}
.row{display:flex;gap:8px} .row-end{display:flex;justify-content:flex-end;gap:10px;margin-top:16px} .gap6{gap:6px;margin-top:10px}
.link-btn{border:none;background:none;color:var(--accent-d);font-weight:600;font-size:12px;padding:2px 0} .link-btn:hover{text-decoration:underline}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}
.form-card{padding:20px;margin-bottom:24px}
.field{display:flex;flex-direction:column;gap:5px}
.field-label{font-size:12px;font-weight:600;color:var(--muted)}
.inp{border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-size:13.5px;background:#fcfdfd;color:var(--ink);width:100%}
.inp.sm{padding:7px 9px;font-size:13px} .inp.w90{width:90px}
.inp:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.spec-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px}
.hint{font-size:11px;color:var(--muted);margin-top:7px;line-height:1.45}
.sub-label{font-size:12px;font-weight:700;color:var(--ink);margin:16px 0 8px}
.tier-h-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px;margin-bottom:6px}
.tier-h{display:flex;flex-direction:column;gap:3px} .tier-h span{font-size:11px;color:var(--muted);font-weight:600}
.opt-row{display:flex;align-items:center;gap:10px;margin-top:10px}
.check{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink);font-weight:600;cursor:pointer}
.total-readout{margin-top:14px;padding:9px 12px;background:var(--accent-soft);border-radius:9px;font-size:12.5px;color:var(--accent-d)} .total-readout b{font-weight:750}
.img-slot{display:flex;flex-direction:column;gap:5px;align-items:center}
.img-slot-label{font-size:11px;color:var(--muted);font-weight:600}
.img-drop{width:100%;aspect-ratio:1;border:1.5px dashed var(--line);border-radius:11px;display:flex;align-items:center;justify-content:center;background:#fafbfb;overflow:hidden;cursor:pointer}
.img-drop:hover{border-color:var(--accent)} .img-drop img{width:100%;height:100%;object-fit:contain} .img-plus{font-size:22px;color:var(--muted)}
.seg{display:inline-flex;background:var(--bg);border-radius:10px;padding:3px;gap:3px;margin-bottom:18px} .seg.sm{margin:0}
.seg-btn{border:none;background:transparent;padding:7px 16px;border-radius:8px;font-weight:600;font-size:12.5px;color:var(--muted)}
.seg-btn.on{background:var(--panel);color:var(--accent-d);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.proj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
.proj-card{padding:14px;display:flex;flex-direction:column;gap:10px}
.proj-mini{display:flex;justify-content:center;align-items:flex-end;background:var(--bg);border-radius:10px;padding:10px;min-height:130px}
.proj-name{font-weight:700;letter-spacing:-.01em}
.spec-chip{display:inline-block;font-size:11px;color:var(--accent-d);background:var(--accent-soft);padding:3px 9px;border-radius:7px;font-weight:600;width:fit-content}
.proj-actions{display:flex;gap:8px;margin-top:auto} .proj-actions .btn{flex:1}
.mini-header{fill:var(--accent)} .mini-frame{fill:#efe7d6;stroke:var(--wood-edge);stroke-width:2}
.mini-base{fill:#b89a6b} .mini-tier{fill:var(--wood-line)} .mini-box{fill:#fff;stroke:var(--accent);stroke-width:.6;opacity:.9}
.lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
.lib-card{padding:12px;display:flex;flex-direction:column;gap:4px}
.lib-thumb{aspect-ratio:1;background:var(--bg);border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:6px}
.lib-thumb img{width:100%;height:100%;object-fit:contain} .thumb-ph{color:var(--muted);font-weight:700} .lib-name{font-weight:650}
.editor{display:grid;grid-template-columns:230px 1fr 290px;height:calc(100vh - 64px)}
.palette,.inspector{background:var(--panel);overflow-y:auto;padding:16px}
.palette{border-right:1px solid var(--line)}
.inspector{border-left:1px solid var(--line);display:flex;flex-direction:column;gap:18px}
.pal-head{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:13px;margin-bottom:4px}
.pal-list{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.pal-empty{color:var(--muted);padding:16px 4px;text-align:center;font-size:12.5px}
.pal-item{display:flex;align-items:center;gap:10px;border:1px solid var(--line);background:#fcfdfd;border-radius:10px;padding:8px;text-align:left}
.pal-item:hover{border-color:var(--accent);background:var(--accent-soft)}
.pal-thumb{width:38px;height:38px;border-radius:7px;background:var(--bg);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none;font-size:11px;color:var(--muted)}
.pal-thumb img{width:100%;height:100%;object-fit:contain} .pal-name{font-weight:600;line-height:1.2;font-size:12.5px}
.canvas-col{display:flex;flex-direction:column;background:var(--bg);min-width:0}
.canvas-toolbar{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--line);background:var(--panel);gap:12px;flex-wrap:wrap}
.ct-left{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.board-wrap{flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:28px}
.board{position:relative;flex:none;touch-action:none}
.board.zoom{overflow:hidden;border-radius:5px;box-shadow:var(--shadow)}
.tier-select{border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:12.5px;background:#fcfdfd;color:var(--ink);font-weight:600;cursor:pointer}
.tier-select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.vmk-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.vmk-board{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px;overflow:auto;display:flex;justify-content:center}
.topper{position:absolute;left:-2%;width:104%;top:0;background:linear-gradient(180deg,var(--accent),var(--accent-d));border-radius:6px 6px 3px 3px;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;letter-spacing:.18em;font-size:13px;box-shadow:0 6px 12px rgba(11,111,101,.3);z-index:3}
.frame{position:absolute;left:0;right:0;background:repeating-linear-gradient(0deg,transparent,transparent 40px,rgba(138,109,67,.04) 40px,rgba(138,109,67,.04) 41px),linear-gradient(180deg,#f3ecdd,#e9dec7);border:6px solid var(--wood-edge);border-radius:5px;box-shadow:inset 0 0 30px rgba(138,109,67,.18),var(--shadow);z-index:1}
.side-dim .frame{background:repeating-linear-gradient(90deg,transparent,transparent 30px,rgba(138,109,67,.05) 30px,rgba(138,109,67,.05) 31px),linear-gradient(180deg,#efe6d4,#e4d8bf)}
.base{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(180deg,#c2a376,#b89a6b);border-top:4px solid var(--wood-line);display:flex;align-items:center;justify-content:center}
.base-handle{width:34%;height:5px;border-radius:3px;background:rgba(0,0,0,.22)}
.board-plate{position:absolute;left:0;right:0;background:linear-gradient(180deg,#d8c19a,#c2a376);box-shadow:0 4px 7px rgba(0,0,0,.18);border-top:1px solid rgba(255,255,255,.5);border-bottom:1px solid rgba(0,0,0,.15);z-index:2}
.board-hint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--wood-edge);opacity:.6;font-weight:600;font-size:13px;pointer-events:none;text-align:center;padding:20px;z-index:4}
.side-axis{position:absolute;left:0;right:0;bottom:-22px;text-align:center;font-size:11px;color:var(--muted);letter-spacing:.05em}
.marquee{position:absolute;border:1.5px dashed var(--accent);background:rgba(15,138,126,.10);z-index:60;pointer-events:none;border-radius:2px}
.placement{position:absolute;cursor:grab;display:flex;align-items:flex-end;justify-content:center;touch-action:none;filter:drop-shadow(0 3px 4px rgba(0,0,0,.18))}
.placement:active{cursor:grabbing}
.placement .frontface{position:relative;z-index:1;width:100%;height:100%;display:flex;align-items:flex-end;justify-content:center}
.placement img{width:100%;height:100%;object-fit:contain;pointer-events:none;user-select:none}
.placement.has-depth{overflow:visible}
.behind{position:absolute;inset:0;z-index:0;display:flex;align-items:flex-end;justify-content:center;filter:saturate(.85) brightness(.96)}
.behind-row{position:relative;width:100%;height:100%}
.col-unit{position:absolute;top:0;bottom:0;display:flex;align-items:flex-end;justify-content:center}
.col-unit img{width:100%;height:100%;object-fit:contain}
.placement.posm{filter:drop-shadow(0 2px 5px rgba(0,0,0,.22))}
.placement.sel{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
.placement.side{align-items:stretch}
.side-dim .placement:not(.sel){opacity:.6}
.depth-unit{position:absolute;top:0;height:100%;display:flex;align-items:flex-end;justify-content:center;border-right:1px dashed rgba(11,111,101,.25)}
.depth-unit img{width:100%;height:100%;object-fit:contain}
.depth-handle{position:absolute;right:-8px;top:0;bottom:0;width:16px;cursor:ew-resize;display:flex;align-items:center;justify-content:center;z-index:6}
.depth-handle::after{content:'';width:4px;height:46%;background:var(--accent);border-radius:2px;box-shadow:0 0 0 2px #fff,0 1px 3px rgba(0,0,0,.3)}
.pl-ph{width:100%;height:100%;background:#fff;border:1px solid var(--accent);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;text-align:center;padding:2px}
.placement.posm .pl-ph{background:var(--accent-soft)}
.pal-search{margin:10px 0 0}
.lib-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.lib-toolbar .seg{margin-bottom:0}
.lib-search{max-width:240px}
.insp-block{display:flex;flex-direction:column;gap:8px}
.insp-title{font-weight:700;font-size:13px}
.sel-name{font-weight:700}
.readout{display:flex;gap:8px;font-size:11.5px;color:var(--muted);margin:4px 0}
.readout span{background:var(--bg);padding:3px 8px;border-radius:6px}
.depth-box{background:var(--accent-soft);border-radius:9px;padding:9px 11px;display:flex;flex-direction:column;gap:5px}
.depth-line{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;font-weight:700;color:var(--accent-d)}
.depth-ctrl{display:flex;align-items:center;gap:5px}
.depth-ctrl .btn{padding:3px 9px} .cnt{min-width:24px;text-align:center;font-weight:750}
.ctrl-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px}
.place-list{display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto}
.place-row{display:flex;justify-content:space-between;align-items:center;border:1px solid var(--line);background:#fcfdfd;border-radius:8px;padding:6px 8px 6px 10px;text-align:left;gap:6px}
.place-row.on{border-color:var(--accent);background:var(--accent-soft)}
.pr-main{flex:1;min-width:0;display:flex;justify-content:space-between;align-items:center;gap:8px;border:none;background:none;text-align:left;padding:0;font:inherit;color:inherit;cursor:pointer}
.pr-arrows{display:flex;flex-direction:column;gap:2px;flex:none}
.pr-arrows button{border:none;background:var(--bg);border-radius:4px;width:22px;height:15px;line-height:1;font-size:8px;color:var(--muted);padding:0;display:flex;align-items:center;justify-content:center}
.pr-arrows button:hover:not(:disabled){background:var(--accent-soft);color:var(--accent-d)}
.pr-arrows button:disabled{opacity:.3;cursor:default}
.pr-name{font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:900px){.editor{grid-template-columns:1fr;height:auto}.palette{border-right:none;border-bottom:1px solid var(--line)}.inspector{border-left:none;border-top:1px solid var(--line)}.grid4{grid-template-columns:1fr 1fr}}
*:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
    `}</style>
  );
}
