/*
 * dsh-extra-workspaces — browser half.
 *
 * Registers one custom control for the session-settings item
 * ('dsh-extra-workspaces', 'workspaces'): the per-session list of extra local
 * working directories that sit beside the session's own workspace.
 *
 * The settings page hands a registered renderer
 *   { pluginId, sessionId, item, registration, value, defaultValue,
 *     overridden, disabled, busy, domId, t, setValue, reset }
 * where setValue(nextArray) persists the whole array. There is no other
 * transport, no import beyond the module table's react, and no build step:
 * this file is the shipped artifact. Style uses host theme tokens only; copy
 * comes from this file's own zh/en tables and follows the host language.
 *
 * Below the list the control offers a quick-add strip: directories one click
 * away because this browser added them before (a localStorage history), because
 * the user already registered them as DSH workspaces, or because they sit next
 * to this session's own workspace. Only candidates the list would accept are
 * offered, so a click never produces a refusal. The history is a convenience
 * local to this browser; the per-session list itself stays the host's truth.
 */
window.__ModuleLoader__.load({
  id: 'dsh-extra-workspaces',
  factory: function (require) {
    var React = require('react')
    var h = React.createElement

    /* ------------------------------------------------------------ contract */

    var PLUGIN_ID = 'dsh-extra-workspaces'
    var ITEM_KEY = 'workspaces'
    /** More than this many extras stops being a set a person can keep in mind. */
    var MAX_ENTRIES = 8
    var PLUGIN_TAG = '[dsh-extra-workspaces]'
    /** localStorage key of the last directory the picker landed on. */
    var LAST_DIR_KEY = 'dsh-extra-workspaces:last-browse-dir'
    /** localStorage key of the directories this browser added before. */
    var HISTORY_KEY = 'dsh-extra-workspaces:history-v1'
    /** How many used directories the history keeps (the oldest drop off). */
    var HISTORY_LIMIT = 20
    /** How many quick-add chips one row shows before offering "more". */
    var QUICK_PAGE = 6
    /** How many sibling directories one parent listing may contribute. */
    var SIBLING_LIMIT = 8
    /** Sibling listings kept per parent path; one Host call per TTL. */
    var SIBLING_TTL = 5 * 60 * 1000
    var siblingCache = { key: null, at: 0, items: null }
    /**
     * Directory names that are never worth offering as an extra workspace:
     * system folders Windows' dot-prefix rule does not hide, plus build output
     * that merely happens to sit beside a project.
     */
    var NOISE_DIRS = [
      'appdata', 'application data', 'local settings', 'recent', 'sendto', 'templates',
      'start menu', 'my documents', 'documents and settings', '$recycle.bin',
      'system volume information', 'recovery', 'programdata', 'program files',
      'program files (x86)', 'windows', 'node_modules', 'bower_components',
      'dist', 'build', 'out', 'obj', 'bin',
    ]
    /** Id of the injected sheet (one per page, refreshed in place on HMR). */
    var STYLE_ID = 'dsh-extra-workspaces-responsive'
    /** Letters probed to surface Windows drive shortcuts beside the path. */
    var DRIVE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    /** Last discovered drives; shared across dialog opens in one page. */
    var driveCache = { items: null, at: 0 }
    /** How long a drive discovery stays fresh before the next open re-probes. */
    var DRIVE_CACHE_MS = 5 * 60 * 1000

    /* ---------------------------------------------------------------- copy */

    /** Built-in dictionaries; both tables carry the same keys. */
    var OWN_TEXT = {
      zh: {
        hint: '这些目录是会话工作区之外的额外工作区，本会话里的命令和文件操作都可以使用它们。',
        empty: '还没有额外工作区。',
        add: '添加工作区',
        aliasLabel: '别名',
        aliasPlaceholder: '好记的名字',
        pathLabel: '目录',
        noteLabel: '备注',
        notePlaceholder: '这个目录是做什么的（可不填）',
        remove: '移除',
        missing: '宿主读不到该目录',
        pickerUnavailable: '现在打不开目录选择器，请稍后再试。',
        browserTitle: '选择目录',
        browserTarget: '添加为额外工作区',
        browserHome: '主目录',
        browserUp: '上一级',
        browserDriveJump: '跳转到 {name} 盘',
        browserLoading: '加载中…',
        browserEmpty: '这个目录下没有子文件夹。',
        browserTruncated: '文件夹过多，仅显示开头部分。',
        browserShowHidden: '显示隐藏文件',
        browserNewFolder: '新建文件夹',
        browserFolderName: '文件夹名称',
        browserCreate: '创建',
        browserCancel: '取消',
        browserUse: '选择当前目录',
        browserEditPath: '编辑路径',
        browserGo: '前往',
        browserPathLabel: '目录路径',
        errEmpty: '没有选中任何目录。',
        errDuplicate: '这个目录已经在列表里了。',
        errOverlap: '这个目录和列表里的目录互相包含，只能留一个。',
        errLimit: '最多只能添加 {n} 个额外工作区。',
        groupLabel: '额外工作区',
        quickTitle: '快速添加',
        quickRecent: '最近使用',
        quickSuggested: '推荐',
        quickMore: '还有 {n} 个',
        quickLess: '收起',
        forget: '从历史里移除 {name}',
        sourceHistory: '上次用过',
        sourceWorkspace: '已有工作区',
        sourceSibling: '同级目录',
        count: '{n} / {max}',
        pickerPlaces: '常用位置',
        pickerAlready: '这个目录已经在列表里了。',
      },
      en: {
        hint: 'These directories are extra to the session workspace; commands and file operations in this session can use them.',
        empty: 'No extra workspaces yet.',
        add: 'Add workspace',
        aliasLabel: 'Alias',
        aliasPlaceholder: 'A name you will recognize',
        pathLabel: 'Directory',
        noteLabel: 'Note',
        notePlaceholder: 'What this directory is for (optional)',
        remove: 'Remove',
        missing: 'The host cannot read this directory',
        pickerUnavailable: 'The directory picker is unavailable right now. Try again later.',
        browserTitle: 'Choose a directory',
        browserTarget: 'Add as an extra workspace',
        browserHome: 'Home',
        browserUp: 'Up one level',
        browserDriveJump: 'Jump to drive {name}',
        browserLoading: 'Loading…',
        browserEmpty: 'No folders in this directory.',
        browserTruncated: 'Too many folders; only the beginning is shown.',
        browserShowHidden: 'Show hidden files',
        browserNewFolder: 'New folder',
        browserFolderName: 'Folder name',
        browserCreate: 'Create',
        browserCancel: 'Cancel',
        browserUse: 'Use this folder',
        browserEditPath: 'Edit path',
        browserGo: 'Go',
        browserPathLabel: 'Directory path',
        errEmpty: 'No directory was selected.',
        errDuplicate: 'That directory is already in the list.',
        errOverlap: 'That directory and one already listed contain each other; keep only one.',
        errLimit: 'At most {n} extra workspaces.',
        groupLabel: 'Extra workspaces',
        quickTitle: 'Quick add',
        quickRecent: 'Recent',
        quickSuggested: 'Suggested',
        quickMore: '{n} more',
        quickLess: 'Show less',
        forget: 'Remove {name} from history',
        sourceHistory: 'Used before',
        sourceWorkspace: 'An existing workspace',
        sourceSibling: 'Next to this session',
        count: '{n} / {max}',
        pickerPlaces: 'Places',
        pickerAlready: 'That directory is already in the list.',
      },
    }

    function makeOwnT(lang) {
      var dict = lang === 'en' ? OWN_TEXT.en : OWN_TEXT.zh
      return function (key, params) {
        var text = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
        if (params === undefined || params === null) return text
        return text.replace(/\{(\w+)\}/g, function (match, name) {
          return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
        })
      }
    }

    /* ------------------------------------------------------------- helpers */

    function noop() {}

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /** Anything that is not an array reads as the empty list; an entry without
     *  a usable path is dropped rather than rendered as an empty row. */
    function normalizeEntries(value) {
      if (!Array.isArray(value)) return []
      var entries = []
      for (var i = 0; i < value.length; i += 1) {
        var raw = value[i]
        if (!isRecord(raw)) continue
        if (typeof raw.path !== 'string' || raw.path.trim() === '') continue
        entries.push({
          path: raw.path,
          alias: typeof raw.alias === 'string' ? raw.alias : '',
          note: typeof raw.note === 'string' ? raw.note : '',
        })
      }
      return entries
    }

    /** Windows compares directory paths without case; the platform string is
     *  the only hint a browser page has for it. */
    function isCaseInsensitive() {
      try {
        if (typeof navigator === 'undefined') return false
        var platform = typeof navigator.platform === 'string' ? navigator.platform : ''
        if (platform === '' && isRecord(navigator.userAgentData) && typeof navigator.userAgentData.platform === 'string') {
          platform = navigator.userAgentData.platform
        }
        return /win/i.test(platform)
      } catch (error) {
        /* No readable navigator: keep the case-sensitive comparison. */
        return false
      }
    }

    /** The comparison key for one directory: one separator convention, no
     *  trailing separator, and the case folding that path's platform uses. A
     *  drive-letter path is a Windows path wherever the page happens to run. */
    function pathKey(path) {
      var text = String(path).replace(/\\/g, '/').replace(/\/+$/, '')
      if (text === '') text = String(path).replace(/\\/g, '/')
      if (!/^[A-Za-z]:/.test(text) && !isCaseInsensitive()) return text
      return text.toLowerCase()
    }

    /**
     * True when one directory contains the other, either way round. A plain
     * prefix test would call '/w/beta' a child of '/w/be', so the character
     * after the prefix must be the separator.
     */
    function containsPath(outer, inner) {
      if (outer === '' || inner === '') return false
      if (outer === inner) return true
      if (inner.length <= outer.length) return false
      if (inner.indexOf(outer) !== 0) return false
      return inner.charAt(outer.length) === '/'
    }

    /**
     * The rule check that runs before an add: a directory already listed, or
     * one that contains or sits inside a listed directory, is refused. Alias
     * and note edits change neither a path nor the list length, so they cannot
     * newly break these rules and write directly.
     */
    function conflictFor(entries, candidateKey) {
      for (var i = 0; i < entries.length; i += 1) {
        var existing = pathKey(entries[i].path)
        if (existing === '') continue
        if (existing === candidateKey) return 'duplicate'
        if (containsPath(existing, candidateKey) || containsPath(candidateKey, existing)) return 'overlap'
      }
      return null
    }

    /** The last segment of a picked directory, from either separator, with a
     *  trailing separator removed. */
    function basename(path) {
      var text = String(path)
      var trimmed = text.replace(/[\\/]+$/, '')
      if (trimmed === '') return text
      var cut = trimmed.lastIndexOf('/')
      var other = trimmed.lastIndexOf('\\')
      if (other > cut) cut = other
      var name = cut === -1 ? trimmed : trimmed.slice(cut + 1)
      return name === '' ? trimmed : name
    }

    /* ----------------------------------------------------------- history */

    /** The directories this browser added before, newest first. Anything the
     *  store cannot vouch for (bad JSON, non-array, blank path) is dropped
     *  rather than rendered as an unusable chip. */
    function readHistory() {
      try {
        if (typeof window === 'undefined' || window === null) return []
        var storage = window.localStorage
        if (storage === null || storage === undefined || typeof storage.getItem !== 'function') return []
        var raw = storage.getItem(HISTORY_KEY)
        if (typeof raw !== 'string' || raw === '') return []
        var parsed
        try {
          parsed = JSON.parse(raw)
        } catch (error) {
          return []
        }
        if (!Array.isArray(parsed)) return []
        var items = []
        for (var i = 0; i < parsed.length; i += 1) {
          var item = parsed[i]
          if (!isRecord(item)) continue
          if (typeof item.path !== 'string' || item.path.trim() === '') continue
          items.push({
            path: item.path,
            alias: typeof item.alias === 'string' ? item.alias : '',
            note: typeof item.note === 'string' ? item.note : '',
            updatedAt: typeof item.updatedAt === 'number' && isFinite(item.updatedAt) ? item.updatedAt : 0,
            source: 'history',
          })
          if (items.length === HISTORY_LIMIT) break
        }
        return items
      } catch (error) {
        return []
      }
    }

    /** Persist the history; a refused or full store is a lost convenience, not
     *  a broken page. */
    function writeHistory(items) {
      try {
        if (typeof window === 'undefined' || window === null) return
        var storage = window.localStorage
        if (storage === null || storage === undefined || typeof storage.setItem !== 'function') return
        storage.setItem(HISTORY_KEY, JSON.stringify(items))
      } catch (error) {
        /* Best effort only. */
      }
    }

    /** Move a used directory to the head of the history, keeping the alias and
     *  note last written for it. */
    function upsertHistory(items, entry, now) {
      var key = pathKey(entry.path)
      var next = [{
        path: entry.path,
        alias: typeof entry.alias === 'string' ? entry.alias : '',
        note: typeof entry.note === 'string' ? entry.note : '',
        updatedAt: now,
        source: 'history',
      }]
      for (var i = 0; i < items.length; i += 1) {
        if (pathKey(items[i].path) === key) continue
        next.push(items[i])
        if (next.length === HISTORY_LIMIT) break
      }
      return next
    }

    /** Drop one path from the history; the original array when nothing matched. */
    function forgetHistory(items, path) {
      var key = pathKey(path)
      var next = []
      for (var i = 0; i < items.length; i += 1) {
        if (pathKey(items[i].path) === key) continue
        next.push(items[i])
      }
      return next.length === items.length ? items : next
    }

    /**
     * Fold the session's current entries into the history so a directory that
     * was in use before this browser recorded any history is still one click
     * away after it is removed. Entries keep their list order at the head;
     * an existing row keeps its recency (only a real add bumps that).
     */
    function seedHistory(items, entries, now) {
      var next = items.slice()
      var changed = false
      for (var i = entries.length - 1; i >= 0; i -= 1) {
        var entry = entries[i]
        var key = pathKey(entry.path)
        var found = false
        for (var j = 0; j < next.length; j += 1) {
          if (pathKey(next[j].path) !== key) continue
          found = true
          if (next[j].alias !== entry.alias || next[j].note !== entry.note) {
            next[j] = {
              path: next[j].path, alias: entry.alias, note: entry.note,
              updatedAt: next[j].updatedAt, source: 'history',
            }
            changed = true
          }
          break
        }
        if (found) continue
        next.unshift({
          path: entry.path, alias: entry.alias, note: entry.note,
          updatedAt: now - i, source: 'history',
        })
        changed = true
      }
      if (next.length > HISTORY_LIMIT) next = next.slice(0, HISTORY_LIMIT)
      return changed ? next : items
    }

    /* -------------------------------------------------------- suggestions */

    /** The parent directory of a host path in its own separator convention, or
     *  null for a drive root and '/'. */
    function parentPathOf(path) {
      var text = String(path).replace(/[\\/]+$/, '')
      if (text === '') return null
      var cut = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'))
      if (cut <= 0) return null
      var parent = text.slice(0, cut)
      return /^[A-Za-z]:$/.test(parent) ? parent + '\\' : parent
    }

    function isNoiseDir(name) {
      return NOISE_DIRS.indexOf(String(name).toLowerCase()) !== -1
    }

    /** The name a suggestion shows: its alias, else the last path segment. */
    function suggestionName(item) {
      if (typeof item.alias === 'string' && item.alias !== '') return item.alias
      return basename(item.path)
    }

    /**
     * The quick-add candidates, already filtered to what the list would accept:
     * no duplicate, no overlap, not the session's own workspace, nothing past
     * the cap. History comes first because it is the most specific memory, then
     * the user's registered DSH workspaces by recency, then sibling folders.
     * @returns { recent: candidates, suggested: candidates } in display order.
     */
    function suggestionCandidates(options) {
      var entries = Array.isArray(options.entries) ? options.entries : []
      var room = (Number.isInteger(options.maxEntries) ? options.maxEntries : MAX_ENTRIES) - entries.length
      if (room <= 0) return { recent: [], suggested: [] }
      var mainCwd = typeof options.mainCwd === 'string' && options.mainCwd !== '' ? pathKey(options.mainCwd) : null
      var seen = {}
      function accept(item) {
        if (!isRecord(item) || typeof item.path !== 'string' || item.path.trim() === '') return null
        var key = pathKey(item.path)
        if (seen[key] === true) return null
        seen[key] = true
        if (mainCwd !== null && key === mainCwd) return null
        if (conflictFor(entries, key) !== null) return null
        return item
      }
      var recent = []
      var history = Array.isArray(options.history) ? options.history : []
      for (var i = 0; i < history.length && recent.length < room; i += 1) {
        var fromHistory = accept(history[i])
        if (fromHistory !== null) recent.push(fromHistory)
      }
      var suggested = []
      var workspaces = Array.isArray(options.workspaces) ? options.workspaces : []
      var ordered = workspaces.slice()
      ordered.sort(function (left, right) {
        var a = left === null || left === undefined ? 0 : Date.parse(left.updatedAt)
        var b = right === null || right === undefined ? 0 : Date.parse(right.updatedAt)
        if (isNaN(a)) a = 0
        if (isNaN(b)) b = 0
        return b - a
      })
      for (var w = 0; w < ordered.length && suggested.length < room; w += 1) {
        var workspace = ordered[w]
        if (!isRecord(workspace) || typeof workspace.path !== 'string') continue
        var accepted = accept({
          path: workspace.path,
          alias: typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : basename(workspace.path),
          note: '',
          source: 'workspace',
        })
        if (accepted !== null) suggested.push(accepted)
      }
      var siblings = Array.isArray(options.siblings) ? options.siblings : []
      for (var s = 0; s < siblings.length && suggested.length < room; s += 1) {
        var sibling = siblings[s]
        if (!isRecord(sibling) || typeof sibling.path !== 'string') continue
        var next = accept({
          path: sibling.path,
          alias: typeof sibling.alias === 'string' && sibling.alias !== '' ? sibling.alias : basename(sibling.path),
          note: '',
          source: 'sibling',
        })
        if (next !== null) suggested.push(next)
      }
      return { recent: recent, suggested: suggested }
    }

    /* ---------------------------------------------------------------- lang */

    function readLang(ctx) {
      try {
        var locale = ctx !== null && ctx !== undefined && typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        var snapshot = locale !== null && locale !== undefined && typeof locale.getLocale === 'function' ? locale.getLocale() : undefined
        var active = snapshot !== null && snapshot !== undefined && typeof snapshot.active === 'string' ? snapshot.active : ''
        if (active === '') {
          active = typeof navigator !== 'undefined' && typeof navigator.language === 'string' ? navigator.language : 'en'
        }
        return String(active).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
      } catch (error) {
        return 'en'
      }
    }

    function reportFailure(phase, error) {
      try {
        console.error(PLUGIN_TAG + ' ' + phase + ' failed', error)
      } catch (ignored) { /* nothing left to report with */ }
    }

    /** One language source per activation: the control re-renders when the
     *  host switches language. */
    function createLangStore(ctx) {
      var current = readLang(ctx)
      var listeners = new Set()
      return {
        get: function () { return current },
        subscribe: function (listener) {
          listeners.add(listener)
          return function () { listeners.delete(listener) }
        },
        sync: function () {
          var next = readLang(ctx)
          if (next === current) return
          current = next
          var list = []
          listeners.forEach(function (listener) { list.push(listener) })
          for (var i = 0; i < list.length; i += 1) {
            try {
              list[i]()
            } catch (error) {
              reportFailure('language subscriber', error)
            }
          }
        },
      }
    }

    function useLang(langStore) {
      var subscribe = React.useCallback(function (listener) { return langStore.subscribe(listener) }, [langStore])
      var getSnapshot = React.useCallback(function () { return langStore.get() }, [langStore])
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    /* --------------------------------------------------------------- parts */

    /** Local draft that follows the external value; commits happen on blur or
     *  Enter so a keystroke never becomes a write. */
    function useDraft(value) {
      var text = typeof value === 'string' ? value : ''
      var pair = React.useState(text)
      var setDraft = pair[1]
      React.useEffect(function () { setDraft(text) }, [text])
      return pair
    }

    function enterCommits(commit) {
      return function (event) {
        if (event.key !== 'Enter') return
        event.preventDefault()
        commit()
      }
    }

    /** True while an IME candidate window owns Enter, so composing a name
     *  never submits the input it is being typed into. */
    function isComposing(event) {
      if (event === null || event === undefined || typeof event !== 'object') return false
      return event.isComposing === true || event.keyCode === 229
    }

    /**
     * The wire code of a rejected Remote call, when the failure carries one.
     * Only a code the host actually stated may be acted on; an unknown failure
     * means "we do not know", never "the directory is gone".
     */
    function remoteFailureCode(error) {
      if (error === null || error === undefined || typeof error !== 'object') return undefined
      var rpc = error.rpcError
      if (rpc !== null && rpc !== undefined && typeof rpc === 'object' && typeof rpc.code === 'string') return rpc.code
      return typeof error.code === 'string' ? error.code : undefined
    }

    /** One 16px line icon from a fixed set. currentColor keeps it themed and
     *  aria-hidden keeps it out of the page's text. */
    function iconNode(name, size, className) {
      var children = []
      if (name === 'plus') {
        children.push(h('path', { key: 'i1', d: 'M8 3.2v9.6M3.2 8h9.6' }))
      } else if (name === 'clock') {
        children.push(h('circle', { key: 'i1', cx: '8', cy: '8', r: '5.4' }))
        children.push(h('path', { key: 'i2', d: 'M8 4.9v3.3l2.1 1.3' }))
      } else if (name === 'layers') {
        children.push(h('path', { key: 'i1', d: 'M8 2.4 13.6 5 8 7.6 2.4 5z' }))
        children.push(h('path', { key: 'i2', d: 'M2.4 8 8 10.6 13.6 8' }))
        children.push(h('path', { key: 'i3', d: 'M2.4 11 8 13.6 13.6 11' }))
      } else {
        children.push(h('path', { key: 'i1', d: 'M2.4 5.2a1.3 1.3 0 0 1 1.3-1.3h3l1.3 1.5h4.3a1.3 1.3 0 0 1 1.3 1.3v5.1a1.3 1.3 0 0 1-1.3 1.3H3.7a1.3 1.3 0 0 1-1.3-1.3z' }))
      }
      return h('svg', {
        key: 'icon-' + name,
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        className: className === undefined ? 'dsh-ew-chip-icon' : className,
        style: { flex: '0 0 auto', display: 'block' },
      }, children)
    }

    /** Identity-stable empty snapshots: uSES compares the read result, so the
     *  absent-service fallback must not be a fresh object per render. */
    var EMPTY_SESSION_STATE = { ids: [], byId: {}, phase: 'pending' }
    var EMPTY_WORKSPACE_STATE = { items: [], phase: 'pending' }

    /** Follow one client service snapshot; a missing service reads as its
     *  empty value and simply produces no suggestions. */
    function useServiceSnapshot(getSource, fallback) {
      var subscribe = React.useCallback(function (listener) {
        var source = getSource()
        if (source === null || source === undefined || typeof source.subscribe !== 'function') return noop
        try {
          return source.subscribe(listener)
        } catch (error) {
          reportFailure('snapshot subscribe', error)
          return noop
        }
      }, [getSource])
      var getSnapshot = React.useCallback(function () {
        var source = getSource()
        if (source === null || source === undefined || typeof source.getSnapshot !== 'function') return fallback
        try {
          return source.getSnapshot()
        } catch (error) {
          reportFailure('snapshot read', error)
          return fallback
        }
      }, [getSource, fallback])
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    }

    /** The session's own working directory from the session list, or null. */
    function sessionCwdOf(state, sessionId) {
      if (!isRecord(state) || !isRecord(state.byId)) return null
      var summary = state.byId[sessionId]
      if (!isRecord(summary)) return null
      return typeof summary.cwd === 'string' && summary.cwd !== '' ? summary.cwd : null
    }

    /** Why a suggestion is being offered, for its tooltip. */
    function sourceLabelOf(ownT, source) {
      if (source === 'history') return ownT('sourceHistory')
      if (source === 'workspace') return ownT('sourceWorkspace')
      return ownT('sourceSibling')
    }

    function WorkspaceRow(props) {
      var entry = props.entry
      var ownT = props.ownT
      var readOnly = props.readOnly
      var aliasDraft = useDraft(entry.alias)
      var noteDraft = useDraft(entry.note)
      var missingPair = React.useState(false)
      var missing = missingPair[0]
      var setMissing = missingPair[1]

      // Best-effort only, and never a false claim. A directory is marked missing
      // only when the host's browse capability reports it unreadable. A host
      // whose picker is the native OS chooser serves NO browse capability, so
      // its list verb is refused as 'directory-picker/unavailable' - that says
      // nothing about the directory, and such a host stays quiet here. The
      // reminder carries the truth in that case: the host half can check the
      // disk directly, this panel cannot.
      React.useEffect(function () {
        var ui = props.getUi()
        if (ui === null || ui === undefined || typeof ui.listDirectory !== 'function') return undefined
        var cancelled = false
        var scan
        try {
          scan = ui.listDirectory(entry.path)
        } catch (error) {
          reportFailure('listDirectory', error)
          return undefined
        }
        if (scan === null || scan === undefined || typeof scan.then !== 'function') return undefined
        scan.then(function () {
          if (!cancelled) setMissing(false)
        }, function (error) {
          if (cancelled) return
          if (remoteFailureCode(error) === 'directory-picker/unreadable') setMissing(true)
        })
        return function () { cancelled = true }
      }, [props.getUi, entry.path])

      function commitAlias() {
        if (aliasDraft[0] === entry.alias) return
        props.onEdit(props.index, 'alias', aliasDraft[0])
      }

      function commitNote() {
        if (noteDraft[0] === entry.note) return
        props.onEdit(props.index, 'note', noteDraft[0])
      }

      return h('div', { style: STYLES.entry, className: 'dsh-ew-entry-card' },
        h('div', { key: 'head', style: STYLES.entryHead },
          h('input', {
            key: 'alias',
            type: 'text',
            id: props.base + '-alias-' + props.index,
            value: aliasDraft[0],
            placeholder: ownT('aliasPlaceholder'),
            disabled: readOnly,
            spellCheck: false,
            'aria-label': ownT('aliasLabel'),
            className: 'dsh-ew-input',
            onChange: function (event) { aliasDraft[1](event.target.value) },
            onBlur: commitAlias,
            onKeyDown: enterCommits(commitAlias),
            style: STYLES.aliasInput,
          }),
          h('span', { key: 'path', style: STYLES.path, title: entry.path, 'aria-label': ownT('pathLabel') }, [
            iconNode('folder', 12, 'dsh-ew-path-icon'),
            h('span', { key: 'text', style: STYLES.pathText }, entry.path),
            missing ? h('span', { key: 'missing', style: STYLES.missing }, ' · ' + ownT('missing')) : null,
          ]),
          readOnly ? null : h('button', {
            key: 'remove',
            type: 'button',
            style: STYLES.linkButton,
            className: 'dsh-ew-link',
            'aria-label': ownT('remove'),
            onClick: function () { props.onRemove(props.index) },
          }, ownT('remove')),
        ),
        h('input', {
          key: 'note',
          type: 'text',
          id: props.base + '-note-' + props.index,
          value: noteDraft[0],
          placeholder: ownT('notePlaceholder'),
          disabled: readOnly,
          spellCheck: false,
          'aria-label': ownT('noteLabel'),
          className: 'dsh-ew-input',
          onChange: function (event) { noteDraft[1](event.target.value) },
          onBlur: commitNote,
          onKeyDown: enterCommits(commitNote),
          style: STYLES.noteInput,
        }),
      )
    }

    /** Host failure text: a Remote business failure carries `rpcError.message`;
     *  the client wrapper keeps only Error text for other refusals. */
    function failureTextOf(reason) {
      if (reason !== null && reason !== undefined && typeof reason === 'object') {
        var rpc = reason.rpcError
        if (rpc !== null && rpc !== undefined && typeof rpc === 'object' && typeof rpc.message === 'string') return rpc.message
        if (typeof reason.message === 'string') return reason.message
      }
      return String(reason)
    }

    /**
     * The one sheet this plugin injects: layout variables (dialog geometry, row
     * height, touch sizes) plus the small state vocabulary the inline styles
     * cannot express (hover, focus, disabled, transitions). Every colour is a
     * host theme token with a standalone fallback, so light/dark follow the GUI
     * and a page whose theme is missing still reads. Built once per page.
     */
    function buildStylesheet() {
      return [
        '.dsh-ew-overlay {',
        '  --ew-dialog-w: min(680px, calc(100vw - 32px));',
        '  --ew-dialog-h: min(500px, calc(100vh - 64px));',
        '  --ew-dialog-h: min(500px, calc(100dvh - 64px));',
        '  --ew-radius: 12px;',
        '  --ew-head-pad: 12px 16px;',
        '  --ew-body-pad: 8px 12px;',
        '  --ew-foot-pad: 10px 16px;',
        '  --ew-row-pad: 6px 8px;',
        '  --ew-row-font: 12px;',
        '  --ew-row-min: 28px;',
        '  --ew-btn-pad: 4px 10px;',
        '  --ew-btn-font: 12px;',
        '  --ew-link-font: 11px;',
        '  --ew-link-pad: 2px 4px;',
        '  --ew-input-font: 12px;',
        '  --ew-title-font: 13px;',
        '  --ew-status-font: 12px;',
        '  --ew-status-pad: 6px 16px;',
        '  --ew-chip-font: 12px;',
        '  --ew-chip-pad: 3px 8px;',
        '  --ew-quick-label: 11px;',
        '}',
        '.dsh-ew-control {',
        '  --ew-input-font: 12px;',
        '  --ew-hint-font: 12px;',
        '  --ew-btn-pad: 4px 10px;',
        '  --ew-btn-font: 12px;',
        '  --ew-link-font: 11px;',
        '  --ew-link-pad: 2px 4px;',
        '  --ew-chip-font: 12px;',
        '  --ew-chip-pad: 3px 8px;',
        '  --ew-quick-label: 11px;',
        '}',
        '.dsh-ew-primary {',
        '  transition: filter 120ms ease, opacity 120ms ease;',
        '}',
        '.dsh-ew-primary:hover:not(:disabled) { filter: brightness(1.1); }',
        '.dsh-ew-primary:active:not(:disabled) { filter: brightness(0.94); }',
        '.dsh-ew-primary:disabled { opacity: 0.5; cursor: default; }',
        '.dsh-ew-secondary {',
        '  background: transparent;',
        '  transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease;',
        '}',
        '.dsh-ew-secondary:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.06)); }',
        '.dsh-ew-secondary:disabled { opacity: 0.55; cursor: default; }',
        '.dsh-ew-link {',
        '  background: transparent;',
        '  transition: color 120ms ease, opacity 120ms ease;',
        '}',
        '.dsh-ew-link:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 2px; }',
        '.dsh-ew-link:disabled { opacity: 0.5; cursor: default; }',
        '.dsh-ew-primary:focus-visible,',
        '.dsh-ew-secondary:focus-visible,',
        '.dsh-ew-link:focus-visible,',
        '.dsh-ew-row:focus-visible,',
        '.dsh-ew-chip:focus-visible,',
        '.dsh-ew-chip-x:focus-visible,',
        '.dsh-ew-more:focus-visible {',
        '  outline: 2px solid var(--dsw-alias-link, #7aa2ff);',
        '  outline-offset: 1px;',
        '}',
        '.dsh-ew-entry-card { transition: box-shadow 120ms ease; }',
        '.dsh-ew-entry-card:hover { box-shadow: 0 0 0 1px var(--dsw-alias-border-l2, rgba(255,255,255,0.14)); }',
        '.dsh-ew-input { transition: box-shadow 120ms ease, border-color 120ms ease; }',
        '.dsh-ew-input:focus {',
        '  border-color: var(--dsw-alias-link, #7aa2ff);',
        '  box-shadow: 0 0 0 1px var(--dsw-alias-link, #7aa2ff);',
        '  outline: none;',
        '}',
        '.dsh-ew-path-icon { flex: 0 0 auto; opacity: 0.45; }',
        '.dsh-ew-row { background: transparent; transition: background-color 120ms ease; }',
        '.dsh-ew-row:hover { background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.06)); }',
        '.dsh-ew-row-icon { flex: 0 0 auto; margin-right: 7px; opacity: 0.5; }',
        '.dsh-ew-chip {',
        '  display: inline-flex;',
        '  align-items: center;',
        '  gap: 5px;',
        '  max-width: 100%;',
        '  box-sizing: border-box;',
        '  padding: var(--ew-chip-pad, 3px 8px);',
        '  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08));',
        '  border-radius: 6px;',
        '  background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.18));',
        '  color: var(--dsw-alias-label-primary, #e8e8ec);',
        '  font-size: var(--ew-chip-font, 12px);',
        '  line-height: 1.45;',
        '  text-align: left;',
        '  cursor: pointer;',
        '  touch-action: manipulation;',
        '  -webkit-tap-highlight-color: transparent;',
        '  transition: background-color 120ms ease, border-color 120ms ease;',
        '}',
        '.dsh-ew-chip:hover {',
        '  background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.07));',
        '  border-color: var(--dsw-alias-border-l2, rgba(255,255,255,0.14));',
        '}',
        '.dsh-ew-chip:active { background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.03)); }',
        '.dsh-ew-chip-icon { flex: 0 0 auto; display: block; opacity: 0.62; }',
        '.dsh-ew-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
        '.dsh-ew-split {',
        '  display: inline-flex;',
        '  align-items: stretch;',
        '  max-width: 100%;',
        '  min-width: 0;',
        '  box-sizing: border-box;',
        '  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08));',
        '  border-radius: 6px;',
        '  overflow: hidden;',
        '  background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.18));',
        '  transition: background-color 120ms ease, border-color 120ms ease;',
        '}',
        '.dsh-ew-split:hover {',
        '  border-color: var(--dsw-alias-border-l2, rgba(255,255,255,0.14));',
        '  background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.07));',
        '}',
        '.dsh-ew-split .dsh-ew-chip { border: 0; border-radius: 0; background: transparent; padding-right: 2px; }',
        '.dsh-ew-split .dsh-ew-chip:hover { background: transparent; border-color: transparent; }',
        '.dsh-ew-chip-x {',
        '  display: inline-flex;',
        '  align-items: center;',
        '  justify-content: center;',
        '  min-width: 20px;',
        '  padding: 0 6px;',
        '  border: 0;',
        '  border-left: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08));',
        '  background: transparent;',
        '  color: var(--dsw-alias-label-tertiary, rgba(232,232,236,0.55));',
        '  font-size: var(--ew-chip-font, 12px);',
        '  cursor: pointer;',
        '  touch-action: manipulation;',
        '  -webkit-tap-highlight-color: transparent;',
        '  transition: color 120ms ease, background-color 120ms ease;',
        '}',
        '.dsh-ew-chip-x:hover {',
        '  color: var(--dsw-alias-state-danger-label, #ef7d7d);',
        '  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.03));',
        '}',
        '.dsh-ew-more {',
        '  border: 0;',
        '  background: transparent;',
        '  color: var(--dsw-alias-link, #7aa2ff);',
        '  font-size: 11px;',
        '  padding: 2px 0;',
        '  cursor: pointer;',
        '  white-space: nowrap;',
        '}',
        '.dsh-ew-more:hover { text-decoration: underline; text-underline-offset: 2px; }',
        '.dsh-ew-place-current { box-shadow: inset 0 0 0 1px var(--dsw-alias-link, #7aa2ff); }',
        '@media (max-width: 640px), (max-height: 600px) {',
        '  .dsh-ew-overlay {',
        '    --ew-dialog-w: 100vw;',
        '    --ew-dialog-h: 100dvh;',
        '    --ew-radius: 0px;',
        '    --ew-head-pad: calc(10px + env(safe-area-inset-top, 0px)) 14px 10px;',
        '    --ew-body-pad: 6px 10px;',
        '    --ew-foot-pad: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));',
        '    --ew-row-pad: 12px 10px;',
        '    --ew-row-font: 15px;',
        '    --ew-row-min: 44px;',
        '    --ew-btn-pad: 10px 14px;',
        '    --ew-btn-font: 14px;',
        '    --ew-link-font: 13px;',
        '    --ew-link-pad: 8px 6px;',
        '    --ew-input-font: 16px;',
        '    --ew-title-font: 16px;',
        '    --ew-status-font: 13px;',
        '    --ew-status-pad: 10px 14px;',
        '    --ew-chip-font: 14px;',
        '    --ew-chip-pad: 8px 12px;',
        '    --ew-quick-label: 13px;',
        '  }',
        '  .dsh-ew-control {',
        '    --ew-input-font: 16px;',
        '    --ew-hint-font: 13px;',
        '    --ew-btn-pad: 10px 14px;',
        '    --ew-btn-font: 14px;',
        '    --ew-link-font: 13px;',
        '    --ew-link-pad: 8px 6px;',
        '    --ew-chip-font: 14px;',
        '    --ew-chip-pad: 8px 12px;',
        '    --ew-quick-label: 13px;',
        '  }',
        '}',
        '@media (prefers-reduced-motion: reduce) {',
        '  .dsh-ew-overlay *, .dsh-ew-control * { transition: none !important; }',
        '}',
      ].join('\n')
    }

    /** The built sheet text, computed once per page. */
    var stylesheetText = null

    /**
     * Inject the sheet once and keep it current: the element is reused, and a
     * changed text (a code edit during development) replaces its content, so a
     * reloaded bundle cannot keep running on stale rules.
     */
    function ensureStyles() {
      try {
        if (stylesheetText === null) stylesheetText = buildStylesheet()
        if (typeof document === 'undefined' || document === null) return
        if (document.head === null || document.head === undefined) return
        if (typeof document.getElementById !== 'function') return
        var existing = document.getElementById(STYLE_ID)
        if (existing !== null && existing !== undefined) {
          if (existing.textContent !== stylesheetText) existing.textContent = stylesheetText
          return
        }
        if (typeof document.createElement !== 'function') return
        var style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = stylesheetText
        document.head.appendChild(style)
      } catch (error) {
        reportFailure('injected styles', error)
      }
    }

    /** The last directory the picker landed on, when browser storage allows it. */
    function readLastDir() {
      try {
        if (typeof window === 'undefined' || window === null) return null
        var storage = window.localStorage
        if (storage === null || storage === undefined || typeof storage.getItem !== 'function') return null
        var value = storage.getItem(LAST_DIR_KEY)
        return typeof value === 'string' && value !== '' ? value : null
      } catch (error) {
        return null
      }
    }

    function writeLastDir(path) {
      try {
        if (typeof path !== 'string' || path === '') return
        if (typeof window === 'undefined' || window === null) return
        var storage = window.localStorage
        if (storage === null || storage === undefined || typeof storage.setItem !== 'function') return
        storage.setItem(LAST_DIR_KEY, path)
      } catch (error) {
        /* Remembering the last directory is a convenience, never a requirement. */
      }
    }

    /**
     * Probe the Windows drive roots once: each letter's root is listed with a
     * short abort bound, so an empty optical drive or a disconnected network
     * mount cannot hold the picker. The result feeds the compact drive
     * shortcuts beside the path; the cache keeps a later open instant.
     * @param ui - uiWorkspace face from the control.
     * @param onFound - receives the servable drive rows; never called after cancel.
     * @returns cancel function aborting the outstanding probes.
     */
    function probeDrives(ui, onFound) {
      var controllers = []
      var cancelled = false
      var found = []
      var remaining = DRIVE_LETTERS.length
      function settle() {
        remaining -= 1
        if (remaining !== 0 || cancelled) return
        found.sort(function (a, b) { return a.name < b.name ? -1 : 1 })
        driveCache.items = found
        driveCache.at = Date.now()
        onFound(found)
      }
      for (var i = 0; i < DRIVE_LETTERS.length; i += 1) {
        (function (letter) {
          var path = letter + ':\\'
          var controller = null
          if (typeof AbortController === 'function') {
            try { controller = new AbortController() } catch (error) { controller = null }
          }
          if (controller !== null) controllers.push(controller)
          var timer = setTimeout(function () {
            if (controller === null) return
            try { controller.abort() } catch (error) { /* already settled */ }
          }, 1200)
          var pending
          try {
            pending = ui.listDirectory(path, controller === null ? undefined : controller.signal)
          } catch (reason) {
            clearTimeout(timer)
            settle()
            return
          }
          Promise.resolve(pending).then(function () {
            clearTimeout(timer)
            if (!cancelled) found.push({ name: letter + ':', path: path })
            settle()
          }, function () {
            clearTimeout(timer)
            settle()
          })
        })(DRIVE_LETTERS.charAt(i))
      }
      return function cancel() {
        cancelled = true
        for (var i = 0; i < controllers.length; i += 1) {
          try { controllers[i].abort() } catch (error) { /* already settled */ }
        }
        controllers = []
      }
    }

    /**
     * Render the dialog into `document.body` when the platform module table
     * provides react-dom. The control lives inside a settings card with its
     * own stacking context and resize handles, so an inline fixed overlay can
     * sit under those handles; a body portal lands the dialog on the page's
     * top layer instead. Falls back to inline rendering where portals are
     * unavailable (tests, exotic shells).
     * @param node - the dialog element.
     * @returns the element, portaled when possible.
     */
    function portalize(node) {
      try {
        if (typeof document === 'undefined' || document === null) return node
        if (document.body === null || document.body === undefined) return node
        var ReactDOM = require('react-dom')
        if (ReactDOM === null || ReactDOM === undefined || typeof ReactDOM.createPortal !== 'function') return node
        return ReactDOM.createPortal(node, document.body)
      } catch (error) {
        return node
      }
    }

    /**
     * The in-app directory picker. DSH composes the "browse" directory
     * interaction instead of the native OS chooser whenever the deployment
     * admits a remote trusted authority (e.g. `dsh web --trusted-host …`);
     * in that composition `pickDirectory()` is refused by design and the
     * official workspace flow picks in-app. This dialog follows that flow's
     * data path — the same `listDirectory`/`createDirectory` primitives, a
     * home start, the hidden filter, and the Host's listing bound — so extra
     * workspaces stay addable without the native chooser.
     *
     * @param props - uiWorkspace face, copy, open generation, settle callbacks.
     * @returns the dialog element.
     */
    function DirectoryBrowser(props) {
      var ui = props.ui
      var ownT = props.ownT
      var openSeq = props.openSeq
      var listingPair = React.useState(null)
      var listing = listingPair[0]
      var setListing = listingPair[1]
      var errorPair = React.useState(null)
      var error = errorPair[0]
      var setError = errorPair[1]
      var loadingPair = React.useState(false)
      var loading = loadingPair[0]
      var setLoading = loadingPair[1]
      var hiddenPair = React.useState(false)
      var showHidden = hiddenPair[0]
      var setShowHidden = hiddenPair[1]
      var draftPair = React.useState(null)
      var draft = draftPair[0]
      var setDraft = draftPair[1]
      var folderPair = React.useState(null)
      var folderDraft = folderPair[0]
      var setFolderDraft = folderPair[1]
      var createErrorPair = React.useState(null)
      var createError = createErrorPair[0]
      var setCreateError = createErrorPair[1]
      var creatingPair = React.useState(false)
      var creating = creatingPair[0]
      var setCreating = creatingPair[1]
      var requestRef = React.useRef(0)
      var drivePair = React.useState(driveCache.items === null ? [] : driveCache.items)
      var driveLetters = drivePair[0]
      var setDriveLetters = drivePair[1]
      var aliveRef = React.useRef(true)
      var probeCancelRef = React.useRef(null)
      var driveRefreshedRef = React.useRef(false)
      var bodyScrollRef = React.useRef(null)
      var dialogRef = React.useRef(null)

      /** Classify one failed browse call: a refused capability means the Host
       *  serves no picker at all and the control reports it; a remembered
       *  directory that no longer lists falls back to the Host home; anything
       *  else is shown inside the dialog. */
      function settleFailure(reason, mine, path, fallbackHome) {
        if (mine !== requestRef.current) return
        if (remoteFailureCode(reason) === 'directory-picker/unavailable') {
          props.onUnavailable()
          return
        }
        if (fallbackHome === true && path !== undefined) {
          load(undefined, false)
          return
        }
        setError(failureTextOf(reason))
      }

      /** Load one level; a newer request supersedes an older settlement. */
      function load(path, fallbackHome) {
        requestRef.current += 1
        var mine = requestRef.current
        setLoading(true)
        setError(null)
        var pending
        try {
          pending = ui.listDirectory(path)
        } catch (reason) {
          reportFailure('listDirectory', reason)
          setLoading(false)
          settleFailure(reason, mine, path, fallbackHome)
          return
        }
        Promise.resolve(pending).then(function (next) {
          if (mine !== requestRef.current) return
          setListing(next)
          setLoading(false)
          if (next !== null && next !== undefined && typeof next.path === 'string') writeLastDir(next.path)
          if (next !== null && next !== undefined && typeof next.home === 'string' && next.home.indexOf('\\') !== -1) ensureDrives()
        }, function (reason) {
          if (mine !== requestRef.current) return
          setLoading(false)
          settleFailure(reason, mine, path, fallbackHome)
        })
      }

      // Every open resumes the last directory this picker landed on (when it
      // still lists) and falls back to the Host home; the drive panel starts
      // closed and any in-flight probe is retired.
      React.useEffect(function () {
        setListing(null)
        setError(null)
        setLoading(false)
        setShowHidden(false)
        setDraft(null)
        setFolderDraft(null)
        setCreateError(null)
        setCreating(false)
        driveRefreshedRef.current = false
        if (dialogRef.current !== null && dialogRef.current !== undefined) dialogRef.current.focus()
        var remembered = readLastDir()
        if (remembered !== null) load(remembered, true)
        else load(undefined, false)
      }, [openSeq])

      // A closed dialog must not leave probe requests (and their abort timers)
      // running against the Host, and a settlement after unmount is ignored.
      React.useEffect(function () {
        aliveRef.current = true
        return function () {
          aliveRef.current = false
          if (probeCancelRef.current !== null) {
            probeCancelRef.current()
            probeCancelRef.current = null
          }
        }
      }, [])

      var listingPath = listing !== null && listing !== undefined && typeof listing.path === 'string' ? listing.path : null
      // A new level starts at its top row: carrying an old scroll offset into
      // a different directory would hide the head of the new listing.
      React.useEffect(function () {
        if (bodyScrollRef.current !== null && bodyScrollRef.current !== undefined) bodyScrollRef.current.scrollTop = 0
      }, [listingPath])

      /** Navigate to one level (crumb, folder row, or a submitted path). */
      function go(path) {
        setDraft(null)
        setFolderDraft(null)
        setCreateError(null)
        load(path)
      }

      /** The listed level's parent from the Host ancestry; null at a root. */
      function parentPath() {
        if (listing === null || listing === undefined) return null
        var chain = Array.isArray(listing.crumbs) ? listing.crumbs : []
        if (chain.length < 2) return null
        var parent = chain[chain.length - 2]
        return parent !== null && parent !== undefined && typeof parent.path === 'string' ? parent.path : null
      }

      /** Ensure the drive shortcuts: reuse a fresh cache, otherwise probe once
       *  per open in the background (navigation never re-probes). */
      function ensureDrives() {
        if (driveRefreshedRef.current) return
        driveRefreshedRef.current = true
        if (driveCache.items !== null && Date.now() - driveCache.at < DRIVE_CACHE_MS) {
          setDriveLetters(driveCache.items)
          return
        }
        if (probeCancelRef.current !== null) return
        probeCancelRef.current = probeDrives(ui, function (items) {
          probeCancelRef.current = null
          if (aliveRef.current) setDriveLetters(items)
        })
      }

      /** The drive letter of the listed level, or '' on a non-drive path. */
      function currentDrive() {
        if (listing === null || listing === undefined || typeof listing.path !== 'string') return ''
        var match = /^([A-Za-z]):/.exec(listing.path)
        return match === null ? '' : match[1].toUpperCase() + ':'
      }

      /** Compact drive shortcuts shown beside the path bar (Windows host only). */
      function driveChips() {
        if (hostWindows !== true || driveLetters.length === 0) return null
        var current = currentDrive()
        var nodes = []
        for (var i = 0; i < driveLetters.length; i += 1) {
          var item = driveLetters[i]
          nodes.push(h('button', {
            key: 'drive-' + item.name,
            type: 'button',
            title: ownT('browserDriveJump', { name: item.name }),
            className: 'dsh-ew-link',
            style: item.name === current ? STYLES.driveCurrent : STYLES.driveButton,
            onClick: (function (target) { return function () { setDraft(null); go(target) } })(item.path),
          }, item.name))
        }
        return nodes
      }

      /** Breadcrumb chain with the home subtree collapsed under "Home". */
      function crumbs() {
        if (listing === null || listing === undefined) return []
        var chain = Array.isArray(listing.crumbs) ? listing.crumbs : []
        var home = typeof listing.home === 'string' ? listing.home : ''
        var index = -1
        if (home !== '') {
          for (var i = 0; i < chain.length; i += 1) {
            var crumb = chain[i]
            if (crumb !== null && crumb !== undefined && crumb.path === home) { index = i; break }
          }
        }
        var out = []
        if (index !== -1) out.push({ name: ownT('browserHome'), path: home })
        for (var j = index + 1; j < chain.length; j += 1) out.push(chain[j])
        return out
      }

      /** Quick-jump chips for the header: the Host home first, then the places
       *  the control knows (used before, registered workspaces). Navigation
       *  only — picking still goes through the footer — so a wrong jump costs
       *  one click, never a wrong entry. */
      function placesNodes() {
        var home = listing !== null && listing !== undefined && typeof listing.home === 'string' ? listing.home : ''
        var atHome = listing !== null && listing !== undefined && typeof listing.path === 'string'
          && home !== '' && pathKey(listing.path) === pathKey(home)
        var items = []
        var seen = {}
        // At Home the breadcrumb already is the home jump; the chip would only
        // repeat it. Elsewhere it is the way back.
        if (home !== '' && !atHome) {
          items.push({ path: home, label: ownT('browserHome'), source: 'home' })
          seen[pathKey(home)] = true
        }
        var known = typeof props.placesOf === 'function' ? props.placesOf() : []
        var list = Array.isArray(known) ? known : []
        for (var i = 0; i < list.length && items.length < 8; i += 1) {
          var item = list[i]
          if (!isRecord(item) || typeof item.path !== 'string' || item.path === '') continue
          var key = pathKey(item.path)
          if (seen[key] === true) continue
          seen[key] = true
          items.push({
            path: item.path,
            label: typeof item.label === 'string' && item.label !== '' ? item.label : basename(item.path),
            source: item.source,
          })
        }
        if (items.length === 0) return null
        var currentKey = listing !== null && listing !== undefined && typeof listing.path === 'string'
          ? pathKey(listing.path)
          : ''
        var nodes = [h('span', { key: 'label', style: STYLES.placesLabel }, ownT('pickerPlaces'))]
        for (var j = 0; j < items.length; j += 1) {
          var entry = items[j]
          var current = pathKey(entry.path) === currentKey
          nodes.push(h('button', {
            key: 'place-' + j,
            type: 'button',
            className: current ? 'dsh-ew-chip dsh-ew-place dsh-ew-place-current' : 'dsh-ew-chip dsh-ew-place',
            title: entry.path,
            'aria-current': current ? 'true' : undefined,
            onClick: (function (target) {
              return function () { setDraft(null); go(target) }
            })(entry.path),
          }, [
            iconNode(entry.source === 'history' ? 'clock' : entry.source === 'workspace' ? 'layers' : 'folder', 12),
            h('span', { key: 'name', className: 'dsh-ew-chip-name' }, entry.label),
          ]))
        }
        return nodes
      }

      function rows() {
        if (listing === null || listing === undefined || !Array.isArray(listing.entries)) return []
        var out = []
        for (var i = 0; i < listing.entries.length; i += 1) {
          var entry = listing.entries[i]
          if (entry === null || entry === undefined) continue
          if (entry.hidden === true && !showHidden) continue
          out.push(entry)
        }
        return out
      }

      function confirmPick() {
        if (listing === null || listing === undefined || typeof listing.path !== 'string') return
        writeLastDir(listing.path)
        props.onPick(listing.path)
      }

      function submitCreate() {
        if (folderDraft === null || listing === null || listing === undefined) return
        var name = String(folderDraft)
        if (name.trim() === '') return
        var parent = listing.path
        setCreating(true)
        setCreateError(null)
        var pending
        try {
          pending = ui.createDirectory(parent, name)
        } catch (reason) {
          reportFailure('createDirectory', reason)
          setCreating(false)
          setCreateError(failureTextOf(reason))
          return
        }
        Promise.resolve(pending).then(function (created) {
          setCreating(false)
          setFolderDraft(null)
          load(typeof created === 'string' ? created : parent)
        }, function (reason) {
          setCreating(false)
          setCreateError(failureTextOf(reason))
        })
      }

      function rowNodes(entries) {
        var out = []
        for (var i = 0; i < entries.length; i += 1) {
          out.push(h('button', {
            key: 'row-' + i,
            type: 'button',
            className: 'dsh-ew-row',
            style: STYLES.browserRow,
            onClick: (function (target) { return function () { go(target) } })(entries[i].path),
          }, [
            iconNode('folder', 13, 'dsh-ew-row-icon'),
            h('span', { key: 'name', style: STYLES.rowName }, String(entries[i].name)),
          ]))
        }
        return out
      }

      function crumbNodes(chain) {
        var out = []
        for (var i = 0; i < chain.length; i += 1) {
          if (i > 0) out.push(h('span', { key: 'sep-' + i, style: STYLES.crumbSep }, '\u203A'))
          out.push(h('button', {
            key: 'crumb-' + i,
            type: 'button',
            className: 'dsh-ew-link',
            style: STYLES.crumbButton,
            onClick: (function (target) { return function () { go(target) } })(chain[i].path),
          }, String(chain[i].name)))
        }
        return out
      }

      function pathEditor(pathText) {
        if (draft === null) {
          return h('div', { key: 'path', style: STYLES.pathRow },
            h('span', { key: 'text', style: STYLES.pathText, title: pathText }, pathText),
            h('button', {
              key: 'edit',
              type: 'button',
              className: 'dsh-ew-link',
              style: STYLES.linkButton,
              onClick: function () { setDraft(pathText) },
            }, ownT('browserEditPath')),
            driveChips())
        }
        return h('div', { key: 'path', style: STYLES.pathRow },
          h('input', {
            key: 'draft',
            type: 'text',
            style: STYLES.pathInput,
            value: draft,
            'aria-label': ownT('browserPathLabel'),
            onChange: function (event) { setDraft(event.target.value) },
            onKeyDown: function (event) {
              if (event.key === 'Enter' && !isComposing(event)) {
                event.preventDefault()
                go(draft)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setDraft(null)
              }
            },
          }),
          h('button', { key: 'go', type: 'button', className: 'dsh-ew-secondary', style: STYLES.secondaryButton, onClick: function () { go(draft) } }, ownT('browserGo')),
          h('button', { key: 'cancel', type: 'button', className: 'dsh-ew-link', style: STYLES.linkButton, onClick: function () { setDraft(null) } }, ownT('browserCancel')),
          driveChips())
      }

      /** The new-folder form, pinned between the scrolling list and the
       *  footer: a long directory must never bury the input it just opened.
       *  @returns the form, or null while closed. */
      function createPanel() {
        if (folderDraft === null) return null
        return h('div', { key: 'create-panel', 'data-dsh-create': 'true', style: STYLES.createPanel },
          h('div', { key: 'row', style: STYLES.createRow },
            h('input', {
              key: 'name',
              type: 'text',
              style: STYLES.pathInput,
              value: folderDraft,
              placeholder: ownT('browserFolderName'),
              'aria-label': ownT('browserFolderName'),
              autoFocus: true,
              disabled: creating,
              onChange: function (event) { setFolderDraft(event.target.value) },
              onKeyDown: function (event) {
                if (event.key === 'Enter' && !isComposing(event)) {
                  event.preventDefault()
                  submitCreate()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  if (!creating) setFolderDraft(null)
                }
              },
            }),
            h('button', { key: 'create', type: 'button', className: 'dsh-ew-primary', style: STYLES.primaryButton, disabled: creating || String(folderDraft).trim() === '', onClick: submitCreate }, ownT('browserCreate')),
            h('button', { key: 'cancel', type: 'button', className: 'dsh-ew-link', style: STYLES.linkButton, disabled: creating, onClick: function () { setFolderDraft(null) } }, ownT('browserCancel'))),
          createError !== null ? h('div', { key: 'error', style: STYLES.dialogError, role: 'alert' }, createError) : null)
      }

      var chain = crumbs()
      var entries = rows()
      var body = []
      if (listing !== null && listing !== undefined) {
        var upTarget = parentPath()
        if (upTarget !== null) {
          body.push(h('button', {
            key: 'up',
            type: 'button',
            className: 'dsh-ew-row',
            style: STYLES.upRow,
            title: ownT('browserUp'),
            'aria-label': ownT('browserUp'),
            onClick: function () { go(upTarget) },
          }, '../'))
        }
        if (entries.length === 0) body.push(h('div', { key: 'empty', style: STYLES.status }, ownT('browserEmpty')))
        var rowElements = rowNodes(entries)
        for (var bodyIndex = 0; bodyIndex < rowElements.length; bodyIndex += 1) {
          body.push(rowElements[bodyIndex])
        }
      }
      /** Why the listed directory cannot be picked right now, or null when it
       *  can. Stated before the click: a disabled button with no reason reads as
       *  a broken dialog. */
      var pickBlock = null
      if (listing !== null && listing !== undefined && typeof listing.path === 'string') {
        var taken = Array.isArray(props.existing) ? props.existing : []
        var limit = Number.isInteger(props.maxEntries) ? props.maxEntries : MAX_ENTRIES
        if (taken.length >= limit) {
          pickBlock = ownT('errLimit', { n: limit })
        } else {
          var takenConflict = conflictFor(taken, pathKey(listing.path))
          if (takenConflict === 'duplicate') pickBlock = ownT('pickerAlready')
          else if (takenConflict === 'overlap') pickBlock = ownT('errOverlap')
        }
      }
      // Transient state sits in the fixed strip above the footer: a scrolled
      // listing must not hide the fact that it is loading, cut, or refused.
      var statusNode = null
      if (loading === true && listing === null) {
        statusNode = h('div', { key: 'status', style: STYLES.statusBar, role: 'status' }, ownT('browserLoading'))
      } else if (error !== null) {
        statusNode = h('div', { key: 'status', style: STYLES.statusErrorBar, role: 'alert' }, error)
      } else if (pickBlock !== null) {
        statusNode = h('div', { key: 'status', style: STYLES.statusBar, role: 'status' }, pickBlock)
      } else if (listing !== null && listing !== undefined && listing.truncated === true) {
        statusNode = h('div', { key: 'status', style: STYLES.statusBar, role: 'status' }, ownT('browserTruncated'))
      }
      var createNode = createPanel()

      var pathText = listing !== null && listing !== undefined && typeof listing.path === 'string' ? listing.path : ''
      // Drive letters exist only on a Windows Host; the listed home path's
      // separator is the platform fact the Host stamped (never the browser's).
      var hostWindows = listing !== null && listing !== undefined
        && typeof listing.home === 'string' && listing.home.indexOf('\\') !== -1
      var placeNodes = placesNodes()
      return portalize(h('div', { style: STYLES.overlay, className: 'dsh-ew-overlay' },
        h('div', {
          ref: dialogRef,
          tabIndex: -1,
          style: STYLES.dialog,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': ownT('browserTitle'),
          onKeyDown: function (event) {
            if (event.key !== 'Escape' || isComposing(event) || creating === true) return
            event.preventDefault()
            props.onCancel()
          },
        },
          h('div', { style: STYLES.dialogHead },
            h('div', { key: 'top', style: STYLES.dialogTop },
              h('div', { key: 'title', style: STYLES.dialogTitle }, ownT('browserTitle')),
              h('span', { key: 'target', style: STYLES.dialogHint }, ownT('browserTarget'))),
            h('div', { key: 'crumbs', style: STYLES.crumbs }, crumbNodes(chain)),
            pathEditor(pathText),
            placeNodes === null ? null : h('div', { key: 'places', style: STYLES.placesRow }, placeNodes)),
          h('div', { style: STYLES.dialogBody, 'data-dsh-scroll': 'true', ref: bodyScrollRef }, body),
          statusNode,
          createNode,
          h('div', { style: STYLES.dialogFoot },
            h('button', {
              key: 'hidden',
              type: 'button',
              className: 'dsh-ew-secondary',
              style: STYLES.secondaryButton,
              'aria-pressed': showHidden === true,
              onClick: function () { setShowHidden(!showHidden) },
            }, ownT('browserShowHidden') + (showHidden ? ' \u2713' : '')),
            h('button', {
              key: 'new-folder',
              type: 'button',
              className: 'dsh-ew-secondary',
              style: STYLES.secondaryButton,
              disabled: listing === null || folderDraft !== null,
              onClick: function () { setCreateError(null); setFolderDraft('') },
            }, ownT('browserNewFolder')),
            h('span', { key: 'gap', style: STYLES.footerGap }),
            h('button', { key: 'cancel', type: 'button', className: 'dsh-ew-secondary', style: STYLES.secondaryButton, onClick: props.onCancel }, ownT('browserCancel')),
            h('button', {
              key: 'use',
              type: 'button',
              className: 'dsh-ew-primary',
              style: STYLES.primaryButton,
              disabled: listing === null || loading === true || pickBlock !== null,
              onClick: confirmPick,
            }, ownT('browserUse'))))))
    }

    /**
     * The quick-add strip under the list: directories that are one click away
     * because this browser used them before, because the user registered them
     * as DSH workspaces, or because they sit next to this session's workspace.
     *
     * It only offers candidates the list would accept (the same duplicate,
     * overlap and cap rules run before a chip is shown), so a click can never
     * produce a refusal. Nothing is offered at all when nothing is addable,
     * which keeps a full list and a locked page free of chrome.
     */
    function QuickAdd(props) {
      var ownT = props.ownT
      var sessionState = useServiceSnapshot(props.services.getSessionList, EMPTY_SESSION_STATE)
      var workspaceState = useServiceSnapshot(props.services.getWorkspaceList, EMPTY_WORKSPACE_STATE)
      var cwd = sessionCwdOf(sessionState, props.sessionId)
      var siblingPair = React.useState(null)
      var siblings = siblingPair[0]
      var setSiblings = siblingPair[1]
      var expandedPair = React.useState(false)
      var expanded = expandedPair[0]
      var setExpanded = expandedPair[1]

      // Sibling folders come from one Host listing of the session workspace's
      // parent, shared by every mount through siblingCache: reopening the
      // settings tab must not re-list the same directory. A Host that serves no
      // browse capability refuses the verb; that is silence, not an error.
      React.useEffect(function () {
        if (cwd === null) return undefined
        var parent = parentPathOf(cwd)
        if (parent === null) return undefined
        var ui = props.getUi()
        if (ui === null || ui === undefined || typeof ui.listDirectory !== 'function') return undefined
        var parentKey = pathKey(parent)
        var now = Date.now()
        if (siblingCache.key === parentKey && now - siblingCache.at < SIBLING_TTL) {
          setSiblings(siblingCache.items)
          return undefined
        }
        var cancelled = false
        siblingCache.key = parentKey
        siblingCache.at = now
        siblingCache.items = null
        var pending
        try {
          pending = ui.listDirectory(parent)
        } catch (error) {
          return undefined
        }
        if (pending === null || pending === undefined || typeof pending.then !== 'function') return undefined
        pending.then(function (listing) {
          if (cancelled) return
          var found = []
          var list = listing !== null && listing !== undefined && Array.isArray(listing.entries) ? listing.entries : []
          for (var i = 0; i < list.length && found.length < SIBLING_LIMIT; i += 1) {
            var entry = list[i]
            if (!isRecord(entry) || typeof entry.path !== 'string') continue
            if (entry.hidden === true) continue
            if (typeof entry.name !== 'string' || entry.name === '') continue
            if (isNoiseDir(entry.name)) continue
            if (pathKey(entry.path) === pathKey(cwd)) continue
            found.push({ path: entry.path, alias: entry.name })
          }
          siblingCache.items = found
          siblingCache.at = Date.now()
          setSiblings(found)
        }, function () {
          if (cancelled) return
          siblingCache.items = []
          siblingCache.at = Date.now()
          setSiblings([])
        })
        return function () { cancelled = true }
      }, [cwd])

      var candidates = suggestionCandidates({
        entries: props.entries,
        history: props.history,
        workspaces: workspaceState.items,
        siblings: siblings,
        mainCwd: cwd,
        maxEntries: MAX_ENTRIES,
      })
      var room = MAX_ENTRIES - props.entries.length
      if (room <= 0) return null
      if (candidates.recent.length === 0 && candidates.suggested.length === 0) return null

      var page = expanded ? Math.max(candidates.recent.length, candidates.suggested.length) : QUICK_PAGE
      var recent = candidates.recent.slice(0, page)
      var suggested = candidates.suggested.slice(0, page)
      var hidden = candidates.recent.length - recent.length + candidates.suggested.length - suggested.length

      function chipNode(item, index) {
        var name = suggestionName(item)
        var tip = sourceLabelOf(ownT, item.source) + ' · ' + item.path
        var main = h('button', {
          key: 'chip-' + index,
          type: 'button',
          className: 'dsh-ew-chip',
          style: STYLES.chip,
          title: tip,
          onClick: function () { props.onAdd(item) },
        }, [
          iconNode(item.source === 'history' ? 'clock' : item.source === 'workspace' ? 'layers' : 'folder', 12),
          h('span', { key: 'name', className: 'dsh-ew-chip-name', style: STYLES.chipName }, name),
        ])
        if (item.source !== 'history') return main
        var forgetLabel = ownT('forget', { name: name })
        return h('span', { key: 'chip-' + index, className: 'dsh-ew-split', style: STYLES.splitChip },
          main,
          h('button', {
            key: 'forget',
            type: 'button',
            className: 'dsh-ew-chip-x',
            title: forgetLabel,
            'aria-label': forgetLabel,
            onClick: function () { props.onForget(item.path) },
          }, '\u00d7'))
      }

      function rowNode(key, label, items) {
        if (items.length === 0) return null
        var chips = []
        for (var i = 0; i < items.length; i += 1) chips.push(chipNode(items[i], i))
        return h('div', { key: key, style: STYLES.quickRow },
          h('span', { key: 'label', style: STYLES.quickLabel }, label),
          h('div', { key: 'chips', style: STYLES.quickChips }, chips))
      }

      var toggle = (hidden > 0 || expanded)
        ? h('button', {
          key: 'toggle',
          type: 'button',
          className: 'dsh-ew-more',
          style: STYLES.moreButton,
          onClick: function () { setExpanded(!expanded) },
        }, expanded ? ownT('quickLess') : ownT('quickMore', { n: hidden }))
        : null

      return h('div', {
        key: 'quick',
        className: 'dsh-ew-quick',
        style: STYLES.quick,
        role: 'group',
        'aria-label': ownT('quickTitle'),
        'data-dsh-quick': 'true',
      }, [
        h('div', { key: 'head', style: STYLES.quickHead },
          h('span', { key: 'title', style: STYLES.quickTitleStyle }, ownT('quickTitle')),
          toggle),
        rowNode('recent', ownT('quickRecent'), recent),
        rowNode('suggested', ownT('quickSuggested'), suggested),
      ])
    }

    /** The control factory: the uiWorkspace lookup and the language store are
     *  per-activation, so nothing leaks between plugin loads. */
    function createWorkspacesControl(options) {
      var getUi = options.getUi
      var langStore = options.langStore
      var getService = options.getService

      /** The snapshot source of one optional client service. Both services this
       *  control reads (sessions, workspaces) belong to the shipped Web app; a
       *  profile without them simply offers history-based shortcuts. */
      function serviceList(name) {
        var service = getService(name)
        if (service === null || service === undefined) return undefined
        var list = service.list
        return list === null || list === undefined ? undefined : list
      }

      var services = {
        getSessionList: function () { return serviceList('sessions') },
        getWorkspaceList: function () { return serviceList('workspaces') },
      }

      return function WorkspacesControl(props) {
        var lang = useLang(langStore)
        var ownT = makeOwnT(lang)
        var item = isRecord(props.item) ? props.item : {}
        var entries = normalizeEntries(props.value)
        var latest = React.useRef(entries)
        latest.current = entries
        var readOnly = props.disabled === true || props.busy === true
        var noticePair = React.useState(null)
        var notice = noticePair[0]
        var setNotice = noticePair[1]
        var browserPair = React.useState(null)
        var browser = browserPair[0]
        var setBrowser = browserPair[1]
        var browserSequence = React.useRef(0)
        var historyPair = React.useState(readHistory)
        var history = historyPair[0]
        var setHistory = historyPair[1]
        var historyRef = React.useRef(history)
        historyRef.current = history
        var entrySignature = entries.map(function (entry) {
          return entry.path + '\u0000' + entry.alias + '\u0000' + entry.note
        }).join('\u0001')
        // A directory already on the list is one the browser has certainly used:
        // fold it into the history so it stays one click away after removal.
        React.useEffect(function () {
          var next = seedHistory(historyRef.current, entries, Date.now())
          if (next === historyRef.current) return
          historyRef.current = next
          writeHistory(next)
          setHistory(next)
        }, [entrySignature])
        var base = typeof props.domId === 'string' && props.domId !== '' ? props.domId : PLUGIN_ID
        var t = typeof props.t === 'function' ? props.t : function (text) { return text }

        function write(next) {
          // The page surfaces its own write failure notice; a rejection here
          // must not escape into the render.
          try {
            var pending = props.setValue(next)
            if (pending !== null && pending !== undefined && typeof pending.catch === 'function') pending.catch(noop)
          } catch (error) {
            reportFailure('write', error)
          }
        }

        /** Remember a directory this browser added: the quick-add row's memory. */
        function rememberPath(entry) {
          var next = upsertHistory(historyRef.current, entry, Date.now())
          historyRef.current = next
          writeHistory(next)
          setHistory(next)
        }

        function forgetRemembered(path) {
          var next = forgetHistory(historyRef.current, path)
          if (next === historyRef.current) return
          historyRef.current = next
          writeHistory(next)
          setHistory(next)
        }

        /**
         * Append one directory, running the same rules for every entry point
         * (native chooser, in-app picker, quick-add chip). A seed may carry the
         * recognized name/note of a suggestion; the picked path defaults to its
         * own last segment.
         * @returns true when the list was written.
         */
        function addPath(picked, seed) {
          var path = String(picked)
          if (path.trim() === '') {
            setNotice('errEmpty')
            return false
          }
          var current = latest.current
          if (current.length >= MAX_ENTRIES) {
            setNotice('errLimit')
            return false
          }
          var conflict = conflictFor(current, pathKey(path))
          if (conflict !== null) {
            setNotice(conflict === 'duplicate' ? 'errDuplicate' : 'errOverlap')
            return false
          }
          setNotice(null)
          var alias = seed !== null && seed !== undefined && typeof seed.alias === 'string' && seed.alias.trim() !== ''
            ? seed.alias
            : basename(path)
          var note = seed !== null && seed !== undefined && typeof seed.note === 'string' ? seed.note : ''
          write(current.concat([{ path: path, alias: alias, note: note }]))
          rememberPath({ path: path, alias: alias, note: note })
          return true
        }

        /** Quick-jump places inside the picker: directories this browser used,
         *  then the user's registered workspaces. The dialog adds Home and caps
         *  the row itself. */
        function placesOf() {
          var items = []
          var seen = {}
          var historyList = historyRef.current
          for (var h = 0; h < historyList.length; h += 1) {
            var used = historyList[h]
            var usedKey = pathKey(used.path)
            if (seen[usedKey] === true) continue
            seen[usedKey] = true
            items.push({ path: used.path, label: suggestionName(used), source: 'history' })
          }
          var source = serviceList('workspaces')
          var snapshot = source === null || source === undefined ? null : source.getSnapshot()
          var workspaces = snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.items) ? snapshot.items : []
          for (var w = 0; w < workspaces.length; w += 1) {
            var workspace = workspaces[w]
            if (!isRecord(workspace) || typeof workspace.path !== 'string') continue
            var key = pathKey(workspace.path)
            if (seen[key] === true) continue
            seen[key] = true
            items.push({
              path: workspace.path,
              label: typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : basename(workspace.path),
              source: 'workspace',
            })
          }
          return items
        }

        /** Open the in-app picker bound to the uiWorkspace face that answered
         *  at click time (a later service swap must not redirect it). */
        function openBrowser(ui) {
          browserSequence.current += 1
          setBrowser({ sequence: browserSequence.current, ui: ui })
        }

        function closeBrowser() {
          setBrowser(null)
        }

        function pickFromBrowser(path) {
          setBrowser(null)
          addPath(path)
        }

        function browseUnavailable() {
          setBrowser(null)
          setNotice('pickerUnavailable')
        }

        /** Follow the Host's browse composition: the same interaction the
         *  official workspace dialog drives. A Host serving neither reports
         *  the unavailable notice instead of opening a dead dialog. */
        function followBrowsePicker(ui) {
          if (typeof ui.listDirectory !== 'function') {
            setNotice('pickerUnavailable')
            return
          }
          setNotice(null)
          openBrowser(ui)
        }

        function onAdd() {
          if (readOnly) return
          var ui = getUi()
          if (ui === null || ui === undefined) {
            setNotice('pickerUnavailable')
            return
          }
          // A browse composition serves listing/creation instead of an OS
          // chooser; pick in-app like the official workspace flow does.
          if (typeof ui.pickDirectory !== 'function') {
            followBrowsePicker(ui)
            return
          }
          var picked
          try {
            picked = ui.pickDirectory()
          } catch (error) {
            reportFailure('pickDirectory', error)
            followBrowsePicker(ui)
            return
          }
          Promise.resolve(picked).then(function (value) {
            if (typeof value === 'string') addPath(value)
          }, function (error) {
            reportFailure('pickDirectory', error)
            // The native chooser was refused (the browse composition is the
            // expected one); fall back to the in-app picker.
            followBrowsePicker(ui)
          })
        }

        function onRemove(index) {
          if (readOnly) return
          var current = latest.current
          var next = []
          for (var i = 0; i < current.length; i += 1) {
            if (i !== index) next.push(current[i])
          }
          setNotice(null)
          write(next)
        }

        function onEdit(index, field, text) {
          if (readOnly) return
          var current = latest.current
          var next = []
          for (var i = 0; i < current.length; i += 1) {
            var entry = current[i]
            if (i !== index) {
              next.push(entry)
              continue
            }
            next.push({
              path: entry.path,
              alias: field === 'alias' ? text : entry.alias,
              note: field === 'note' ? text : entry.note,
            })
          }
          write(next)
        }

        var children = [h('div', { key: 'hint', style: STYLES.hint }, ownT('hint'))]
        if (notice !== null) {
          children.push(h('div', { key: 'notice', style: STYLES.notice, role: 'status' }, ownT(notice, { n: MAX_ENTRIES })))
        }
        if (entries.length === 0) {
          children.push(h('div', { key: 'empty', style: STYLES.empty }, ownT('empty')))
        } else {
          children.push(h('div', { key: 'list', style: STYLES.list }, entries.map(function (entry, index) {
            return h(WorkspaceRow, {
              key: 'entry-' + index,
              index: index,
              entry: entry,
              base: base,
              readOnly: readOnly,
              getUi: getUi,
              ownT: ownT,
              onEdit: onEdit,
              onRemove: onRemove,
            })
          })))
        }
        if (!readOnly) {
          // One-click directories first: choosing one of them is the fastest
          // path, and the explicit picker stays the fallback right below.
          children.push(h(QuickAdd, {
            key: 'quick',
            sessionId: props.sessionId,
            entries: entries,
            history: history,
            ownT: ownT,
            services: services,
            getUi: getUi,
            onAdd: function (item) { addPath(item.path, { alias: item.alias, note: item.note }) },
            onForget: forgetRemembered,
          }))
          children.push(h('div', { key: 'add', style: STYLES.addRow }, [
            h('button', {
              key: 'button',
              type: 'button',
              id: base + '-add',
              className: 'dsh-ew-primary',
              style: STYLES.primaryButton,
              onClick: onAdd,
            }, [
              iconNode('plus', 13),
              h('span', { key: 'label' }, ownT('add')),
            ]),
            entries.length === 0
              ? null
              : h('span', { key: 'count', style: STYLES.count }, ownT('count', { n: entries.length, max: MAX_ENTRIES })),
          ]))
        }
        if (browser !== null && !readOnly) {
          children.push(h(DirectoryBrowser, {
            key: 'browser',
            openSeq: browser.sequence,
            ui: browser.ui,
            ownT: ownT,
            existing: entries,
            maxEntries: MAX_ENTRIES,
            placesOf: placesOf,
            onPick: pickFromBrowser,
            onCancel: closeBrowser,
            onUnavailable: browseUnavailable,
          }))
        }
        return h('div', {
          id: base,
          className: 'dsh-ew-control',
          style: STYLES.root,
          role: 'group',
          'aria-label': typeof item.title === 'string' && item.title !== '' ? t(item.title) : ownT('groupLabel'),
        }, children)
      }
    }

    /* -------------------------------------------------------------- styles */

    /** Host theme tokens only — no Harness client package is imported. The
     *  fallbacks after each var() are for standalone rendering; in the GUI the
     *  alias always resolves. */
    var STYLES = {
      // Fills the page's control column, and may shrink below its content width
      // so a narrow pane wraps the row instead of overflowing.
      root: { display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 auto', minWidth: 0 },
      hint: { fontSize: 'var(--ew-hint-font, 12px)', color: 'var(--dsw-alias-label-tertiary, rgba(232,232,236,0.55))' },
      list: { display: 'flex', flexDirection: 'column', gap: '6px' },
      entry: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))',
        background: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.03))',
      },
      entryHead: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' },
      aliasInput: {
        flex: '1 1 90px',
        minWidth: '70px',
        maxWidth: '140px',
        padding: '4px 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.14))',
        background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.18))',
        color: 'var(--dsw-alias-label-primary, #e8e8ec)',
        fontSize: 'var(--ew-input-font, 12px)',
      },
      path: {
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        flex: '1 1 auto',
        minWidth: 0,
        fontSize: '11px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: 'var(--dsw-alias-label-secondary, rgba(232,232,236,0.7))',
      },
      noteInput: {
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        padding: '4px 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.14))',
        background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.18))',
        color: 'var(--dsw-alias-label-primary, #e8e8ec)',
        fontSize: 'var(--ew-input-font, 12px)',
      },
      missing: { color: 'var(--dsw-alias-state-warn-label, #d8b46a)' },
      notice: {
        padding: '4px 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-state-warn-primary, #b98a2f)',
        background: 'var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.06))',
        color: 'var(--dsw-alias-state-warn-label, #d8b46a)',
        fontSize: '12px',
      },
      empty: { fontSize: '12px', color: 'var(--dsw-alias-label-dimmed, rgba(232,232,236,0.38))' },
      addRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' },
      // The quick-add strip: a quiet inset under the list, not a second dialog.
      quick: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))',
        background: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.03))',
      },
      quickHead: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
      quickTitleStyle: {
        flex: '1 1 auto',
        minWidth: 0,
        fontSize: 'var(--ew-quick-label, 11px)',
        fontWeight: '600',
        color: 'var(--dsw-alias-label-tertiary, rgba(232,232,236,0.55))',
      },
      quickRow: { display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' },
      quickLabel: {
        flex: '0 0 auto',
        minWidth: '46px',
        paddingTop: '4px',
        fontSize: 'var(--ew-quick-label, 11px)',
        color: 'var(--dsw-alias-label-dimmed, rgba(232,232,236,0.38))',
      },
      quickChips: { flex: '1 1 180px', display: 'flex', flexWrap: 'wrap', gap: '6px', minWidth: 0 },
      chip: { display: 'inline-flex', alignItems: 'center', gap: '5px', maxWidth: '100%', minWidth: 0 },
      chipName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '170px' },
      splitChip: { display: 'inline-flex', alignItems: 'stretch', maxWidth: '100%', minWidth: 0 },
      moreButton: {
        flex: '0 0 auto',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-link, #7aa2ff)',
        fontSize: 'var(--ew-quick-label, 11px)',
        padding: '2px 0',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      count: {
        marginLeft: 'auto',
        fontSize: 'var(--ew-quick-label, 11px)',
        color: 'var(--dsw-alias-label-tertiary, rgba(232,232,236,0.55))',
        fontVariantNumeric: 'tabular-nums',
      },
      placesRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', minWidth: 0 },
      placesLabel: {
        fontSize: 'var(--ew-link-font, 11px)',
        color: 'var(--dsw-alias-label-dimmed, rgba(232,232,236,0.38))',
      },
      primaryButton: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: 'var(--ew-btn-pad, 4px 10px)',
        borderRadius: '6px',
        border: '1px solid transparent',
        background: 'var(--dsw-alias-button-primary-fill, #4a7dff)',
        color: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
        fontSize: 'var(--ew-btn-font, 12px)',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      },
      linkButton: {
        padding: 'var(--ew-link-pad, 2px 4px)',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-link, #7aa2ff)',
        fontSize: 'var(--ew-link-font, 11px)',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      },
      secondaryButton: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: 'var(--ew-btn-pad, 4px 10px)',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.14))',
        color: 'var(--dsw-alias-label-primary, #e8e8ec)',
        fontSize: 'var(--ew-btn-font, 12px)',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      },
      footerGap: { flex: '1 1 auto' },
      overlay: {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.45)',
        overscrollBehavior: 'contain',
      },
      dialog: {
        width: 'var(--ew-dialog-w, min(680px, calc(100vw - 32px)))',
        height: 'var(--ew-dialog-h, min(500px, calc(100vh - 64px)))',
        maxWidth: '100%',
        maxHeight: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 'var(--ew-radius, 12px)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.14))',
        background: 'var(--dsw-alias-bg-layer-1, #1b1b20)',
        boxShadow: '0 18px 48px rgba(0, 0, 0, 0.45)',
      },
      dialogHead: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: 'var(--ew-head-pad, 12px 16px)',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))',
      },
      dialogTop: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' },
      dialogTitle: { fontSize: 'var(--ew-title-font, 13px)', fontWeight: '600', color: 'var(--dsw-alias-label-primary, #e8e8ec)' },
      dialogHint: { fontSize: 'var(--ew-link-font, 11px)', color: 'var(--dsw-alias-label-dimmed, rgba(232,232,236,0.38))' },
      crumbs: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px', fontSize: 'var(--ew-link-font, 11px)' },
      crumbButton: {
        padding: 'var(--ew-link-pad, 2px 4px)',
        border: 'none',
        borderRadius: '4px',
        background: 'transparent',
        color: 'var(--dsw-alias-link, #7aa2ff)',
        fontSize: 'var(--ew-link-font, 11px)',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      },
      crumbSep: { color: 'var(--dsw-alias-label-dimmed, rgba(232,232,236,0.38))' },
      upRow: {
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 'var(--ew-row-min, 28px)',
        padding: 'var(--ew-row-pad, 6px 8px)',
        border: '1px solid transparent',
        borderRadius: '6px',
        color: 'var(--dsw-alias-label-secondary, rgba(232,232,236,0.7))',
        fontSize: 'var(--ew-row-font, 12px)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        textAlign: 'left',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      },
      driveButton: {
        padding: 'var(--ew-link-pad, 2px 4px)',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-link, #7aa2ff)',
        fontSize: 'var(--ew-link-font, 11px)',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      },
      driveCurrent: {
        padding: 'var(--ew-link-pad, 2px 4px)',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #e8e8ec)',
        fontSize: 'var(--ew-link-font, 11px)',
        fontWeight: '600',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      },
      pathRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' },
      pathText: {
        flex: '1 1 auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: 'var(--ew-link-font, 11px)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: 'var(--dsw-alias-label-secondary, rgba(232,232,236,0.7))',
      },
      pathInput: {
        flex: '1 1 auto',
        minWidth: 0,
        boxSizing: 'border-box',
        padding: '4px 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.14))',
        background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.18))',
        color: 'var(--dsw-alias-label-primary, #e8e8ec)',
        fontSize: 'var(--ew-input-font, 12px)',
      },
      dialogBody: {
        flex: '1 1 auto',
        minHeight: 0,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: 'var(--ew-body-pad, 8px 12px)',
        WebkitOverflowScrolling: 'touch',
      },
      rowName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      browserRow: {
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 'var(--ew-row-min, 28px)',
        padding: 'var(--ew-row-pad, 6px 8px)',
        border: '1px solid transparent',
        borderRadius: '6px',
        color: 'var(--dsw-alias-label-primary, #e8e8ec)',
        fontSize: 'var(--ew-row-font, 12px)',
        textAlign: 'left',
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      },
      status: {
        padding: '4px 6px',
        fontSize: 'var(--ew-status-font, 12px)',
        color: 'var(--dsw-alias-label-tertiary, rgba(232,232,236,0.55))',
      },
      dialogError: {
        padding: '4px 6px',
        fontSize: 'var(--ew-status-font, 12px)',
        color: 'var(--dsw-alias-state-danger-label, #ef7d7d)',
      },
      dialogFoot: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        padding: 'var(--ew-foot-pad, 10px 16px)',
        borderTop: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))',
      },
      createRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' },
      createPanel: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: 'var(--ew-status-pad, 8px 16px)',
        borderTop: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))',
      },
      statusBar: {
        padding: 'var(--ew-status-pad, 6px 16px)',
        borderTop: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))',
        fontSize: 'var(--ew-status-font, 12px)',
        color: 'var(--dsw-alias-label-tertiary, rgba(232,232,236,0.55))',
      },
      statusErrorBar: {
        padding: 'var(--ew-status-pad, 6px 16px)',
        borderTop: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08))',
        fontSize: 'var(--ew-status-font, 12px)',
        color: 'var(--dsw-alias-state-danger-label, #ef7d7d)',
      },
    }

    /* ----------------------------------------------------------------- ctx */

    return {
      name: PLUGIN_ID,
      inject: ['sessionSettings'],
      apply: function (ctx) {
        ensureStyles()
        var langStore = createLangStore(ctx)
        var getUi = function () {
          try {
            return typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
          } catch (error) {
            reportFailure('uiWorkspace lookup', error)
            return undefined
          }
        }

        // Follow the host language; the control re-renders through the store.
        ctx.effect(function () {
          var locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
          if (locale === null || locale === undefined || typeof locale.subscribe !== 'function') return undefined
          return locale.subscribe(function () { langStore.sync() })
        }, PLUGIN_ID + ': follow host language')

        // Optional client services the quick-add row reads (sessions' working
        // directories, registered workspaces). A profile without them keeps the
        // history-based shortcuts; nothing here is a hard dependency.
        var getService = function (name) {
          try {
            return typeof ctx.get === 'function' ? ctx.get(name) : undefined
          } catch (error) {
            reportFailure('service lookup ' + name, error)
            return undefined
          }
        }

        var sessionSettings = ctx.sessionSettings
        var Control = createWorkspacesControl({ getUi: getUi, langStore: langStore, getService: getService })
        ctx.effect(function () {
          try {
            var dispose = sessionSettings.registerRenderer(PLUGIN_ID, ITEM_KEY, Control)
            return typeof dispose === 'function' ? dispose : noop
          } catch (error) {
            // A refused registration leaves the item on the page's own default
            // control instead of taking the whole settings page down.
            reportFailure('register', error)
            return noop
          }
        }, PLUGIN_ID + ': register the workspaces control')
      },
    }
  },
})
