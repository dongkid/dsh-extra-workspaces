/**
 * Client-half tests (lib/client.js).
 *
 * The bundle is a browser script: it registers a lazy factory on
 * window.__ModuleLoader__ and its control is a React component the
 * session-settings page renders. The test stubs the loader, react, the Cordis
 * context it is handed, and the uiWorkspace picker, then renders the control
 * through a minimal hook runtime (path-keyed state, dependency-aware effects)
 * so the assertions run against the element tree the real GUI would receive.
 *
 * No jsdom, no build step: the bundle itself must stay dependency-free, and so
 * does its test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

const PLUGIN_ID = 'dsh-extra-workspaces'

/* ------------------------------------------------------------ mini react */

/** Hook state by component path, so a re-render keeps useState values. */
const hookState = new Map()
/** Effect deps by hook key, so a render with unchanged deps stays put. */
const effectDeps = new Map()
const frames = []

function withFrame(key, render) {
  frames.push({ key, index: 0 })
  try {
    return render()
  } finally {
    frames.pop()
  }
}

function slot(init) {
  const frame = frames[frames.length - 1]
  const key = frame.key + '#' + frame.index
  frame.index += 1
  if (!hookState.has(key)) hookState.set(key, typeof init === 'function' ? init() : init)
  return key
}

const ReactStub = {
  createElement(type, props, ...children) {
    const merged = Object.assign({}, props)
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  },
  useState(init) {
    const key = slot(init)
    return [hookState.get(key), (next) => {
      hookState.set(key, typeof next === 'function' ? next(hookState.get(key)) : next)
    }]
  },
  useEffect(fn, deps) {
    const key = slot(undefined)
    const previous = effectDeps.get(key)
    const unchanged = previous !== undefined && Array.isArray(deps)
      && previous.length === deps.length
      && previous.every((value, index) => Object.is(value, deps[index]))
    if (unchanged) return
    effectDeps.set(key, Array.isArray(deps) ? deps.slice() : undefined)
    fn()
  },
  useCallback(fn) {
    slot(undefined)
    return fn
  },
  useRef(init) {
    const key = slot(null)
    if (hookState.get(key) === null) hookState.set(key, { current: init })
    return hookState.get(key)
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    slot(undefined)
    return getSnapshot()
  },
}

function renderNode(node, path) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (Array.isArray(node)) {
    return { tag: '#array', props: {}, children: node.map((kid, i) => renderNode(kid, path + '.' + i)).filter(Boolean) }
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return { tag: '#text', props: {}, text: String(node) }
  }
  const type = node.type
  const props = node.props || {}
  if (typeof type === 'string') {
    const kids = props.children
    const list = Array.isArray(kids) ? kids : [kids]
    return { tag: type, props, children: list.map((kid, i) => renderNode(kid, path + '.' + i)).filter(Boolean) }
  }
  if (typeof type === 'function') {
    return withFrame(path, () => renderNode(type(props), path + '>'))
  }
  throw new Error('unsupported element type: ' + String(type))
}

function walk(node, out) {
  if (node === null || node === undefined) return out
  if (node.tag === '#text') {
    out.texts.push(node.text)
    return out
  }
  out.nodes.push(node)
  for (const kid of node.children || []) walk(kid, out)
  return out
}

/** Render one element and expose the flat node list plus text helpers. */
function mount(element) {
  const tree = renderNode(element, 'root')
  const out = { nodes: [], texts: [] }
  walk(tree, out)
  out.tree = tree
  out.find = (tag, pred) => out.nodes.filter((node) => node.tag === tag && (pred === undefined || pred(node.props)))
  out.text = out.texts.join(' | ')
  out.textOf = (node) => walk(node, { nodes: [], texts: [] }).texts.join('')
  out.buttonWithText = (needle) => out.find('button').find((button) => out.textOf(button).includes(needle))
  out.buttonExact = (needle) => out.find('button').find((button) => out.textOf(button).trim() === needle)
  out.field = (label, index = 0) => out.find('input', (props) => props['aria-label'] === label)[index]
  return out
}

/* --------------------------------------------------------- module load */

let captured
globalThis.window = {
  __ModuleLoader__: { load(definition) { captured = definition } },
}
try {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
} catch (error) { /* the runtime's own navigator stays; copy falls back to it */ }

await import(new URL('../lib/client.js', import.meta.url))

/* ------------------------------------------------------------ harness */

function createHarness(options = {}) {
  hookState.clear()
  effectDeps.clear()
  frames.length = 0
  const provided = {}
  const registrations = []
  const effects = []
  const localeListeners = []
  const ui = options.ui === undefined
    ? { pickDirectory: async () => '/w/alpha', listDirectory: async () => [] }
    : options.ui
  if (ui !== null && ui !== undefined) provided.uiWorkspace = ui
  if (options.sessions !== undefined) provided.sessions = options.sessions
  if (options.workspaces !== undefined) provided.workspaces = options.workspaces
  let activeLocale = options.locale === undefined ? 'zh-CN' : options.locale
  provided.locale = {
    getLocale: () => ({ active: activeLocale }),
    subscribe: (listener) => { localeListeners.push(listener); return () => {} },
  }
  const sessionSettings = {
    registerRenderer(pluginId, itemKey, Component) {
      const entry = { pluginId, itemKey, Component }
      registrations.push(entry)
      return () => {
        const index = registrations.indexOf(entry)
        if (index !== -1) registrations.splice(index, 1)
      }
    },
  }
  const ctx = {
    sessionSettings,
    effect(fn) { const dispose = fn(); effects.push(dispose); return { dispose } },
    get(name) { return provided[name] },
    provide() { throw new Error('this plugin must not provide a service') },
  }
  const requires = []
  const mod = captured.factory((id) => {
    requires.push(id)
    if (id === 'react') return ReactStub
    if (options.reactDom !== undefined && id === 'react-dom') return options.reactDom
    throw new Error('unexpected require: ' + id)
  })
  mod.apply(ctx)
  return { registrations, effects, provided, ui, mod, localeListeners, requires, setLocale(next) { activeLocale = next } }
}

