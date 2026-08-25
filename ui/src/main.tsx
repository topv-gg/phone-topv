import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PhoneHost } from '@/phone/PhoneHost'
import { appliquerTheme } from '@/topv/theme'
import { verifierAppareil } from '@/topv/link'
import './index.css'

// The player's choice is set BEFORE the first render: otherwise the app shows for a
// fraction of a second in the host's theme before switching.
appliquerTheme()

// An expired token must no longer show up as an unexplained empty feed. We do not
// block rendering: the check runs its course and only does something if the server
// explicitly answers “I do not know this device”.
void verifierAppareil()

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <PhoneHost>
            <App />
        </PhoneHost>
    </StrictMode>,
)
