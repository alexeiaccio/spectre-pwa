import { render } from '@solidjs/web'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

const root = document.getElementById('root')

render(() => <App />, root!)

registerSW({ immediate: true })
