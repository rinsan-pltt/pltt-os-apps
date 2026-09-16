"""Object-storage layout for app files.

Mirrors the palette-creative-labs convention (`backend/api/core/storage_helper.py`
and `backend/api/routes/assets.py` there): every object lives under an app
namespace, split by direction — `inputs/` for anything a person uploads,
`outputs/` for anything the app generates — then a folder per kind:

    corporate_card/inputs/receipts/<file>
    corporate_card/inputs/statements/<file>
    corporate_card/outputs/erp_exports/<file>

Palette prefixes the whole tree with the org-scoped bucket path, so an uploaded
receipt lands at:

    uploads/apps/corporate_card_system_<id>/<org>/corporate_card/inputs/receipts/<file>

Anything this app stores should build its key here rather than inlining a
folder string, so the two halves of the tree stay predictable.
"""

from __future__ import annotations

STORAGE_NAMESPACE = "corporate_card"
INPUT_ROOT = f"{STORAGE_NAMESPACE}/inputs"
OUTPUT_ROOT = f"{STORAGE_NAMESPACE}/outputs"

RECEIPTS = "receipts"
STATEMENTS = "statements"
ERP_EXPORTS = "erp_exports"


def input_folder(kind: str) -> str:
    """Folder holding uploads of `kind` (receipts, statements, ...)."""
    return f"{INPUT_ROOT}/{kind}"


def output_folder(kind: str) -> str:
    """Folder holding app-generated files of `kind` (erp_exports, ...)."""
    return f"{OUTPUT_ROOT}/{kind}"


def input_key(kind: str, filename: str) -> str:
    return f"{input_folder(kind)}/{filename}"


def output_key(kind: str, filename: str) -> str:
    return f"{output_folder(kind)}/{filename}"
