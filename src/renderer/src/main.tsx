import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/views.css'
import './styles/effects.css'
import { App } from './App'
import { GameLogWindow } from './views/GameLogWindow'

// The live-log window opened per launch (main/gameLogWindow.ts) loads this
// same bundle with a `gameLog` query parameter rather than getting a second
// Vite entry point, so it stays in step with every renderer change for free.
// Anything without that parameter is the ordinary launcher window.
const params = new URLSearchParams(window.location.search)
const gameLogInstanceId = params.get('gameLog')

const root = (
  <StrictMode>
    {gameLogInstanceId ? (
      <GameLogWindow instanceId={gameLogInstanceId} instanceName={params.get('name') ?? gameLogInstanceId} />
    ) : (
      <App />
    )}
  </StrictMode>
)

createRoot(document.getElementById('root') as HTMLElement).render(root)
