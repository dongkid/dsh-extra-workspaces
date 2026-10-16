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
        errEmpty: '没有选中任何目录。',
        errDuplicate: '这个目录已经在列表里了。',
        errOverlap: '这个目录和列表里的目录互相包含，只能留一个。',
        errLimit: '最多只能添加 {n} 个额外工作区。',
        groupLabel: '额外工作区',
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
        errEmpty: 'No directory was selected.',
        errDuplicate: 'That directory is already in the list.',
        errOverlap: 'That directory and one already listed contain each other; keep only one.',
        errLimit: 'At most {n} extra workspaces.',
        groupLabel: 'Extra workspaces',
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

      return h('div', { style: STYLES.entry },
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
            onChange: function (event) { aliasDraft[1](event.target.value) },
            onBlur: commitAlias,
            onKeyDown: enterCommits(commitAlias),
            style: STYLES.aliasInput,
          }),
          h('span', { key: 'path', style: STYLES.path, title: entry.path, 'aria-label': ownT('pathLabel') }, [
            h('span', { key: 'text' }, entry.path),
            missing ? h('span', { key: 'missing', style: STYLES.missing }, ' · ' + ownT('missing')) : null,
          ]),
          readOnly ? null : h('button', {
            key: 'remove',
            type: 'button',
            style: STYLES.linkButton,
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
          onChange: function (event) { noteDraft[1](event.target.value) },
          onBlur: commitNote,
          onKeyDown: enterCommits(commitNote),
          style: STYLES.noteInput,
        }),
      )
    }

    /** The control factory: the uiWorkspace lookup and the language store are
     *  per-activation, so nothing leaks between plugin loads. */
    function createWorkspacesControl(options) {
      var getUi = options.getUi
      var langStore = options.langStore

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

        function addPath(picked) {
          var path = String(picked)
          if (path.trim() === '') {
            setNotice('errEmpty')
            return
          }
          var current = latest.current
          if (current.length >= MAX_ENTRIES) {
            setNotice('errLimit')
            return
          }
          var conflict = conflictFor(current, pathKey(path))
          if (conflict !== null) {
            setNotice(conflict === 'duplicate' ? 'errDuplicate' : 'errOverlap')
            return
          }
          setNotice(null)
          write(current.concat([{ path: path, alias: basename(path), note: '' }]))
        }

        function onAdd() {
          if (readOnly) return
          var ui = getUi()
          if (ui === null || ui === undefined || typeof ui.pickDirectory !== 'function') {
            setNotice('pickerUnavailable')
            return
          }
          var picked
          try {
            picked = ui.pickDirectory()
          } catch (error) {
            reportFailure('pickDirectory', error)
            setNotice('pickerUnavailable')
            return
          }
          Promise.resolve(picked).then(function (value) {
            if (typeof value === 'string') addPath(value)
          }, function (error) {
            reportFailure('pickDirectory', error)
            setNotice('pickerUnavailable')
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
          children.push(h('div', { key: 'add', style: STYLES.addRow }, h('button', {
            key: 'button',
            type: 'button',
            id: base + '-add',
            style: STYLES.primaryButton,
            onClick: onAdd,
          }, ownT('add'))))
        }
        return h('div', {
          id: base,
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
      hint: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, rgba(232,232,236,0.55))' },
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
      entryHead: { display: 'flex', alignItems: 'center', gap: '8px' },
      aliasInput: {
        flex: '1 1 90px',
        minWidth: '70px',
        maxWidth: '140px',
        padding: '4px 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.14))',
        background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.18))',
        color: 'var(--dsw-alias-label-primary, #e8e8ec)',
        fontSize: '12px',
      },
      path: {
        flex: '1 1 auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
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
        fontSize: '12px',
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
      addRow: { display: 'flex' },
      primaryButton: {
        padding: '4px 10px',
        borderRadius: '6px',
        border: '1px solid transparent',
        background: 'var(--dsw-alias-button-primary-fill, #4a7dff)',
        color: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
        fontSize: '12px',
        cursor: 'pointer',
      },
      linkButton: {
        padding: '2px 4px',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-link, #7aa2ff)',
        fontSize: '11px',
        cursor: 'pointer',
      },
    }

    /* ----------------------------------------------------------------- ctx */

    return {
      name: PLUGIN_ID,
      inject: ['sessionSettings'],
      apply: function (ctx) {
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

        var sessionSettings = ctx.sessionSettings
        var Control = createWorkspacesControl({ getUi: getUi, langStore: langStore })
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
