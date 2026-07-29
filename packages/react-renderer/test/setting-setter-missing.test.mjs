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

test('frozen setter props are detached before default and multi-value state are added', () => {
  const frozenSetterProps = Object.freeze({ placeholder: 'Frozen metadata value' })
  const field = {
    extraProps: Object.freeze({ defaultValue: 'fallback value' }),
    getValue: () => undefined,
    id: 'frozen-setter-props-field',
    setter: Object.freeze({
      componentName: 'FrozenSetter',
      props: frozenSetterProps,
    }),
    valueState: -1,
  }
  let resolvedSetterProps
  const context = {
    setters: {
      createSetterContent: (_setterType, setterProps) => {
        resolvedSetterProps = setterProps
        return null
      },
    },
    settingsManager: {},
  }

  assert.doesNotThrow(() =>
    renderToStaticMarkup(
      createElement(SettingRendererContext.Provider, { value: context }, createElement(SettingSetter, { field })),
    ),
  )

  assert.notStrictEqual(resolvedSetterProps, frozenSetterProps)
  assert.deepEqual(resolvedSetterProps, {
    defaultValue: 'fallback value',
    multiValue: true,
    placeholder: 'Frozen metadata value',
  })
  assert.deepEqual(frozenSetterProps, { placeholder: 'Frozen metadata value' })

  const frozenDynamicSetterProps = Object.freeze({ placeholder: 'Frozen dynamic value' })
  let receivedDynamicField
  const dynamicField = {
    ...field,
    id: 'frozen-dynamic-setter-props-field',
    setter: Object.freeze({
      componentName: 'FrozenDynamicSetter',
      props: receivedField => {
        receivedDynamicField = receivedField
        return frozenDynamicSetterProps
      },
    }),
  }
  resolvedSetterProps = undefined

  assert.doesNotThrow(() =>
    renderToStaticMarkup(
      createElement(
        SettingRendererContext.Provider,
        { value: context },
        createElement(SettingSetter, { field: dynamicField }),
      ),
    ),
  )

  assert.strictEqual(receivedDynamicField, dynamicField)
  assert.notStrictEqual(resolvedSetterProps, frozenDynamicSetterProps)
  assert.deepEqual(resolvedSetterProps, {
    defaultValue: 'fallback value',
    multiValue: true,
    placeholder: 'Frozen dynamic value',
  })
  assert.deepEqual(frozenDynamicSetterProps, { placeholder: 'Frozen dynamic value' })
})
