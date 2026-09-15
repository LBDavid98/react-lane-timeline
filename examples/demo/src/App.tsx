import { type ReactElement } from 'react'
import { DemoPage } from './DemoPage.js'

export function App(): ReactElement {
  return (
    <div className="sh">
      <header className="sh-bar">
        <strong>react-lane-timeline</strong>
        <nav className="sh-nav">
          <a
            className="sh-tab"
            href="https://github.com/LBDavid98/react-lane-timeline"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </header>
      <main className="sh-main">
        <DemoPage />
      </main>
    </div>
  )
}
