/**
 * AuthContext.jsx
 * ---------------
 * Provides authentication state (token, user) to the entire app.
 * Token is persisted in sessionStorage for the browser session.
 */

import { createContext, useContext, useState, useCallback } from 'react'
import { login as apiLogin } from '../utils/api'


const AuthContext = createContext(null)


export function AuthProvider({ children }) {
  const [token, setToken] = useState(
    () => sessionStorage.getItem('token') || null
  )

  const [user, setUser] = useState(
    () => {
      const stored = sessionStorage.getItem('user')
      return stored ? JSON.parse(stored) : null
    }
  )

  const [error, setError] = useState(null)


  const login = useCallback(async (username, password) => {
    setError(null)

    const data = await apiLogin(username, password)

    // Decode the JWT payload (no verification needed client-side)
    const payload = JSON.parse(atob(data.access_token.split('.')[1]))

    sessionStorage.setItem('token', data.access_token)
    sessionStorage.setItem('user', JSON.stringify(payload))

    setToken(data.access_token)
    setUser(payload)
  }, [])


  const logout = useCallback(() => {
    sessionStorage.removeItem('token')
    sessionStorage.removeItem('user')
    setToken(null)
    setUser(null)
  }, [])


  return (
    <AuthContext.Provider value={{ token, user, login, logout, error, setError }}>
      {children}
    </AuthContext.Provider>
  )
}


export function useAuth() {
  return useContext(AuthContext)
}
