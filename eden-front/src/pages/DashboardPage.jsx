import React, { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { Box, Paper, Typography, Alert, Divider, Stack, Chip, ToggleButtonGroup, ToggleButton, TextField, CircularProgress, Button } from '@mui/material'
import ThermostatIcon from '@mui/icons-material/Thermostat'
import AirIcon from '@mui/icons-material/Air'
import WaterDropIcon from '@mui/icons-material/WaterDrop'
import WbSunnyIcon from '@mui/icons-material/WbSunny'
import MetricCard from '../components/MetricCard'
import { api } from '../api'

const RANGE_OPTIONS = [
  { value: '30m', label: '30m', ms: 30 * 60 * 1000, limit: 1200 },
  { value: '1h', label: '1h', ms: 60 * 60 * 1000, limit: 2400 },
  { value: '6h', label: '6h', ms: 6 * 60 * 60 * 1000, limit: 10000 },
  { value: '24h', label: '24h', ms: 24 * 60 * 60 * 1000, limit: 24000 },
  { value: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000, limit: 40000 },
  { value: 'custom', label: 'Personalizado', ms: 0, limit: 40000 },
]

const SOIL_COLORS = ['#0288d1', '#00897b', '#7b1fa2', '#e65100']

function toInputDateTimeValue(d) {
  const local = new Date(d.getTime() - (d.getTimezoneOffset() * 60000))
  return local.toISOString().slice(0, 16)
}

function formatAxisTime(d, spanMs) {
  if (!d) return ''
  if (spanMs <= 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTooltipTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('pt-BR')
}

function formatWindowLabel(isoFrom, isoTo) {
  if (!isoFrom || !isoTo) return 'Sem dados no intervalo'
  const from = new Date(isoFrom)
  const to = new Date(isoTo)
  return `${from.toLocaleString('pt-BR')} -> ${to.toLocaleString('pt-BR')}`
}

function HistoryChartCard({ title, data, dataKey, unit, color, minLimit, maxLimit }) {
  const latestValue = data.length ? data[data.length - 1][dataKey] : null
  return (
    <Paper sx={{ p: 2, borderRadius: 3, height: 320 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.2 }}>
        <Typography variant="subtitle1" fontWeight={800}>{title}</Typography>
        <Stack direction="row" spacing={0.8}>
          {minLimit != null && <Chip size="small" label={`min ${Number(minLimit).toFixed(1)}${unit}`} />}
          {maxLimit != null && <Chip size="small" label={`max ${Number(maxLimit).toFixed(1)}${unit}`} />}
          {latestValue != null && <Chip size="small" color="primary" label={`${Number(latestValue).toFixed(1)}${unit}`} />}
        </Stack>
      </Stack>
      <ResponsiveContainer width="100%" height="84%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0ece6" />
          <XAxis dataKey="xLabel" minTickGap={28} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={44} />
          <Tooltip
            labelFormatter={(_, payload) => {
              const p = payload && payload.length ? payload[0].payload : null
              return formatTooltipTime(p?.timestamp)
            }}
            formatter={(v) => [`${Number(v).toFixed(1)}${unit}`, title]}
          />
          {minLimit != null && <ReferenceLine y={Number(minLimit)} stroke="#ef6c00" strokeDasharray="4 4" />}
          {maxLimit != null && <ReferenceLine y={Number(maxLimit)} stroke="#c62828" strokeDasharray="4 4" />}
          <Line type="monotone" dataKey={dataKey} stroke={color} dot={false} strokeWidth={2.2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      {data.length === 0 && (
        <Typography variant="caption" color="text.secondary">
          Sem dados no periodo selecionado.
        </Typography>
      )}
    </Paper>
  )
}

function SoilHistoryChartCard({ data, allKeys, soilFilter, setSoilFilter }) {
  const visibleKeys = soilFilter.length > 0 ? soilFilter : allKeys

  function toggleKey(k) {
    if (soilFilter.length === 0) {
      setSoilFilter(allKeys.filter(x => x !== k))
    } else if (soilFilter.includes(k)) {
      const next = soilFilter.filter(x => x !== k)
      setSoilFilter(next.length === 0 ? [] : next)
    } else {
      const next = [...soilFilter, k]
      setSoilFilter(next.length === allKeys.length ? [] : next)
    }
  }

  return (
    <Paper sx={{ p: 2, borderRadius: 3, height: 320 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.2 }}>
        <Typography variant="subtitle1" fontWeight={800}>Umidade do Solo</Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap">
          {allKeys.map((k, i) => {
            const active = soilFilter.length === 0 || soilFilter.includes(k)
            return (
              <Chip
                key={k}
                size="small"
                clickable
                label={`Solo ${k}`}
                sx={{ borderColor: SOIL_COLORS[i % SOIL_COLORS.length] }}
                variant={active ? 'filled' : 'outlined'}
                style={active ? { backgroundColor: SOIL_COLORS[i % SOIL_COLORS.length], color: '#fff' } : {}}
                onClick={() => toggleKey(k)}
              />
            )
          })}
        </Stack>
      </Stack>
      <ResponsiveContainer width="100%" height="84%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0ece6" />
          <XAxis dataKey="xLabel" minTickGap={28} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={44} />
          <Tooltip
            labelFormatter={(_, payload) => {
              const p = payload?.[0]?.payload
              return formatTooltipTime(p?.timestamp)
            }}
            formatter={(v, name) => [Number(v).toFixed(0), name]}
          />
          {allKeys.map((k, i) => {
            if (!visibleKeys.includes(k)) return null
            return (
              <Line
                key={k}
                type="monotone"
                dataKey={`soil_s_${k}`}
                stroke={SOIL_COLORS[i % SOIL_COLORS.length]}
                dot={false}
                strokeWidth={2.2}
                isAnimationActive={false}
                name={`Solo ${k}`}
              />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
      {data.length === 0 && (
        <Typography variant="caption" color="text.secondary">
          Sem dados no periodo selecionado.
        </Typography>
      )}
    </Paper>
  )
}

export default function DashboardPage({ latest, warnings, events, rules }) {
  const [range, setRange] = useState('6h')
  const [customFrom, setCustomFrom] = useState(toInputDateTimeValue(new Date(Date.now() - (6 * 60 * 60 * 1000))))
  const [customTo, setCustomTo] = useState(toInputDateTimeValue(new Date()))
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadNonce, setReloadNonce] = useState(0)
  const [soilFilter, setSoilFilter] = useState([])

  const activeRange = useMemo(() => RANGE_OPTIONS.find(r => r.value === range) || RANGE_OPTIONS[2], [range])

  const queryWindow = useMemo(() => {
    if (range !== 'custom') {
      const to = new Date()
      const from = new Date(to.getTime() - activeRange.ms)
      return { from, to, limit: activeRange.limit, valid: true, message: '' }
    }

    if (!customFrom || !customTo) {
      return { from: null, to: null, limit: activeRange.limit, valid: false, message: 'Preencha inicio e fim no filtro personalizado.' }
    }

    const from = new Date(customFrom)
    const to = new Date(customTo)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return { from: null, to: null, limit: activeRange.limit, valid: false, message: 'Data/hora personalizada invalida.' }
    }
    if (from > to) {
      return { from: null, to: null, limit: activeRange.limit, valid: false, message: 'Inicio deve ser menor que fim.' }
    }
    return { from, to, limit: activeRange.limit, valid: true, message: '' }
  }, [range, customFrom, customTo, activeRange])

  useEffect(() => {
    let cancelled = false

    async function loadHistory() {
      if (!queryWindow.valid) {
        setHistory([])
        setError(queryWindow.message)
        return
      }
      setLoading(true)
      setError('')
      try {
        const now = new Date()
        const fetchTo = range !== 'custom' ? now : queryWindow.to
        const fetchFrom = range !== 'custom' ? new Date(now.getTime() - activeRange.ms) : queryWindow.from
        const out = await api.readingsRange({
          from: fetchFrom.toISOString(),
          to: fetchTo.toISOString(),
          limit: queryWindow.limit,
        })
        if (!cancelled) {
          setHistory(Array.isArray(out) ? out : [])
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Falha ao carregar historico.')
          setHistory([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadHistory()
    const timer = setInterval(loadHistory, 20000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [queryWindow, range, activeRange, reloadNonce])

  const spanMs = useMemo(() => {
    if (!queryWindow.valid || !queryWindow.from || !queryWindow.to) return 0
    return Math.max(0, queryWindow.to.getTime() - queryWindow.from.getTime())
  }, [queryWindow])

  // Derive which soil sensor indices appear in history
  const soilSensorKeys = useMemo(() => {
    const keys = new Set()
    history.forEach(r => {
      if (r.soil_sensors && typeof r.soil_sensors === 'object') {
        Object.keys(r.soil_sensors).forEach(k => keys.add(k))
      }
    })
    return Array.from(keys).sort((a, b) => Number(a) - Number(b))
  }, [history])

  const chartData = useMemo(() => history.map((r) => {
    const d = new Date(r.timestamp)
    const soilFlat = {}
    if (r.soil_sensors && typeof r.soil_sensors === 'object') {
      Object.entries(r.soil_sensors).forEach(([k, v]) => {
        soilFlat[`soil_s_${k}`] = v
      })
    }
    return {
      ...r,
      ...soilFlat,
      xLabel: formatAxisTime(d, spanMs),
    }
  }), [history, spanMs])

  const dataWindowLabel = useMemo(() => {
    if (!history.length) return 'Sem dados no intervalo'
    return formatWindowLabel(history[0]?.timestamp, history[history.length - 1]?.timestamp)
  }, [history])

  // Prefer latest payload soil map; fallback to most recent history entry that has soil_sensors.
  const latestSoilMap = useMemo(() => {
    if (latest?.soil_sensors && Object.keys(latest.soil_sensors).length > 0) {
      return latest.soil_sensors
    }
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i]?.soil_sensors
      if (m && Object.keys(m).length > 0) {
        return m
      }
    }
    return {}
  }, [latest, history])

  const latestSoilEntries = Object.entries(latestSoilMap)
    .sort(([a], [b]) => Number(a) - Number(b))

  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', md: 'repeat(auto-fill,minmax(190px,1fr))' }, gap: 2 }}>
        <MetricCard icon={<ThermostatIcon />} label="Temperatura" value={`${(latest.temperature_c ?? 0).toFixed(1)}°C`} color="#2e7d32" />
        <MetricCard icon={<AirIcon />} label="Umidade Ar" value={`${(latest.air_humidity ?? 0).toFixed(1)}%`} color="#1565c0" />
        {latestSoilEntries.length > 0 ? (
          latestSoilEntries.map(([k, v], i) => (
            <MetricCard
              key={k}
              icon={<WaterDropIcon />}
              label={`Solo ${k}`}
              value={`${Number(v).toFixed(0)}`}
              color={SOIL_COLORS[i % SOIL_COLORS.length]}
            />
          ))
        ) : (
          <MetricCard icon={<WaterDropIcon />} label="Umid. Solo" value={`${(latest.soil_humidity ?? 0).toFixed(1)}%`} color="#0288d1" />
        )}
        <MetricCard icon={<WbSunnyIcon />} label="Luz" value={`${(latest.light_level ?? 0).toFixed(0)}%`} color="#f57c00" />
      </Box>

      {warnings.length > 0 && <Alert severity="warning" sx={{ mt: 2 }}>{warnings.join(' · ')}</Alert>}

      <Paper sx={{ p: 2, borderRadius: 3, mt: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between" spacing={1.3}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="h6" fontWeight={800}>Historico Avancado</Typography>
            <Chip size="small" label={`${history.length} pontos`} />
            <Chip size="small" label={dataWindowLabel} />
            {loading && <CircularProgress size={16} />}
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
            <ToggleButtonGroup size="small" value={range} exclusive onChange={(_, v) => { if (v) setRange(v) }}>
              {RANGE_OPTIONS.map(opt => (
                <ToggleButton key={opt.value} value={opt.value}>{opt.label}</ToggleButton>
              ))}
            </ToggleButtonGroup>
            {range === 'custom' && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField size="small" type="datetime-local" label="Inicio" InputLabelProps={{ shrink: true }} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                <TextField size="small" type="datetime-local" label="Fim" InputLabelProps={{ shrink: true }} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                <Button size="small" variant="outlined" onClick={() => setReloadNonce(v => v + 1)}>Aplicar</Button>
              </Stack>
            )}
          </Stack>
        </Stack>
        {error && <Alert severity="warning" sx={{ mt: 1.2 }}>{error}</Alert>}
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 2, mt: 2 }}>
        <HistoryChartCard
          title="Temperatura"
          data={chartData}
          dataKey="temperature_c"
          unit="°C"
          color="#2e7d32"
          minLimit={rules?.min_temp}
          maxLimit={rules?.max_temp}
        />
        <HistoryChartCard
          title="Umidade do Ar"
          data={chartData}
          dataKey="air_humidity"
          unit="%"
          color="#1565c0"
          minLimit={rules?.min_air_humidity}
          maxLimit={rules?.max_air_humidity}
        />
        {soilSensorKeys.length > 0 ? (
          <SoilHistoryChartCard
            data={chartData}
            allKeys={soilSensorKeys}
            soilFilter={soilFilter}
            setSoilFilter={setSoilFilter}
          />
        ) : (
          <HistoryChartCard
            title="Umidade do Solo"
            data={chartData}
            dataKey="soil_humidity"
            unit="%"
            color="#0288d1"
            minLimit={rules?.min_soil_humidity}
            maxLimit={rules?.max_soil_humidity}
          />
        )}
        <HistoryChartCard
          title="Luz"
          data={chartData}
          dataKey="light_level"
          unit="%"
          color="#f57c00"
          minLimit={rules?.min_light_level}
          maxLimit={rules?.max_light_level}
        />
      </Box>

      <Paper sx={{ p: 2.5, borderRadius: 3, mt: 2, maxHeight: 460, overflow: 'auto' }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>Log de Execucao</Typography>
        <Divider sx={{ mb: 1.5 }} />
        {events.length === 0 ? (
          <Typography color="text.secondary" variant="body2">Nenhum evento ainda.</Typography>
        ) : (
          events.map((e, i) => (
            <Box key={i} sx={{ mb: 1.2, p: 1.2, borderRadius: 2, bgcolor: '#f4fbf7', borderLeft: '3px solid #0f6b4a' }}>
              <Typography variant="caption" color="text.secondary">{new Date(e.timestamp).toLocaleString('pt-BR')}</Typography>
              <Typography variant="body2" fontWeight={600} sx={{ mt: 0.2 }}>{e.message}</Typography>
            </Box>
          ))
        )}
      </Paper>
    </>
  )
}
