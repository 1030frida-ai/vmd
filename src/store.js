import { supabase, hasSupabase, BUCKET } from "./supabaseClient";

/* 클라우드(Supabase) 설정 여부. 미설정이면 브라우저 localStorage로 동작(기기 한정). */
export const hasCloud = hasSupabase;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// key: "vmd:item:<id>" | "vmd:project:<id>"  (prefix는 끝의 id가 빈 문자열)
function parseKey(key) {
  const m = key.match(/^vmd:(item|project):(.*)$/s);
  if (!m) return null;
  return { table: m[1] === "item" ? "items" : "projects", kind: m[1], id: m[2] || null };
}

/* ---------------- list ---------------- */
export async function storeList(prefix) {
  const k = parseKey(prefix);
  if (hasSupabase && k) {
    const { data, error } = await supabase.from(k.table).select("id");
    if (error) { console.warn(error); return []; }
    return (data || []).map((r) => `vmd:${k.kind}:${r.id}`);
  }
  // localStorage
  const out = [];
  for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key && key.startsWith(prefix)) out.push(key); }
  return out;
}

/* ---------------- get ---------------- */
export async function storeGet(key) {
  const k = parseKey(key);
  if (hasSupabase && k && k.id) {
    const { data, error } = await supabase.from(k.table).select("data").eq("id", k.id).maybeSingle();
    if (error || !data) return null;
    return { value: JSON.stringify(data.data) };
  }
  const v = localStorage.getItem(key);
  return v ? { value: v } : null;
}

/* ---------------- set ---------------- */
export async function storeSet(key, obj) {
  const k = parseKey(key);
  if (hasSupabase && k && k.id) {
    const { error } = await supabase.from(k.table).upsert({ id: k.id, data: obj, updated_at: new Date().toISOString() });
    if (error) console.warn(error);
    return;
  }
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { console.warn("localStorage full", e); }
}

/* ---------------- delete ---------------- */
export async function storeDel(key) {
  const k = parseKey(key);
  if (hasSupabase && k && k.id) {
    const { error } = await supabase.from(k.table).delete().eq("id", k.id);
    if (error) console.warn(error);
    return;
  }
  localStorage.removeItem(key);
}

/* ---------------- image resize ---------------- */
function resize(file, maxDim = 600) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        const png = /png/i.test(file.type);
        const type = png ? "image/png" : "image/jpeg";
        const dataURL = c.toDataURL(type, png ? undefined : 0.82);
        c.toBlob((blob) => resolve({ blob, dataURL, type, ext: png ? "png" : "jpg" }), type, png ? undefined : 0.82);
      };
      img.onerror = reject; img.src = reader.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

/* 이미지 저장: 클라우드면 Storage 업로드 후 공개 URL, 아니면 base64 dataURL */
export async function storeImage(file) {
  const { blob, dataURL, type, ext } = await resize(file);
  if (hasSupabase) {
    const path = `items/${uid()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (error) { console.warn("upload fail, fallback to dataURL", error); return dataURL; }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || dataURL;
  }
  return dataURL;
}

/* 최초 실행 시 카탈로그(public/catalog.json) 시드 — 라이브러리가 비어있을 때만 */
export async function seedIfEmpty() {
  try {
    const existing = await storeList("vmd:item:");
    if (existing.length > 0) return;
    const res = await fetch("/catalog.json");
    if (!res.ok) return;
    const items = await res.json();
    if (!Array.isArray(items)) return;
    for (const it of items) { if (it && it.id) await storeSet(`vmd:item:${it.id}`, it); }
  } catch (e) { /* 카탈로그 없으면 무시 */ }
}
