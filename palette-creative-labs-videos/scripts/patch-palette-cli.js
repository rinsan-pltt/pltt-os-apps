#!/usr/bin/env node
"use strict"

/**
 * Teach the installed Palette CLI about `manifest.data_scope`.
 *
 * The dev-os / qa-os / os appstore API rejects a publish with
 *   "data_scope is required and must be personal or organization"
 * but @palettelab/cli 0.3.63 (the newest on npm at the time of writing) does
 * not list `data_scope` in its allowed top-level manifest keys, so its own
 * pre-flight fails first with "manifest.data_scope is not allowed". The two
 * validators disagree and there is no `--skip-validation` flag, so a publish is
 * impossible without this patch.
 *
 * The globally installed CLI (`/opt/homebrew/lib/node_modules/@palettelab/cli`,
 * what plain `pltt` runs) already carries this patch, so publishing with `pltt
 * publish --env dev` works as-is. This script patches the *local* copy under
 * ./node_modules for anyone running `npx pltt` or working on a fresh clone.
 *
 * Run it by hand: `npm run patch:cli`. It cannot be a postinstall hook —
 * `pltt test` fails plugin packages that define install lifecycle scripts.
 * Idempotent, and no-ops as soon as a CLI release knows the key — delete this
 * script and the `patch:cli` entry then.
 */

const fs = require("fs")
const path = require("path")

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "@palettelab",
  "cli",
  "lib",
  "manifest.js",
)

if (!fs.existsSync(target)) process.exit(0)

const src = fs.readFileSync(target, "utf8")
if (src.includes('"data_scope"')) process.exit(0)   // CLI caught up — nothing to do

const anchor = '  "database",\n'
if (!src.includes(anchor)) {
  console.warn("[patch-palette-cli] TOP_LEVEL_KEYS anchor not found; skipping")
  process.exit(0)
}

fs.writeFileSync(target, src.replace(anchor, anchor + '  "data_scope",\n'), "utf8")
console.log("[patch-palette-cli] allowed manifest.data_scope in @palettelab/cli")
