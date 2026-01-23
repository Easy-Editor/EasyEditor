/**
 * Vite Plugin: External Dependencies
 * 外部依赖插件 - 在开发模式下将 React/ReactDOM 外部化
 *
 * 用途：
 * - 防止 Vite 将 React/ReactDOM 打包进开发服务器的模块
 * - 强制使用父应用（dashboard）提供的 React 实例
 * - 解决双 React 实例导致的 "Invalid hook call" 错误
 */

import type { Plugin } from 'vite'

export interface ExternalDepsOptions {
  /** 需要外部化的依赖列表 */
  externals?: string[]
  /** 全局变量映射 */
  globals?: Record<string, string>
}

const DEFAULT_EXTERNALS = ['react', 'react-dom', 'react/jsx-runtime']

const DEFAULT_GLOBALS: Record<string, string> = {
  react: 'React',
  'react-dom': 'ReactDOM',
  'react/jsx-runtime': 'jsxRuntime',
}

// 虚拟模块前缀
const VIRTUAL_PREFIX = '\0virtual:external:'

/**
 * 生成 React 模块的虚拟代码
 */
function generateReactCode(globalName: string): string {
  return `
// External module: react -> window.${globalName}
const React = window.${globalName};
if (!React) {
  throw new Error(
    'External dependency "react" (window.${globalName}) is not available. ' +
    'Make sure the parent application has loaded it globally.'
  );
}

export default React;

export const {
  useState, useEffect, useContext, useReducer, useCallback, useMemo,
  useRef, useImperativeHandle, useLayoutEffect, useDebugValue,
  useDeferredValue, useTransition, useId, useSyncExternalStore,
  Fragment, StrictMode, Suspense, createElement, createContext,
  forwardRef, lazy, memo, startTransition, Component, PureComponent,
  Children, cloneElement, isValidElement,
} = React;
`
}

/**
 * 生成 ReactDOM 模块的虚拟代码
 */
function generateReactDomCode(globalName: string): string {
  return `
// External module: react-dom -> window.${globalName}
const ReactDOM = window.${globalName};
if (!ReactDOM) {
  throw new Error(
    'External dependency "react-dom" (window.${globalName}) is not available. ' +
    'Make sure the parent application has loaded it globally.'
  );
}

export default ReactDOM;

export const {
  createRoot, hydrateRoot, render, hydrate,
  unmountComponentAtNode, findDOMNode, flushSync,
} = ReactDOM;
`
}

/**
 * 生成 JSX Runtime 模块的虚拟代码
 */
function generateJsxRuntimeCode(globalName: string): string {
  return `
// External module: react/jsx-runtime -> window.${globalName}
const jsxRuntime = window.${globalName};
if (!jsxRuntime) {
  throw new Error(
    'External dependency "react/jsx-runtime" (window.${globalName}) is not available. ' +
    'Make sure the parent application has loaded it globally.'
  );
}

export const { jsx, jsxs, Fragment } = jsxRuntime;
export default jsxRuntime;
`
}

/**
 * 生成 @easy-editor/core 模块的虚拟代码
 */
function generateEasyEditorCoreCode(globalName: string): string {
  return `
// External module: @easy-editor/core -> window.${globalName}
const EasyEditorCore = window.${globalName};
if (!EasyEditorCore) {
  throw new Error(
    'External dependency "@easy-editor/core" (window.${globalName}) is not available. ' +
    'Make sure the parent application has loaded it globally.'
  );
}

export default EasyEditorCore;

// 动态导出所有属性
const keys = Object.keys(EasyEditorCore || {});
keys.forEach(key => {
  Object.defineProperty(module.exports, key, {
    get: () => EasyEditorCore[key],
    enumerable: true,
  });
});
`
}

/**
 * 生成通用模块的虚拟代码
 */
function generateGenericCode(moduleName: string, globalName: string): string {
  return `
// External module: ${moduleName} -> window.${globalName}
const mod = window.${globalName};
if (!mod) {
  throw new Error(
    'External dependency "${moduleName}" (window.${globalName}) is not available. ' +
    'Make sure the parent application has loaded it globally.'
  );
}
export default mod;
`
}

/**
 * 创建外部依赖插件
 */
export function externalDepsPlugin(options: ExternalDepsOptions = {}): Plugin {
  const externals = options.externals || DEFAULT_EXTERNALS
  const globals = { ...DEFAULT_GLOBALS, ...options.globals }

  return {
    name: 'vite-plugin-external-deps',
    enforce: 'pre',

    // 在开发模式下拦截模块解析
    resolveId(id) {
      if (externals.includes(id)) {
        return VIRTUAL_PREFIX + id
      }
      return null
    },

    // 加载外部模块的代理代码
    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) {
        return null
      }

      const moduleName = id.slice(VIRTUAL_PREFIX.length)
      const globalName = globals[moduleName]

      if (!globalName) {
        throw new Error(
          `[vite-plugin-external-deps] No global mapping found for "${moduleName}". ` +
            'Please add it to the globals option.',
        )
      }

      // 根据模块名生成对应的虚拟代码
      switch (moduleName) {
        case 'react':
          return generateReactCode(globalName)
        case 'react-dom':
          return generateReactDomCode(globalName)
        case 'react/jsx-runtime':
          return generateJsxRuntimeCode(globalName)
        case '@easy-editor/core':
          return generateEasyEditorCoreCode(globalName)
        default:
          return generateGenericCode(moduleName, globalName)
      }
    },

    // 配置 Rollup 外部化（用于构建）
    config() {
      return {
        build: {
          rollupOptions: {
            external: externals,
            output: {
              globals,
            },
          },
        },
      }
    },
  }
}
