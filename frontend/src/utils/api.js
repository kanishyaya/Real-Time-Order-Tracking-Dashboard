/**
 * api.js — all HTTP calls to the backend
 * BASE_URL is empty — nginx on the same origin proxies /api/* to backend.
 */

const BASE_URL = ''

async function request(path, options = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Request failed: ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export const login = (username, password) =>
  request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })

/**
 * Fetch orders.
 *
 * When sinceVersion is provided, only orders whose version > sinceVersion
 * are returned. Use on WebSocket reconnect to catch up on missed changes
 * without re-downloading the entire list.
 */
export const fetchOrders = (token, sinceVersion = null) => {
  const qs = sinceVersion != null ? `?since_version=${sinceVersion}` : ''
  return request(`/api/orders${qs}`, {}, token)
}
export const createOrder  = (token, data)   => request('/api/orders',           { method: 'POST',   body: JSON.stringify(data) }, token)
export const updateOrder  = (token, id, data) => request(`/api/orders/${id}`,   { method: 'PUT',    body: JSON.stringify(data) }, token)
export const deleteOrder  = (token, id)     => request(`/api/orders/${id}`,     { method: 'DELETE' }, token)
export const fetchHealth  = ()              => request('/api/health',           {})
export const fetchMetrics = (token)         => request('/api/metrics',          {}, token)
