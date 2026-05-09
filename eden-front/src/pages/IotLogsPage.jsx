import React, { useMemo, useState } from 'react'
import { Box, Paper, Typography, Stack, Chip, TextField, MenuItem, Collapse, IconButton, Button, Divider, Alert } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt'

const LEVEL_STYLE = {
  warn:  { border: '#f57c00', bg: '#fff8f0', chip: 'warning' },
  error: { border: '#c62828', bg: '#fff0f0', chip: 'error'   },
  info:  { border: '#0288d1', bg: '#f0f8ff', chip: 'info'    },
  all:   { border: '#bdbdbd', bg: '#f7f7f7', chip: 'default' },
}

const TYPE_LABEL = {
  iot_log:       'IoT',
  iot_sync:      'Sync',
  automation:    'Auto',
  actuator:      'Atuador',
  actuator_mode: 'Modo',
  plant:         'Planta',
  plant_phase:   'Fase',
  plant_progress:'Progresso',
}

function parseLog(e) {
  const msg = String(e?.message || '')
  let level = 'all'
  let text = msg
  const m = msg.match(/^\[(info|warn|error)\]\s*(.*)$/i)
  if (m) {
    level = m[1].toLowerCase()
    text = m[2]
  }
  if (e?.type === 'iot_sync' && msg.toLowerCase().includes('ota')) level = 'info'
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { level, text, json, raw: e }
}

function LogEntry({ entry }) {
  const [open, setOpen] = useState(false)
  const { level, text, json, raw } = entry
  const style = LEVEL_STYLE[level] || LEVEL_STYLE.all
  const typeLabel = TYPE_LABEL[raw.type] || raw.type

  return (
    <Box sx={{ borderRadius: 1.5, border: `1px solid ${style.border}40`, bgcolor: style.bg, overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.2, py: 0.8, cursor: 'pointer', userSelect: 'none' }} onClick={() => setOpen(v => !v)}>
        <Chip size="small" label={level === 'all' ? typeLabel : level} color={LEVEL_STYLE[level]?.chip || 'default'} sx={{ minWidth: 52, fontWeight: 700, fontSize: '0.65rem' }} />
        <Chip size="small" variant="outlined" label={typeLabel} sx={{ fontWeight: 600, fontSize: '0.6rem', height: 18 }} />
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {new Date(raw.timestamp).toLocaleTimeString('pt-BR')}
        </Typography>
        <Typography variant="body2" sx={{ flex: 1, wordBreak: 'break-word', fontFamily: 'monospace', fontSize: '0.78rem' }}>
          {text}
        </Typography>
        <IconButton size="small" sx={{ p: 0 }}>
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Stack>
      <Collapse in={open}>
        <Box sx={{ px: 1.2, pb: 1, borderTop: `1px solid ${style.border}30` }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.4, mt: 0.6 }}>
            {new Date(raw.timestamp).toLocaleString('pt-BR')} · source: {raw.source || '-'} · type: {raw.type}
          </Typography>
          <Box component="pre" sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: '#1e1e1e', color: '#d4d4d4', fontSize: '0.72rem', overflow: 'auto', maxHeight: 220, fontFamily: 'monospace' }}>
            {json ? JSON.stringify(json, null, 2) : raw.message}
          </Box>
        </Box>
      </Collapse>
    </Box>
  )
}

