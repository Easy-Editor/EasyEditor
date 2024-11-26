import { Outlet } from 'react-router-dom'

function Examples() {
  return (
    <div>
      <section>
        <div className='overflow-hidden rounded-[0.5rem] border bg-background shadow'>
          <Outlet />
        </div>
      </section>
    </div>
  )
}

export default Examples
