const Right = () => {
  return (
    <div className='w-72 bg-white border-l border-gray-200 flex flex-col'>
      <div className='p-4 border-b border-gray-200'>
        <h2 className='text-lg font-medium text-gray-700'>属性设置</h2>
      </div>
      <div className='flex-1 overflow-y-auto p-4'>
        <div className='space-y-4'>
          <div className='space-y-2'>
            <label htmlFor='componentName' className='block text-sm font-medium text-gray-700'>
              组件名称
            </label>
            <input
              id='componentName'
              type='text'
              className='px-3 py-2 border border-gray-300 rounded-md'
              placeholder='请输入组件名称'
            />
          </div>
          <div className='space-y-2'>
            <label htmlFor='styleSelect' className='block text-sm font-medium text-gray-700'>
              样式设置
            </label>
            <select id='styleSelect' className='w-full px-3 py-2 border border-gray-300 rounded-md'>
              <option>默认样式</option>
              <option>主要样式</option>
              <option>次要样式</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Right
