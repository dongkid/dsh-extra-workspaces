/**
 * dsh-extra-workspaces — host half.
 *
 * Registers one declarative option into the session-settings page (a list of
 * extra local working directories for the current session) and contributes the
 * matching runtime-context reminder: the model learns about the extra
 * directories when the list changes, not as a new prompt section every turn.
 *
 * The reminder is honest about capability. This plugin does NOT widen the
 * host's writable roots, so under 'read-only' and 'workspace-write' extra
 * directories outside those roots stay readable but not writable, and the text
 * says exactly that; an entry that happens to sit inside a writable root (the
 * session's workspace, or a system temporary directory) is described as
 * writable instead, because that is what the sandbox actually allows.
 * Values live in the session-settings store, keyed by session.
 *
 * @module dsh-extra-workspaces
 */
import { tmpdir } from 'node:os'
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
function buildRegistration(config) {
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
      // The add cap travels on the item (protocol v1 SerializedItem.max) so the
      // browser half enforces the same number this half trims to instead of
      // hard-coding its own.
      max: config.maxWorkspaces,
    }],
  }
}

/**
 * The sandbox facts the reminder needs, or undefined when the optional policy
 * service is not mounted (read through ctx.get).
 * @param ctx - host context.
 * @param session - the agent's session.
 * @returns { mode, workspaceRoot } when resolvable.
 */
function sandboxFacts(ctx, session) {
  const service = typeof ctx.get === 'function' ? ctx.get('sandboxPolicy') : undefined
  if (service === null || service === undefined || typeof service.resolve !== 'function') return undefined
  try {
    const resolved = service.resolve({ session })
    if (resolved === null || typeof resolved !== 'object') return undefined
    return {
      mode: resolved.mode,
      workspaceRoot: typeof resolved.workspaceRoot === 'string' && resolved.workspaceRoot !== ''
        ? resolved.workspaceRoot
        : undefined,
    }
  } catch {
    return undefined
  }
}

/**
 * Every path the file sandbox allows writing under workspace-write: the
 * session's workspace root plus the system temporary directories. The reminder
 * needs them so an entry inside one is not described as read-only.
 * @param facts - resolved sandbox facts, if any.
 * @returns the writable roots, empty for any other mode or when unknown.
 */
function writableRootsOf(facts) {
  if (facts === undefined || facts.mode !== 'workspace-write') return []
  return [facts.workspaceRoot, '/tmp', tmpdir()].filter(text => typeof text === 'string' && text !== '')
}

/**
 * Register the settings option and the runtime-context reminder.
 * @param ctx - host context carrying sessionSettings, plus systemPrompt when the profile mounts it.
 * @param rawConfig - untrusted plugin configuration.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)

  ctx.effect(
    () => ctx.sessionSettings.register(buildRegistration(config)),
    'dsh-extra-workspaces: session-settings option',
  )

  ctx.inject(['systemPrompt'], scope => {
    scope.systemPrompt.context({
      name: CONTEXT_NAME,
      order: CONTEXT_ORDER,
      // The body embeds user-entered aliases, notes and paths. Never treat a
      // literal "{{name}}" in them as a prompt variable: prompt assembly throws
      // on an unknown or malformed reference, and that would fail the step.
      interpolate: false,
      text: context => {
        const session = context.agent?.session
        if (session === undefined) return ''
        // This runs on the request path: a store or service failure degrades to
        // "no reminder", it must never fail the step.
        let stored
        try {
          stored = ctx.sessionSettings.getItem(PLUGIN_ID, ITEM_KEY, session.id)
        } catch {
          return ''
        }
        const entries = normalizeEntries(stored, config.maxWorkspaces)
        if (entries.length === 0) return ''
        const facts = sandboxFacts(ctx, session)
        return reminderText({
          entries,
          mode: facts?.mode,
          lang: config.reminderLanguage,
          // The session's own workspace travels with the text: an entry that
          // contains it, or sits inside it, must not be described as unwritable
          // or as outside it.
          cwd: session.header?.cwd,
          workspaceRoot: facts?.workspaceRoot,
          writableRoots: writableRootsOf(facts),
        })
      },
    })
  })
}
