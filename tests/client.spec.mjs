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
  const mod = captured.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error('unexpected require: ' + id)
  })
  mod.apply(ctx)
  return { registrations, effects, provided, ui, mod, localeListeners, setLocale(next) { activeLocale = next } }
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

test('the list is capped at eight entries', async () => {
  const harness = createHarness({ ui: { pickDirectory: async () => '/w/new', listDirectory: async () => [] } })
  const value = []
  for (let i = 0; i < 8; i += 1) value.push({ path: '/w/' + i, alias: 'w' + i, note: '' })
  const { props, writes } = makeProps({ value })
  const page = renderControl(harness, props)
  page.buttonWithText('添加工作区').props.onClick()
  await flush()
  assert.equal(writes.length, 0)
  assert.ok(renderControl(harness, props).text.includes('最多只能添加 8 个额外工作区'))
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
