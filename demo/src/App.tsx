import './styles/global.css'

import { RouterProvider } from 'react-router-dom'
import { ThemeProvider } from './components/theme-provider'
import { router } from './router'

const App = () => {
  return (
    <ThemeProvider defaultTheme='system' storageKey='easy-editor-theme'>
      <div className='relative p-4'>
        <RouterProvider router={router} />
      </div>
    </ThemeProvider>
  )
}

export default App
