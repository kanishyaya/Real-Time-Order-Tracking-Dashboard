/**
 * App.jsx
 * -------
 * Root component. Wraps the app in AuthProvider and shows either
 * the login page or the dashboard based on authentication state.
 */

import { AuthProvider, useAuth } from './hooks/AuthContext'
import LoginPage  from './components/LoginPage'
import Dashboard  from './components/Dashboard'


function AppInner() {
  const { token } = useAuth()

  return token ? <Dashboard /> : <LoginPage />
}


export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
