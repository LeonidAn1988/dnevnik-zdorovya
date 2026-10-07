import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Public files are copied before writeBundle: generate the worker afterwards
 * so that the public template cannot overwrite its complete build manifest. */
function offlinePrecache(): Plugin {
  let publicDir: string
  let outDir: string
  const filesIn = (dir: string, prefix = ''): string[] => readdirSync(dir, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.')).flatMap(entry => {
    const name = prefix + entry.name
    return entry.isDirectory() ? filesIn(join(dir, entry.name), name + '/') : [name]
  })
  return {
    name: 'offline-precache',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir
      outDir = resolve(config.root, config.build.outDir)
    },
    writeBundle(_options, bundle) {
      const template = readFileSync(join(publicDir, 'sw.js'), 'utf8')
      const files = [...new Set([...Object.keys(bundle), ...filesIn(publicDir)])].filter(name => name !== 'sw.js').sort()
      const hash = createHash('sha256').update(template)
      for (const name of files) hash.update(name).update('\0').update(readFileSync(join(outDir, name))).update('\0')
      const buildId = hash.digest('hex').slice(0, 20)
      const marker = "/* __PRECACHE__ */ ['./', './index.html']"
      if (!template.includes('__BUILD_ID__') || !template.includes(marker)) throw new Error('Missing service worker build markers')
      const worker = template.replace('__BUILD_ID__', buildId).replace(marker, JSON.stringify(['./', ...files.map(name => './' + name)]))
      writeFileSync(join(outDir, 'sw.js'), worker)
    },
  }
}

// Web Bluetooth требует secure context.
//   npm run dev      -> http://localhost:5199        (localhost считается защищённым, годится для Mac)
//   npm run dev:lan  -> https://<ip-мака>:5199       (самоподписанный сертификат, нужен для Android)
const lan = process.env.LAN === '1'

export default defineConfig({
  base: './',
  plugins: [react(), ...(lan ? [basicSsl()] : []), offlinePrecache()],
  server: {
    port: 5199,
    host: lan ? true : 'localhost',
    strictPort: true,
  },
  preview: { port: 5199, host: true },
})
