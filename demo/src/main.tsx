import { createRoot } from 'react-dom/client'
import { scan } from 'react-scan'
import App from './App'
import './styles/global.css'

if (typeof window !== 'undefined') {
  scan({
    enabled: true,
    log: false, // logs render info to console (default: false)
  })
}

createRoot(document.getElementById('root')!).render(<App />)
