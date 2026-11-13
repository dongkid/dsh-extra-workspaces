/**
 * dsh-extra-workspaces — the entry rules, as plain functions over plain data.
 *
 * No DSH imports, no I/O and no clock, so the parts a bug would hide in (path
 * comparison, duplicate and overlap refusal, the cap, the reminder wording) stay
 * directly testable. The browser half mirrors these rules for immediate
 * feedback; this module is the host's copy and the one the reminder text is
 * built from.
 * @module dsh-extra-workspaces/rules
 */

/** Default cap on extra workspaces per session. */
export const DEFAULT_MAX_WORKSPACES = 8

/** Languages the reminder text is written in. */
export const REMINDER_LANGUAGES = Object.freeze(['zh', 'en'])

/** Longest alias kept from a stored entry; longer text is cut, not dropped. */
export const ALIAS_MAX = 200

/** Longest note kept from a stored entry; longer text is cut, not dropped. */
export const NOTE_MAX = 500

const WINDOWS = process.platform === 'win32'
const SEPARATOR = WINDOWS ? '\\' : '/'

function asText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * One line of user text: control characters (newlines included) become spaces
 * and runs of whitespace collapse, so a stored value can never break the
 * Markdown list row it is spliced into.
 * @param value - already trimmed text.
 * @returns the single-line form.
 */
function singleLine(value) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * One stored path: control characters cannot occur in a directory name on
 * Windows and would only corrupt the reminder row elsewhere, so they become
 * spaces. Interior spaces are preserved: a path may legitimately contain them.
 * @param value - already trimmed text.
 * @returns the single-line path.
 */
function pathText(value) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()
}

/** Cut text to its cap; callers cap alias/note, never a path. */
function clampText(value, max) {
  return value.length > max ? value.slice(0, max) : value
}

/**
 * Comparison form of one path: trailing separators dropped, '/' unified to the
 * platform's separator, and case-folded on Windows (where paths are
 * case-insensitive). Deliberately lexical: a path that does not exist yet still
 * compares, and two spellings of one directory must not both be accepted.
 * A root path made only of separators stays comparable instead of collapsing
 * to '', which would silently disable the duplicate/overlap rules for it.
 * @param path - a candidate directory path.
 * @returns the comparison form; '' for a non-string or blank path.
 */
export function comparablePath(path) {
  const text = asText(path)
  if (text === '') return ''
  const withoutTrailer = text.replace(/[\\/]+$/, '')
  if (withoutTrailer === '') return text
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
  const boundary = outer.endsWith(SEPARATOR) ? outer : outer + SEPARATOR
  return inner.startsWith(boundary)
}

/**
 * The default alias of a path: its last segment without any trailing separator.
 * A root path has no segment, so the root itself is the alias.
 * @param path - a directory path.
 * @returns the segment, or the whole trimmed path when it has none.
 */