function makeProps(overrides = {}) {
  const writes = []
  const props = {
    pluginId: PLUGIN_ID,
    sessionId: 's1',
    item: { key: 'workspaces', type: 'stringList', title: '额外工作区', default: [] },
    registration: { pluginId: PLUGIN_ID, title: 'Extra workspaces', items: [] },
    value: [],
    defaultValue: [],
    overridden: false,
    disabled: false,
    busy: false,
    domId: 'pane1-dsh-extra-workspaces-workspaces',
    t: (text) => text,
    setValue: (next) => { writes.push(next); return Promise.resolve() },
    reset: () => {},
  }
  Object.assign(props, overrides)
  return { props, writes }
}

function renderControl(harness, props) {
  return mount(ReactStub.createElement(harness.registrations[0].Component, props))
}

const ALIAS = '别名'
const NOTE = '备注'
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/* ---------------------------------------------------------------- tests */

test('the module materializes with react only and the frozen interface', () => {
  assert.equal(captured.id, PLUGIN_ID)
  const mod = captured.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error('unexpected require: ' + id)
  })
  assert.equal(mod.name, PLUGIN_ID)
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual(mod.inject, ['sessionSettings'])
})

test('apply registers the workspaces control and its disposer removes it', () => {
  const harness = createHarness()
  assert.equal(harness.registrations.length, 1)
  assert.equal(harness.registrations[0].pluginId, PLUGIN_ID)
  assert.equal(harness.registrations[0].itemKey, 'workspaces')
  assert.equal(typeof harness.registrations[0].Component, 'function')
  const dispose = harness.effects[harness.effects.length - 1]
  assert.equal(typeof dispose, 'function', 'registerRenderer returns the disposer')
  dispose()
  assert.equal(harness.registrations.length, 0)
})

test('an empty list renders the hint, no row and the add button', () => {
  const harness = createHarness()
  const { props } = makeProps()
  const page = renderControl(harness, props)
  assert.ok(page.text.includes('这些目录是会话工作区之外的额外工作区'), page.text)
  assert.ok(page.text.includes('还没有额外工作区'), page.text)
  assert.equal(page.find('input').length, 0)
  assert.ok(page.buttonWithText('添加工作区') !== undefined)
  assert.equal(page.find('div')[0].props['aria-label'], '额外工作区', 'the item title reaches the group label')
})

test('two entries show the alias, the path and the note', () => {
  const harness = createHarness()
  const value = [
    { path: '/w/alpha', alias: '团队文档', note: '共享资料' },
    { path: 'C:\\work\\beta', alias: 'Beta repo', note: '' },
  ]
  const { props } = makeProps({ value })
  const page = renderControl(harness, props)
  assert.deepEqual(page.find('input', (p) => p['aria-label'] === ALIAS).map((n) => n.props.value), ['团队文档', 'Beta repo'])
  assert.deepEqual(page.find('input', (p) => p['aria-label'] === NOTE).map((n) => n.props.value), ['共享资料', ''])
  assert.ok(page.text.includes('/w/alpha'), page.text)
  assert.ok(page.text.includes('C:\\work\\beta'), page.text)
  assert.equal(page.find('button', (p) => p['aria-label'] === '移除').length, 2)
})

test('a value that is not an array reads as the empty list', () => {
  const harness = createHarness()
  const page = renderControl(harness, makeProps({ value: 'garbage' }).props)
  assert.equal(page.find('input').length, 0)
  assert.ok(page.text.includes('还没有额外工作区'))
})

test('adding a duplicate path writes nothing and says why', async () => {
  const harness = createHarness({ ui: { pickDirectory: async () => '/w/alpha', listDirectory: async () => [] } })
  const { props, writes } = makeProps({ value: [{ path: '/w/alpha/', alias: 'Alpha', note: '' }] })
  const page = renderControl(harness, props)
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  assert.equal(writes.length, 0)
  assert.ok(renderControl(harness, props).text.includes('这个目录已经在列表里了'))
})

test('adding a directory that contains, or sits inside, a listed one is refused', async () => {
  const harness = createHarness({ ui: { pickDirectory: async () => '/w/alpha/sub', listDirectory: async () => [] } })
  const { props, writes } = makeProps({ value: [{ path: '/w/alpha', alias: 'Alpha', note: '' }] })
  const page = renderControl(harness, props)
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  assert.equal(writes.length, 0)
  assert.ok(renderControl(harness, props).text.includes('这个目录和列表里的目录互相包含'))
})

test('the picker result is appended with its own name as the alias', async () => {
  const harness = createHarness({ ui: { pickDirectory: async () => 'C:\\work\\gamma\\', listDirectory: async () => [] } })
  const { props, writes } = makeProps()
  const page = renderControl(harness, props)
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0], [{ path: 'C:\\work\\gamma\\', alias: 'gamma', note: '' }])
})

test('an unavailable picker shows a message instead of throwing', async () => {
  const harness = createHarness({ ui: null })
  const { props, writes } = makeProps()
  const page = renderControl(harness, props)
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  assert.equal(writes.length, 0)
  assert.ok(renderControl(harness, props).text.includes('现在打不开目录选择器'))
})

