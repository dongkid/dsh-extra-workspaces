/**
 * dsh-extra-workspaces — host half.
 *
 * Registers one declarative option into the session-settings page (a list of
 * extra local working directories for the current session) and contributes the
 * matching runtime-context reminder: the model learns about the extra
 * directories when the list changes, not as a new prompt section every turn.
 *
 * The reminder is honest about capability. This plugin does NOT widen the
 * host's writable roots, so under 'read-only' and 'workspace-write' the extra
 * directories stay readable but not writable, and the text says exactly that.
 * Values live in the session-settings store, keyed by session.
 *
 * @module dsh-extra-workspaces
 */
import { reminderText, normalizeEntries, DEFAULT_MAX_WORKSPACES } from './rules.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-extra-workspaces'

/** The session-settings service owns the registration channel and the store. */
export const inject = ['sessionSettings']

/** Registration identity shared with the browser half. */
export const PLUGIN_ID = 'dsh-extra-workspaces'
/** The single declarative item the browser half renders. */
export const ITEM_KEY = 'workspaces'
/** Runtime-context contribution name. */
export const CONTEXT_NAME = 'extra-workspaces:context'
/**
 * Position inside the runtime-context snapshot: after the sandbox policy (110)
 * and the approval policy (115), before subagent delegation (120). That table
 * lives in dsh-system-prompt, which an out-of-tree plugin cannot extend, so the
 * position is stated here once.
 */
export const CONTEXT_ORDER = 118

/** Copy for the settings card, both languages, same keys (protocol section 2.1). */
export const LOCALE = Object.freeze({
  zh: {
    title: '额外工作区',
    itemTitle: '额外工作区',
    itemDescription: '给这个会话加上额外的本地目录。清单随会话保存；它不会扩大 DSH 允许写入的范围。',
  },
  en: {
    title: 'Extra workspaces',
    itemTitle: 'Extra workspaces',
    itemDescription: 'Attach extra local directories to this session. The list is stored with the session; it does not widen what DSH allows writing to.',
  },
})

/**
 * Validate plugin configuration. Unknown fields are ignored; a malformed value
 * keeps the documented default rather than failing the whole plugin.
 * @param raw - the plugin config from cordis.yml.
 * @returns the accepted { maxWorkspaces, reminderLanguage }.
 */
export function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const max = Number.isInteger(source.maxWorkspaces) && source.maxWorkspaces > 0
    ? Math.min(source.maxWorkspaces, 64)
    : DEFAULT_MAX_WORKSPACES
  return { maxWorkspaces: max, reminderLanguage: source.reminderLanguage === 'en' ? 'en' : 'zh' }
}

/** The declarative registration the settings page renders. */
function buildRegistration() {
  return {
    pluginId: PLUGIN_ID,
    title: 'title',
    order: 30,
    locale: LOCALE,
    items: [{
      key: ITEM_KEY,
      // Closest declared control type. The browser half supplies its own
      // renderer, so the built-in line-per-entry control is never used.
      type: 'stringList',
      title: 'itemTitle',
      description: 'itemDescription',
      default: [],
    }],
  }
}

/**
 * The session's resolved permission mode, or undefined when the service is not
 * mounted (optional service, read through ctx.get).
 */
function permissionMode(ctx, session) {
  const service = typeof ctx.get === 'function' ? ctx.get('sandboxPolicy') : undefined
  if (service === null || service === undefined || typeof service.resolve !== 'function') return undefined
  try {
    return service.resolve({ session }).mode
  } catch {
    return undefined
  }
}

/**
 * Register the settings option and the runtime-context reminder.
 * @param ctx - host context carrying sessionSettings, plus systemPrompt when the profile mounts it.
 * @param rawConfig - untrusted plugin configuration.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)

  ctx.effect(
    () => ctx.sessionSettings.register(buildRegistration()),
    'dsh-extra-workspaces: session-settings option',
  )

  ctx.inject(['systemPrompt'], scope => {
    scope.systemPrompt.context({
      name: CONTEXT_NAME,
      order: CONTEXT_ORDER,
      text: context => {
        const session = context.agent?.session
        if (session === undefined) return ''
        const stored = ctx.sessionSettings.getItem(PLUGIN_ID, ITEM_KEY, session.id)
        const entries = normalizeEntries(stored, config.maxWorkspaces)
        if (entries.length === 0) return ''
        return reminderText({
          entries,
          mode: permissionMode(ctx, session),
          lang: config.reminderLanguage,
          // The session's own workspace travels with the text: an entry that
          // contains it must not be described as unwritable.
          cwd: session.header?.cwd,
        })
      },
    })
  })
}
