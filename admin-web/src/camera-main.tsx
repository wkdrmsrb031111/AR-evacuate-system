import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CameraGuide from './CameraGuide'

createRoot(document.getElementById('root')!).render(<StrictMode><CameraGuide /></StrictMode>)