test('the list is capped at eight entries and a full list disables adding', () => {
  const harness = createHarness({ ui: { pickDirectory: async () => '/w/new', listDirectory: async () => [] } })
  const value = []
  for (let i = 0; i < 8; i += 1) value.push({ path: '/w/' + i, alias: 'w' + i, note: '' })
  const { props, writes } = makeProps({ value })
  const page = renderControl(harness, props)
  // The cap is known before the picker opens, so the button refuses at once
  // instead of walking the user through a chooser that ends in "at most 8".
  assert.equal(page.buttonWithText('添加工作区').props.disabled, true)
  assert.ok(page.text.includes('8 / 8'), page.text)
  assert.equal(writes.length, 0)
})

test('the configured cap from the registration item bounds the panel', async () => {
  const harness = createHarness({ ui: { pickDirectory: async () => '/w/c', listDirectory: async () => [] } })
  const item = { key: 'workspaces', type: 'stringList', title: '额外工作区', default: [], max: 3 }
  const value = [
    { path: '/w/a', alias: 'a', note: '' },
    { path: '/w/b', alias: 'b', note: '' },
  ]
  const { props, writes } = makeProps({ value, item })
  const page = renderControl(harness, props)
  assert.ok(page.text.includes('2 / 3'), page.text)
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].length, 3, JSON.stringify(writes[0]))
  const full = renderControl(harness, makeProps({ value: writes[0], item }).props)
  assert.equal(full.buttonWithText('添加工作区').props.disabled, true)
  assert.ok(full.text.includes('3 / 3'), full.text)
})

test('removing an entry writes the remaining ones', () => {
  const harness = createHarness()
  const value = [
    { path: '/w/alpha', alias: 'Alpha', note: 'a' },
    { path: '/w/beta', alias: 'Beta', note: 'b' },
  ]
  const { props, writes } = makeProps({ value })
  const page = renderControl(harness, props)
  page.buttonWithText('移除').props.onClick()
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0], [{ path: '/w/beta', alias: 'Beta', note: 'b' }])
})

test('a keystroke never writes; blur commits the alias edit', () => {
  const harness = createHarness()
  const value = [{ path: '/w/alpha', alias: 'Alpha', note: 'a' }]
  const { props, writes } = makeProps({ value })
  const page = renderControl(harness, props)
  page.field(ALIAS).props.onChange({ target: { value: 'Alpha2' } })
  assert.equal(writes.length, 0, 'the keystroke stays a draft')
  const rerendered = renderControl(harness, props)
  rerendered.field(ALIAS).props.onBlur()
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0], [{ path: '/w/alpha', alias: 'Alpha2', note: 'a' }])
})

test('an IME-composing Enter never commits the alias', () => {
  const harness = createHarness()
  const value = [{ path: '/w/alpha', alias: 'Alpha', note: 'a' }]
  const { props, writes } = makeProps({ value })
  const page = renderControl(harness, props)
  page.field(ALIAS).props.onChange({ target: { value: '阿尔' } })
  const composing = { key: 'Enter', isComposing: true, preventDefault() { this.prevented = true } }
  renderControl(harness, props).field(ALIAS).props.onKeyDown(composing)
  assert.equal(composing.prevented, undefined, 'the composing Enter is left to the IME')
  assert.equal(writes.length, 0, 'a half-typed alias is not written')
  // A plain Enter still commits the draft.
  const plain = { key: 'Enter', preventDefault() { this.prevented = true } }
  renderControl(harness, props).field(ALIAS).props.onKeyDown(plain)
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0].alias, '阿尔')
})

test('a rejected write returns the row draft to the value the host kept', async () => {
  const harness = createHarness()
  const value = [{ path: '/w/alpha', alias: 'Alpha', note: '' }]
  let attempts = 0
  const { props } = makeProps({
    value,
    setValue: () => { attempts += 1; return Promise.reject(new Error('store down')) },
  })
  let page = renderControl(harness, props)
  page.field(ALIAS).props.onChange({ target: { value: 'Alpha2' } })
  page = renderControl(harness, props)
  page.field(ALIAS).props.onBlur()
  await flush()
  // The failure tick re-renders the row, and the draft resets to the kept value.
  page = renderControl(harness, props)
  page = renderControl(harness, props)
  assert.equal(page.field(ALIAS).props.value, 'Alpha')
  assert.equal(attempts, 1)
})

test('a rejected setValue never escapes the render', async () => {
  const harness = createHarness()
  const value = [{ path: '/w/alpha', alias: 'Alpha', note: '' }]
  const { props } = makeProps({ value, setValue: () => Promise.reject(new Error('boom')) })
  const page = renderControl(harness, props)
  page.buttonWithText('移除').props.onClick()
  await flush()
  assert.ok(renderControl(harness, props).text.includes('/w/alpha'))
})

test('disabled and busy render read-only with no add or remove affordance', () => {
  const harness = createHarness()
  const value = [{ path: '/w/alpha', alias: 'Alpha', note: '' }]
  for (const flag of [{ disabled: true }, { busy: true }]) {
    const { props, writes } = makeProps(Object.assign({ value }, flag))
    const page = renderControl(harness, props)
    assert.equal(page.find('button').length, 0, JSON.stringify(flag))
    assert.ok(page.find('input').every((node) => node.props.disabled === true))
    assert.equal(writes.length, 0)
  }
})

test('a host whose picker has no browse capability does not mark a directory missing', async () => {
  const harness = createHarness({
    ui: {
      pickDirectory: async () => '/w/alpha',
      listDirectory: async () => {
        throw { rpcError: { code: 'directory-picker/unavailable', details: { capability: 'native' } } }
      },
    },
  })
  const { props } = makeProps({ value: [{ path: '/w/alpha', alias: 'Alpha', note: '' }] })
  assert.ok(!renderControl(harness, props).text.includes('宿主读不到该目录'))
  await flush()
  assert.ok(!renderControl(harness, props).text.includes('宿主读不到该目录'))
})

