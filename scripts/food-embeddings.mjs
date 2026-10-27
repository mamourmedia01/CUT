import { AutoTokenizer, CLIPTextModelWithProjection, AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers';
import fs from 'fs';
const src = fs.readFileSync('/home/claude/cut/food/foods.js', 'utf8');
const window = {}; eval(src);
const foods = window.CUT_FOODS.map(f => f[0]);
const id = process.env.MID || 'Xenova/clip-vit-base-patch32';
const tok = await AutoTokenizer.from_pretrained(id);
const tm = await CLIPTextModelWithProjection.from_pretrained(id, { dtype: 'fp32' });
const prompts = foods.map(f => 'a photo of ' + f + ', a type of food.');
const extra = ['a photo of a person', 'a selfie', 'a photo of a gym', 'a screenshot of a phone', 'a photo of a room', 'a bottle of water', 'a photo of a cat', 'a photo of a dog', 'a photo of a car', 'a photo of a street', 'a photo of a document', 'an empty plate'];
const ti = tok(prompts.concat(extra), { padding: 'max_length', truncation: true });
const { text_embeds } = await tm(ti);
const E = text_embeds.normalize().tolist();
// int8 quantise each vector (scale per vector) to keep the file small
const q = E.map(v => { const m = Math.max(...v.map(Math.abs)); return { s: +(m / 127).toPrecision(6), d: Buffer.from(Int8Array.from(v.map(x => Math.round(x / m * 127))).buffer).toString('base64') }; });
fs.writeFileSync('/home/claude/cut/food/embeddings.json', JSON.stringify({ model: id, dim: E[0].length, labels: foods.concat(extra.map(x => '#' + x)), v: q }));
console.log('dim', E[0].length, 'n', E.length, 'bytes', fs.statSync('/home/claude/cut/food/embeddings.json').size);
// sanity: classify a couple of real food photos with the quantised vision model
const proc = await AutoProcessor.from_pretrained(id);
const vm = await CLIPVisionModelWithProjection.from_pretrained(id, { dtype: process.env.VD || 'q8' });
const deq = q.map(o => { const b = Buffer.from(o.d, 'base64'); return Array.from(new Int8Array(b.buffer, b.byteOffset, b.length), x => x * o.s); });
const labels = foods.concat(extra);
for (const url of process.argv.slice(2)) {
  try {
    const img = await RawImage.read(url);
    const { image_embeds } = await vm(await proc(img));
    const iv = image_embeds.normalize().tolist()[0];
    const sc = deq.map((t, i) => [labels[i], t.reduce((s, x, k) => s + x * iv[k], 0)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    console.log(url.split('/').pop().slice(0, 40), '→', sc.map(x => x[0] + ' ' + x[1].toFixed(3)).join(' | '));
  } catch (e) { console.log('img fail', url, e.message); }
}
