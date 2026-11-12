import { createRouter, createWebHistory } from 'vue-router'
import HomePage from './pages/HomePage.vue'
import LibraryPage from './pages/LibraryPage.vue'
import WordsPage from './pages/WordsPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import ReadingPage from './pages/ReadingPage.vue'
import SummaryPage from './pages/SummaryPage.vue'

export const routes = [
  { path: '/', name: 'home', component: HomePage, meta: { title: '阅读台' } },
  { path: '/library', name: 'library', component: LibraryPage, meta: { title: '文章库' } },
  { path: '/words', name: 'words', component: WordsPage, meta: { title: '词库' } },
  { path: '/settings', name: 'settings', component: SettingsPage, meta: { title: '设置' } },
  { path: '/read/:id', name: 'reading', component: ReadingPage, meta: { title: '精读', immersive: true } },
  {
    path: '/read/:id/summary',
    name: 'summary',
    component: SummaryPage,
    meta: { title: '学习小结', immersive: true }
  },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.afterEach((to) => {
  const title = to.meta && to.meta.title
  document.title = title ? `${title} · ReadLoop` : 'ReadLoop'
})

export default router

