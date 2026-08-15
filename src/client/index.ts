/**
 * dsh-airbag Web client.
 *
 * Loaded through the official client channel (package `dsh.client`
 * declaration + `exports["./client"]`). Mounts the paste guard (A1), the
 * corner notification center (G1), and the Airbag panel (events / health
 * scan / settings / demo). Everything is torn down by the Cordis effect
 * disposer on unload.
 */
import type { Context } from '@deepseek-ai/cordis'
import { AirbagApi } from './api.ts'
import { mountPasteGuard } from './paste-guard.ts'
import { mountNotify, type NotifyApi } from './notify.ts'
import { createPanel } from './panel.ts'

export const name = 'dsh-airbag-client'

/** Client plugin activation. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const api = new AirbagApi()
    const notify: NotifyApi = mountNotify()
    let dnd = false

    const guard = mountPasteGuard(api, {
      notify: (notice, title, detail) => notify.toast(notice, title, detail),
      record: (event) => api.addEvent(event),
    })

    const panel = createPanel({
      api,
      notify,
      onSettingsSaved() {
        void guard.refresh()
      },
      isDnd() {
        return dnd
      },
      setDnd(value) {
        dnd = value
        notify.setDnd(value)
      },
    })

    // Initial state: first-run hint (yellow dot) + today's unread badge.
    const refreshBadge = async (): Promise<void> => {
      const state = await api.state().catch(() => null)
      if (state === null) return
      dnd = state.settings.dnd
      notify.setDnd(dnd)
      const events = await api.events(200).catch(() => [])
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayIso = today.toISOString()
      const unread = events.filter((e) => e.ts >= todayIso)
      if (unread.length > 0) {
        const level = Math.max(1, ...unread.map((e) => e.notice ?? 1))
        notify.setBadge(unread.length, Math.min(level, 4))
      } else if (state.scannedAt === null) {
        // First run: invite to the health scan without any popup.
        notify.setBadge(1, 1)
      } else {
        notify.setBadge(0, 0)
      }
    }
    void refreshBadge()
    // Poll so host-side interceptions (A2 write guard) surface within 30s.
    const poll = window.setInterval(() => void refreshBadge(), 30_000)

    return () => {
      window.clearInterval(poll)
      panel.dispose()
      notify.dispose()
      guard.dispose()
    }
  })
}
