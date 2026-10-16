/**
 * Host-half behaviour: the registration contract, the entry rules, and the
 * reminder text the model actually reads.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, LOCALE, ITEM_KEY, PLUGIN_ID, CONTEXT_NAME, CONTEXT_ORDER, resolveConfig } from '../lib/index.js'
import { normalizeEntries, reminderText, containsPath, isSamePath, defaultAlias } from '../lib/rules.js'

/** A context stub exposing exactly what the host half consumes. */
function makeCtx({ values = {}, sandboxPolicy } = {}) {
  const registrations = []
  const contributions = []
  const disposers = []
  const scope = {
    systemPrompt: {
      context(contribution) {
        contributions.push(contribution)
        return () => {}
      },
    },
  }
  const ctx = {
    effect(callback) {
      const disposer = callback()
      disposers.push(disposer)
      return disposer
    },
    inject(names, callback) {
      if (names.includes('systemPrompt')) callback(scope)
      return () => {}
    },
    get(serviceName) {
      return serviceName === 'sandboxPolicy' ? sandboxPolicy : undefined
    },
    sessionSettings: {
      register(value) {
        registrations.push(value)
        return () => {}
      },
      getItem(pluginId, itemKey, sessionId) {
        assert.equal(pluginId, PLUGIN_ID)
        assert.equal(itemKey, ITEM_KEY)
        const perSession = values[sessionId]
        return perSession === undefined ? undefined : perSession[itemKey]
      },
    },
  }
  return { ctx, registrations, contributions, disposers }
}

const session = { id: 's-1' }

function textFor(options) {
  const built = makeCtx(options)
  apply(built.ctx, undefined)
  assert.equal(built.contributions.length, 1)
  return built.contributions[0].text({ agent: { session: options.session ?? session } })
}

const backendEntry = { path: 'D:\\work\\backend', alias: 'backend', note: '后端服务' }
const policyFor = mode => ({ resolve: () => ({ mode }) })

test('registers exactly one declarative item with a JSON default', () => {
  const built = makeCtx()
  apply(built.ctx, undefined)
  assert.equal(built.registrations.length, 1)
  const registration = built.registrations[0]
  assert.equal(registration.pluginId, PLUGIN_ID)
  assert.equal(registration.items.length, 1)
  assert.equal(registration.items[0].key, ITEM_KEY)
  assert.equal(registration.items[0].type, 'stringList')
  assert.deepEqual(registration.items[0].default, [])
  assert.equal(typeof LOCALE.zh.title, 'string')
  assert.deepEqual(Object.keys(registration.locale.zh).sort(), Object.keys(registration.locale.en).sort())
  assert.equal(built.disposers.length, 1)
})

test('contributes the reminder at the declared position', () => {
  const built = makeCtx()
  apply(built.ctx, undefined)
  assert.equal(built.contributions[0].name, CONTEXT_NAME)
  assert.equal(built.contributions[0].order, CONTEXT_ORDER)
})

test('says nothing when the session has no extra workspaces', () => {
  assert.equal(textFor({}), '')
  assert.equal(textFor({ values: { 's-1': { [ITEM_KEY]: [] } } }), '')
  assert.equal(textFor({ values: { 's-1': { [ITEM_KEY]: 'not-an-array' } } }), '')
})

test('names every accepted entry, and only entries of this session', () => {
  const text = textFor({
    values: {
      's-1': { [ITEM_KEY]: [backendEntry] },
      's-2': { [ITEM_KEY]: [{ path: 'D:\\work\\other', alias: 'other', note: '' }] },
    },
  })
  assert.match(text, /D:\\work\\backend/)
  assert.match(text, /backend/)
  assert.match(text, /后端服务/)
  assert.doesNotMatch(text, /other/)
})

test('states the capability the session actually has', () => {
  const values = { 's-1': { [ITEM_KEY]: [backendEntry] } }
  assert.match(textFor({ values, sandboxPolicy: policyFor('workspace-write') }), /不能修改/)
  assert.match(textFor({ values, sandboxPolicy: policyFor('read-only') }), /仅可查看/)
  assert.match(textFor({ values, sandboxPolicy: policyFor('danger-full-access') }), /完全权限/)
  assert.match(textFor({ values }), /取决于本会话当前的权限档/)
})

