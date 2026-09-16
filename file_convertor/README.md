# File Convertor — Palette plugin

Every tool you need to work with your files in one place — convert, compress, merge,
split and protect PDFs, Office documents and images (inspired by iLovePDF).
Built as a Palette plugin with the same layout as the pltt-creative reference app.

## Structure

```
file_convertor/
├── palette-plugin.json          # plugin manifest (id: file-convertor)
├── package.json                 # root npm project (pltt dev/test, build:css)
├── pyproject.toml               # backend dependencies (installed by the CLI)
├── docker-compose.yml           # postgres helper (plugin declares no DB yet)
├── docker-compose.platform.yml  # full platform-dev stack (Docker parity)
├── frontend/                    # palette-app framework (React 19 + Tailwind 4)
│   ├── build-css.mjs            #   compiles globals.css → app/compiled.css
│   ├── app/                     #   file-based routes: home grid + tools/[slug]
│   ├── components/
│   │   ├── ui/                  #   shadcn-style primitives (button, card, input, …)
│   │   └── layout/              #   app shell, tool grid/cards, dropzone, workspace
│   ├── hooks/                   #   use-tool-runner
│   └── lib/                     #   tool registry, API helper (platform apiFetch), utils
└── backend/                     # FastAPI, exported as a Palette PluginRouter
    ├── api/
    │   ├── main.py              #   entry — exports `router` (+ standalone `app`)
    │   ├── routes/              #   tools.py — POST /tools/{slug}
    │   └── core/                #   pdf_ops, convert_ops, office, files, palette
    └── tests/                   #   pytest smoke tests
```

## Tools

| Category | Tools |
| --- | --- |
| Organize PDF | Merge, Split, Compress, Rotate |
| Convert to PDF | Word, PowerPoint, Excel, JPG/images, Text |
| Convert from PDF | Word (DOCX), PowerPoint (PPTX), Excel (XLSX), JPG, Text |
| PDF Security | Protect (AES-256), Unlock |
| Images | Convert between JPG / PNG / WEBP / BMP / TIFF / GIF |

## Develop

```bash
npm install
npm run dev        # pltt dev — app on http://localhost:7321
```

The simulator serves the frontend and mounts the backend at
`/api/v1/plugins/file-convertor/*`. After editing `frontend/app/globals.css` or
using new Tailwind classes, regenerate the compiled CSS:

```bash
npm run build:css
```

> **Note:** Word/Excel/PowerPoint → PDF requires LibreOffice
> (`brew install --cask libreoffice` on macOS). Everything else works out of the box.

## Test & publish

```bash
npm test           # pltt test — manifest, bundles, backend contract
npm run test:backend   # pytest against the standalone FastAPI app
pltt publish       # when ready
```

Standalone backend (no Palette, useful for API poking):

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd .. && npm run backend    # http://localhost:8000/docs
```

## API

- `GET /status` — health/status (permission: tasks:read)
- `GET /tools` — tool registry (permission: resources:read)
- `POST /tools/{slug}` — multipart form with `files` (one or many) plus tool options
  (`ranges`, `level`, `angle`, `password`, `format`); permission: resources:write.
  Returns the converted file, or a zip when a tool produces several files. Uploads
  are stored in an isolated temp dir and deleted right after the response is sent.

(Standalone `uvicorn` serves the same routes under an `/api` prefix plus `/api/health`.)
