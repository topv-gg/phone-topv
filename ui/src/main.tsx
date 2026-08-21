import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PhoneHost } from '@/phone/PhoneHost'
import { appliquerTheme } from '@/topv/theme'
import { verifierAppareil } from '@/topv/link'
import './index.css'

// Le choix du joueur est pose AVANT le premier rendu : sinon l'app s'affiche une
// fraction de seconde dans le theme de l'hote avant de basculer.
appliquerTheme()

// Un jeton perime ne doit plus se traduire par un fil vide inexplicable. On ne
// bloque pas le rendu : la verification suit son cours et ne fait quelque chose
// que si le serveur repond explicitement « je ne connais pas cet appareil ».
void verifierAppareil()

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <PhoneHost>
            <App />
        </PhoneHost>
    </StrictMode>,
)
