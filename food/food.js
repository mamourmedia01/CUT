// Cut Log: what's on the plate? Runs entirely on the phone (no API key, no server, free).
// OpenAI CLIP ViT-B/32 (MIT licence) turns the photo into a vector; we compare it with
// pre-computed vectors for the foods in foods.js (food/embeddings.json, made by
// scripts/food-embeddings.mjs). The model (~64 MB) downloads once and is then cached.
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

const MODEL = 'Xenova/clip-vit-base-patch32';
env.allowLocalModels = false;
env.useBrowserCache = true;

let loading = null;
function load(onProgress) {
  if (!loading) loading = (async () => {
    const files = {};
    const progress = p => {
      if (!onProgress || !p || !p.file) return;
      if (p.status === 'progress' && p.total) { files[p.file] = [p.loaded, p.total]; }
      if (p.status === 'done' && files[p.file]) files[p.file][0] = files[p.file][1];
      const t = Object.values(files).reduce((a, f) => [a[0] + f[0], a[1] + f[1]], [0, 0]);
      if (t[1] > 2e6) onProgress(t[0] / t[1], t[1]);
    };
    const [proc, model, emb] = await Promise.all([
      AutoProcessor.from_pretrained(MODEL),
      CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'q4', device: 'wasm', progress_callback: progress }),
      fetch(new URL('./embeddings.json', import.meta.url)).then(r => r.json())
    ]);
    const vecs = emb.v.map(o => { const b = Uint8Array.from(atob(o.d), c => c.charCodeAt(0)); return Float32Array.from(new Int8Array(b.buffer), x => x * o.s); });
    return { proc, model, labels: emb.labels, vecs };
  })().catch(e => { loading = null; throw e; });
  return loading;
}

// Is the model already on this phone? (so the app can say "one-time 64 MB download" only when true)
export async function cached() {
  try { const c = await caches.open('transformers-cache'); const k = await c.keys(); return k.some(r => r.url.includes('clip-vit-base-patch32') && r.url.includes('vision_model')); } catch (e) { return false; }
}

// blob -> { food: bool, top: [{ name, kcal, serving, score }] }
export async function guess(blob, onProgress) {
  const { proc, model, labels, vecs } = await load(onProgress);
  const img = await RawImage.fromBlob(blob);
  const { image_embeds } = await model(await proc(img));
  const v = image_embeds.normalize().data;
  const foods = (window.CUT_FOODS || []);
  const scored = labels.map((l, i) => { let s = 0; const t = vecs[i]; for (let k = 0; k < t.length; k++) s += t[k] * v[k]; return [l, s]; }).sort((a, b) => b[1] - a[1]);
  const top = [], seen = new Set();
  for (const [l, s] of scored) {
    if (l.startsWith('#')) continue;
    const f = foods.find(x => x[0] === l); if (!f || seen.has(l)) continue;
    seen.add(l); top.push({ name: f[0], kcal: f[1], serving: f[2], score: s });
    if (top.length === 4) break;
  }
  // not food: a non-food label wins, or nothing scores like a meal photo
  const food = !scored[0][0].startsWith('#') && scored[0][1] > 0.24;
  return { food, top };
}
