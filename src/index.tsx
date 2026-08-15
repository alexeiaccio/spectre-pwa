import { render } from '@solidjs/web'
import './index.css'
import App from './app.tsx'
import { useUpdate } from './lib/update.ts'

const root = document.getElementById('root')

render(() => <App update={useUpdate()} />, root!)
