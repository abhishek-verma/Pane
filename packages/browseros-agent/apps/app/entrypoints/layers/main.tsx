import ReactDOM from 'react-dom/client'
import '@/styles/global.css'
import { ThemeProvider } from '@/components/theme-provider'
import { LayersPage } from '@/screens/layers/LayersPage'

const root = document.getElementById('root')
if (root) {
  document.body.style.width = '360px'
  document.body.style.maxWidth = '100vw'
  document.body.style.minHeight = '240px'
  ReactDOM.createRoot(root).render(
    <ThemeProvider>
      <LayersPage compact />
    </ThemeProvider>,
  )
}
