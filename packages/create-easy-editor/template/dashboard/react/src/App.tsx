import { lazy } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { ThemeProvider } from './components/theme-provider'

const Preview = lazy(() => import('./pages/preview'))
const Editor = lazy(() => import('./pages/editor'))

function App() {
  return (
    <ErrorBoundary fallback={<div className='p-4 text-red-500'>严重错误！请刷新页面</div>}>
      <ThemeProvider defaultTheme='system' storageKey='easy-dashboard-theme'>
        <BrowserRouter>
          <Routes>
            <Route path='/' element={<Editor />} />
            <Route path='/preview' element={<Preview />} />
            <Route path='/test' element={<div>test</div>} />

            <Route path='*' element={<Navigate to='/' />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
