import { lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { ThemeProvider } from './components/theme-provider'

const Preview = lazy(() => import('./pages/preview'))
const Editor = lazy(() => import('./pages/editor'))

function App() {
  return (
    <ThemeProvider defaultTheme='system' storageKey='easy-form-theme'>
      <BrowserRouter>
        <Routes>
          <Route path='/' element={<Editor />} />
          <Route path='/preview' element={<Preview />} />
          <Route path='*' element={<Navigate to='/' />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
