import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingRendererContext, SettingSetter } from '../.test-dist/index.js'

test('a missing setter renders a placeholder instead of crashing the settings panel', () => {
  const field = {
    extraProps: {},
    getValue: () => undefined,
    id: 'missing-setter-field',
    setter: 'MissingSetter',
    valueState: 0,
  }
  const context = {
    setters: {
      createSetterContent: () => null,
    },
    settingsManager: {},
  }

  const markup = renderToStaticMarkup(
    createElement(SettingRendererContext.Provider, { value: context }, createElement(SettingSetter, { field })),
  )

  assert.match(markup, /加载中: MissingSetter/)
})
