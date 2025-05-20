import BannerImg from '@/assets/banner.png'

export function MainNav() {
  return (
    <div className='mr-4 hidden md:flex'>
      <div className='mr-4 flex items-center gap-2 lg:mr-6'>
        <img src={BannerImg} alt='banner' className='h-6' />
      </div>
      <nav className='flex items-center gap-4 text-sm xl:gap-6' />
    </div>
  )
}
