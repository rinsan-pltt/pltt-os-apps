"""Prompt construction for newsletter generation. A single grounded call that
also picks layout per block. The user picks the brand theme (palette/typography/
headers/footers) explicitly — the LLM never invents colors."""

LAYOUT_KEYS = [
    "title_only",
    "single_column",
    "two_column",
    "hero_image",
    "feature_split",
    "sidebar",
    "gallery",
    "text_only",
    "image_right",
    "six_image_grid",
    "three_across",
    "image_trio",
    "two_image_single_column",
    "banner_text",
    "paired_column",
]

SYSTEM = """You are an expert newsletter editor. You turn retrieved source excerpts into a tight, well-structured newsletter.

Rules:
- Ground every block ONLY in the supplied source chunks. Never invent facts, numbers, names, or dates that are not present in the chunks.
- Cluster the chunks by topic. One block per distinct topic — do not emit one block per chunk when several chunks cover the same topic.
- The FIRST block is the masthead: layout_key "title_only", a short title, and a one-line summary of the whole issue.
- Each subsequent block: a specific title; a summary of 50-90 characters that includes exactly one <mark>...</mark> highlight; content of at most ~480 characters in 1-2 short paragraphs (you may use <strong> and <em> sparingly).
- Pick each block's layout_key from this exact set: {layouts}. Use hero_image for the lead story, two_column or sidebar for narrative+stat, feature_split for two related features, single_column otherwise.
- image_desc: a short English image-generation prompt describing a fitting editorial image (empty string for title_only).
- For every non-masthead block, list the chunk_ids you actually used in "citation_chunk_ids".

Return ONLY a JSON object of this exact shape:
{{
  "blocks": [
    {{"layout_key": "...", "title": "...", "summary": "...", "content": "...", "image_desc": "...", "citation_chunk_ids": ["..."]}}
  ]
}}
No prose, no code fences."""


def build_generation_messages(
    *,
    title: str,
    language: str,
    tone: str,
    block_count: int,
    focus_prompt: str,
    chunks: list[dict],
) -> tuple[str, str]:
    system = SYSTEM.format(layouts=", ".join(LAYOUT_KEYS))

    chunk_lines = []
    for ch in chunks:
        chunk_lines.append(f'[chunk_id={ch["chunkId"]}] (from {ch["documentName"]})\n{ch["content"]}')
    chunks_blob = "\n\n".join(chunk_lines)

    user = f"""Newsletter title: {title or "(propose one)"}
Language: {language}
Tone: {tone}
Target number of blocks (including the masthead): {block_count}
Editorial focus: {focus_prompt or "(no specific focus — summarize what matters most)"}

Source chunks retrieved for this issue:
{chunks_blob}

Write the newsletter now as the JSON object specified. Produce about {block_count} blocks total."""
    return system, user
