import { copyFile, mkdir, readFile, cp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = path.join(root, 'dist')
const target = path.resolve(root, '../sites/camera-test/dist')
const html = await readFile(path.join(source, 'camera.html'), 'utf8')
await mkdir(target, { recursive: true })
await copyFile(path.join(source, 'camera.html'), path.join(target, 'index.html'))
const copied = new Set()
async function copyAsset(relative) {
  const name = relative.replace(/^\//, '')
  if (copied.has(name)) return
  const filename = path.resolve(source, name)
  if (!filename.startsWith(`${source}${path.sep}`)) throw new Error('Asset outside build output')
  copied.add(name)
  await mkdir(path.dirname(path.join(target, name)), { recursive: true })
  await copyFile(filename, path.join(target, name))
  if (name.endsWith('.js')) {
    const js = await readFile(filename, 'utf8')
    for (const match of js.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)["'`]([^"'`]+)["'`]/g)) {
      if (match[1].startsWith('.')) await copyAsset(path.posix.join(path.posix.dirname(name), match[1]))
    }
  }
}
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) await copyAsset(match[1])
await copyFile(path.join(root, 'public/camera-route-demo.json'), path.join(target, 'camera-route-demo.json'))
await copyFile(path.resolve(root, '../demo-assets/demo-corridor.png'), path.join(target, 'ai-sample.png'))
await cp(path.join(root, 'public/ocr'), path.join(target, 'ocr'), { recursive: true })
console.log(`Camera-only export: ${copied.size} assets and demo route`)
