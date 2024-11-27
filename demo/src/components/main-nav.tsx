'use client'

import { Link } from 'react-router-dom'

export function MainNav() {
  return (
    <div className='mr-4 hidden md:flex'>
      <Link to='/' className='mr-4 flex items-center gap-2 lg:mr-6'>
        <span className='hidden font-bold lg:inline-block'>低代码平台</span>
      </Link>
    </div>
  )
}
