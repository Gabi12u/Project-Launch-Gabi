import './lib/lang'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/views.css'
import './styles/effects.css'
import './styles/logo-intro.css'
import { App } from './App'
import { GameLogWindow } from './views/GameLogWindow'
import { ErrorBoundary } from './components/ErrorBoundary'

// The live-log window opened per launch (main/gameLogWindow.ts) loads this
// same bundle with a `gameLog` query parameter rather than getting a second
// Vite entry point, so it stays in step with every renderer change for free.
// Anything without that parameter is the ordinary launcher window.
const params = new URLSearchParams(window.location.search)
const gameLogInstanceId = params.get('gameLog')

// Caught out here as well. The log window had no boundary at all, and it has
// no frame of its own, so a render error left an empty window with nothing to
// close it by. The launcher's own boundary only exists once it is ready, so a
// failure during loading blanked it the same way.
const root = (
  <StrictMode>
    <ErrorBoundary variant="app">
      {gameLogInstanceId ? (
        <GameLogWindow instanceId={gameLogInstanceId} instanceName={params.get('name') ?? gameLogInstanceId} />
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </StrictMode>
)

createRoot(document.getElementById('root') as HTMLElement).render(root)