test('makes no existence claim, and marks the entry that contains the session workspace', () => {
  const text = textFor({
    values: {
      's-1': { [ITEM_KEY]: [
        { path: 'D:\\work\\backend', alias: 'backend', note: '' },
        { path: 'D:\\other\\docs', alias: 'docs', note: '' },
      ] },
    },
    sandboxPolicy: policyFor('workspace-write'),
    session: { id: 's-1', header: { cwd: 'D:\\work\\backend\\src' } },
  })
  assert.doesNotMatch(text, /不存在|no longer exists/)
  assert.equal((text.match(/本会话主工作区在其中/g) ?? []).length, 1)
  // The blanket sentence must carry the same exception as the entry marker.
  assert.match(text, /仍然照常可写/)
})

test('claims writability only in the mode that grants it', () => {
  const values = { 's-1': { [ITEM_KEY]: [{ path: 'D:\\work', alias: 'work', note: '' }] } }
  const contain = { id: 's-1', header: { cwd: 'D:\\work\\backend' } }
  assert.match(textFor({ values, session: contain, sandboxPolicy: policyFor('workspace-write') }), /本会话主工作区在其中/)
  for (const sandboxPolicy of [policyFor('read-only'), undefined]) {
    const text = textFor({ values, session: contain, sandboxPolicy })
    assert.doesNotMatch(text, /照常可写|stays writable/, text)
    // The location sentence is about where the directory is, not permission.
    assert.doesNotMatch(text, /不在主工作区之内|outside the main workspace/, text)
  }
})

test('keeps the plain wording when no entry contains the session workspace', () => {
  const text = textFor({
    values: { 's-1': { [ITEM_KEY]: [{ path: 'D:\\other', alias: 'other', note: '' }] } },
    session: { id: 's-1', header: { cwd: 'D:\\work\\backend' } },
    sandboxPolicy: policyFor('workspace-write'),
  })
  assert.match(text, /除主工作区外/)
  assert.match(text, /不在主工作区之内/)
})

test('drops duplicates, overlaps and junk, and defaults the alias', () => {
  const entries = normalizeEntries([
    { path: 'D:\\work\\backend', alias: '', note: '' },
    { path: 'D:\\work\\backend', alias: 'copy', note: '' },
    { path: 'D:\\work\\backend\\src', alias: 'child', note: '' },
    { path: 'D:\\work', alias: 'parent', note: '' },
    null,
    { path: '   ' },
    'text',
    { path: 'D:\\work\\docs', note: '文档' },
  ])
  assert.deepEqual(entries, [
    { path: 'D:\\work\\backend', alias: 'backend', note: '' },
    { path: 'D:\\work\\docs', alias: 'docs', note: '文档' },
  ])
})

test('stops at the configured cap', () => {
  const many = Array.from({ length: 20 }, (_, index) => ({ path: 'D:\\w\\p' + String(index), alias: '', note: '' }))
  assert.equal(normalizeEntries(many, 8).length, 8)
  assert.equal(normalizeEntries(many).length, 8)
  assert.equal(normalizeEntries(many, 3).length, 3)
})

test('path comparison ignores case and a trailing separator', () => {
  assert.equal(isSamePath('D:\\Work\\Backend\\', 'd:\\work\\backend'), true)
  assert.equal(isSamePath('D:\\work\\backend', 'D:\\work\\backend2'), false)
  assert.equal(containsPath('D:\\work', 'D:\\work\\a\\b'), true)
  assert.equal(containsPath('D:\\work\\a', 'D:\\work'), false)
  assert.equal(defaultAlias('D:\\work\\backend\\'), 'backend')
  assert.equal(defaultAlias('/home/me/docs'), 'docs')
})

test('configuration is validated, not trusted', () => {
  assert.deepEqual(resolveConfig(undefined), { maxWorkspaces: 8, reminderLanguage: 'zh' })
  assert.deepEqual(resolveConfig({ maxWorkspaces: 2, reminderLanguage: 'en' }), { maxWorkspaces: 2, reminderLanguage: 'en' })
  assert.deepEqual(resolveConfig({ maxWorkspaces: 0, reminderLanguage: 'fr' }), { maxWorkspaces: 8, reminderLanguage: 'zh' })
  assert.deepEqual(resolveConfig({ maxWorkspaces: 500 }), { maxWorkspaces: 64, reminderLanguage: 'zh' })
})

test('the English reminder is available and never mixes languages', () => {
  const text = reminderText({
    entries: [{ path: 'D:\\work\\backend', alias: 'backend', note: 'api' }],
    mode: 'workspace-write',
    lang: 'en',
  })
  assert.match(text, /extra workspaces/i)
  assert.match(text, /api/)
  assert.doesNotMatch(text, /工作区/)
})