test('a browse host that reports the directory unreadable marks it missing', async () => {
  const harness = createHarness({
    ui: {
      pickDirectory: async () => '/w/alpha',
      listDirectory: async () => {
        throw { rpcError: { code: 'directory-picker/unreadable', details: { path: '/w/gone' } } }
      },
    },
  })
  const { props } = makeProps({ value: [{ path: '/w/gone', alias: 'Gone', note: '' }] })
  assert.ok(!renderControl(harness, props).text.includes('宿主读不到该目录'))
  await flush()
  assert.ok(renderControl(harness, props).text.includes('宿主读不到该目录'))
})

test('the copy follows the host language and re-localizes on a switch', () => {
  const harness = createHarness({ locale: 'zh-CN' })
  const value = [{ path: '/w/alpha', alias: 'Alpha', note: '' }]
  const { props } = makeProps({ value })
  let page = renderControl(harness, props)
  assert.ok(page.field('别名') !== undefined)
  harness.setLocale('en-US')
  for (const listener of harness.localeListeners) listener()
  page = renderControl(harness, props)
  assert.ok(page.field('Alias') !== undefined, page.text)
  assert.ok(page.buttonWithText('Add workspace') !== undefined, page.text)
})

/* ------------------------------------------------ in-app picker fallback */

function browseListing(overrides = {}) {
  return Object.assign({
    path: '/home/u',
    home: '/home/u',
    crumbs: [
      { name: '/', path: '/', hidden: false },
      { name: 'home', path: '/home', hidden: false },
      { name: 'u', path: '/home/u', hidden: false },
    ],
    entries: [
      { name: '.cache', path: '/home/u/.cache', hidden: true },
      { name: 'projects', path: '/home/u/projects', hidden: false },
    ],
    truncated: false,
  }, overrides)
}

test('a refused native chooser falls back to the in-app picker over the Host home', async () => {
  const calls = []
  const harness = createHarness({
    ui: {
      pickDirectory: async () => {
        throw new Error('directory picker failed: directoryPicker.pick needs the native capability; the composed picker serves "browse"')
      },
      listDirectory: async (path) => {
        calls.push(path)
        if (path === undefined) return browseListing()
        return browseListing({
          path,
          crumbs: browseListing().crumbs.concat([{ name: 'projects', path, hidden: false }]),
          entries: [{ name: 'web', path: '/home/u/projects/web', hidden: false }],
        })
      },
    },
  })
  const { props, writes } = makeProps()
  let page = renderControl(harness, props)
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  page = renderControl(harness, props)
  assert.ok(page.text.includes('选择目录'), page.text)
  await flush()
  page = renderControl(harness, props)
  assert.ok(page.text.includes('projects'), page.text)
  assert.ok(!page.text.includes('.cache'), 'hidden entries stay hidden')
  assert.deepEqual(calls, [undefined], 'the picker starts at the Host home')
  page.buttonWithText('projects').props.onClick()
  await flush()
  page = renderControl(harness, props)
  assert.deepEqual(calls, [undefined, '/home/u/projects'])
  assert.ok(page.text.includes('web'), page.text)
  page.buttonWithText('选择当前目录').props.onClick()
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0], [{ path: '/home/u/projects', alias: 'projects', note: '' }])
})

test('the in-app picker toggles hidden entries and surfaces the listing bound', async () => {
  const harness = createHarness({
    ui: {
      listDirectory: async () => browseListing({ truncated: true }),
    },
  })
  const { props } = makeProps()
  let page = renderControl(harness, props)
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  page = renderControl(harness, props)
  await flush()
  page = renderControl(harness, props)
  assert.ok(page.text.includes('projects'), page.text)
  assert.ok(!page.text.includes('.cache'), 'hidden entries stay hidden until asked for')
  assert.ok(page.text.includes('文件夹过多'), 'the Host listing bound is reported')
  const scrollArea = page.nodes.find((node) => node.props['data-dsh-scroll'] === 'true')
  assert.ok(scrollArea !== undefined, 'the listing renders inside a scroll container')
  assert.ok(!walk(scrollArea, { nodes: [], texts: [] }).texts.join('').includes('文件夹过多'),
    'the bound notice stays pinned outside the scroll area')
  page.buttonWithText('显示隐藏文件').props.onClick()
  page = renderControl(harness, props)
  assert.ok(page.text.includes('.cache'), 'the toggle reveals hidden entries')
})

test('when neither chooser answers the control reports it instead of leaving a dead dialog', async () => {
  const harness = createHarness({
    ui: {
      pickDirectory: async () => {
        throw new Error('directory picker failed: directoryPicker.pick needs the native capability; the composed picker serves "browse"')
      },
      listDirectory: async () => {
        throw { rpcError: { code: 'directory-picker/unavailable', message: 'no browse capability', details: { capability: 'native' } } }
      },
    },
  })
  const { props, writes } = makeProps()
  let page = renderControl(harness, props)
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  page = renderControl(harness, props)
  await flush()
  page = renderControl(harness, props)
  assert.equal(writes.length, 0)
  assert.ok(!page.text.includes('选择目录'), 'the dead dialog is gone: ' + page.text)
  assert.ok(page.text.includes('现在打不开目录选择器'), page.text)
})

/* -------------------------------------------- in-app picker ergonomics */

const ROOT_CRUMBS = [
  { name: '/', path: '/', hidden: false },
  { name: 'home', path: '/home', hidden: false },
  { name: 'u', path: '/home/u', hidden: false },
]

