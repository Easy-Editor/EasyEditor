import { type RouteObject, createHashRouter } from 'react-router-dom'
import Dashboard from '../src/examples/dashboard'

export const routes: RouteObject[] = [
  {
    path: '/dashboard',
    Component: Dashboard,
  },
]

export const router = createHashRouter(routes)
