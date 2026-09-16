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

import { API_BASE, type ApiFetch } from "./api-client"

export type TalkChannel = {
  id: string
  name: string
  type: string
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

/** Channels this app's agent is seated in. Empty = not invited anywhere yet. */
export async function listTalkChannels(apiFetch: ApiFetch): Promise<TalkChannel[]> {
  const data = await json<{ channels: TalkChannel[] }>(
    await apiFetch(`${API_BASE}/talk/channels`, { cache: "no-store" }),
  )
  return data.channels ?? []
}

/** Posts plain text as the app's agent. `channel` is an id or a name
 * ("general" / "#general"); an `@Name` in the text mentions that member or
 * agent exactly as a typed message does. */
export async function postTalkMessage(
  apiFetch: ApiFetch,
  text: string,
  channel: string,
): Promise<{ status: string }> {
  return json(
    await apiFetch(`${API_BASE}/talk/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, channel }),
    }),
  )
}

/** Announces a newsletter (title + draft/ready state) in a channel. */
export async function shareNewsletterToTalk(
  apiFetch: ApiFetch,
  newsletterId: string,
  channel: string,
  note?: string,
): Promise<{ status: string }> {
  return json(
    await apiFetch(`${API_BASE}/talk/share/${newsletterId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, note: note ?? null }),
    }),
  )
}