export default function IotLogsPage({ events = [], otaRelease, publishOtaFirmware, uploadOtaFirmware }) {
  const [level, setLevel] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [otaFile, setOtaFile] = useState(null)
  const [otaVersion, setOtaVersion] = useState('')
  const [otaLoading, setOtaLoading] = useState(false)
  const [otaMsg, setOtaMsg] = useState('')

  const allLogs = useMemo(
    () => [...events].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map(parseLog),
    [events]
  )

  const filtered = useMemo(() => {
    let list = allLogs
    if (typeFilter !== 'all') list = list.filter(e => e.raw.type === typeFilter)
    if (level !== 'all') list = list.filter(e => e.level === level)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(e => e.text.toLowerCase().includes(q) || (e.raw.type || '').includes(q))
    }
    return list
  }, [allLogs, typeFilter, level, search])

  const counts = useMemo(() => ({
    warn:  allLogs.filter(e => e.level === 'warn').length,
    error: allLogs.filter(e => e.level === 'error').length,
  }), [allLogs])

  const eventTypes = useMemo(() => {
    const types = [...new Set(events.map(e => e?.type).filter(Boolean))]
    return types.sort()
  }, [events])

  async function handleUpload() {
    if (!otaFile || !uploadOtaFirmware) return
    setOtaLoading(true)
    setOtaMsg('')
    try {
      await uploadOtaFirmware({ file: otaFile, version: otaVersion })
      setOtaMsg('Upload OK — agora clique Publicar para enviar ao ESP.')
      setOtaFile(null)
      setOtaVersion('')
    } catch (e) {
      setOtaMsg('Erro no upload: ' + (e?.message || 'falha'))
    } finally {
      setOtaLoading(false)
    }
  }

  async function handlePublish() {
    if (!publishOtaFirmware || !otaRelease?.version) return
    setOtaLoading(true)
    setOtaMsg('')
    try {
      await publishOtaFirmware(otaRelease.version)
      setOtaMsg(`OTA v${otaRelease.version} enviado ao ESP. Acompanhe os logs abaixo.`)
      setSearch('ota')
    } catch (e) {
      setOtaMsg('Erro ao publicar: ' + (e?.message || 'falha'))
    } finally {
      setOtaLoading(false)
    }
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1.2 }}>
          <SystemUpdateAltIcon color="primary" />
          <Typography variant="subtitle1" fontWeight={700}>OTA Firmware</Typography>
          <Chip size="small" label={otaRelease?.version ? `v${otaRelease.version} pronto` : 'sem firmware'} color={otaRelease?.version ? 'success' : 'default'} />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems="flex-start">
          <Button variant="outlined" component="label" size="small" disabled={otaLoading}>
            {otaFile ? otaFile.name : 'Selecionar .bin'}
            <input hidden type="file" accept=".bin,application/octet-stream" onChange={e => setOtaFile(e.target.files?.[0] || null)} />
          </Button>
          <TextField size="small" label="Versão" value={otaVersion} onChange={e => setOtaVersion(e.target.value)} placeholder="ex: 3" sx={{ width: 110 }} />
          <Button variant="contained" size="small" disabled={!otaFile || otaLoading} onClick={handleUpload}>
            {otaLoading ? 'Enviando...' : 'Enviar .bin'}
          </Button>
          <Divider orientation="vertical" flexItem />
          <Button variant="contained" size="small" color="warning" disabled={!otaRelease?.version || otaLoading} onClick={handlePublish} startIcon={<SystemUpdateAltIcon />}>
            {otaLoading ? 'Publicando...' : `Publicar v${otaRelease?.version ?? '?'} no ESP`}
          </Button>
        </Stack>
        {otaMsg && <Alert severity={otaMsg.startsWith('Erro') ? 'error' : 'success'} sx={{ mt: 1 }} onClose={() => setOtaMsg('')}>{otaMsg}</Alert>}
      </Paper>

      <Paper sx={{ p: 2.5, borderRadius: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Stack direction="row" alignItems="center" gap={1}>
            <Typography variant="h6" fontWeight={800}>Todos os Logs</Typography>
            <Chip size="small" label={`${filtered.length} / ${allLogs.length}`} />
            {counts.error > 0 && <Chip size="small" label={`${counts.error} erros`} color="error" />}
            {counts.warn  > 0 && <Chip size="small" label={`${counts.warn} avisos`} color="warning" />}
          </Stack>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ mb: 1.5 }}>
          <TextField select size="small" label="Tipo" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} sx={{ width: 150 }}>
            <MenuItem value="all">Todos os tipos</MenuItem>
            {eventTypes.map(t => <MenuItem key={t} value={t}>{TYPE_LABEL[t] || t}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Nível" value={level} onChange={e => setLevel(e.target.value)} sx={{ width: 130 }}>
            <MenuItem value="all">Todos</MenuItem>
            <MenuItem value="info">Info</MenuItem>
            <MenuItem value="warn">Warn</MenuItem>
            <MenuItem value="error">Error</MenuItem>
          </TextField>
          <TextField size="small" label="Buscar" value={search} onChange={e => setSearch(e.target.value)} placeholder="ota, bootstrap, mqtt..." sx={{ flex: 1 }} />
        </Stack>

        {filtered.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Sem logs para este filtro.</Typography>
        ) : (
          <Box sx={{ display: 'grid', gap: 0.6, maxHeight: '60vh', overflow: 'auto', pr: 0.5 }}>
            {filtered.map((e, idx) => (
              <LogEntry key={`${e.raw.timestamp || 't'}-${idx}`} entry={e} />
            ))}
          </Box>
        )}
      </Paper>
    </Box>
  )
}
