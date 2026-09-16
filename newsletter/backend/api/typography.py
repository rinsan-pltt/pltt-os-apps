"""Single source of truth for newsletter typography + page geometry.

Mirror of frontend/src/lib/typography.ts — keep the numeric values and the
structure in sync or the PDF export will diverge from the on-screen preview.
"""

from typing import TypedDict


class TypeToken(TypedDict):
    size: int  # px
    weight: int  # 400 / 500 / 700
    leading: float  # unitless ratio (line-height)
    tracking: float  # em


class LayoutTypo(TypedDict):
    title: TypeToken
    summary: TypeToken
    content: TypeToken


_SECTION_TITLE: TypeToken = {
    "size": 18,
    "weight": 700,
    "leading": 1.375,
    "tracking": -0.01,
}

_SUMMARY: TypeToken = {
    "size": 14,
    "weight": 500,
    "leading": 1.625,
    "tracking": 0.0,
}

_CONTENT: TypeToken = {
    "size": 15,
    "weight": 400,
    "leading": 28 / 15,  # tailwind leading-7 = 28px absolute
    "tracking": 0.0,
}

_TITLE_ONLY: LayoutTypo = {
    "title": {"size": 28, "weight": 700, "leading": 1.25, "tracking": -0.01},
    "summary": {"size": 16, "weight": 500, "leading": 1.625, "tracking": 0.0},
    "content": _CONTENT,
}

_HERO_IMAGE: LayoutTypo = {
    "title": {"size": 22, "weight": 700, "leading": 1.25, "tracking": -0.01},
    "summary": {"size": 16, "weight": 500, "leading": 1.625, "tracking": 0.0},
    "content": _CONTENT,
}

_PAIRED_COLUMN: LayoutTypo = {
    "title": {"size": 16, "weight": 700, "leading": 1.375, "tracking": -0.01},
    "summary": _SUMMARY,
    "content": _CONTENT,
}

_SECTION: LayoutTypo = {
    "title": _SECTION_TITLE,
    "summary": _SUMMARY,
    "content": _CONTENT,
}

TYPO: dict[str, LayoutTypo] = {
    "title_only": _TITLE_ONLY,
    "hero_image": _HERO_IMAGE,
    "paired_column": _PAIRED_COLUMN,
    "single_column": _SECTION,
    "two_column": _SECTION,
    "feature_split": _SECTION,
    "sidebar": _SECTION,
    "gallery": _SECTION,
    "text_only": _SECTION,
    "image_right": _SECTION,
    "six_image_grid": _SECTION,
    "three_across": _SECTION,
    "image_trio": _SECTION,
    "two_image_single_column": _SECTION,
    "banner_text": _SECTION,
}


def typo_for(layout: str) -> LayoutTypo:
    return TYPO.get(layout, _SECTION)


class PageGeom(TypedDict):
    padding_mm: int
    footer_mm: int


PAGE: PageGeom = {"padding_mm": 12, "footer_mm": 6}
