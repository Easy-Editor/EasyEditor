import { SiteHeader } from '@/components/site-header'
import { Outlet } from 'react-router-dom'

function Examples() {
  return (
    <div className='flex flex-col'>
      <SiteHeader className='flex-1' />

      <section className='flex flex-1'>
        <Outlet />
      </section>
    </div>
  )
}

export default Examples
