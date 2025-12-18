/**
 * 全局变量初始化
 * 将 React、ReactDOM 等暴露到 window 对象，供 UMD 组件使用
 */

import * as React from 'react'
import * as ReactDOM from 'react-dom'

/**
 * 初始化全局变量
 * 供远程物料（UMD 组件）使用
 */
export function initGlobals() {
  // 暴露 React 到全局
  if (typeof window !== 'undefined') {
    // React
    if (!window.React) {
      window.React = React
      console.log('[Globals] ✅ window.React exposed')
    }

    // ReactDOM
    if (!window.ReactDOM) {
      window.ReactDOM = ReactDOM
      console.log('[Globals] ✅ window.ReactDOM exposed')
    }

    // jsx-runtime（用于 runtime: 'automatic' 模式）
    if (!window.jsxRuntime && window.React) {
      window.jsxRuntime = {
        jsx: React.createElement,
        jsxs: React.createElement,
        Fragment: React.Fragment,
      }
      console.log('[Globals] ✅ window.jsxRuntime exposed')
    }

    // $EasyEditor 命名空间（如果不存在）
    if (!window.$EasyEditor) {
      window.$EasyEditor = {}
      console.log('[Globals] ✅ window.$EasyEditor initialized')
    }
  }
}
