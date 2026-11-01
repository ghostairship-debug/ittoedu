import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { expect, it } from 'vitest'
import { loadSourceLanguage } from '../../src/renderer/documentFiles/sourceLanguage'

it.each([
  ['invalid.json', '{ "value": broken, }'],
  ['settings.JSONC', '{ // comment\n "value": 1, }'],
  ['index.js', 'const value = 1;'],
  ['view.jsx', 'const view = <p>Hello</p>;'],
  ['index.ts', 'const value: number = 1;'],
  ['view.tsx', 'const view = <p>Hello</p>;'],
  ['index.html', '<p>Hello</p>'],
  ['style.css', 'p { color: red }'],
])('loads a language for %s without altering source', async (filename, source) => {
  const state = EditorState.create({ doc: source, extensions: [await loadSourceLanguage(filename)] })
  expect(syntaxTree(state).length).toBeGreaterThan(0)
  expect(state.doc.toString()).toBe(source)
})

it.each(['README', 'settings.yaml', '.env', 'notes.custom'])('keeps %s editable without a language package', async filename => {
  expect(await loadSourceLanguage(filename)).toEqual([])
})
