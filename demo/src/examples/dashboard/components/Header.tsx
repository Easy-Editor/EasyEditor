const Header = () => {
  return (
    <header className='h-14 bg-white border-b border-gray-200 flex items-center px-4 shadow-sm'>
      <div className='flex items-center justify-between w-full'>
        <div className='flex items-center space-x-4'>
          <h1 className='text-xl font-semibold text-gray-800'>低代码平台</h1>
        </div>
        <div className='flex items-center space-x-4'>
          <button type='button' className='px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600'>
            预览
          </button>
          <button type='button' className='px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600'>
            保存
          </button>
        </div>
      </div>
    </header>
  )
}

export default Header
