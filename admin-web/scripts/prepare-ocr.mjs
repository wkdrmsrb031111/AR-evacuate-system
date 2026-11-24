import { mkdir, copyFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const target = path.join(root, 'public/ocr')
await mkdir(path.join(target, 'core'), { recursive: true })
await mkdir(path.join(target, 'lang'), { recursive: true })
await copyFile(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'), path.join(target, 'worker.min.js'))
for (const name of await readdir(path.join(root, 'node_modules/tesseract.js-core'))) {
  if (/\.wasm(?:\.js)?$/.test(name)) await copyFile(path.join(root, 'node_modules/tesseract.js-core', name), path.join(target, 'core', name))
}
for (const lang of ['kor', 'eng']) {
  await copyFile(path.join(root, `node_modules/@tesseract.js-data/${lang}/4.0.0/${lang}.traineddata.gz`), path.join(target, `lang/${lang}.traineddata.gz`))
}
await copyFile(path.join(root, '../demo-assets/demo-room.png'), path.join(target, 'sample.png'))
await copyFile(path.join(root, '../demo-assets/demo-corridor.png'), path.join(root, 'public/ai-sample.png'))
console.log('OCR worker, models and sample prepared locally.')
