/* global process */
/**
 * Trellis Session Start Plugin (OpenCode v2)
 *
 * Injects compact SessionStart context into the outgoing model request via
 * `ctx.session.hook("context", ...)` — an ephemeral edit to the request's
 * system parts. TUI / stored history / SQLite stay untouched.
 *
 * OpenCode v2 requires plugins to default-export `{ id, setup }`
 * (schema: `{id, effect}` | `{id, setup}`). The v1 factory-function export
 * fails with "Plugin must export a default definition with an id and an
 * effect or setup function."
 */

import { TrellisContext, debugLog, isTrellisSubagent } from "../lib/trellis-context.js"
import {
  prependSystemText,
  transcriptHasAssistantMessageV2,
} from "../lib/context-visibility.js"
import { buildSessionContext } from "../lib/session-utils.js"

const FIRST_REPLY_NOTICE_RE = /<first-reply-notice>[\s\S]*?<\/first-reply-notice>\s*/g

function stripFirstReplyNotice(context) {
  return context.replace(FIRST_REPLY_NOTICE_RE, "")
}

export default {
  id: "trellis.session-start",
  async setup(ctx) {
    const directory = ctx.location?.directory || process.cwd()
    const tctx = new TrellisContext(directory)
    debugLog("session", "Plugin loaded, directory:", directory)

    await ctx.session.hook("context", async (event) => {
      try {
        const platformInput = { sessionID: event.sessionID, agent: event.agent }
        const agent = event.agent || "unknown"
        debugLog("session", "context hook called, agent:", agent)

        if (isTrellisSubagent(platformInput)) {
          debugLog("session", "Skipping trellis subagent turn:", agent)
          return
        }

        if (process.env.TRELLIS_HOOKS === "0" || process.env.TRELLIS_DISABLE_HOOKS === "1") {
          debugLog("session", "Skipping - TRELLIS_HOOKS disabled")
          return
        }

        if (process.env.OPENCODE_NON_INTERACTIVE === "1") {
          debugLog("session", "Skipping - non-interactive mode")
          return
        }

        let context = buildSessionContext(tctx, platformInput)
        if (transcriptHasAssistantMessageV2(event.messages)) {
          context = stripFirstReplyNotice(context)
        }
        debugLog("session", "Built context, length:", context.length)
        prependSystemText(event.system, context)
      } catch (error) {
        debugLog("session", "Error in context hook:", error.message, error.stack)
      }
    })
  },
}
