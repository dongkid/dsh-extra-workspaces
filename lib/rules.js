/**
 * dsh-extra-workspaces — the entry rules, as plain functions over plain data.
 *
 * No DSH imports, no I/O and no clock, so the parts a bug would hide in (path
 * comparison, duplicate and overlap refusal, the cap) stay directly testable.
 * The browser half mirrors these rules for immediate feedback; this module is
 * the host's copy and the one the reminder text is built from.
 * @module dsh-extra-workspaces/rules
 */

/** Default cap on extra workspaces per session. */
export const DEFAULT_MAX_WORKSPACES = 8

/** Languages the reminder text is written in. */
export const REMINDER_LANGUAGES = Object.freeze(['zh', 'en'])

const WINDOWS = process.platform === 'win32'
const SEPARATOR = WINDOWS ? '\\' : '/'

function asText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Comparison form of one path: trailing separators dropped, '/' unified to the
 * platform's separator, and case-folded on Windows (where paths are
 * case-insensitive). Deliberately lexical: a path that does not exist yet still
 * compares, and two spellings of one directory must not both be accepted.
 * @param path - a candidate directory path.
 * @returns the comparison form; '' for a non-string or blank path.
 */
export function comparablePath(path) {
  const text = asText(path)
  if (text === '') return ''
  const withoutTrailer = text.replace(/[\\/]+$/, '')
  return WINDOWS ? withoutTrailer.replaceAll('/', '\\').toLowerCase() : withoutTrailer
}

/**
 * Whether two directory paths name the same directory.
 * @param left - one path.
 * @param right - the other path.
 * @returns true when both are non-blank and compare equal.
 */
export function isSamePath(left, right) {
  const a = comparablePath(left)
  const b = comparablePath(right)
  return a !== '' && a === b
}

/**
 * Whether one directory contains another (or is the same directory).
 * @param parent - the candidate containing directory.
 * @param child - the candidate contained directory.
 * @returns true when child equals parent or sits underneath it.
 */
export function containsPath(parent, child) {
  const outer = comparablePath(parent)
  const inner = comparablePath(child)
  if (outer === '' || inner === '') return false
  if (outer === inner) return true
  return inner.startsWith(outer + SEPARATOR)
}

/**
 * The default alias of a path: its last segment without any trailing separator.
 * @param path - a directory path.
 * @returns the segment, or the whole trimmed path when it has none.
 */
export function defaultAlias(path) {
  const trimmed = asText(path).replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

/**
 * Reduce a stored value to the entries the host will actually use.
 *
 * Anything that is not a plain object with a non-blank path is dropped; a
 * duplicate of an accepted path is dropped; a path that overlaps an accepted
 * entry in either direction is dropped; the result stops at max. First accepted
 * entry wins, so the stored order is the user's order.
 * @param value - the stored item value (any JSON).
 * @param max - the accepted count cap.
 * @returns the accepted entries, each { path, alias, note }.
 */
export function normalizeEntries(value, max = DEFAULT_MAX_WORKSPACES) {
  if (!Array.isArray(value)) return []
  const limit = Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_WORKSPACES
  const accepted = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const path = asText(raw.path)
    if (path === '') continue
    if (accepted.some(entry => isSamePath(entry.path, path))) continue
    if (accepted.some(entry => containsPath(entry.path, path) || containsPath(path, entry.path))) continue
    const alias = asText(raw.alias)
    accepted.push({ path, alias: alias === '' ? defaultAlias(path) : alias, note: asText(raw.note) })
    if (accepted.length === limit) break
  }
  return accepted
}

