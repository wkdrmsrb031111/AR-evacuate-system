import { createWorker, PSM } from 'tesseract.js'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const started = performance.now()
const worker = await createWorker('kor+eng', 1, { langPath: path.join(root, 'public/ocr/lang'), cacheMethod: 'none' })
const startupMs = Math.round(performance.now() - started)
const cases = [
  { file: 'demo-room.png', expected: 'ai 듣기', crop: { left: 560, top: 75, width: 350, height: 110 } },
  { file: 'demo-corridor.png', expected: '복도 갈림길', crop: { left: 790, top: 440, width: 320, height: 90 } },
  { file: 'demo-east-stairs.png', expected: '동쪽 비상계단', crop: { left: 970, top: 325, width: 390, height: 90 } },
]
const results = []
try {
  for (const item of cases) {
    for (const cropped of [false, true]) {
      await worker.setParameters({ tessedit_pageseg_mode: cropped ? PSM.SINGLE_LINE : PSM.AUTO })
      const start = performance.now()
      const { data } = await worker.recognize(path.resolve(root, '../demo-assets', item.file), cropped ? { rectangle: item.crop } : {})
      const result = { file: item.file, region: cropped ? item.crop : 'whole', expected: item.expected, text: data.text.trim(), modelConfidence: data.confidence, exactTextContained: normalize(data.text).includes(normalize(item.expected)), recognitionMs: Math.round(performance.now() - start) }
      results.push(result); console.log(JSON.stringify(result))
    }
  }
  const negativeText = results.find(r => r.file === 'demo-room.png' && r.region !== 'whole').text
  const report = { testedAt: new Date().toISOString(), environment: 'PC Node.js, Tesseract.js 7, kor+eng; not Galaxy', fixtureNotice: 'Three generated demo photographs. Regions manually selected. Not a real-building accuracy benchmark.', startupMs, results, negativeControl: { recognizedText: negativeText, wrongExpected: '복도 갈림길', matched: normalize(negativeText).includes(normalize('복도 갈림길')) } }
  await mkdir(path.join(root, 'ai-verification'), { recursive: true })
  await writeFile(path.join(root, 'ai-verification/benchmark.json'), JSON.stringify(report, null, 2))
} finally { await worker.terminate() }