export function defaultAlias(path) {
  const text = asText(path)
  const trimmed = text.replace(/[\\/]+$/, '')
  if (trimmed === '') return text
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

/**
 * Reduce a stored value to the entries the host will actually use.
 *
 * Anything that is not a plain object with a non-blank path is dropped; a
 * duplicate of an accepted path is dropped; a path that overlaps an accepted
 * entry in either direction is dropped; the result stops at max. First accepted
 * entry wins, so the stored order is the user's order. Stored user text is
 * flattened to one line and capped before it can reach the model-facing
 * reminder (the settings UI cannot produce newlines, but the store file can be
 * edited and other clients can write through the same service).
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
    const path = pathText(asText(raw.path))
    if (path === '') continue
    if (accepted.some(entry => isSamePath(entry.path, path))) continue
    if (accepted.some(entry => containsPath(entry.path, path) || containsPath(path, entry.path))) continue
    const alias = clampText(singleLine(asText(raw.alias)), ALIAS_MAX)
    accepted.push({
      path,
      alias: alias === '' ? clampText(defaultAlias(path), ALIAS_MAX) : alias,
      note: clampText(singleLine(asText(raw.note)), NOTE_MAX),
    })
    if (accepted.length === limit) break
  }
  return accepted
}

const CAPABILITY = {
  zh: {
    'read-only': '当前权限档是“仅可查看”：这些目录可以读取，但其中的文件都改不了，也不能在其中执行需要写文件的命令；某次调用若经用户批准临时提权，则那一次以沙箱返回为准。',
    'workspace-write': '当前权限档是“工作区可写”：本会话工作区与系统临时目录之内的目录照常可写；其余额外目录只能读取，不能修改其中的文件，也不能在其中执行需要写文件的命令（比如跑测试、装依赖、git 提交）；某次调用若经用户批准临时提权，则那一次以沙箱返回为准。想要完全对等的能力，请让用户把本会话切换到“完全权限”档。',
    'danger-full-access': '当前权限档是“完全权限”：在这些目录里你可以像在主工作区一样读取、修改和执行命令。',
    unknown: '能否修改这些目录，取决于本会话当前的权限档。',
  },
  en: {
    'read-only': 'The current permission mode is read-only: you can read these directories, but you cannot modify files in them, and commands that write files cannot run there; a single call approved for escalation decides by the sandbox result.',
    'workspace-write': 'The current permission mode is workspace-write: directories inside this session\'s workspace and the system temporary directory stay writable; the rest of these directories are read-only — you cannot modify files in them or run commands there that write files (tests, installs, git commits); a single call approved for escalation decides by the sandbox result. For full parity, ask the user to switch this session to danger-full-access.',
    'danger-full-access': 'The current permission mode is danger-full-access: in these directories you can read, modify and run commands exactly as in the main workspace.',
    unknown: 'Whether you can modify these directories depends on the current permission mode of this session.',
  },
}

/**
 * Render the runtime-context reminder for one session.
 *
 * The writability sentences follow the sandbox's actual writable roots: under
 * workspace-write those are the resolved session workspace root plus the system
 * temporary directories, so an entry inside one of them must not be described
 * as read-only, and the "outside the main workspace" sentence must not be said
 * about an entry that sits inside it. No existence claim is made here: an "is
 * it reachable right now" probe would be both a blocking filesystem call on the
 * per-step request path and a different question from "does it exist", and this
 * text is model-visible.
 * @param options - accepted entries, the sandbox facts, the language, and the session's own working directory.
 * @param options.entries - normalized entries (see normalizeEntries).
 * @param options.mode - the session's resolved permission mode, or undefined.
 * @param options.lang - 'zh' or 'en'.
 * @param options.cwd - the session's own working directory, used as the workspace location when the policy service is absent.
 * @param options.workspaceRoot - the sandbox policy's resolved workspace root, when the host could ask for it.
 * @param options.writableRoots - the sandbox's writable roots (workspace root plus system temporary directories) for workspace-write, when known.
 * @returns the reminder body, or '' when the session has no extra workspaces.
 */
export function reminderText({ entries, mode, lang = 'zh', cwd, workspaceRoot, writableRoots }) {
  if (!Array.isArray(entries) || entries.length === 0) return ''
  const language = lang === 'en' ? 'en' : 'zh'
  const root = asText(workspaceRoot) !== '' ? asText(workspaceRoot) : asText(cwd)
  // Only workspace-write has writable roots besides the workspace itself at all;
  // read-only has none and an unknown mode is no licence to claim one.
  const writable = mode === 'workspace-write'
  const roots = writable && Array.isArray(writableRoots)
    ? writableRoots.map(asText).filter(text => text !== '')
    : []
  // An entry that is the workspace root, a directory above it, or a directory
  // inside it makes the location sentence below false for that entry.
  const related = root !== '' && entries.some(entry => containsPath(entry.path, root) || containsPath(root, entry.path))
  const lines = entries.map(entry => {
    const holdsRoot = writable && root !== '' && containsPath(entry.path, root)
    const insideRoot = writable && !holdsRoot && root !== '' && containsPath(root, entry.path)
    const insideTemporary = writable && !holdsRoot && !insideRoot && roots.some(one => containsPath(one, entry.path))
    if (language === 'en') {
      const note = entry.note === '' ? '' : ' (note: ' + entry.note + ')'
      const marker = holdsRoot
        ? " (this session's own workspace is inside it, and that part stays writable)"
        : insideRoot ? ' (inside this session\'s workspace, so it stays writable)'
          : insideTemporary ? ' (inside the system temporary directory, so it stays writable)' : ''
      return '- ' + entry.alias + ' — ' + entry.path + note + marker
    }
    const note = entry.note === '' ? '' : '（备注：' + entry.note + '）'
    const marker = holdsRoot
      ? '（本会话工作区在其中，那部分照常可写）'
      : insideRoot ? '（在主工作区之内，照常可写）'
        : insideTemporary ? '（在系统临时目录之内，照常可写）' : ''
    return '- ' + entry.alias + ' — ' + entry.path + note + marker
  })
  const known = mode === 'read-only' || mode === 'workspace-write' || mode === 'danger-full-access'
  const capabilityKey = known ? mode : 'unknown'
  const head = language === 'en'
    ? (root === '' || related ? 'This session has these extra workspaces:' : 'This session has these extra workspaces besides its main workspace:')
    : (root === '' || related ? '本会话挂了下面这些额外工作区：' : '本会话除主工作区外，还挂了下面这些额外工作区：')
  // DSH 0.2.1 made the session's current directory mutable (the working_directory
  // tool); header.cwd is only the original project. Relative paths therefore
  // resolve from that current directory, not from the main workspace.
  const outside = root !== '' && !related
  const tailEn = 'Reference them by absolute path; relative paths resolve from this session\'s current working directory (initially the main workspace, movable with the working_directory tool, and moving it grants no extra write access).'
  const tailZh = '引用这些目录时请写绝对路径；相对路径按本会话的当前工作目录解析（初始即主工作区，可用 working_directory 切换，切换不会扩大可写范围）。'
  const tail = language === 'en'
    ? (outside ? 'They are outside the main workspace. ' + tailEn : tailEn)
    : (outside ? '它们不在主工作区之内。' + tailZh : tailZh)
  // The list is Markdown: a non-indented line directly under a list item is a
  // lazy continuation of that item, so the sentence after the list would show up
  // inside the last directory's bullet instead of as its own paragraph.
  // A blank line closes the list block before the scope sentence.
  return [head].concat(lines, ['', tail, CAPABILITY[language][capabilityKey]]).join('\n')
}