test('the in-app picker steps up one level from the Host ancestry', async () => {
  const calls = []
  const harness = createHarness({
    ui: {
      listDirectory: async (path) => {
        calls.push(path)
        if (path === '/home/u/projects') {
          return {
            path,
            home: '/home/u',
            crumbs: ROOT_CRUMBS.concat([{ name: 'projects', path, hidden: false }]),
            entries: [],
            truncated: false,
          }
        }
        return {
          path: '/home/u',
          home: '/home/u',
          crumbs: ROOT_CRUMBS,
          entries: [{ name: 'projects', path: '/home/u/projects', hidden: false }],
          truncated: false,
        }
      },
    },
  })
  const { props } = makeProps()
  let page = renderControl(harness, props)
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  page = renderControl(harness, props)
  await flush()
  page = renderControl(harness, props)
  page.buttonWithText('projects').props.onClick()
  await flush()
  page = renderControl(harness, props)
  assert.equal(calls[calls.length - 1], '/home/u/projects')
  page.buttonWithText('../').props.onClick()
  await flush()
  page = renderControl(harness, props)
  assert.equal(calls[calls.length - 1], '/home/u', 'the parent level is listed again')
  assert.ok(page.text.includes('projects'), page.text)
})

test('the picker shows the Windows roots the Host can serve beside the path', async () => {
  const SEP = String.fromCharCode(92)
  const calls = []
  const home = {
    path: 'C:' + SEP + 'Users' + SEP + 'u',
    home: 'C:' + SEP + 'Users' + SEP + 'u',
    crumbs: [
      { name: 'C:' + SEP, path: 'C:' + SEP, hidden: false },
      { name: 'Users', path: 'C:' + SEP + 'Users', hidden: false },
      { name: 'u', path: 'C:' + SEP + 'Users' + SEP + 'u', hidden: false },
    ],
    entries: [],
    truncated: false,
  }
  const harness = createHarness({
    ui: {
      listDirectory: async (path) => {
        calls.push(path)
        if (path === undefined) return home
        const driveRoot = typeof path === 'string' && path.length === 3
          && path.charAt(1) === ':' && path.charAt(2) === SEP
        if (driveRoot) {
          const letter = path.charAt(0)
          if (letter === 'C' || letter === 'D') {
            return { path, home: path, crumbs: [{ name: path, path, hidden: false }], entries: [], truncated: false }
          }
          throw { rpcError: { code: 'directory-picker/unreadable', message: 'no such drive', details: {} } }
        }
        return home
      },
    },
  })
  const { props } = makeProps()
  let page = renderControl(harness, props)
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  page = renderControl(harness, props)
  await flush()
  page = renderControl(harness, props)
  await flush()
  page = renderControl(harness, props)
  assert.ok(page.buttonWithText('C:') !== undefined, page.text)
  assert.ok(page.buttonWithText('D:') !== undefined, page.text)
  assert.ok(page.buttonWithText('E:') === undefined, page.text)
  page.buttonWithText('D:').props.onClick()
  await flush()
  page = renderControl(harness, props)
  assert.equal(calls[calls.length - 1], 'D:' + SEP)
  assert.ok(page.text.includes('D:'), page.text)
})

test('the in-app picker resumes the directory it last landed on', async () => {
  const LAST_DIR_KEY = 'dsh-extra-workspaces:last-browse-dir'
  const store = {}
  const previous = globalThis.window.localStorage
  globalThis.window.localStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value) },
  }
  try {
    store[LAST_DIR_KEY] = 'D:\\work'
    const calls = []
    const harness = createHarness({
      ui: {
        listDirectory: async (path) => {
          calls.push(path)
          if (path === 'D:\\work') {
            return {
              path: 'D:\\work',
              home: 'D:\\',
              crumbs: [
                { name: 'D:\\', path: 'D:\\', hidden: false },
                { name: 'work', path: 'D:\\work', hidden: false },
              ],
              entries: [],
              truncated: false,
            }
          }
          return { path: '/home/u', home: '/home/u', crumbs: ROOT_CRUMBS, entries: [], truncated: false }
        },
      },
    })
    const { props } = makeProps()
    let page = renderControl(harness, props)
    page.buttonWithText('添加工作区').props.onClick()
    await flush()
    page = renderControl(harness, props)
    await flush()
    page = renderControl(harness, props)
    assert.equal(calls[0], 'D:\\work', 'the remembered directory opens first: ' + JSON.stringify(calls))
    page.buttonWithText('选择当前目录').props.onClick()
    assert.equal(store[LAST_DIR_KEY], 'D:\\work')
  } finally {
    if (previous === undefined) delete globalThis.window.localStorage
    else globalThis.window.localStorage = previous
  }
})

test('the picker remembers only a directory the user confirmed', async () => {
  const LAST_DIR_KEY = 'dsh-extra-workspaces:last-browse-dir'
  const store = {}
  const previous = globalThis.window.localStorage
  globalThis.window.localStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value) },
  }
  try {
    const harness = createHarness({ ui: { listDirectory: async () => browseListing() } })
    const { props } = makeProps()
    let page = renderControl(harness, props)
    page.buttonWithText('添加工作区').props.onClick()
    await flush()
    page = renderControl(harness, props)
    await flush()
    page = renderControl(harness, props)
    // Browsing without choosing must not move the next open's starting point.
    assert.equal(store[LAST_DIR_KEY], undefined)
    page.buttonExact('取消').props.onClick()
    page = renderControl(harness, props)
    assert.equal(store[LAST_DIR_KEY], undefined)
  } finally {
    if (previous === undefined) delete globalThis.window.localStorage
    else globalThis.window.localStorage = previous
  }
})

