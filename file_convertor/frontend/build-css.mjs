#!/usr/bin/env node
/**
 * Compile Tailwind 4 (+ the project's globals.css) to generated artifacts.
 * The @palettelab/cli collects CSS bundle output, scopes it under the plugin
 * root, and injects it into Palette OS. The bundler does NOT run Tailwind, so
 * compiled.css must be regenerated after editing globals.css or whenever new
 * Tailwind utility classes are used:
 *
 *   npm run build:css
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

const inputCss = resolve(__dirname, "app/globals.css")
const tmpCss = resolve(__dirname, "app/.tw.css")
const outCss = resolve(__dirname, "app/compiled.css")
const outTs = resolve(__dirname, "app/compiled-css.ts")

function extractExistingCompiledCss() {
  if (!existsSync(outTs)) return null
  const source = readFileSync(outTs, "utf8")
  const match = source.match(/export const COMPILED_CSS = (.*)\s*$/s)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

/**
 * Ship every Tailwind utility UNLAYERED. Palette OS renders plugins into the
 * shared, host-styled DOM whose own preflight resets are unlayered, and
 * unlayered rules outrank anything in a cascade layer. Lifting utilities out
 * of `@layer utilities` gives each class its real (0,1,0) specificity so the
 * plugin's colors beat the host's universal resets.
 */
function unwrapUtilitiesLayer(src) {
  const marker = "@layer utilities{"
  const start = src.indexOf(marker)
  if (start === -1) return src
  const contentStart = start + marker.length
  let depth = 1
  let i = contentStart
  for (; i < src.length && depth > 0; i++) {
    const c = src[i]
    if (c === "{") depth++
    else if (c === "}") depth--
  }
  if (depth !== 0) {
    throw new Error("build-css: could not brace-match the @layer utilities block")
  }
  return src.slice(0, start) + src.slice(contentStart, i - 1) + src.slice(i)
}

let compiled
try {
  execFileSync("npx", ["@tailwindcss/cli@latest", "-i", inputCss, "-o", tmpCss, "--minify"], {
    cwd: root,
    stdio: "inherit",
    timeout: 60_000,
  })
  compiled = unwrapUtilitiesLayer(readFileSync(tmpCss, "utf8"))
} catch (error) {
  const fallback = extractExistingCompiledCss()
  if (!fallback) throw error
  console.warn("build-css: Tailwind CLI unavailable; reused existing compiled-css.ts")
  compiled = fallback
}

const css = compiled
const ts = `// AUTO-GENERATED. Run \`npm run build:css\` to regenerate.
// Compiled Tailwind 4 output for the File Convertor plugin.
export const COMPILED_CSS = ${JSON.stringify(css)}
`
mkdirSync(dirname(outTs), { recursive: true })
writeFileSync(outCss, css)
writeFileSync(outTs, ts)
console.log(`compiled.css and compiled-css.ts written (${css.length} bytes of CSS)`)
