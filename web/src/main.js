import { createApp } from 'vue'
import App from './App.vue'
import router from './router.js'
import { clickOutside } from './lib/directives.js'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/turn.css'
import './styles/recap.css'
import './styles/recap-chat.css'
import './styles/float.css'
import './styles/summary.css'
import './styles/home.css'
import './styles/home-calendar.css'
import './styles/home-extra.css'
import './styles/settings.css'
import './styles/settings-ai.css'
import './styles/adhd.css'

const app = createApp(App)
app.directive('click-outside', clickOutside)
app.use(router)
app.mount('#app')



