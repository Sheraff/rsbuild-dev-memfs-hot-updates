// node repro.mjs [--cycles=200] [--rotate-chunk] [--rspack-clean]
// Starts the Rsbuild dev server (no browser), edits src/index.js N times, and
// after each batch lists the dev middleware's in-memory output file system.
import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { createRsbuild } from '@rsbuild/core'

const root = new URL('.', import.meta.url).pathname
const cycles = Number(process.argv.find((a) => a.startsWith('--cycles='))?.slice(9) ?? 200)
const rotateChunk = process.argv.includes('--rotate-chunk')
const rspackClean = process.argv.includes('--rspack-clean') // control: does Rspack's output.clean prune the memfs?
const entry = root + 'src/index.js'
const chunkDir = root + 'src/chunks/'

// ~8 KB of plain functions, so each hot update has the size of a real module.
const body = Array.from({ length: 120 }, (_, k) => `export function fn${k}(a, b) { return helper(a + b + ${k}) }`).join('\n')
const source = (i) =>
  `import { helper } from './helper.js'\nexport const n = ${i}\nconsole.log(helper(n))\n${body}\n` +
  (rotateChunk ? `import('./chunks/lazy-${i}.js').then((m) => console.log(m.lazy))\n` : '')
const resetChunks = () => {
  for (const f of readdirSync(chunkDir)) {
    if (f !== '.gitkeep') rmSync(chunkDir + f)
  }
}
resetChunks()
if (rotateChunk) writeFileSync(`${chunkDir}lazy-0.js`, 'export const lazy = 0\n')
writeFileSync(entry, source(0))

let compiler
let compiles = 0
const rsbuild = await createRsbuild({
  cwd: root,
  rsbuildConfig: {
    root,
    logLevel: 'warn',
    source: { entry: { index: './src/index.js' } },
    server: { port: 3199, strictPort: true, printUrls: false },
    tools: rspackClean ? { rspack: { output: { clean: true } } } : undefined,
  },
})
rsbuild.onAfterCreateCompiler((p) => {
  compiler = p.compiler
})
rsbuild.onAfterDevCompile(() => {
  compiles++
})
const devServer = await rsbuild.startDevServer()

const waitForCompile = async (seen) => {
  const until = Date.now() + 20000
  while (compiles === seen) {
    if (Date.now() > until) throw new Error('no compilation within 20 s')
    await sleep(20)
  }
  await sleep(100)
}

const ofs = compiler.outputFileSystem
const distPath = compiler.options.output.path
const listFiles = (dir, out = []) => {
  for (const d of ofs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + '/' + d.name
    if (d.isDirectory()) listFiles(p, out)
    else out.push(p)
  }
  return out
}
const mb = (b) => (b / 1048576).toFixed(1)
const row = (i) => {
  const files = listFiles(distPath)
  const bytes = files.reduce((s, f) => s + ofs.statSync(f).size, 0)
  const hot = files.filter((f) => f.includes('.hot-update.')).length
  const lazy = files.filter((f) => /lazy[-_]/.test(f.slice(distPath.length))).length
  console.log(
    `edits=${String(i).padStart(4)} memfsFiles=${String(files.length).padStart(4)} hotUpdateFiles=${String(hot).padStart(4)}` +
      (rotateChunk ? ` lazyChunkFiles=${String(lazy).padStart(4)}` : '') +
      ` memfsBytes=${mb(bytes).padStart(5)}MB rss=${mb(process.memoryUsage().rss)}MB`,
  )
}

try {
  if (compiles === 0) await waitForCompile(0)
  row(0)
  for (let i = 1; i <= cycles; i++) {
    const seen = compiles
    if (rotateChunk) {
      writeFileSync(`${chunkDir}lazy-${i}.js`, `export const lazy = ${i}\n`)
    }
    writeFileSync(entry, source(i))
    await waitForCompile(seen)
    if (rotateChunk) rmSync(`${chunkDir}lazy-${i - 1}.js`)
    if (i % 25 === 0) row(i)
  }
  const sample = listFiles(distPath).filter((f) => f.includes('.hot-update.')).slice(0, 4)
  console.log('\nsample of retained files:', sample.map((f) => f.slice(distPath.length + 1)))
} finally {
  writeFileSync(entry, source(0))
  resetChunks()
  await devServer.server.close()
}
