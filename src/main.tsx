import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AssistantProvider } from './components/AssistantContext'
import { IonApp, setupIonicReact } from '@ionic/react'
import { MotionConfig } from 'motion/react'
import '@ionic/react/css/core.css'
import '@ionic/react/css/normalize.css'
import '@ionic/react/css/structure.css'
import '@ionic/react/css/typography.css'
import './tokens.css'
import './theme.css'
import './features.css'
import './study-cards.css'
import './experience.css'
import './appearance.css'
import './study-session.css'
import './page-flow.css'

setupIonicReact({ mode: 'ios', rippleEffect: false, hardwareBackButton: false })
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><MotionConfig reducedMotion="user"><IonApp><AssistantProvider><App /></AssistantProvider></IonApp></MotionConfig></React.StrictMode>,
)
