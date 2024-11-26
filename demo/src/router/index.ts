import Examples from '@/examples'
import { Dashboard } from '@/examples/dashboard'
import { type RouteObject, createBrowserRouter } from 'react-router-dom'

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: Examples,
    children: [
      {
        index: true,
        Component: Dashboard,
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
