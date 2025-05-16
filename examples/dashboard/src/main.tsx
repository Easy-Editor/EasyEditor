import { createRoot } from 'react-dom/client'
import { scan } from 'react-scan'
import 'virtual:uno.css'
import App from './App'
import './editor'
import './index.css'

if (typeof window !== 'undefined') {
  scan({
    enabled: true,
    log: false, // logs render info to console (default: false)
  })
}

createRoot(document.getElementById('root')!).render(<App />)
