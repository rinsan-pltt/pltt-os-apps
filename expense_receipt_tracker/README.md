# Expense & Receipt Tracker — Palette plugin

Scan a receipt, get the vendor/date/total read automatically, categorize it, and
export a clean CSV or PDF reimbursement report when it's time to submit. Built as
a Palette plugin with the same layout as the reference `file-convertor` app.

## Structure

```
expense_receipt_tracker/
├── palette-plugin.json          # plugin manifest (id: expense-receipt-tracker)
├── package.json                 # root npm project (pltt dev/test, build:css)
├── pyproject.toml               # backend dependencies (installed by the CLI)
├── docker-compose.yml           # postgres for expense/receipt records (optional — standalone dev uses SQLite)
├── docker-compose.platform.yml  # full platform-dev stack (Docker parity)
├── frontend/                    # palette-app framework (React 19 + Tailwind 4)
│   ├── build-css.mjs            #   compiles globals.css → app/compiled.css
│   ├── app/                     #   file-based routes: dashboard, scan, reports
│   ├── components/
│   │   ├── ui/                  #   shadcn-style primitives (button, card, dialog, …)
│   │   └── layout/              #   app shell, dashboard hero, expense list/row, badges, dropzone, form dialog
│   ├── hooks/                   #   use-expenses, use-receipt-scan
│   └── lib/                     #   api client, category/status registry, utils
└── backend/                     # FastAPI, exported as a Palette PluginRouter
    ├── api/
    │   ├── main.py               #   entry — exports `router` (+ standalone `app`)
    │   ├── routes/                #   expenses.py, receipts.py, imports.py, reports.py, categories.py
    │   └── core/                  #   db, models, ocr, imports, extraction, llm, secrets, categories, storage, reports, palette
    └── tests/                     #   pytest smoke tests
```

## What it does

| Page | Purpose |
| --- | --- |
| Dashboard (`/`) | Stat cards (total tracked, pending, reimbursed, top category), search + category/status filters, expense list with inline edit/delete |
| Scan Receipt (`/receipts/scan`) | Two tabs: scan a single receipt/invoice (image or PDF), or bulk-import an Excel/CSV spreadsheet or a PDF bank/credit-card statement — reviewed before saving either way |
| Reports (`/reports`) | Filter by category/status/date range, preview the matching expenses and total, export CSV or PDF |

Expense categories: Meals & Entertainment, Travel, Transportation, Lodging, Office
Supplies, Software & Subscriptions, Utilities, Marketing & Advertising, Professional
Services, Health & Wellness, Other — auto-guessed from the document text, editable
per expense.

### How field extraction works

- **Excel/CSV** — read directly from the spreadsheet's cells (column headers like
  `Date`/`Vendor`/`Description`/`Amount` are matched by alias), so this is
  already exact; no OCR or LLM involved.
- **PDF/image receipts, invoices, and statements** — text is extracted first
  (via `pymupdf` for PDFs, optional `pytesseract` OCR for images), then regex
  heuristics pull out the vendor, date and total. This is the baseline and
  works with zero configuration.
- **Optional LLM assist** — set `OPENAI_KEY` (see `.env.example`) and the LLM
  gets a chance to read messier documents the regex heuristics struggle with
  (multi-line invoices, varied statement layouts). It never gets the final
  word, though: every value it returns is checked against the document's own
  extracted text before being used (`backend/api/core/extraction.py`) — an
  amount, date, or vendor that doesn't actually appear in the source text is
  discarded and the heuristic result is kept instead. Nothing is ever invented.

## Develop

```bash
npm install
npm run dev        # pltt dev — app on http://localhost:7321
```

The simulator serves the frontend and mounts the backend at
`/api/v1/plugins/expense-receipt-tracker/*`. After editing `frontend/app/globals.css`
or using new Tailwind classes, regenerate the compiled CSS:

```bash
npm run build:css
```

> **Note:** Image receipt OCR requires the `tesseract` binary
> (`brew install tesseract` on macOS). Without it, image scans just leave the
> fields blank for manual entry — PDF receipts always extract text fine (no
> OCR needed there). Standalone dev and tests use a local SQLite file under
> `backend/data/` with zero setup; point `DATABASE_URL` at `docker-compose.yml`'s
> Postgres service if you want that instead.

## Test & publish

```bash
npm test           # pltt test — manifest, bundles, backend contract
npm run test:backend   # pytest against the standalone FastAPI app
pltt publish        # when ready
```

Standalone backend (no Palette, useful for API poking):

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd .. && npm run backend    # http://localhost:8000/docs
```

## API

- `GET /status` — health/status (permission: tasks:read)
- `GET /categories` — category registry (permission: resources:read)
- `GET /expenses` — list, filterable by `category`, `status`, `q`, `date_from`, `date_to`
- `GET /expenses/summary` — dashboard totals (total/pending/reimbursed amounts + by-category breakdown)
- `POST /expenses` — multipart form (`vendor`, `amount`, `currency`, `category`,
  `expense_date`, `status`, `notes`, optional `receipt` file); permission: resources:write
- `GET /expenses/{id}` / `PUT /expenses/{id}` (JSON partial update) / `DELETE /expenses/{id}`
- `GET /expenses/{id}/receipt` — stream the stored receipt file
- `POST /receipts/scan` — multipart `file`; reads one receipt/invoice and returns a
  draft (`vendor`, `amount`, `expense_date`, `category`, `llm_assisted`) for the user
  to review — nothing is saved until `POST /expenses`
- `POST /imports/preview` — multipart `file` (`.xlsx`/`.xls`/`.csv`/`.pdf`); parses
  every transaction row into a draft (nothing saved yet)
- `POST /imports/commit` — JSON `{rows: [...]}`; creates one expense per confirmed row
- `POST /reports/export` — JSON body (`ids` or `category`/`status`/`date_from`/`date_to`,
  `format: "csv" | "pdf"`); returns the report file

(Standalone `uvicorn` serves the same routes under an `/api` prefix plus `/api/health`.)
