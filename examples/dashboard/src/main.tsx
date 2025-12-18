import { createRoot } from 'react-dom/client'
import App from './App'
import { initGlobals } from './globals'
import './styles/global.css'

// 初始化全局变量（供 UMD 组件使用）
initGlobals()

createRoot(document.getElementById('root')!).render(<App />)
