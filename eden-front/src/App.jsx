import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { AppBar, Toolbar, Typography, Tabs, Tab, Box, Paper, Chip, Container } from '@mui/material'
import ParkIcon from '@mui/icons-material/Park'
import TuneIcon from '@mui/icons-material/Tune'
import LocalFloristIcon from '@mui/icons-material/LocalFlorist'
import BoltIcon from '@mui/icons-material/Bolt'
import SubjectIcon from '@mui/icons-material/Subject'
import DashboardPage from './pages/DashboardPage'
import PlantsPage from './pages/PlantsPage'
import ControlRulesPage from './pages/ControlRulesPage'
import IotLogsPage from './pages/IotLogsPage'
import { EMPTY_PLANT, EMPTY_RULE } from './constants/ui'

const theme = createTheme({
  palette: { primary: { main: '#0f6b4a' }, secondary: { main: '#1565c0' } },
  shape: { borderRadius: 16 },
  typography: { fontFamily: '"Inter","Roboto",sans-serif' },
})

function parseDurationToSeconds(input) {
  if (input == null) return 0
  const raw = String(input).trim()
  if (!raw) return 0

  const low = raw.toLowerCase()
  if (low.endsWith('s')) {
    const seconds = Number(low.slice(0, -1).trim())
    if (Number.isNaN(seconds) || seconds < 0) return null
    return Math.round(seconds)
  }
  if (low.endsWith('m')) {
    const minutes = Number(low.slice(0, -1).trim())
    if (Number.isNaN(minutes) || minutes < 0) return null
    return Math.round(minutes * 60)
  }

  if (raw.includes(':')) {
    const parts = raw.split(':').map(p => p.trim())
    if (parts.some(p => p === '' || Number.isNaN(Number(p)))) return null

    if (parts.length === 2) {
      const [hh, mm] = parts.map(Number)
      if (hh < 0 || mm < 0 || mm > 59) return null
      return hh * 3600 + mm * 60
    }
    if (parts.length === 3) {
      const [hh, mm, ss] = parts.map(Number)
      if (hh < 0 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null
      return hh * 3600 + mm * 60 + ss
    }
    return null
  }

  // Compatibilidade: numero sem sufixo continua representando minutos.
  const minutes = Number(raw)
  if (Number.isNaN(minutes) || minutes < 0) return null
  return Math.round(minutes * 60)
}

function pad2(v) {
  return String(v).padStart(2, '0')
}

function formatDurationForInput(rule) {
  const sec = Number(rule?.duracao_segundos ?? 0)
  if (sec > 0) {
    if (sec % 60 === 0) {
      return String(sec / 60)
    }
    const hh = Math.floor(sec / 3600)
    const mm = Math.floor((sec % 3600) / 60)
    const ss = sec % 60
    return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`
  }
  return rule?.duracao_minutos ?? ''
}

function getWsUrl() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8080'
  const u = new URL(apiUrl)
  const proto = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${u.host}/ws`
}

function normalizeRuleActions(rule) {
  const acoes = Array.isArray(rule?.acoes) && rule.acoes.length
    ? rule.acoes
    : (rule?.dispositivo && rule?.comando ? [{ dispositivo: rule.dispositivo, comando: rule.comando }] : [])
  const acoesAbaixo = Array.isArray(rule?.acoes_abaixo_minimo) && rule.acoes_abaixo_minimo.length
    ? rule.acoes_abaixo_minimo
    : (rule?.acao_abaixo_minimo ? [rule.acao_abaixo_minimo] : [])
  const acoesAcima = Array.isArray(rule?.acoes_acima_maximo) && rule.acoes_acima_maximo.length
    ? rule.acoes_acima_maximo
    : (rule?.acao_acima_maximo ? [rule.acao_acima_maximo] : [])
  return { acoes, acoesAbaixo, acoesAcima }
}

function ruleToForm(rule) {
  const { acoes, acoesAbaixo, acoesAcima } = normalizeRuleActions(rule)
  return {
    ...EMPTY_RULE,
    id: rule.id || '',
    name: rule.name || '',
    tipo_parametro: rule.tipo_parametro || 'LIMITE',
    enabled: rule.enabled ?? true,
    variavel_sensor: rule.variavel_sensor || 'TEMPERATURA',
    operador: rule.operador || 'MAIOR_QUE',
    valor: rule.valor ?? '',
    valor_minimo: rule.valor_minimo ?? '',
    valor_maximo: rule.valor_maximo ?? '',
    horario: rule.horario || '',
    dias_semana: Array.isArray(rule.dias_semana) ? rule.dias_semana : [],
    intervalo_minutos: rule.intervalo_minutos ?? '',
    duracao_minutos: formatDurationForInput(rule),
    dispositivo: rule.dispositivo || (acoes[0]?.dispositivo ?? 'EXAUSTAO'),
    comando: rule.comando || (acoes[0]?.comando ?? 'LIGAR'),
    acoes,
    acao_abaixo_minimo: acoesAbaixo[0] || { dispositivo: 'AQUECEDOR', comando: 'LIGAR' },
    acao_acima_maximo: acoesAcima[0] || { dispositivo: 'EXAUSTAO', comando: 'LIGAR' },
    acoes_abaixo_minimo: acoesAbaixo,
    acoes_acima_maximo: acoesAcima,
    created_at: rule.created_at || '',
    last_run_at: rule.last_run_at || '',
  }
}

export default function App() {
  const [tab, setTab] = useState(0)
  const [readings, setReadings] = useState([])
  const [plants, setPlants] = useState([])
  const [rules, setRules] = useState(null)
  const [act, setAct] = useState(null)
  const [events, setEvents] = useState([])
  const [automationRules, setAutomationRules] = useState([])
  const [deviceMap, setDeviceMap] = useState({ sensor_ports: {}, actuator_ports: {} })
  const [otaRelease, setOtaRelease] = useState(null)

  const [showRuleForm, setShowRuleForm] = useState(false)
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE)
  const [savingRule, setSavingRule] = useState(false)

  const [showPlantForm, setShowPlantForm] = useState(false)
  const [plantForm, setPlantForm] = useState(EMPTY_PLANT)
  const [savingPlant, setSavingPlant] = useState(false)

  const fileRef = useRef()

  async function loadAll() {
    try {
      const [r, p, ru, a, ev, ar, dm, ota] = await Promise.all([
        api.readings(), api.plants(), api.rules(), api.actuators(), api.events(400), api.automationRules(), api.deviceMap(), api.otaRelease(),
      ])
      setReadings(Array.isArray(r) ? r : [])
      setPlants(Array.isArray(p) ? p : [])
      setRules(ru && typeof ru === 'object' ? ru : {})
      setAct(a && typeof a === 'object' ? a : {})
      setEvents(Array.isArray(ev) ? ev : [])
      setAutomationRules(Array.isArray(ar) ? ar : [])
      setDeviceMap(dm && typeof dm === 'object' ? dm : { sensor_ports: {}, actuator_ports: {} })
      setOtaRelease(ota && typeof ota === 'object' ? ota : null)
    } catch (e) {
      console.error(e)
      setReadings([])
      setPlants([])
      setEvents([])
    }
  }

  useEffect(() => {
    loadAll()
    const i = setInterval(loadAll, 15000)

    let ws
    let retry
    let closedByCleanup = false

    const connect = () => {
      ws = new WebSocket(getWsUrl())

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (Array.isArray(data.readings)) setReadings(data.readings)
          if (Array.isArray(data.plants)) setPlants(data.plants)
          if (data.rules && typeof data.rules === 'object') setRules(data.rules)
          if (data.actuators && typeof data.actuators === 'object') setAct(data.actuators)
          if (Array.isArray(data.events)) setEvents(data.events)
          if (Array.isArray(data.automation_rules)) setAutomationRules(data.automation_rules)
          if (data.device_map && typeof data.device_map === 'object') setDeviceMap(data.device_map)
        } catch (e) {
          console.error('ws parse error', e)
        }
      }

      ws.onclose = () => {
        if (!closedByCleanup) {
          retry = setTimeout(connect, 2500)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      closedByCleanup = true
      clearInterval(i)
      if (retry) clearTimeout(retry)
      if (ws && ws.readyState === WebSocket.OPEN) ws.close()
    }
  }, [])

  const latest = readings.length ? readings[readings.length - 1] : {}

  const warnings = useMemo(() => {
    if (!rules || latest.temperature_c == null) return []
    const w = []
    if (latest.temperature_c < rules.min_temp || latest.temperature_c > rules.max_temp) w.push('Temperatura fora')
    if (latest.air_humidity < rules.min_air_humidity || latest.air_humidity > rules.max_air_humidity) w.push('Umidade ar fora')
    if (latest.soil_humidity < rules.min_soil_humidity || latest.soil_humidity > rules.max_soil_humidity) w.push('Umidade solo fora')
    if (rules.min_light_level != null && latest.light_level != null && (latest.light_level < rules.min_light_level || latest.light_level > rules.max_light_level)) w.push('Luz fora')
    return w
  }, [latest, rules])

  async function saveAct(next) {
    setAct(await api.saveActuators(next))
    setEvents(await api.events(400))
  }

  async function patchAct(dispositivo, on) {
    setAct(await api.patchActuator(dispositivo, on))
    setEvents(await api.events(400))
  }

  async function setActuatorMode(mode) {
    setAct(await api.setActuatorsMode(mode))
    setEvents(await api.events(400))
  }

  function handlePhoto(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setPlantForm(f => ({ ...f, photo_base64: ev.target.result.split(',')[1] }))
    reader.readAsDataURL(file)
  }

  async function savePlant(e) {
    e.preventDefault()
    setSavingPlant(true)
    try {
      await api.createPlant({
        ...plantForm,
        planted_at: new Date(plantForm.planted_at).toISOString(),
        expected_flowering_days: Number(plantForm.expected_flowering_days),
        expected_harvest_days: Number(plantForm.expected_harvest_days),
      })
      setPlants(await api.plants())
      setPlantForm(EMPTY_PLANT)
      setShowPlantForm(false)
    } finally {
      setSavingPlant(false)
    }
  }

  async function saveRule() {
    if (!ruleForm.name.trim()) return
    setSavingRule(true)
    try {
      const tipo = ruleForm.tipo_parametro
      const duracaoSegundos = parseDurationToSeconds(ruleForm.duracao_minutos)
      if (duracaoSegundos == null) {
        throw new Error('Duração inválida. Use minutos (ex: 90), 10s, HH:MM ou HH:MM:SS (ex: 00:00:10).')
      }
      const payload = {
        name: ruleForm.name,
        tipo_parametro: tipo,
        enabled: ruleForm.enabled,
        variavel_sensor: ruleForm.variavel_sensor,
        operador: ruleForm.operador,
        valor: ruleForm.valor ? Number(ruleForm.valor) : 0,
        valor_minimo: ruleForm.valor_minimo ? Number(ruleForm.valor_minimo) : 0,
        valor_maximo: ruleForm.valor_maximo ? Number(ruleForm.valor_maximo) : 0,
        horario: ruleForm.horario,
        dias_semana: ruleForm.dias_semana,
        intervalo_minutos: ruleForm.intervalo_minutos ? Number(ruleForm.intervalo_minutos) : 0,
        duracao_minutos: duracaoSegundos > 0 ? Math.ceil(duracaoSegundos / 60) : 0,
        duracao_segundos: duracaoSegundos,
        dispositivo: ruleForm.dispositivo,
        comando: ruleForm.comando,
        acoes: tipo !== 'LIMITE' ? (ruleForm.acoes || []) : [],
        acao_abaixo_minimo: tipo === 'LIMITE' ? ruleForm.acao_abaixo_minimo : null,
        acao_acima_maximo: tipo === 'LIMITE' ? ruleForm.acao_acima_maximo : null,
        acoes_abaixo_minimo: tipo === 'LIMITE' ? (ruleForm.acoes_abaixo_minimo || []) : [],
        acoes_acima_maximo: tipo === 'LIMITE' ? (ruleForm.acoes_acima_maximo || []) : [],
        created_at: ruleForm.created_at || undefined,
        last_run_at: ruleForm.last_run_at || undefined,
      }
      if (ruleForm.id) {
        await api.updateAutomationRule(ruleForm.id, payload)
        await notifyIotSyncSafe('automation_rule_updated')
      } else {
        await api.createAutomationRule(payload)
        await notifyIotSyncSafe('automation_rule_saved')
      }
      setRuleForm(EMPTY_RULE)
      setShowRuleForm(false)
      setAutomationRules(await api.automationRules())
    } catch (e) {
      alert(e?.message || 'Falha ao salvar regra')
    } finally {
      setSavingRule(false)
    }
  }

  async function deleteRule(id) {
    if (!confirm('Excluir esta regra?')) return
    await api.deleteAutomationRule(id)
    await notifyIotSyncSafe('automation_rule_deleted')
    setAutomationRules(await api.automationRules())
  }

  function editRule(rule) {
    setRuleForm(ruleToForm(rule))
    setShowRuleForm(true)
  }

  async function saveDeviceMap(next) {
    const out = await api.saveDeviceMap(next)
    await notifyIotSyncSafe('device_map_saved')
    setDeviceMap(out)
  }

  async function notifyIotSyncSafe(reason) {
    try {
      await api.notifyIotSync(reason)
    } catch (e) {
      console.warn('Falha ao notificar IoT sync:', reason, e)
    }
  }

  async function uploadOtaFirmware({ file, version, description }) {
    const out = await api.otaUpload({ file, version, description })
    setOtaRelease(out)
    return out
  }

  async function publishOtaFirmware(version) {
    const out = await api.otaPublish(version)
    setOtaRelease(out)
    return out
  }

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ minHeight: '100vh', background: 'radial-gradient(circle at 10% -20%,#d9efe3 0,transparent 35%),radial-gradient(circle at 100% 0%,#d9e9ff 0,transparent 35%),#edf4f1' }}>
        <AppBar position="sticky" elevation={0} sx={{ background: 'linear-gradient(90deg,#0b5138,#178f63)' }}>
          <Toolbar>
            <ParkIcon sx={{ mr: 1.2 }} />
            <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 800, letterSpacing: 0.5 }}>Eden Greenhouse</Typography>
            {warnings.length > 0 && <Chip label={`${warnings.length} alerta${warnings.length > 1 ? 's' : ''}`} color="error" size="small" sx={{ mr: 1 }} />}
          </Toolbar>
        </AppBar>

        <Container maxWidth={false} sx={{ px: { xs: 1, md: 3 }, py: 2 }}>
          <Paper sx={{ mb: 2, p: 0.5, borderRadius: 3 }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth">
              <Tab icon={<TuneIcon fontSize="small" />} iconPosition="start" label="Painel" />
              <Tab icon={<LocalFloristIcon fontSize="small" />} iconPosition="start" label="Plantas" />
              <Tab icon={<BoltIcon fontSize="small" />} iconPosition="start" label="Controle & Regras" />
              <Tab icon={<SubjectIcon fontSize="small" />} iconPosition="start" label="Logs IoT" />
            </Tabs>
          </Paper>

          {tab === 0 && <DashboardPage latest={latest} warnings={warnings} events={events} rules={rules} />}

          {tab === 1 && <PlantsPage plants={plants} showPlantForm={showPlantForm} setShowPlantForm={setShowPlantForm} plantForm={plantForm} setPlantForm={setPlantForm} fileRef={fileRef} handlePhoto={handlePhoto} savePlant={savePlant} savingPlant={savingPlant} />}

          {tab === 2 && <ControlRulesPage act={act} saveAct={saveAct} patchAct={patchAct} setActuatorMode={setActuatorMode} showRuleForm={showRuleForm} setShowRuleForm={setShowRuleForm} ruleForm={ruleForm} setRuleForm={setRuleForm} saveRule={saveRule} savingRule={savingRule} automationRules={automationRules} deleteRule={deleteRule} editRule={editRule} deviceMap={deviceMap} saveDeviceMap={saveDeviceMap} otaRelease={otaRelease} uploadOtaFirmware={uploadOtaFirmware} publishOtaFirmware={publishOtaFirmware} events={events} />}
          {tab === 3 && <IotLogsPage events={events} otaRelease={otaRelease} publishOtaFirmware={publishOtaFirmware} uploadOtaFirmware={uploadOtaFirmware} />}
        </Container>
      </Box>
    </ThemeProvider>
  )
}
