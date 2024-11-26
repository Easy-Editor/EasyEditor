import './App.css'
import Center from './components/Center'
import Header from './components/Header'
import Left from './components/Left'
import Right from './components/Right'

const App = () => {
  return (
    <div className='h-screen flex flex-col'>
      <Header />
      <div className='flex-1 flex overflow-hidden'>
        <Left />
        <Center />
        <Right />
      </div>
    </div>
  )
}

export default App
