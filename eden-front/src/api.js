const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8080'

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function requestForm(path, formData, options = {}) {
  const res = await fetch(`${API}${path}`, {
    method: options.method || 'POST',
    body: formData,
    ...options,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function requestFallback(path, fallback, options = {}) {
  try {
    return await request(path, options)
  } catch {
    return fallback
  }
}

export const api = {
  readings: (limit = 120) => request(`/api/readings?limit=${limit}`),
  readingsRange: ({ from, to, limit = 1200 } = {}) => {
    const params = new URLSearchParams()
    if (limit != null) params.set('limit', String(limit))
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return request(`/api/readings?${params.toString()}`)
  },
  plants: () => request('/api/plants'),
  createPlant: (body) => request('/api/plants', { method: 'POST', body: JSON.stringify(body) }),
  updatePlantPhase: (id, phase) => request(`/api/plants/${id}/phase`, { method: 'PUT', body: JSON.stringify({ phase }) }),
  plantProgress: (id, limit = 60) => requestFallback(`/api/plants/${id}/progress?limit=${limit}`, []),
  addPlantProgress: (id, body) => request(`/api/plants/${id}/progress`, { method: 'POST', body: JSON.stringify(body) }),
  events: (limit = 80) => requestFallback(`/api/events?limit=${limit}`, []),
  automationGroups: () => requestFallback('/api/automation-groups', []),
  createAutomationGroup: (body) => request('/api/automation-groups', { method: 'POST', body: JSON.stringify(body) }),
  automationRules: () => requestFallback('/api/automation-rules', []),
  createAutomationRule: (body) => request('/api/automation-rules', { method: 'POST', body: JSON.stringify(body) }),
  updateAutomationRule: (id, body) => request(`/api/automation-rules/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteAutomationRule: (id) => request(`/api/automation-rules/${id}`, { method: 'DELETE' }),
  rules: () => request('/api/rules'),
  saveRules: (body) => request('/api/rules', { method: 'PUT', body: JSON.stringify(body) }),
  actuators: () => request('/api/actuators'),
  saveActuators: (body) => request('/api/actuators', { method: 'PUT', body: JSON.stringify(body) }),
  patchActuator: (dispositivo, on) => request('/api/actuators', { method: 'PATCH', body: JSON.stringify({ dispositivo, on }) }),
  setActuatorsMode: (mode) => request('/api/actuators/mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  deviceMap: () => requestFallback('/api/device-map', { sensor_ports: {}, actuator_ports: {} }),
  saveDeviceMap: (body) => request('/api/device-map', { method: 'PUT', body: JSON.stringify(body) }),
  bootstrapConfig: () => request('/api/bootstrap/config'),
  notifyIotSync: (reason = 'frontend_update') => request('/api/iot/sync', { method: 'POST', body: JSON.stringify({ reason }) }),
  otaRelease: () => requestFallback('/api/ota/release', null),
  otaUpload: ({ file, version, description = '' }) => {
    const fd = new FormData()
    fd.append('firmware', file)
    if (version != null && String(version).trim() !== '') fd.append('version', String(version))
    if (description) fd.append('description', description)
    return requestForm('/api/ota/upload', fd)
  },
  otaPublish: (version) => request('/api/ota/publish', { method: 'POST', body: JSON.stringify({ version }) }),
}