const CAPABILITY = {
  zh: {
    'read-only': '当前权限档是“仅可查看”：你可以读取这些目录，但任何文件都改不了，也不能在其中执行需要写文件的命令。',
    'workspace-write': '当前权限档是“工作区可写”：你可以读取这些目录，但不能修改其中的文件，也不能在其中执行需要写文件的命令（比如跑测试、装依赖、git 提交）；本会话主工作区本身仍然照常可写。想要完全对等的能力，请让用户把本会话切换到“完全权限”档。',
    'danger-full-access': '当前权限档是“完全权限”：在这些目录里你可以像在主工作区一样读取、修改和执行命令。',
    unknown: '能否修改这些目录，取决于本会话当前的权限档。',
  },
  en: {
    'read-only': 'The current permission mode is read-only: you can read these directories, but you cannot modify anything in them, and commands that write files cannot run there.',
    'workspace-write': 'The current permission mode is workspace-write: you can read these directories, but you cannot modify files in them and cannot run commands there that write files (tests, installs, git commits); this session\'s own main workspace stays writable. For full parity, ask the user to switch this session to danger-full-access.',
    'danger-full-access': 'The current permission mode is danger-full-access: in these directories you can read, modify and run commands exactly as in the main workspace.',
    unknown: 'Whether you can modify these directories depends on the current permission mode of this session.',
  },
}

/**
 * Render the runtime-context reminder for one session.
 * No existence claim is made here: an "is it reachable right now" probe would be both
 * a blocking filesystem call on the per-step request path and a different question from
 * "does it exist", and this text is model-visible.
 * @param options - accepted entries, the session's permission mode, the language, and the session's own working directory.
 * @param options.entries - normalized entries (see normalizeEntries).
 * @param options.mode - the session's resolved permission mode, or undefined.
 * @param options.lang - 'zh' or 'en'.
 * @param options.cwd - the session's own working directory, so an entry that contains it is not described as unwritable.
 * @returns the reminder body, or '' when the session has no extra workspaces.
 */
export function reminderText({ entries, mode, lang = 'zh', cwd }) {
  if (!Array.isArray(entries) || entries.length === 0) return ''
  const language = lang === 'en' ? 'en' : 'zh'
  const main = typeof cwd === 'string' ? cwd : ''
  // Only workspace-write grants this session a writable root at all, so only
  // there may the workspace inside an entry be called writable: read-only has no
  // writable root, and an unknown mode is no licence to claim one.
  const writable = mode === 'workspace-write'
  // An entry that is the session's own workspace, or a directory above it,
  // contains that workspace. The shared sentences below must then stop saying
  // these directories are all outside the main workspace — in any mode, because
  // that sentence is about location, not permission.
  const anyHoldsWorkspace = main !== '' && entries.some(entry => containsPath(entry.path, main))
  const lines = entries.map(entry => {
    const holdsWorkspace = main !== '' && containsPath(entry.path, main)
    const writableHere = writable && holdsWorkspace
    if (language === 'en') {
      const note = entry.note === '' ? '' : ' (note: ' + entry.note + ')'
      const marker = writableHere ? " (this session's own working directory is inside it, and stays writable)" : ''
      return '- ' + entry.alias + ' — ' + entry.path + note + marker
    }
    const note = entry.note === '' ? '' : '（备注：' + entry.note + '）'
    const marker = writableHere ? '（本会话主工作区在其中，那部分照常可写）' : ''
    return '- ' + entry.alias + ' — ' + entry.path + note + marker
  })
  const known = mode === 'read-only' || mode === 'workspace-write' || mode === 'danger-full-access'
  const capabilityKey = known ? mode : 'unknown'
  const head = language === 'en'
    ? (anyHoldsWorkspace ? 'This session has these extra workspaces:' : 'This session has these extra workspaces besides its main workspace:')
    : (anyHoldsWorkspace ? '本会话挂了下面这些额外工作区：' : '本会话除主工作区外，还挂了下面这些额外工作区：')
  const tail = language === 'en'
    ? (anyHoldsWorkspace
      ? 'Reference them by absolute path; relative paths still resolve from the main workspace.'
      : 'They are outside the main workspace. Reference them by absolute path; relative paths still resolve from the main workspace.')
    : (anyHoldsWorkspace
      ? '引用这些目录时请写绝对路径；相对路径仍然只相对主工作区解析。'
      : '它们不在主工作区之内。引用这些目录时请写绝对路径；相对路径仍然只相对主工作区解析。')
  return [head].concat(lines, [tail, CAPABILITY[language][capabilityKey]]).join('\n')
}
