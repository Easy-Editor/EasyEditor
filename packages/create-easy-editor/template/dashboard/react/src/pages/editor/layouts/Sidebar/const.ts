import type { Snippet } from '@easy-editor/core'

import Cover1 from '@/assets/materials/cover/cover-1.jpeg'
import Cover2 from '@/assets/materials/cover/cover-2.jpeg'
import Cover3 from '@/assets/materials/cover/cover-3.jpeg'
import Cover4 from '@/assets/materials/cover/cover-4.jpeg'
import Cover5 from '@/assets/materials/cover/cover-5.jpeg'
import Cover6 from '@/assets/materials/cover/cover-6.jpeg'
import Cover7 from '@/assets/materials/cover/cover-7.jpeg'
import Cover8 from '@/assets/materials/cover/cover-8.jpeg'
import Cover9 from '@/assets/materials/cover/cover-9.jpeg'

import Header1 from '@/assets/materials/header/header-1.png'
import Header2 from '@/assets/materials/header/header-2.png'
import Header3 from '@/assets/materials/header/header-3.png'
import Header4 from '@/assets/materials/header/header-4.png'
import Header5 from '@/assets/materials/header/header-5.png'
import Header6 from '@/assets/materials/header/header-6.png'
import Header7 from '@/assets/materials/header/header-7.png'
import Header8 from '@/assets/materials/header/header-8.png'

import Title1 from '@/assets/materials/title/title-1.png'
import Title2 from '@/assets/materials/title/title-2.png'
import Title3 from '@/assets/materials/title/title-3.png'
import Title4 from '@/assets/materials/title/title-4.png'
import Title5 from '@/assets/materials/title/title-5.png'
import Title6 from '@/assets/materials/title/title-6.png'

import Card2 from '@/assets/materials/card/card-2.png'
import Card3 from '@/assets/materials/card/card-3.png'
import Card4 from '@/assets/materials/card/card-4.png'
import Card5 from '@/assets/materials/card/card-5.png'
import Card6 from '@/assets/materials/card/card-6.png'
import Card7 from '@/assets/materials/card/card-7.png'

import Component1 from '@/assets/materials/component/component-1.png'
import Component10 from '@/assets/materials/component/component-10.png'
import Component2 from '@/assets/materials/component/component-2.png'
import Component4 from '@/assets/materials/component/component-4.png'
import Component5 from '@/assets/materials/component/component-5.png'
import Component6 from '@/assets/materials/component/component-6.png'
import Component7 from '@/assets/materials/component/component-7.png'
import Component8 from '@/assets/materials/component/component-8.png'
import Component9 from '@/assets/materials/component/component-9.png'

import Other1 from '@/assets/materials/other/other-1.png'
import Other2 from '@/assets/materials/other/other-2.png'
import Other3 from '@/assets/materials/other/other-3.png'
import Other4 from '@/assets/materials/other/other-4.png'
import Other5 from '@/assets/materials/other/other-5.png'

import Footer1 from '@/assets/materials/footer/footer-1.png'

const coverList = [Cover1, Cover2, Cover3, Cover4, Cover5, Cover6, Cover7, Cover8, Cover9]
const headerList = [Header1, Header2, Header3, Header4, Header5, Header6, Header7, Header8]
const titleList = [Title1, Title2, Title3, Title4, Title5, Title6]
const cardList = [Card2, Card3, Card4, Card5, Card6, Card7]
const componentList = [
  Component1,
  Component2,
  Component4,
  Component5,
  Component6,
  Component7,
  Component8,
  Component9,
  Component10,
]
const otherList = [Other1, Other2, Other3, Other4, Other5]
const footerList = [Footer1]

const generateSnippets = (list: string[], width = 300, height = 300): Snippet[] => {
  return list.map(item => {
    return {
      // title: `${type}-${index + 1}`,
      screenshot: item,
      schema: {
        componentName: 'Image',
        props: {
          src: item,
        },
        $dashboard: {
          rect: {
            width,
            height,
          },
        },
      },
    }
  })
}

export const snippets = [
  {
    title: '封面',
    snippets: generateSnippets(coverList, 1920 / 2, 1080 / 2),
  },
  {
    title: '头部',
    snippets: generateSnippets(headerList, 1920, 100),
  },
  {
    title: '标题',
    snippets: generateSnippets(titleList, 1920 / 5, 50),
  },
  {
    title: '卡片',
    snippets: generateSnippets(cardList, 1920 / 5, 1080 / 5),
  },
  {
    title: '组件',
    snippets: generateSnippets(componentList, 1920 / 8, 1920 / 8),
  },
  {
    title: '其他',
    snippets: generateSnippets(otherList, 1920 / 10, 1920 / 10),
  },
  {
    title: '底部',
    snippets: generateSnippets(footerList, 1920, 100),
  },
]
