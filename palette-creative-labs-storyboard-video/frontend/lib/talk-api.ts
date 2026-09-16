/**
 * Palette OS Talk client.
 *
 * `@palettelab/sdk` has NO frontend equivalent for Talk — writing into a
 * channel only happens through the Python backend, as the app's own agent
 * identity (`ctx.talk`, backend SDK >= 0.1.13, `chat:write` permission). So
 * these helpers call this plugin's own `/talk/*` routes rather than the SDK.
 *
 * The app can only post into channels a member has invited its agent to, and
 * `listTalkChannels()` (ids/names/types of those rooms) is the only Talk read
 * it gets — no history, no members, no search.
 */

import { apiRequest } from "./api-helper"

export type TalkChannel = {
  id: string
  name: string
  type: string
}

/** Channels this app's agent is seated in. Empty = not invited anywhere yet. */
export async function listTalkChannels(): Promise<TalkChannel[]> {
  const data = await apiRequest("/talk/channels")
  return (data?.channels ?? []) as TalkChannel[]
}

/** Posts plain text as the app's agent. `channel` is an id or a name
 * ("general" / "#general"); an `@Name` in the text mentions that member or
 * agent exactly as a typed message does. */
export async function postTalkMessage(text: string, channel: string) {
  return apiRequest("/talk/message", {
    method: "POST",
    body: JSON.stringify({ text, channel }),
  })
}

/** Shares a finished generation (output URL + prompt + model) into a channel. */
export async function shareGenerationToTalk(
  itemId: string,
  channel: string,
  note?: string,
) {
  return apiRequest(`/talk/share/${itemId}`, {
    method: "POST",
    body: JSON.stringify({ channel, note: note ?? null }),
  })
}