test('the dialog portals to document.body when react-dom is available', async () => {
  const previousDocument = globalThis.document
  globalThis.document = { body: {} }
  const portalCalls = []
  try {
    const harness = createHarness({
      ui: { listDirectory: async () => browseListing() },
      reactDom: {
        createPortal: (node, container) => {
          portalCalls.push(container)
          return node
        },
      },
    })
    const { props } = makeProps()
    let page = renderControl(harness, props)
    page.buttonWithText('添加工作区').props.onClick()
    await flush()
    page = renderControl(harness, props)
    await flush()
    page = renderControl(harness, props)
    assert.ok(harness.requires.includes('react-dom'), 'react-dom is requested: ' + JSON.stringify(harness.requires))
    assert.ok(portalCalls.length > 0, 'the dialog is portaled')
    assert.equal(portalCalls[0], globalThis.document.body)
    assert.ok(page.text.includes('选择目录'), page.text)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('a failed first listing offers a retry inside the dialog', async () => {
  let calls = 0
  const harness = createHarness({
    ui: {
      listDirectory: async () => {
        calls += 1
        if (calls === 1) throw new Error('transient failure')
        return browseListing()
      },
    },
  })
  const { props } = makeProps()
  let page = renderControl(harness, props)
  page.buttonWithText('添加工作区').props.onClick()
  for (let i = 0; i < 4; i += 1) {
    await flush()
    page = renderControl(harness, props)
  }
  assert.ok(page.text.includes('transient failure'), page.text)
  const retry = page.buttonWithText('重试')
  assert.ok(retry !== undefined, page.text)
  retry.props.onClick()
  await flush()
  page = renderControl(harness, props)
  assert.ok(page.buttonWithText('选择当前目录') !== undefined, page.text)
})

test('the dialog closes on a backdrop click and on a document-level Escape', async () => {
  const previousDocument = globalThis.document
  const listeners = []
  globalThis.document = {
    activeElement: null,
    body: {},
    head: null,
    addEventListener(type, fn) { listeners.push({ type, fn }) },
    removeEventListener() {},
  }
  try {
    const harness = createHarness({ ui: { listDirectory: async () => browseListing() } })
    const { props } = makeProps()
    let page = renderControl(harness, props)
    page.buttonWithText('添加工作区').props.onClick()
    await flush()
    page = renderControl(harness, props)
    await flush()
    page = renderControl(harness, props)
    const overlay = page.nodes.find((node) => node.props.className === 'dsh-ew-overlay')
    assert.ok(overlay !== undefined, page.text)
    overlay.props.onMouseDown({ target: overlay, currentTarget: overlay, preventDefault() {} })
    page = renderControl(harness, props)
    assert.equal(page.nodes.filter((node) => node.props.className === 'dsh-ew-overlay').length, 0, 'backdrop click closes')

    // Reopen; Escape falling on the page (focus on <body>) must still close it.
    page.buttonWithText('添加工作区').props.onClick()
    await flush()
    page = renderControl(harness, props)
    await flush()
    page = renderControl(harness, props)
    const keyListeners = listeners.filter((entry) => entry.type === 'keydown')
    assert.ok(keyListeners.length > 0, 'the dialog listens for keys at the document')
    for (const entry of keyListeners) entry.fn({ key: 'Escape', defaultPrevented: false, preventDefault() {} })
    page = renderControl(harness, props)
    assert.equal(page.nodes.filter((node) => node.props.className === 'dsh-ew-overlay').length, 0, 'document Escape closes')
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('the new-folder form stays pinned outside the scrolling list and autofocuses', async () => {
  const entries = []
  for (let i = 0; i < 30; i += 1) {
    entries.push({ name: 'dir' + i, path: '/home/u/dir' + i, hidden: false })
  }
  const harness = createHarness({
    ui: { listDirectory: async () => browseListing({ entries }) },
  })
  const { props } = makeProps()
  let page = renderControl(harness, props)
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  page = renderControl(harness, props)
  await flush()
  page = renderControl(harness, props)
  page.buttonWithText('新建文件夹').props.onClick()
  page = renderControl(harness, props)
  const field = page.field('文件夹名称')
  assert.ok(field !== undefined, 'the folder-name input renders')
  assert.equal(field.props.autoFocus, true, 'the input takes focus when it opens')
  const scrollArea = page.nodes.find((node) => node.props['data-dsh-scroll'] === 'true')
  assert.ok(scrollArea !== undefined, 'the scrolling list exists')
  assert.ok(
    !walk(scrollArea, { nodes: [], texts: [] }).nodes.some((node) => node.props['data-dsh-create'] === 'true'),
    'the form is pinned outside the scroll area',
  )
  const panel = page.nodes.find((node) => node.props['data-dsh-create'] === 'true')
  assert.ok(panel !== undefined, 'the pinned form panel exists')
})

/* ------------------------------------------------- responsiveness */

test('responsive styles are injected once into the page head', () => {
  const previousDocument = globalThis.document
  const appended = []
  globalThis.document = {
    head: { appendChild(node) { appended.push(node) } },
    body: {},
    getElementById(id) {
      return appended.find((node) => node.id === id) ?? null
    },
    createElement() {
      return { id: '', textContent: '' }
    },
  }
  try {
    createHarness()
    createHarness()
    const sheets = appended.filter((node) => node.id === 'dsh-extra-workspaces-responsive')
    assert.equal(sheets.length, 1, 'a single sheet per page')
    const css = sheets[0].textContent
    assert.ok(css.includes('@media (max-width: 640px)'), 'the phone media query is present')
    assert.ok(css.includes('--ew-dialog-w'), 'dialog geometry is variable-driven')
    assert.ok(css.includes('--ew-row-min'), 'touch row height is variable-driven')
    assert.ok(css.includes('env(safe-area-inset-bottom'), 'safe-area padding is present')
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('the control and dialog carry the responsive class hooks', async () => {
  const harness = createHarness({ ui: { listDirectory: async () => browseListing() } })
  const { props } = makeProps()
  let page = renderControl(harness, props)
  const control = page.nodes.find((node) => node.props.className === 'dsh-ew-control')
  assert.ok(control !== undefined, 'the settings control exposes its class')
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  page = renderControl(harness, props)
  await flush()
  page = renderControl(harness, props)
  const overlay = page.nodes.find((node) => node.props.className === 'dsh-ew-overlay')
  assert.ok(overlay !== undefined, 'the overlay carries its class')
  assert.ok(page.text.includes('选择目录'), page.text)
})

/* ------------------------------------------------- quick add: sources */

const HISTORY_KEY = 'dsh-extra-workspaces:history-v1'

/** A client service face ({ list } snapshot source) with a settable value. */
function makeService(initial) {
  let value = initial
  const source = {
    getSnapshot: () => value,
    subscribe: () => () => {},
  }
  return { list: source, set(next) { value = next } }
}

/** Install a localStorage stub for one test; returns the restore function. */
function withStorage(store) {
  const previous = globalThis.window.localStorage
  globalThis.window.localStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value) },
    removeItem: (key) => { delete store[key] },
  }
  return () => {
    if (previous === undefined) delete globalThis.window.localStorage
    else globalThis.window.localStorage = previous
  }
}

function sessionService(cwd) {
  return makeService({
    phase: 'ready',
    ids: ['s1'],
    byId: { s1: { id: 's1', cwd, displayTitle: 's1', running: false, blank: false, updatedAt: 0 } },
  })
}

test('a directory the user registered as a workspace is one click away', async () => {
  const store = {}
  const restore = withStorage(store)
  try {
    const harness = createHarness({
      ui: { listDirectory: async () => browseListing() },
      sessions: sessionService('/home/u/projects/web'),
      workspaces: makeService({
        phase: 'ready',
        items: [
          { workspaceId: 'w1', path: '/home/u/projects/web', title: 'Web', updatedAt: '2024-01-02T00:00:00Z' },
          { workspaceId: 'w2', path: '/other/docs', title: 'Docs', updatedAt: '2024-01-01T00:00:00Z' },
        ],
      }),
    })
    const { props, writes } = makeProps()
    let page = renderControl(harness, props)
    await flush()
    page = renderControl(harness, props)
    assert.ok(page.text.includes('快速添加'), page.text)
    assert.ok(page.text.includes('推荐'), page.text)
    const chip = page.buttonWithText('Docs')
    assert.ok(chip !== undefined, page.text)
    chip.props.onClick()
    assert.deepEqual(writes[0], [{ path: '/other/docs', alias: 'Docs', note: '' }])
  } finally {
    restore()
  }
})

test('history remembers an added directory and offers it back after removal', async () => {
  const store = {}
  const restore = withStorage(store)
  try {
    const harness = createHarness()
    const first = makeProps({ value: [{ path: '/w/alpha', alias: 'Alpha', note: '共享资料' }] })
    renderControl(harness, first.props)
    await flush()
    const saved = JSON.parse(store[HISTORY_KEY])
    assert.equal(saved.length, 1)
    assert.deepEqual(saved[0], { path: '/w/alpha', alias: 'Alpha', note: '共享资料', updatedAt: saved[0].updatedAt, source: 'history' })
    assert.equal(typeof saved[0].updatedAt, 'number')

    // The entry is removed from the list; the browser can still put it back.
    const second = makeProps()
    let page = renderControl(harness, second.props)
    await flush()
    page = renderControl(harness, second.props)
    const chip = page.buttonWithText('Alpha')
    assert.ok(chip !== undefined, page.text)
    chip.props.onClick()
    assert.deepEqual(second.writes[0], [{ path: '/w/alpha', alias: 'Alpha', note: '共享资料' }])
  } finally {
    restore()
  }
})

test('a history chip can be dropped without touching the list', async () => {
  const store = {}
  store[HISTORY_KEY] = JSON.stringify([
    { path: '/w/beta', alias: 'Beta', note: '', updatedAt: 1, source: 'history' },
  ])
  const restore = withStorage(store)
  try {
    const harness = createHarness()
    const { props, writes } = makeProps()
    let page = renderControl(harness, props)
    await flush()
    page = renderControl(harness, props)
    assert.ok(page.text.includes('最近使用'), page.text)
    const forget = page.find('button', (p) => p['aria-label'] === '从历史里移除 Beta')[0]
    assert.ok(forget !== undefined, page.text)
    forget.props.onClick()
    assert.equal(writes.length, 0, 'forgetting a shortcut is not a list write')
    assert.deepEqual(JSON.parse(store[HISTORY_KEY]), [])
    page = renderControl(harness, props)
    assert.ok(page.buttonWithText('Beta') === undefined, page.text)
  } finally {
    restore()
  }
})

test('a corrupted history store reads as empty instead of breaking the card', async () => {
  const store = { [HISTORY_KEY]: '{not json' }
  const restore = withStorage(store)
  try {
    const harness = createHarness()
    const { props } = makeProps()
    const page = renderControl(harness, props)
    await flush()
    assert.ok(page.text.includes('还没有额外工作区'))
    assert.ok(page.find('button').length === 1, 'only the add button remains')
  } finally {
    restore()
  }
})

test('candidates already in the list, or overlapping it, are never offered', async () => {
  const store = {}
  const restore = withStorage(store)
  try {
    const harness = createHarness({
      workspaces: makeService({
        phase: 'ready',
        items: [
          { workspaceId: 'w1', path: '/w/alpha', title: 'Alpha again', updatedAt: '2024-01-02T00:00:00Z' },
          { workspaceId: 'w2', path: '/w/alpha/sub', title: 'Inside alpha', updatedAt: '2024-01-01T00:00:00Z' },
        ],
      }),
    })
    const { props } = makeProps({ value: [{ path: '/w/alpha', alias: 'Alpha', note: '' }] })
    let page = renderControl(harness, props)
    await flush()
    page = renderControl(harness, props)
    assert.ok(!page.text.includes('快速添加'), 'no offer means no strip: ' + page.text)
  } finally {
    restore()
  }
})

test('a full list offers no quick-add and shows the count', async () => {
  const store = {}
  const restore = withStorage(store)
  try {
    const harness = createHarness({
      workspaces: makeService({
        phase: 'ready',
        items: [{ workspaceId: 'w1', path: '/w/other', title: 'Other', updatedAt: '2024-01-02T00:00:00Z' }],
      }),
    })
    const value = []
    for (let i = 0; i < 8; i += 1) value.push({ path: '/w/' + i, alias: 'w' + i, note: '' })
    const { props } = makeProps({ value })
    let page = renderControl(harness, props)
    await flush()
    page = renderControl(harness, props)
    assert.ok(!page.text.includes('快速添加'))
    assert.ok(page.text.includes('8 / 8'), page.text)
  } finally {
    restore()
  }
})

test('sibling folders beside the session workspace are offered, minus noise', async () => {
  const store = {}
  const restore = withStorage(store)
  try {
    const calls = []
    const harness = createHarness({
      ui: {
        listDirectory: async (path) => {
          calls.push(path)
          return {
            path,
            home: '/home/u',
            crumbs: [{ name: '/', path: '/', hidden: false }, { name: 'work', path: '/work', hidden: false }, { name: 'src', path: '/work/src', hidden: false }],
            entries: [
              { name: 'app', path: '/work/src/app', hidden: false },
              { name: 'docs', path: '/work/src/docs', hidden: false },
              { name: 'node_modules', path: '/work/src/node_modules', hidden: false },
              { name: 'AppData', path: '/work/src/AppData', hidden: false },
              { name: '.git', path: '/work/src/.git', hidden: true },
            ],
            truncated: false,
          }
        },
      },
      sessions: sessionService('/work/src/app'),
    })
    const { props } = makeProps()
    let page = renderControl(harness, props)
    await flush()
    page = renderControl(harness, props)
    assert.deepEqual(calls[0], '/work/src', 'one listing of the parent directory')
    assert.ok(page.buttonWithText('docs') !== undefined, page.text)
    assert.ok(page.buttonWithText('node_modules') === undefined, 'build noise is filtered')
    assert.ok(page.buttonWithText('AppData') === undefined, 'system folders are filtered')
    assert.ok(page.buttonWithText('.git') === undefined, 'hidden folders never surface')
    assert.ok(page.buttonWithText('app') === undefined, 'the session workspace itself is not offered')
  } finally {
    restore()
  }
})

test('a host without browse capability stays quiet; history still works', async () => {
  const store = {}
  store[HISTORY_KEY] = JSON.stringify([
    { path: '/w/used', alias: 'Used', note: '', updatedAt: 2, source: 'history' },
  ])
  const restore = withStorage(store)
  try {
    const harness = createHarness({
      ui: {
        listDirectory: async () => {
          throw { rpcError: { code: 'directory-picker/unavailable', details: { capability: 'native' } } }
        },
      },
      sessions: sessionService('/deep/repo'),
    })
    const { props } = makeProps()
    let page = renderControl(harness, props)
    await flush()
    page = renderControl(harness, props)
    assert.ok(page.text.includes('最近使用'), page.text)
    assert.ok(page.buttonWithText('Used') !== undefined, page.text)
    assert.ok(!page.text.includes('现在打不开目录选择器'), 'no dead error: ' + page.text)
  } finally {
    restore()
  }
})

/* --------------------------------------------- quick add inside the picker */

test('the picker offers known places and refuses a directory already listed', async () => {
  const store = {}
  store[HISTORY_KEY] = JSON.stringify([
    { path: '/w/used', alias: 'Used', note: '', updatedAt: 2, source: 'history' },
  ])
  const restore = withStorage(store)
  try {
    const calls = []
    const harness = createHarness({
      ui: {
        listDirectory: async (path) => {
          calls.push(path)
          if (path === '/w/used') {
            return { path, home: '/home/u', crumbs: [{ name: '/', path: '/', hidden: false }], entries: [], truncated: false }
          }
          return browseListing()
        },
      },
    })
    const { props } = makeProps({ value: [{ path: '/home/u', alias: 'Home', note: '' }] })
    let page = renderControl(harness, props)
    page.buttonWithText('添加工作区').props.onClick()
    await flush()
    page = renderControl(harness, props)
    await flush()
    page = renderControl(harness, props)
    assert.ok(page.text.includes('常用位置'), page.text)
    const place = page.find('button', (p) => p.title === '/w/used')[0]
    assert.ok(place !== undefined, page.text)
    assert.equal(page.buttonWithText('选择当前目录').props.disabled, true, 'an already listed directory cannot be picked')
    assert.ok(page.text.includes('这个目录已经在列表里了'), page.text)
    place.props.onClick()
    await flush()
    page = renderControl(harness, props)
    assert.equal(calls[calls.length - 1], '/w/used', 'the place chip navigates')
  } finally {
    restore()
  }
})

test('a full list never opens the picker at all', async () => {
  const harness = createHarness({ ui: { listDirectory: async () => browseListing() } })
  const value = []
  for (let i = 0; i < 8; i += 1) value.push({ path: '/w/' + i, alias: 'w' + i, note: '' })
  const { props, writes } = makeProps({ value })
  const page = renderControl(harness, props)
  assert.equal(page.buttonWithText('添加工作区').props.disabled, true)
  assert.equal(page.nodes.filter((node) => node.props.className === 'dsh-ew-overlay').length, 0)
  assert.equal(writes.length, 0)
})
