import ReactDOM from 'react-dom/client'
import '@/styles/global.css'
import { ThemeProvider } from '@/components/theme-provider'
import { LayersPage } from '@/screens/layers/LayersPage'

const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(
    <ThemeProvider>
      <LayersPage compact />
    </ThemeProvider>,
  )
}
