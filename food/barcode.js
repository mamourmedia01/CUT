// Cut Log: scan a packaged food's barcode, look it up in Open Food Facts (free, open database, no key).
// iPhone Safari has no built-in barcode reader, so the ZXing engine (WebAssembly) does the reading.
import { BarcodeDetector as Poly } from 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.2/+esm';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
let det = null;
export async function detector() {
  if (det) return det;
  try {
    if ('BarcodeDetector' in window) {
      const f = await window.BarcodeDetector.getSupportedFormats();
      if (FORMATS.some(x => f.includes(x))) return (det = new window.BarcodeDetector({ formats: FORMATS.filter(x => f.includes(x)) }));
    }
  } catch (e) {}
  return (det = new Poly({ formats: FORMATS }));
}

// source: <video>, <img>, <canvas> or ImageBitmap → barcode digits or null
export async function read(source) {
  const d = await detector();
  const found = await d.detect(source);
  const hit = found.find(b => /^\d{8,14}$/.test(b.rawValue));
  return hit ? hit.rawValue : null;
}

const num = v => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v; return typeof n === 'number' && isFinite(n) ? n : null; };
// digits → { name, kcal, serving, per100, code } or null (not in the database)
export async function lookup(code) {
  const r = await fetch('https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json?fields=product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,quantity,product_quantity');
  if (!r.ok && r.status !== 404) throw new Error('lookup ' + r.status);
  const j = await r.json().catch(() => ({}));
  if (!j || j.status !== 1 || !j.product) return null;
  const p = j.product, n = p.nutriments || {};
  const brand = (p.brands || '').split(',').map(b => b.trim()).filter(Boolean).sort((a, b) => a.length - b.length)[0] || '';
  let name = (p.product_name_en || p.product_name || '').trim() || 'Packaged food';
  if (brand && !name.toLowerCase().includes(brand.toLowerCase())) name = brand + ' ' + name;
  const per100 = num(n['energy-kcal_100g']) != null ? num(n['energy-kcal_100g']) : (num(n['energy_100g']) != null ? num(n['energy_100g']) / 4.184 : null);
  let kcal = num(n['energy-kcal_serving']), serving = p.serving_size || '';
  if (kcal == null && per100 != null) {
    const sq = num(p.serving_quantity), pq = num(p.product_quantity);
    if (sq) { kcal = per100 * sq / 100; serving = serving || sq + ' g'; }
    else if (pq && pq <= 600) { kcal = per100 * pq / 100; serving = 'whole pack (' + (p.quantity || pq + ' g') + ')'; }
    else { kcal = per100; serving = '100 g'; }
  }
  if (kcal == null) return { name, kcal: null, serving, per100, code };
  return { name: name.slice(0, 60), kcal: Math.round(kcal), serving, per100: per100 != null ? Math.round(per100) : null, code };
}
