// Custom drag MIME stamped on drags that start from a generated workspace
// image. It carries the item's identity as JSON (id, url, prompt, model,
// project/keyframe) so drop targets can act on the ITEM, not just its URL —
// e.g. dropping onto the chat panel anchors the chat to that image's thread,
// exactly like clicking its Edit button. Targets that only care about the
// pixels (prompt box, references strip) keep reading `text/uri-list` and are
// unaffected by the extra type.
export const ITEM_DRAG_TYPE = "application/x-pltt-item"

export type DraggedItemPayload = {
  id: string
  url?: string
  prompt?: string
  model_name?: string
  key_frame_id?: string
  project_id?: string
}

export const setItemDragPayload = (
  dt: DataTransfer,
  item: DraggedItemPayload,
) => {
  try {
    dt.setData(ITEM_DRAG_TYPE, JSON.stringify(item))
  } catch {
    /* exotic browsers without custom-type support — URL types still work */
  }
}

export const getItemDragPayload = (dt: DataTransfer): DraggedItemPayload | null => {
  try {
    const raw = dt.getData(ITEM_DRAG_TYPE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraggedItemPayload
    return parsed && typeof parsed.id === "string" ? parsed : null
  } catch {
    return null
  }
}
