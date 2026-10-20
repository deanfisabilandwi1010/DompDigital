// Menyalin ilustrasi sumber ke public/assets/retro dengan nama tujuan,
// plus versi WebP (alpha dipertahankan) yang lebih ringan. Sumber asli tidak diubah.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const map = [
  ['Assets/dfa46874-a984-4648-af71-cc79b69b140c.png', 'kantong-mascot'],
  ['Assets/Happy sprout savings jar.png', 'tabungan-jar'],
  ['Assets/c28885f5-a097-4891-a213-ee765e292ba8.png', 'laporan-crt'],
];
const out = 'public/assets/retro';
await mkdir(out, { recursive: true });
for (const [src, name] of map) {
  const img = sharp(src);
  const meta = await img.metadata();
  console.log(name, meta.width, 'x', meta.height, 'alpha:', meta.hasAlpha);
  await sharp(src).resize(512, 512, { fit: 'inside' }).png({ compressionLevel: 9, palette: true }).toFile(`${out}/${name}.png`);
  await sharp(src).resize(512, 512, { fit: 'inside' }).webp({ quality: 82, alphaQuality: 90 }).toFile(`${out}/${name}.webp`);
}
