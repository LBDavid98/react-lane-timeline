import { createRoot } from 'react-dom/client'
import { App } from './App.js'

// The package stylesheet, then the bundled default palette.
import 'react-lane-timeline/timeline.css'
import 'react-lane-timeline/adapters/default.css'
import './shell.css'

const root = document.getElementById('root')
if (!root) throw new Error('no #root')
createRoot(root).render(<App />)
