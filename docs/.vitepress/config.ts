import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Floating Spheres',
  description: 'Документация анимации плавающих сфер',
  lang: 'ru-RU',
  head: [['link', { rel: 'icon', href: '/favicon.ico' }]],
  themeConfig: {
    nav: [
      { text: 'Главная', link: '/' },
      { text: 'Анимация', link: '/animation' },
      { text: 'Словарь', link: '/glossary' },
    ],
    sidebar: [
      {
        text: 'Документация',
        items: [
          { text: 'Главная', link: '/' },
          { text: 'Анимация', link: '/animation' },
          { text: 'Словарь терминов', link: '/glossary' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    docFooter: {
      prev: 'Предыдущая',
      next: 'Следующая',
    },
    returnToTopLabel: 'Наверх',
    sidebarMenuLabel: 'Меню',
    darkModeSwitchLabel: 'Тема',
    lightModeSwitchTitle: 'Светлая тема',
    darkModeSwitchTitle: 'Тёмная тема',
  },
  markdown: {
    math: true,
    mermaid: true,
  },
})
