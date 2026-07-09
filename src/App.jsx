import { useState, useEffect, useRef, useCallback } from "react";
import { storeList, storeGet, storeSet, storeDel, storeImage, seedIfEmpty, hasCloud } from "./store";

/* =========================================================================
   약국 VMD 시뮬레이터 v5
   - 약국(거래처) 폴더 > 프로젝트(신규/업데이트) 계층 구조
   - 프로젝트별 요청기한/완료기한
   - 편집기: 확대/축소, 드래그 삭제, 그룹화(Ctrl+G / Ctrl+Shift+G),
     순서 단축키(Ctrl+]/[ , Ctrl+Shift+]/[), 실행취소/다시실행(5단계),
     헤더 영역 POSM 드래그 앤 드롭 핏, 우측면 기준 측면 뷰
   - OTC 라이브러리(제품/POSM 통합 + 버튼)
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
const STORE_KEY = (id) => "vmd:store:" + id;
const PROJ_KEY = (id) => "vmd:project:" + id;

/* =========================================================================
   실행취소/다시실행 (최대 5단계)
   ========================================================================= */
function useHistory(limit = 5) {
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [, force] = useState(0);
  const bump = () => force((x) => x + 1);
  const snap = (doc) => JSON.parse(JSON.stringify(doc));
  const push = (prevDoc) => {
    undoStack.current = [...undoStack.current, snap(prevDoc)].slice(-limit);
    redoStack.current = [];
    bump();
  };
  const canUndo = () => undoStack.current.length > 0;
  const canRedo = () => redoStack.current.length > 0;
  const doUndo = (currentDoc, apply) => {
    if (!undoStack.current.length) return;
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [...redoStack.current, snap(currentDoc)].slice(-limit);
    apply(prev); bump();
  };
  const doRedo = (currentDoc, apply) => {
    if (!redoStack.current.length) return;
    const next = redoStack.current[redoStack.current.length - 1];
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current, snap(currentDoc)].slice(-limit);
    apply(next); bump();
  };
  return { push, doUndo, doRedo, canUndo, canRedo };
}

/* =========================================================================
   루트
   ========================================================================= */
export default function App() {
  const [view, setView] = useState("stores"); // stores | projects | library | editor
  const [items, setItems] = useState([]);
  const [stores, setStores] = useState([]);
  const [projects, setProjects] = useState([]);
  const [activeStoreId, setActiveStoreId] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      await seedIfEmpty();
      const its = (await Promise.all((await storeList("vmd:item:")).map(storeGet))).filter(Boolean);
      const sts = (await Promise.all((await storeList("vmd:store:")).map(storeGet))).filter(Boolean);
      const prs = (await Promise.all((await storeList("vmd:project:")).map(storeGet))).filter(Boolean);
      setItems(its); setStores(sts); setProjects(prs); setLoaded(true);
    })();
  }, []);

  const saveItem = useCallback((it) => { setItems((p) => { const i = p.findIndex((x) => x.id === it.id); return i < 0 ? [...p, it] : p.map((x) => x.id === it.id ? it : x); }); storeSet(ITEM_KEY(it.id), it); }, []);
  const removeItem = useCallback((id) => { setItems((p) => p.filter((x) => x.id !== id)); storeDel(ITEM_KEY(id)); }, []);

  const saveStore = useCallback((s) => { setStores((prev) => { const i = prev.findIndex((x) => x.id === s.id); return i < 0 ? [...prev, s] : prev.map((x) => x.id === s.id ? s : x); }); storeSet(STORE_KEY(s.id), s); }, []);
  const removeStore = useCallback((id) => {
    setStores((p) => p.filter((x) => x.id !== id)); storeDel(STORE_KEY(id));
    setProjects((prev) => { const rest = prev.filter((x) => x.storeId !== id); prev.filter((x) => x.storeId === id).forEach((x) => storeDel(PROJ_KEY(x.id))); return rest; });
    setActiveStoreId((a) => a === id ? null : a);
  }, []);

  const saveProject = useCallback((p) => { setProjects((prev) => { const i = prev.findIndex((x) => x.id === p.id); return i < 0 ? [...prev, p] : prev.map((x) => x.id === p.id ? p : x); }); storeSet(PROJ_KEY(p.id), p); }, []);
  const removeProject = useCallback((id) => { setProjects((p) => p.filter((x) => x.id !== id)); storeDel(PROJ_KEY(id)); setActiveProjectId((a) => a === id ? null : a); }, []);

  const activeStore = stores.find((s) => s.id === activeStoreId) || null;
  const activeProject = projects.find((p) => p.id === activeProjectId) || null;

  const openStore = (id) => { setActiveStoreId(id); setView("projects"); };
  const openProject = (id) => { const pr = projects.find((x) => x.id === id); if (pr) setActiveStoreId(pr.storeId); setActiveProjectId(id); setView("editor"); };
  const goStores = () => { setView("stores"); setActiveStoreId(null); setActiveProjectId(null); };
  const goProjects = () => { setView("projects"); setActiveProjectId(null); };

  return (
    <div className="vmd-root">
      <StyleTag />
      <header className="topbar">
        <div className="brand">
          <span className="logo-dot" />
          <div><div className="brand-title">약국 VMD 시뮬레이터</div><div className="brand-sub">약국별 폴더에 진열 시안을 쌓아가는 도구</div></div>
        </div>
        <nav className="tabs">
          <button className={"tab" + ((view === "stores" || view === "projects") ? " on" : "")} onClick={goStores}>프로젝트</button>
          <button className={"tab" + (view === "library" ? " on" : "")} onClick={() => setView("library")}>OTC 라이브러리</button>
          {activeProject && <button className={"tab" + (view === "editor" ? " on" : "")} onClick={() => setView("editor")}>편집: {activeProject.name || "제목 없음"}</button>}
        </nav>
        {!hasCloud && <span className="warn-pill">로컬 저장 모드 (클라우드 미설정)</span>}
      </header>

      <main className="stage">
        {!loaded && <div className="loading">불러오는 중…</div>}
        {loaded && view === "stores" && <StoresView stores={stores} projects={projects} onSave={saveStore} onRemove={removeStore} onOpen={openStore} />}
        {loaded && view === "projects" && activeStore && <ProjectsView store={activeStore} projects={projects.filter((p) => p.storeId === activeStore.id)} onSave={saveProject} onRemove={removeProject} onOpen={openProject} onBack={goStores} />}
        {loaded && view === "projects" && !activeStore && <div className="empty">약국을 먼저 선택하세요.</div>}
        {loaded && view === "library" && <LibraryView items={items} onSave={saveItem} onRemove={removeItem} />}
        {loaded && view === "editor" && activeProject && <EditorView key={activeProject.id} project={activeProject} items={items} onSave={saveProject} goLibrary={() => setView("library")} goProjects={goProjects} />}
        {loaded && view === "editor" && !activeProject && <div className="empty">열린 프로젝트가 없음. 프로젝트 탭에서 선택.</div>}
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
   약국(거래처) 폴더 목록
   ========================================================================= */
function StoresView({ stores, projects, onSave, onRemove, onOpen }) {
  const [form, setForm] = useState(null);
  const newDraft = () => ({ id: uid(), name: "", code: "", memo: "" });

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="h1">프로젝트</h1><p className="muted">약국(거래처) 폴더를 먼저 만들고, 그 안에 진행한 VMD를 계속 쌓아갑니다.</p></div>
        {!form && <button className="btn primary" onClick={() => setForm(newDraft())}>+ 새 약국</button>}
      </div>

      {form && (
        <div className="card form-card">
          <div className="grid2">
            <Field label="약국명"><input className="inp" value={form.name} placeholder="예) OO온누리약국" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="거래처코드"><input className="inp" value={form.code} placeholder="예) A12345" onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          </div>
          <Field label="메모 (선택)"><input className="inp" value={form.memo} placeholder="비고" onChange={(e) => setForm({ ...form, memo: e.target.value })} /></Field>
          <div className="row-end">
            <button className="btn ghost" onClick={() => setForm(null)}>취소</button>
            <button className="btn primary" disabled={!form.name} onClick={() => { onSave(form); setForm(null); }}>만들기</button>
          </div>
        </div>
      )}

      {stores.length === 0 && !form && <div className="empty">등록된 약국이 없음. 새 약국 폴더를 만들어 시작하기.</div>}

      <div className="proj-grid">
        {stores.map((s) => {
          const cnt = projects.filter((p) => p.storeId === s.id).length;
          return (
            <div className="card proj-card store-card" key={s.id}>
              <div className="store-icon">📁</div>
              <div className="proj-body">
                <div className="proj-name">{s.name || "(이름 없음)"}</div>
                <div className="muted sm">{s.code ? `거래처코드 ${s.code}` : "거래처코드 미입력"}</div>
                <div className="spec-chip">VMD {cnt}건</div>
              </div>
              <div className="proj-actions">
                <button className="btn primary sm" onClick={() => onOpen(s.id)}>열기</button>
                <button className="btn danger-ghost sm" onClick={() => { if (confirm("이 약국 폴더와 하위 프로젝트를 모두 삭제할까요?")) onRemove(s.id); }}>삭제</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =========================================================================
   프로젝트 목록 (약국 폴더 내부)
   ========================================================================= */
function ProjectsView({ store, projects, onSave, onRemove, onOpen, onBack }) {
  const [form, setForm] = useState(null);
  const newDraft = () => ({ id: uid(), storeId: store.id, name: "", requestDate: "", dueDate: "", memo: "", shelf: normShelf({ w: 90, d: 35, tiers: 5, uniformH: 30, boardH: 3 }), placements: [] });

  return (
    <div className="page">
      <button className="link-btn back-link" onClick={onBack}>← 약국 목록</button>
      <div className="page-head">
        <div><h1 className="h1">{store.name || "(이름 없음)"}</h1><p className="muted">{store.code ? `거래처코드 ${store.code} · ` : ""}이 약국에서 진행한 VMD 프로젝트 (신규/업데이트 모두 여기 쌓입니다)</p></div>
        {!form && <button className="btn primary" onClick={() => setForm(newDraft())}>+ 새 프로젝트</button>}
      </div>

      {form && (
        <div className="card form-card">
          <div className="grid2">
            <Field label="프로젝트명"><input className="inp" value={form.name} placeholder="예) 2026 가정의 달 매대" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="메모 (선택)"><input className="inp" value={form.memo} placeholder="요청 사항, 입점 조건 등" onChange={(e) => setForm({ ...form, memo: e.target.value })} /></Field>
          </div>
          <div className="grid2">
            <Field label="요청기한"><input className="inp" type="date" value={form.requestDate} onChange={(e) => setForm({ ...form, requestDate: e.target.value })} /></Field>
            <Field label="완료기한"><input className="inp" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          </div>
          <div className="sub-label">진열장 규격</div>
          <ShelfFields shelf={form.shelf} set={(sh) => setForm({ ...form, shelf: sh })} />
          <div className="row-end">
            <button className="btn ghost" onClick={() => setForm(null)}>취소</button>
            <button className="btn primary" disabled={!form.name} onClick={() => { onSave(form); setForm(null); }}>만들기</button>
          </div>
        </div>
      )}

      {projects.length === 0 && !form && <div className="empty">등록된 프로젝트가 없음. 새 프로젝트로 시작하기.</div>}

      <div className="proj-grid">
        {projects.map((p) => {
          const sh = normShelf(p.shelf), g = shelfGeom(sh);
          return (
            <div className="card proj-card" key={p.id}>
              <div className="proj-mini"><MiniShelf shelf={sh} count={p.placements?.length || 0} /></div>
              <div className="proj-body">
                <div className="proj-name">{p.name || "(제목 없음)"}</div>
                <div className="muted sm">{[p.requestDate && `요청 ${p.requestDate}`, p.dueDate && `완료 ${p.dueDate}`].filter(Boolean).join(" · ") || "기한 미입력"}</div>
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
   OTC 라이브러리
   ========================================================================= */
function LibraryView({ items, onSave, onRemove }) {
  const [edit, setEdit] = useState(null);
  const [tab, setTab] = useState("product");
  const [q, setQ] = useState("");
  const blank = () => ({ id: uid(), type: "product", name: "", brand: "", w: 6, h: 9, d: 3, images: { front: null, back: null, left: null, right: null } });
  const dup = (it) => onSave({ ...it, id: uid(), name: (it.name || (it.type === "posm" ? "POSM" : "제품")) + " 사본", images: { ...it.images } });
  const shown = items.filter((i) => i.type === tab).filter((it) => { const s = q.trim().toLowerCase(); return !s || (it.name || "").toLowerCase().includes(s) || (it.brand || "").toLowerCase().includes(s); });

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="h1">OTC 라이브러리</h1><p className="muted">규격과 면별 이미지를 등록해두면 모든 프로젝트에서 재사용. + 버튼 안에서 제품/POSM을 구분해 입력합니다.</p></div>
        {!edit && <button className="btn primary" onClick={() => setEdit(blank())}>+ 추가</button>}
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
          {shown.length === 0 && <div className="empty">{q ? "검색 결과 없음." : `${tab === "product" ? "제품" : "POSM"}이 없음. 위 + 버튼으로 추가.`}</div>}
          <div className="lib-grid">
            {shown.map((it) => (
              <div className="card lib-card" key={it.id}>
                <div className="lib-thumb">{it.images?.front ? <img src={it.images.front} alt={it.name} /> : <div className="thumb-ph">{it.name?.slice(0, 4) || "?"}</div>}</div>
                <div className="lib-name">{it.name || "(이름 없음)"}</div>
                <div className="muted sm">{it.type === "posm" ? "POSM" : "제품"}{it.brand ? ` · ${it.brand}` : ""} · {it.w}×{it.h}×{it.d}cm</div>
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
      <div className="sub-label">구분</div>
      <div className="seg sm" style={{ marginBottom: 16 }}>
        <button type="button" className={"seg-btn" + (d.type === "product" ? " on" : "")} onClick={() => setD({ ...d, type: "product" })}>제품</button>
        <button type="button" className={"seg-btn" + (d.type === "posm" ? " on" : "")} onClick={() => setD({ ...d, type: "posm" })}>POSM</button>
      </div>
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
function EditorView({ project, items, onSave, goLibrary, goProjects }) {
  const [meta, setMeta] = useState({ name: project.name || "", requestDate: project.requestDate || "", dueDate: project.dueDate || "", memo: project.memo || "" });
  const [shelf, setShelfRaw] = useState(normShelf(project.shelf));
  const [placements, setPlacementsRaw] = useState((project.placements || []).map((p) => ({ depthCount: 1, colCount: 1, sideXCm: 0, depthStartCm: 0, groupId: null, fitHeader: false, rotationDeg: 0, ...p })));
  const [selIds, setSelIds] = useState([]);
  const [paletteTab, setPaletteTab] = useState("product");
  const [snap, setSnap] = useState(true);
  const [vmode, setVmode] = useState("front"); // front | side
  const [focusTier, setFocusTier] = useState(null);
  const [palQuery, setPalQuery] = useState("");
  const [marquee, setMarquee] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const boardRef = useRef(null);
  const boardElRef = useRef(null);
  const [boardW, setBoardW] = useState(720);
  const [busy, setBusy] = useState(false);
  const dragRef = useRef(null);
  const clipboardRef = useRef(null);
  const hist = useHistory(5);

  const itemsById = Object.fromEntries(items.map((i) => [i.id, i]));
  const g = shelfGeom(shelf);
  const isFront = vmode === "front";
  const viewW = isFront ? g.w : g.d;
  const ft = (focusTier != null && focusTier >= 0 && focusTier < g.tiers) ? focusTier : null;
  const vpBot = ft != null ? g.boards[ft].bottom : 0;
  const vpTop = ft != null ? (ft < g.tiers - 1 ? g.boards[ft + 1].bottom : g.mainTop) : g.totalH;
  const vpH = Math.max(1, vpTop - vpBot);
  const maxH = 540;
  const ppcBase = Math.max(1.1, Math.min((boardW - 8) / Math.max(1, viewW), maxH / Math.max(1, vpH)));
  const ppc = ppcBase * zoomLevel;

  const curDoc = () => ({ shelf, placements });
  const applyDoc = (dcmt) => { setShelfRaw(dcmt.shelf); setPlacementsRaw(dcmt.placements); };
  const setPlacements = (updater, record = true) => { if (record) hist.push(curDoc()); setPlacementsRaw(updater); };
  const setShelf = (nextShelf, record = true) => { if (record) hist.push(curDoc()); setShelfRaw(nextShelf); };

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
  useEffect(() => { const t = setTimeout(() => onSave({ ...project, ...meta, shelf, placements }), 300); return () => clearTimeout(t); }, [shelf, placements, meta]); // eslint-disable-line

  const doSaveNow = () => onSave({ ...project, ...meta, shelf, placements });

  const groupMembers = (id, currentSel) => {
    if (currentSel.includes(id) && currentSel.length > 1) return currentSel;
    const p = placements.find((x) => x.id === id);
    if (p?.groupId) return placements.filter((x) => x.groupId === p.groupId).map((x) => x.id);
    return [id];
  };
  const selectWithGroup = (id) => {
    const p = placements.find((x) => x.id === id);
    if (p?.groupId) setSelIds(placements.filter((x) => x.groupId === p.groupId).map((x) => x.id));
    else setSelIds([id]);
  };
  const groupSel = () => {
    if (selIds.length < 2) return;
    const gid = uid();
    setPlacements((ps) => ps.map((p) => selIds.includes(p.id) ? { ...p, groupId: gid } : p));
  };
  const ungroupSel = () => {
    if (!selIds.length) return;
    const gids = new Set(placements.filter((p) => selIds.includes(p.id) && p.groupId).map((p) => p.groupId));
    if (!gids.size) return;
    setPlacements((ps) => ps.map((p) => (p.groupId && gids.has(p.groupId)) ? { ...p, groupId: null } : p));
  };

  const bulkZ = (mode) => {
    if (!selIds.length) return;
    const sorted = [...placements].sort((a, b) => b.z - a.z);
    let order = sorted.map((p) => p.id);
    const selSet = new Set(selIds);
    if (mode === "top") { const sel = order.filter((id) => selSet.has(id)); const rest = order.filter((id) => !selSet.has(id)); order = [...sel, ...rest]; }
    else if (mode === "bottom") { const sel = order.filter((id) => selSet.has(id)); const rest = order.filter((id) => !selSet.has(id)); order = [...rest, ...sel]; }
    else if (mode === "up1") { for (let i = 1; i < order.length; i++) { if (selSet.has(order[i]) && !selSet.has(order[i - 1])) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; } } }
    else if (mode === "down1") { for (let i = order.length - 2; i >= 0; i--) { if (selSet.has(order[i]) && !selSet.has(order[i + 1])) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; } } }
    const n = order.length, zmap = {}; order.forEach((id, idx) => { zmap[id] = n - idx; });
    setPlacements((prev) => prev.map((p) => ({ ...p, z: zmap[p.id] ?? p.z })));
  };

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selIds.length && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); removeSel(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) { e.preventDefault(); copySel(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) { e.preventDefault(); pasteClipboard(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) hist.doRedo(curDoc(), applyDoc); else hist.doUndo(curDoc(), applyDoc); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); hist.doRedo(curDoc(), applyDoc); return; }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "g" || e.key === "G") { e.preventDefault(); if (e.shiftKey) ungroupSel(); else groupSel(); }
      else if (e.key === "]") { e.preventDefault(); bulkZ(e.shiftKey ? "top" : "up1"); }
      else if (e.key === "[") { e.preventDefault(); bulkZ(e.shiftKey ? "bottom" : "down1"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const addItem = (it) => {
    const w = frontW(it, "front");
    const xCm = clamp(g.w / 2 - w / 2, 0, Math.max(0, g.w - w));
    const yCm = it.type === "posm"
      ? (g.header > 0 ? clamp(g.mainTop + (g.header - num(it.h)) / 2, 0, g.totalH - num(it.h)) : clamp(g.totalH - num(it.h) - 4, 0, g.totalH - num(it.h)))
      : g.floors[0];
    const z = placements.reduce((m, p) => Math.max(m, p.z), 0) + 1;
    const np = { id: uid(), itemId: it.id, face: "front", xCm, yCm, z, depthCount: 1, colCount: 1, sideXCm: 0, depthStartCm: 0, groupId: null, fitHeader: false, rotationDeg: 0 };
    setPlacements((p) => [...p, np]); setSelIds([np.id]);
  };
  const addItemAtHeader = (it) => {
    const z = placements.reduce((m, p) => Math.max(m, p.z), 0) + 1;
    const np = { id: uid(), itemId: it.id, face: "front", xCm: 0, yCm: g.mainTop, z, depthCount: 1, colCount: 1, sideXCm: 0, depthStartCm: 0, groupId: null, fitHeader: true, rotationDeg: 0 };
    setPlacements((p) => [...p, np]); setSelIds([np.id]);
  };
  const asIds = (ids) => Array.isArray(ids) ? ids : [ids];
  const copySel = () => {
    if (!selIds.length) return;
    clipboardRef.current = placements.filter((p) => selIds.includes(p.id)).map((p) => ({ ...p }));
  };
  const pasteClipboard = () => {
    const clip = clipboardRef.current;
    if (!clip || !clip.length) return;
    let z = placements.reduce((m, p) => Math.max(m, p.z), 0);
    const groupIdMap = {};
    const news = clip.map((p) => {
      z += 1;
      let gid = p.groupId;
      if (gid) { if (!groupIdMap[gid]) groupIdMap[gid] = uid(); gid = groupIdMap[gid]; }
      return { ...p, id: uid(), xCm: clamp(num(p.xCm, 0) + 4, 0, g.w), z, groupId: gid };
    });
    setPlacements((ps) => [...ps, ...news]);
    setSelIds(news.map((n) => n.id));
  };
  const removeP = (ids) => { const idArr = asIds(ids); setPlacements((ps) => ps.filter((p) => !idArr.includes(p.id))); setSelIds((s) => s.filter((x) => !idArr.includes(x))); };
  const removeSel = () => removeP(selIds);
  const duplicateP = (ids) => {
    const idArr = asIds(ids);
    const srcs = placements.filter((p) => idArr.includes(p.id));
    if (!srcs.length) return;
    let z = placements.reduce((m, p) => Math.max(m, p.z), 0);
    const news = srcs.map((s) => { z += 1; return { ...s, id: uid(), xCm: clamp(num(s.xCm, 0) + 3, 0, g.w), z, groupId: null }; });
    setPlacements((p) => [...p, ...news]); setSelIds(news.map((n) => n.id));
  };
  const faceFromDeg = (deg) => { const d = ((deg % 360) + 360) % 360; if (d < 45 || d >= 315) return "front"; if (d < 135) return "right"; if (d < 225) return "back"; return "left"; };
  const bumpRotation = (ids, delta) => {
    const idArr = asIds(ids);
    setPlacements((ps) => ps.map((x) => {
      if (!idArr.includes(x.id)) return x;
      const it = itemsById[x.itemId]; if (!it || it.type !== "product") return x;
      const nd = ((Math.round((x.rotationDeg || 0) + delta) % 360) + 360) % 360;
      const nf = faceFromDeg(nd);
      return { ...x, rotationDeg: nd, face: nf, xCm: clamp(num(x.xCm, 0), 0, Math.max(0, g.w - blockW(it, nf, x.colCount))) };
    }));
  };
  const setRotationAbs = (ids, deg) => {
    const idArr = asIds(ids);
    const nd = ((Math.round(deg) % 360) + 360) % 360;
    const nf = faceFromDeg(nd);
    setPlacements((ps) => ps.map((x) => {
      if (!idArr.includes(x.id)) return x;
      const it = itemsById[x.itemId]; if (!it || it.type !== "product") return x;
      return { ...x, rotationDeg: nd, face: nf, xCm: clamp(num(x.xCm, 0), 0, Math.max(0, g.w - blockW(it, nf, x.colCount))) };
    }));
  };
  const bumpDepth = (ids, delta) => {
    const idArr = asIds(ids);
    setPlacements((ps) => ps.map((x) => {
      if (!idArr.includes(x.id)) return x;
      const it = itemsById[x.itemId]; if (!it || it.type !== "product") return x;
      const nv = clamp((x.depthCount || 1) + delta, 1, maxFitP(it, depthStartOf(x)));
      return { ...x, depthCount: nv };
    }));
  };
  const maxDepth = (ids) => {
    const idArr = asIds(ids);
    setPlacements((ps) => ps.map((x) => {
      if (!idArr.includes(x.id)) return x;
      const it = itemsById[x.itemId]; if (!it || it.type !== "product") return x;
      return { ...x, depthCount: maxFitP(it, depthStartOf(x)) };
    }));
  };
  const bumpCol = (ids, delta) => {
    const idArr = asIds(ids);
    setPlacements((ps) => ps.map((x) => {
      if (!idArr.includes(x.id)) return x;
      const it = itemsById[x.itemId]; if (!it || it.type !== "product") return x;
      const c = clamp((x.colCount || 1) + delta, 1, maxColFit(it, x.face));
      return { ...x, colCount: c, xCm: clamp(num(x.xCm, 0), 0, Math.max(0, g.w - c * frontW(it, x.face))) };
    }));
  };
  const fillRow = (ids) => {
    const idArr = asIds(ids);
    setPlacements((ps) => ps.map((x) => {
      if (!idArr.includes(x.id)) return x;
      const it = itemsById[x.itemId]; if (!it || it.type !== "product") return x;
      const c = maxColFit(it, x.face);
      return { ...x, colCount: c, xCm: 0 };
    }));
  };


  // 정면 뷰의 배치 순서(겹치는 자리 · z 순서)를 바탕으로 측면 깊이 위치를 규격(d)에 맞게 자동 계산.
  // 상태를 바꾸지 않는 순수 계산값이라 저장/실행취소와 절대 충돌하지 않음(매 렌더마다 다시 계산만 함).
  const autoDepthMap = {};
  {
    const prods = placements.filter((p) => itemsById[p.itemId]?.type === "product");
    const rects = prods.map((p) => {
      const it = itemsById[p.itemId];
      const w = blockW(it, p.face, p.colCount);
      const x0 = num(p.xCm, 0), x1 = x0 + w;
      const y0 = num(p.yCm, 0), y1 = y0 + num(it.h, 0);
      return { id: p.id, x0, x1, y0, y1, z: p.z, d: num(it.d, 1) * Math.max(1, p.depthCount || 1) };
    });
    const parent = {}; rects.forEach((r) => { parent[r.id] = r.id; });
    const find = (a) => parent[a] === a ? a : (parent[a] = find(parent[a]));
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0) union(a.id, b.id);
      }
    }
    const groups = {};
    rects.forEach((r) => { const root = find(r.id); (groups[root] = groups[root] || []).push(r); });
    Object.values(groups).forEach((members) => {
      const sorted = [...members].sort((a, b) => b.z - a.z);
      let acc = 0;
      for (const m of sorted) { autoDepthMap[m.id] = acc; acc += m.d; }
    });
  }
  const depthStartOf = (p) => autoDepthMap[p.id] !== undefined ? autoDepthMap[p.id] : num(p.depthStartCm, 0);


  const nearestOf = (arr, v) => arr.reduce((b, f) => Math.abs(f - v) < Math.abs(b - v) ? f : b, arr[0]);

  const startDrag = (e, p, mode) => {
    e.stopPropagation();
    const it = itemsById[p.itemId];
    const rect = boardElRef.current.getBoundingClientRect();
    const shiftLike = e.shiftKey || e.ctrlKey || e.metaKey;
    const beforeDoc = curDoc();
    if (mode === "count") {
      setSelIds([p.id]);
      dragRef.current = { mode: "count", id: p.id, it, depthStart: depthStartOf(p), lastCount: p.depthCount || 1, moved: false, beforeDoc };
      e.currentTarget.setPointerCapture?.(e.pointerId); return;
    }
    let group, deferToggleId = null;
    if (shiftLike) {
      if (selIds.includes(p.id)) {
        if (selIds.length > 1) { group = selIds; deferToggleId = p.id; }
        else { setSelIds([]); return; }
      } else {
        group = [...selIds, p.id];
        setSelIds(group);
      }
    } else {
      group = groupMembers(p.id, selIds);
      if (!(selIds.includes(p.id) && selIds.length > 1)) setSelIds(group);
    }
    const starts = {};
    for (const id of group) { const q = placements.find((x) => x.id === id); if (!q) continue; starts[id] = { h: getH(q), y: num(q.yCm, 0), it: itemsById[q.itemId], w: itemW(q) }; }
    const h = num(it.h), left0 = getH(p), dimW = itemW(p);
    dragRef.current = { mode: "body", id: p.id, it, dim: { w: dimW, h }, group, starts, grabX: (e.clientX - rect.left) - left0 * ppc, grabY: (e.clientY - rect.top) - (vpTop - num(p.yCm, 0) - h) * ppc, lastH: left0, lastY: num(p.yCm, 0), moved: false, beforeDoc, deferToggleId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onBoardDown = (e) => {
    const rect = boardElRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) setSelIds([]);
    dragRef.current = { mode: "marquee" };
    setMarquee({ x0: x, y0: y, x1: x, y1: y });
  };

  const onMove = (e) => {
    const dg = dragRef.current; if (!dg) return;
    const rect = boardElRef.current.getBoundingClientRect();
    if (dg.mode === "marquee") { setMarquee((m) => m && { ...m, x1: e.clientX - rect.left, y1: e.clientY - rect.top }); return; }
    if (dg.mode === "count") {
      const unit = Math.max(1, num(dg.it.d, 1)), start = dg.depthStart || 0;
      const depthCm = (e.clientX - rect.left) / ppc;
      const mx = Math.max(1, Math.floor((g.d - start) / unit));
      const nv = clamp(Math.round((depthCm - start) / unit), 1, mx);
      if (nv !== dg.lastCount) { dg.moved = true; dg.lastCount = nv; }
      setPlacementsRaw((ps) => ps.map((p) => p.id === dg.id ? { ...p, depthCount: nv } : p));
      return;
    }
    const newH = clamp(((e.clientX - rect.left) - dg.grabX) / ppc, 0, Math.max(0, viewW - dg.dim.w));
    const newY = clamp(vpTop - ((e.clientY - rect.top) - dg.grabY) / ppc - dg.dim.h, vpBot, Math.max(vpBot, vpTop - dg.dim.h));
    if (newH !== dg.lastH || newY !== dg.lastY) dg.moved = true;
    const lockHoriz = !isFront && dg.it.type === "product";
    const dH = lockHoriz ? 0 : newH - dg.starts[dg.id].h, dY = newY - dg.starts[dg.id].y;
    setPlacementsRaw((prev) => prev.map((p) => {
      if (!dg.group.includes(p.id)) return p;
      const st = dg.starts[p.id]; if (!st) return p;
      const f = horizField(st.it);
      const lockH = !isFront && st.it.type === "product";
      return { ...p, [f]: lockH ? num(p[f], 0) : clamp(st.h + dH, 0, Math.max(0, viewW - st.w)), yCm: clamp(st.y + dY, vpBot, Math.max(vpBot, vpTop - num(st.it.h))) };
    }));
    dg.lastH = lockHoriz ? dg.lastH : newH; dg.lastY = newY;
  };

  const onUp = (e) => {
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
    if (dg.mode === "count") {
      if (dg.moved) hist.push(dg.beforeDoc);
      dragRef.current = null; return;
    }

    // mode === "body"
    if (dg.deferToggleId && !dg.moved) {
      setSelIds((s) => s.filter((x) => x !== dg.deferToggleId));
      dragRef.current = null;
      return;
    }
    let snapY = dg.lastY, snapH = dg.lastH;
    if (snap) {
      const it = dg.it, h = num(it.h), isGroup = dg.group.length > 1;
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
          for (let i = 0; i < 8; i++) { let moved2 = false; for (const o of others) { if (x < o.xR && x + w > o.xL) { const tl = o.xL - w, tr = o.xR; x = Math.abs(tl - x) <= Math.abs(tr - x) ? tl : tr; moved2 = true; } } if (!moved2) break; }
          snapH = clamp(x, 0, Math.max(0, g.w - w));
        }
      } else {
        if (it.type === "product") {
          const sup = [...floorsUse];
          for (const q of placements) { if (exclude.has(q.id)) continue; const qi = itemsById[q.itemId]; if (!qi) continue; sup.push(num(q.yCm, 0) + num(qi.h)); }
          snapY = clamp(nearestOf(sup, dg.lastY), vpBot, Math.max(vpBot, vpTop - h));
        }
      }
    }

    // 헤더 영역에 놓으면 헤더 폭에 꼭 맞게 (정면·POSM 단일 선택일 때)
    let headerFit;
    if (isFront && dg.it.type === "posm" && g.header > 0 && dg.group.length === 1) {
      const midY = snapY + num(dg.it.h) / 2;
      if (midY >= g.mainTop) headerFit = true;
      else { const cur = placements.find((p) => p.id === dg.id); if (cur?.fitHeader) headerFit = false; }
    }

    if (dg.moved) hist.push(dg.beforeDoc);

    const dH = snapH - dg.lastH, dY = snapY - dg.lastY;
    if (dH || dY || headerFit !== undefined) {
      setPlacementsRaw((ps) => ps.map((p) => {
        if (headerFit !== undefined && p.id === dg.id) {
          return headerFit ? { ...p, fitHeader: true, xCm: 0, yCm: g.mainTop } : { ...p, fitHeader: false };
        }
        if (!dg.group.includes(p.id)) return p;
        const st = dg.starts[p.id]; if (!st) return p;
        const lockH = !isFront && st.it.type === "product";
        const f = horizField(st.it);
        return { ...p, [f]: lockH ? num(p[f], 0) : clamp(num(p[f], 0) + dH, 0, Math.max(0, viewW - st.w)), yCm: clamp(num(p.yCm, 0) + dY, vpBot, Math.max(vpBot, vpTop - num(st.it.h))) };
      }));
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
        if (p.fitHeader) {
          const src = it.images?.front || it.images?.right || it.images?.left || it.images?.back;
          if (src) { try { ctx.drawImage(await loadImg(src), 0, 0, W, headerPx); } catch {} }
          continue;
        }
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
      const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = `VMD_${meta.name || project.id}.png`; a.click();
    } finally { setBusy(false); }
  };

  const selId = selIds.length === 1 ? selIds[0] : null;
  const sel = placements.find((p) => p.id === selId);
  const selItem = sel ? itemsById[sel.itemId] : null;
  const paletteItems = items.filter((i) => i.type === paletteTab).filter((it) => { const q = palQuery.trim().toLowerCase(); return !q || (it.name || "").toLowerCase().includes(q) || (it.brand || "").toLowerCase().includes(q); });

  const renderPlacement = (p) => {
    const it = itemsById[p.itemId]; if (!it) return null;
    const h = p.fitHeader ? g.header : num(it.h);
    const top = (vpTop - num(p.yCm, 0) - h) * ppc, sel0 = selIds.includes(p.id);
    if (isFront) {
      const w = p.fitHeader ? g.w : frontW(it, p.face);
      const col = p.fitHeader ? 1 : Math.max(1, p.colCount || 1);
      const src = it.images?.[p.face];
      const back = p.fitHeader ? 0 : Math.min((p.depthCount || 1) - 1, 5);
      const off = Math.max(3, Math.min(11, h * ppc * 0.09));
      const cubeD = (p.face === "front" || p.face === "back") ? num(it.d, 1) : num(it.w, 1);
      const rowUnits = (cls, key) => (
        <div className={cls} key={key}>
          {Array.from({ length: col }).map((_, c) => (
            <div className="col-unit" style={{ left: c * w * ppc, width: w * ppc }} key={c}>
              {it.type === "product"
                ? <ProductCube it={it} wPx={w * ppc} dPx={cubeD * ppc} hPx={h * ppc} deg={p.rotationDeg || 0} />
                : (src ? <img src={src} alt="" draggable={false} style={p.fitHeader ? { objectFit: "fill" } : undefined} /> : <div className="pl-ph">{it.name?.slice(0, 5)}</div>)}
            </div>
          ))}
        </div>
      );
      return (
        <div key={p.id} className={"placement" + (sel0 ? " sel" : "") + (it.type === "posm" ? " posm" : "") + (back > 0 ? " has-depth" : "") + (p.groupId ? " grouped" : "") + (p.fitHeader ? " fit-header" : "")}
          style={{ left: p.fitHeader ? 0 : num(p.xCm, 0) * ppc, top, width: w * col * ppc, height: h * ppc, zIndex: 100 + p.z }}
          onPointerDown={(e) => startDrag(e, p, "body")}>
          {Array.from({ length: back }).map((_, k) => { const o = back - k; return (
            <div key={"bh" + k} className="behind" style={{ transform: `translate(${off * o * 0.8}px, ${-off * o}px)`, opacity: Math.max(0.22, 0.55 - o * 0.07) }}>{rowUnits("behind-row", k)}</div>); })}
          {rowUnits("frontface", "f")}
        </div>
      );
    } else {
      if (it.type === "posm") {
        const sw = num(it.d), src = it.images?.right || it.images?.front;
        return (
          <div key={p.id} className={"placement side-posm posm" + (sel0 ? " sel" : "") + (p.groupId ? " grouped" : "")}
            style={{ left: num(p.sideXCm || 0) * ppc, top, width: sw * ppc, height: h * ppc, zIndex: 100 + p.z }}
            onPointerDown={(e) => startDrag(e, p, "body")}>
            <div className="frontface">{src ? <img src={src} alt={it.name} draggable={false} /> : <div className="pl-ph">{it.name?.slice(0, 3)}</div>}</div>
          </div>
        );
      }
      const unit = Math.max(1, num(it.d, 1)), cnt = p.depthCount || 1;
      const sideSrc = it.images?.right || it.images?.front;
      return (
        <div key={p.id} className={"placement side" + (sel0 ? " sel" : "") + (p.groupId ? " grouped" : "")}
          style={{ left: depthStartOf(p) * ppc, top, width: unit * cnt * ppc, height: h * ppc, zIndex: 100 + p.z }}
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
            <button className="pal-item" key={it.id} draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", it.id); e.dataTransfer.effectAllowed = "copy"; }} onClick={() => addItem(it)} title={it.type === "posm" ? "클릭해서 매대에 추가 · 헤더 영역으로 드래그하면 꽉 차게 배치" : "클릭해서 매대에 추가"}>
              <div className="pal-thumb">{it.images?.front ? <img src={it.images.front} alt="" /> : <span>{it.name?.slice(0, 2)}</span>}</div>
              <div className="pal-meta"><div className="pal-name">{it.name}</div><div className="muted xs">{it.w}×{it.h}×{it.d}</div></div>
            </button>
          ))}
        </div>
      </aside>

      <section className="canvas-col">
        <div className="canvas-toolbar">
          <div className="ct-left">
            <button className="link-btn" onClick={goProjects}>← 프로젝트 목록</button>
            <div className="seg sm view-toggle">
              <button className={"seg-btn" + (isFront ? " on" : "")} onClick={() => setVmode("front")}>정면</button>
              <button className={"seg-btn" + (!isFront ? " on" : "")} onClick={() => setVmode("side")}>측면(우측)</button>
            </div>
            <span className="spec-chip">{isFront ? `폭 ${g.w}` : `깊이 ${g.d}`}×{Math.round(g.totalH)}cm · {g.tiers}단</span>
            <select className="tier-select" value={ft == null ? "all" : ft} onChange={(e) => setFocusTier(e.target.value === "all" ? null : Number(e.target.value))}>
              <option value="all">전체 보기</option>
              {Array.from({ length: g.tiers }).map((_, k) => { const i = g.tiers - 1 - k; return <option key={i} value={i}>{k + 1}단 확대</option>; })}
            </select>
            <label className="check"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> 자석 정렬</label>
            <div className="zoom-ctrl">
              <button className="btn ghost sm" onClick={() => setZoomLevel((z) => clamp(+(z - 0.15).toFixed(2), 0.4, 3))}>－</button>
              <span className="zoom-pct">{Math.round(zoomLevel * 100)}%</span>
              <button className="btn ghost sm" onClick={() => setZoomLevel((z) => clamp(+(z + 0.15).toFixed(2), 0.4, 3))}>＋</button>
            </div>
          </div>
          <div className="ct-right">
            <button className="btn ghost sm" disabled={!hist.canUndo()} onClick={() => hist.doUndo(curDoc(), applyDoc)} title="실행취소 (Ctrl+Z)">↶ 실행취소</button>
            <button className="btn ghost sm" disabled={!hist.canRedo()} onClick={() => hist.doRedo(curDoc(), applyDoc)} title="다시실행 (Ctrl+Shift+Z)">↷ 다시실행</button>
            <button className="btn ghost sm" onClick={doSaveNow}>저장</button>
            <button className="btn primary sm" disabled={busy} onClick={exportPng}>{busy ? "생성 중…" : "PNG 내보내기"}</button>
          </div>
        </div>
        <div className="board-wrap" ref={boardRef}>
          <div className={"board" + (isFront ? "" : " side-dim") + (ft != null ? " zoom" : "")} ref={boardElRef} style={{ width: viewW * ppc, height: vpH * ppc }}
            onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onPointerDown={onBoardDown}>
            {g.header > 0 && (
              <div className="topper" style={{ bottom: (g.mainTop - vpBot) * ppc, height: g.header * ppc }}
                onDragOver={(e) => { if (isFront) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
                onDrop={(e) => { if (!isFront) return; e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); const it = itemsById[id]; if (it && it.type === "posm") addItemAtHeader(it); }}>
                드래그로 삽입
              </div>
            )}
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
          <div className="insp-title">프로젝트 정보</div>
          <Field label="프로젝트명"><input className="inp sm" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></Field>
          <div className="grid2">
            <Field label="요청기한"><input className="inp sm" type="date" value={meta.requestDate} onChange={(e) => setMeta({ ...meta, requestDate: e.target.value })} /></Field>
            <Field label="완료기한"><input className="inp sm" type="date" value={meta.dueDate} onChange={(e) => setMeta({ ...meta, dueDate: e.target.value })} /></Field>
          </div>
          <Field label="메모"><input className="inp sm" value={meta.memo} onChange={(e) => setMeta({ ...meta, memo: e.target.value })} /></Field>
        </div>
        <div className="insp-block">
          <div className="insp-title">진열장 규격</div>
          <ShelfFields shelf={shelf} set={(sh) => setShelf(sh)} />
        </div>
        {selIds.length > 1 ? (
          <div className="insp-block">
            <div className="insp-title">다중 선택 · {selIds.length}개</div>
            <div className="muted sm">그룹으로 묶지 않아도 함께 이동·편집됩니다. (Ctrl+C/Ctrl+V 복사·붙여넣기, Delete 삭제)</div>
            <div className="depth-box">
              <div className="depth-line"><span>가로 진열 (제품만 적용)</span>
                <div className="depth-ctrl">
                  <button className="btn ghost sm" onClick={() => bumpCol(selIds, -1)}>−</button>
                  <button className="btn ghost sm" onClick={() => bumpCol(selIds, 1)}>＋</button>
                  <button className="btn ghost sm" onClick={() => fillRow(selIds)}>꽉</button>
                </div>
              </div>
            </div>
            <div className="depth-box">
              <div className="depth-line"><span>깊이 진열 (제품만 적용)</span>
                <div className="depth-ctrl">
                  <button className="btn ghost sm" onClick={() => bumpDepth(selIds, -1)}>−</button>
                  <button className="btn ghost sm" onClick={() => bumpDepth(selIds, 1)}>＋</button>
                  <button className="btn ghost sm" onClick={() => maxDepth(selIds)}>최대</button>
                </div>
              </div>
            </div>
            <div className="depth-box">
              <div className="depth-line"><span>회전 (제품만 적용)</span>
                <div className="depth-ctrl">
                  <button className="btn ghost sm" onClick={() => bumpRotation(selIds, -90)}>−90°</button>
                  <button className="btn ghost sm" onClick={() => bumpRotation(selIds, 90)}>+90°</button>
                </div>
              </div>
            </div>
            <div className="hint">순서 변경: Ctrl+] 한 칸 위 · Ctrl+[ 한 칸 아래 · Ctrl+Shift+] 맨 앞 · Ctrl+Shift+[ 맨 뒤</div>
            <div className="ctrl-grid">
              <button className="btn ghost sm" onClick={() => duplicateP(selIds)}>복제</button>
              <button className="btn ghost sm" onClick={() => bulkZ("up1")}>한 칸 위</button>
              <button className="btn ghost sm" onClick={() => bulkZ("down1")}>한 칸 아래</button>
              <button className="btn ghost sm" onClick={() => bulkZ("top")}>맨 앞</button>
              <button className="btn ghost sm" onClick={() => bulkZ("bottom")}>맨 뒤</button>
              <button className="btn ghost sm" onClick={groupSel}>그룹 묶기</button>
              <button className="btn ghost sm" onClick={ungroupSel}>그룹 해제</button>
            </div>
            <button className="btn danger-ghost sm full" onClick={removeSel}>선택 항목 모두 삭제</button>
          </div>
        ) : (
          <div className="insp-block">
            <div className="insp-title">선택 요소</div>
            {!sel && <div className="muted sm">매대에서 요소를 선택. (Shift·드래그로 여러 개, Delete 키로 삭제)</div>}
            {sel && selItem && (
              <>
                <div className="sel-name">{selItem.name}{sel.groupId ? " · 그룹" : ""}</div>
                <div className="muted xs">{FACE_KR[sel.face]} · {frontW(selItem, sel.face)}×{selItem.h}cm · 깊이 {selItem.d}cm</div>
                <div className="readout"><span>{isFront ? "좌측" : "앞에서"} {Math.round(isFront || selItem.type === "posm" ? getH(sel) : depthStartOf(sel))}cm</span><span>바닥 {Math.round(num(sel.yCm, 0))}cm</span></div>
                {selItem.type === "product" && !sel.fitHeader && (
                  <div className="depth-box">
                    <div className="depth-line"><span>가로 진열</span>
                      <div className="depth-ctrl">
                        <button className="btn ghost sm" onClick={() => bumpCol(sel.id, -1)}>−</button>
                        <span className="cnt">{sel.colCount || 1}</span>
                        <button className="btn ghost sm" onClick={() => bumpCol(sel.id, 1)}>＋</button>
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
                        <button className="btn ghost sm" onClick={() => bumpDepth(sel.id, -1)}>−</button>
                        <span className="cnt">{sel.depthCount || 1}</span>
                        <button className="btn ghost sm" onClick={() => bumpDepth(sel.id, 1)}>＋</button>
                        <button className="btn ghost sm" onClick={() => maxDepth(sel.id)}>최대</button>
                      </div>
                    </div>
                    <div className="muted xs">깊이 {Math.round(depthStartOf(sel) + (sel.depthCount || 1) * num(selItem.d))}/{g.d}cm · 남은공간 최대 {maxFitP(selItem, depthStartOf(sel))}개</div>
                  </div>
                )}
                {selItem.type === "product" && (
                  <div className="depth-box">
                    <div className="depth-line"><span>회전각 (정면 기준)</span></div>
                    <div className="depth-ctrl">
                      <button className="btn ghost sm" onClick={() => bumpRotation(sel.id, -90)}>−90°</button>
                      <input className="inp sm rot-input" type="number" value={sel.rotationDeg || 0} onChange={(e) => setRotationAbs(sel.id, num(e.target.value, 0))} />
                      <button className="btn ghost sm" onClick={() => bumpRotation(sel.id, 90)}>+90°</button>
                    </div>
                    <div className="muted xs">0~359° 사이 숫자 입력으로 360도 자유 회전</div>
                  </div>
                )}
                <div className="hint">순서 변경: Ctrl+] 한 칸 위 · Ctrl+[ 한 칸 아래 · Ctrl+Shift+] 맨 앞 · Ctrl+Shift+[ 맨 뒤 · Ctrl+C/V 복사·붙여넣기 · Delete 키로 삭제</div>
                <div className="ctrl-grid">
                  <button className="btn ghost sm" onClick={() => duplicateP(sel.id)}>복제</button>
                  <button className="btn ghost sm" onClick={() => bulkZ("up1")}>한 칸 위</button>
                  <button className="btn ghost sm" onClick={() => bulkZ("down1")}>한 칸 아래</button>
                  <button className="btn ghost sm" onClick={() => bulkZ("top")}>맨 앞</button>
                  <button className="btn ghost sm" onClick={() => bulkZ("bottom")}>맨 뒤</button>
                </div>
                <button className="btn danger-ghost sm full" onClick={() => removeP(sel.id)}>삭제</button>
              </>
            )}
          </div>
        )}
        <div className="insp-block">
          <div className="insp-title">배치 목록 ({placements.length})</div>
          <div className="muted xs">Ctrl+G 그룹 묶기 · Ctrl+Shift+G 그룹 해제 · Ctrl+]／Ctrl+[ 순서 변경</div>
          <div className="place-list">
            {placements.length === 0 && <div className="muted sm">없음</div>}
            {[...placements].sort((a, b) => b.z - a.z).map((p) => {
              const it = itemsById[p.itemId];
              return (
                <div key={p.id} className={"place-row" + (selIds.includes(p.id) ? " on" : "")}>
                  <button className="pr-main" onClick={() => selectWithGroup(p.id)}>
                    <span className="pr-name">{it?.name || "(삭제됨)"}</span>
                    <span className="muted xs">{[p.groupId ? "그룹" : null, p.fitHeader ? "헤더" : null, (p.colCount || 1) > 1 ? `가로${p.colCount}` : null, (p.depthCount || 1) > 1 ? `깊이${p.depthCount}` : null].filter(Boolean).join(" ") || FACE_KR[p.face]}</span>
                  </button>
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

function ProductCube({ it, wPx, dPx, hPx, deg }) {
  const front = it.images?.front, back = it.images?.back, right = it.images?.right, left = it.images?.left;
  const sideOffset = (wPx - dPx) / 2;
  const ph = (label) => <div className="pl-ph">{it.name?.slice(0, label)}</div>;
  return (
    <div className="cube-scene" style={{ width: wPx, height: hPx }}>
      <div className="cube" style={{ width: wPx, height: hPx, transform: `rotateY(${deg}deg)` }}>
        <div className="cube-face" style={{ transform: `translateZ(${dPx / 2}px)` }}>{front ? <img src={front} alt="" draggable={false} /> : ph(5)}</div>
        <div className="cube-face" style={{ transform: `rotateY(180deg) translateZ(${dPx / 2}px)` }}>{back ? <img src={back} alt="" draggable={false} /> : ph(5)}</div>
        <div className="cube-face" style={{ width: dPx, left: sideOffset, transform: `rotateY(90deg) translateZ(${wPx / 2}px)` }}>{right ? <img src={right} alt="" draggable={false} /> : ph(3)}</div>
        <div className="cube-face" style={{ width: dPx, left: sideOffset, transform: `rotateY(-90deg) translateZ(${wPx / 2}px)` }}>{left ? <img src={left} alt="" draggable={false} /> : ph(3)}</div>
      </div>
    </div>
  );
}

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
.btn.ghost:disabled{opacity:.4;cursor:not-allowed}
.btn.danger-ghost{background:transparent;color:var(--danger)} .btn.danger-ghost:hover{background:#fbe9e4}
.row{display:flex;gap:8px} .row-end{display:flex;justify-content:flex-end;gap:10px;margin-top:16px} .gap6{gap:6px;margin-top:10px}
.link-btn{border:none;background:none;color:var(--accent-d);font-weight:600;font-size:12px;padding:2px 0} .link-btn:hover{text-decoration:underline}
.back-link{display:inline-block;margin-bottom:14px;font-size:13px}
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
.store-card{align-items:stretch}
.store-icon{font-size:34px;text-align:center;background:var(--bg);border-radius:10px;padding:20px 0}
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
.ct-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.zoom-ctrl{display:flex;align-items:center;gap:6px}
.zoom-pct{font-size:12px;font-weight:700;color:var(--muted);min-width:38px;text-align:center}
.board-wrap{flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:28px}
.board{position:relative;flex:none;touch-action:none}
.board.zoom{border-radius:5px;box-shadow:var(--shadow)}
.tier-select{border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:12.5px;background:#fcfdfd;color:var(--ink);font-weight:600;cursor:pointer}
.tier-select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.topper{position:absolute;left:-2%;width:104%;top:0;background:linear-gradient(180deg,var(--accent),var(--accent-d));border-radius:6px 6px 3px 3px;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;letter-spacing:.08em;font-size:12px;box-shadow:0 6px 12px rgba(11,111,101,.3);z-index:3;text-align:center;padding:0 6px}
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
.placement.fit-header{filter:drop-shadow(0 2px 4px rgba(0,0,0,.2))}
.placement.grouped{outline:1.5px dashed var(--accent-d);outline-offset:3px;border-radius:3px}
.behind{position:absolute;inset:0;z-index:0;display:flex;align-items:flex-end;justify-content:center;filter:saturate(.85) brightness(.96)}
.behind-row{position:relative;width:100%;height:100%}
.col-unit{position:absolute;top:0;bottom:0;display:flex;align-items:flex-end;justify-content:center}
.col-unit img{width:100%;height:100%;object-fit:contain}
.cube-scene{position:relative;perspective:1200px}
.cube{position:relative;transform-style:preserve-3d}
.cube-face{position:absolute;top:0;left:0;width:100%;height:100%;backface-visibility:hidden;display:flex;align-items:flex-end;justify-content:center}
.cube-face img{width:100%;height:100%;object-fit:contain;pointer-events:none;user-select:none}
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
.rot-input{width:64px;text-align:center;padding:5px 4px}
.ctrl-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px}
.place-list{display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto}
.place-row{display:flex;justify-content:space-between;align-items:center;border:1px solid var(--line);background:#fcfdfd;border-radius:8px;padding:6px 8px 6px 10px;text-align:left;gap:6px}
.place-row.on{border-color:var(--accent);background:var(--accent-soft)}
.pr-main{flex:1;min-width:0;display:flex;justify-content:space-between;align-items:center;gap:8px;border:none;background:none;text-align:left;padding:0;font:inherit;color:inherit;cursor:pointer;width:100%}
.pr-name{font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:900px){.editor{grid-template-columns:1fr;height:auto}.palette{border-right:none;border-bottom:1px solid var(--line)}.inspector{border-left:none;border-top:1px solid var(--line)}.grid4{grid-template-columns:1fr 1fr}}
*:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
    `}</style>
  );
}
