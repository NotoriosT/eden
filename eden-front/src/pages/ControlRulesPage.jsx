import React, { useState } from 'react'
import {
  Box, Paper, Typography, Stack, Button, Chip, Collapse, TextField,
  Divider, FormControlLabel, Switch, MenuItem, InputAdornment, IconButton,
} from '@mui/material'
import BoltIcon from '@mui/icons-material/Bolt'
import FlashOnIcon from '@mui/icons-material/FlashOn'
import TuneIcon from '@mui/icons-material/Tune'
import AddIcon from '@mui/icons-material/Add'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna'
import ActCard from '../components/ActCard'
import RuleCard from '../components/RuleCard'
import { ACTUATORS, RULE_TYPES, SENSORS, COMPARISON_OPS, DEVICES, PRIMARY, EMPTY_RULE, WEEK_DAYS } from '../constants/ui'

const GPIO_OPTIONS = [
  { value: '', label: 'Sem porta' },
  { value: 'GPIO2', label: 'GPIO2 (strap/boot)' },
  { value: 'GPIO4', label: 'GPIO4' },
  { value: 'GPIO5', label: 'GPIO5' },
  { value: 'GPIO12', label: 'GPIO12 (strap/boot)' },
  { value: 'GPIO13', label: 'GPIO13' },
  { value: 'GPIO14', label: 'GPIO14' },
  { value: 'GPIO15', label: 'GPIO15 (strap/boot)' },
  { value: 'GPIO16', label: 'GPIO16' },
  { value: 'GPIO17', label: 'GPIO17' },
  { value: 'GPIO18', label: 'GPIO18' },
  { value: 'GPIO19', label: 'GPIO19' },
  { value: 'GPIO21', label: 'GPIO21' },
  { value: 'GPIO22', label: 'GPIO22' },
  { value: 'GPIO23', label: 'GPIO23' },
  { value: 'GPIO25', label: 'GPIO25' },
  { value: 'GPIO26', label: 'GPIO26' },
  { value: 'GPIO27', label: 'GPIO27' },
  { value: 'GPIO32', label: 'GPIO32 (ADC)' },
  { value: 'GPIO33', label: 'GPIO33 (ADC)' },
  { value: 'GPIO34', label: 'GPIO34 (ADC, entrada apenas)', inputOnly: true, adc1: true },
  { value: 'GPIO35', label: 'GPIO35 (ADC, entrada apenas)', inputOnly: true, adc1: true },
  { value: 'GPIO36', label: 'GPIO36 (ADC, entrada apenas)', inputOnly: true, adc1: true },
  { value: 'GPIO39', label: 'GPIO39 (ADC, entrada apenas)', inputOnly: true, adc1: true },
]

const ADC1_SENSOR_GPIOS = new Set(['GPIO32', 'GPIO33', 'GPIO34', 'GPIO35', 'GPIO36', 'GPIO39'])
const DHT_SENSOR_KEYS = new Set(['TEMPERATURA', 'UMIDADE_AR'])
const ADC_SENSOR_KEYS = new Set(['UMIDADE_SOLO', 'LUMINOSIDADE'])
const MAX_SOIL_SENSORS = 4

function SLabel({ children }) {
  return <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 800, fontSize: '0.68rem', letterSpacing: 1.3, color: PRIMARY, pl: 1.2, borderLeft: `3px solid ${PRIMARY}` }}>{children}</Typography>
}
function SBox({ children, sx }) {
  return <Box sx={{ p: 1.5, bgcolor: '#f5fbf8', borderRadius: 2, border: '1px solid #d4ece3', ...sx }}>{children}</Box>
}
function DeviceSelect({ value, onChange, label = 'Dispositivo' }) {
  return <TextField select size="small" label={label} value={value} onChange={e => onChange(e.target.value)} sx={{ flex: 1 }}>{DEVICES.map(d => <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}</TextField>
}
function CommandSelect({ value, onChange, label = 'Comando' }) {
  return <TextField select size="small" label={label} value={value} onChange={e => onChange(e.target.value)} sx={{ width: 140 }}><MenuItem value="LIGAR">Ligar</MenuItem><MenuItem value="DESLIGAR">Desligar</MenuItem></TextField>
}

function PortSelect({ value, onChange, usedPorts, label = 'Porta GPIO', kind = 'actuator', sensorKey = '' }) {
  const options = GPIO_OPTIONS.filter(opt => {
    if (!opt.value) return true
    if (kind === 'actuator') return !opt.inputOnly
    if (kind === 'sensor' && ADC_SENSOR_KEYS.has(sensorKey)) return ADC1_SENSOR_GPIOS.has(opt.value)
    if (kind === 'sensor' && DHT_SENSOR_KEYS.has(sensorKey)) return !opt.inputOnly
    return true
  })

  return (
    <TextField select size="small" label={label} value={value || ''} onChange={e => onChange(e.target.value)}>
      {options.map(opt => (
        <MenuItem key={opt.value || 'none'} value={opt.value} disabled={!!opt.value && usedPorts.includes(opt.value) && opt.value !== value}>
          {opt.label}
        </MenuItem>
      ))}
    </TextField>
  )
}

function ActionRows({ title, value, onChange }) {
  const add = () => onChange([...(value || []), { dispositivo: 'EXAUSTAO', comando: 'LIGAR' }])
  const remove = idx => onChange((value || []).filter((_, i) => i !== idx))
  const update = (idx, field, v) => onChange((value || []).map((a, i) => i === idx ? { ...a, [field]: v } : a))

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.8 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>{title}</Typography>
        <Button size="small" onClick={add} startIcon={<AddIcon fontSize="small" />}>Adicionar ação</Button>
      </Stack>
      <Box sx={{ display: 'grid', gap: 1 }}>
        {(value || []).map((a, idx) => (
          <Box key={idx} sx={{ p: 1, border: '1px solid #e1ebe7', borderRadius: 2 }}>
            <Stack direction="row" gap={1} alignItems="center">
              <DeviceSelect value={a.dispositivo} onChange={v => update(idx, 'dispositivo', v)} />
              <CommandSelect value={a.comando} onChange={v => update(idx, 'comando', v)} />
              <IconButton color="error" onClick={() => remove(idx)}><DeleteOutlineIcon fontSize="small" /></IconButton>
            </Stack>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

function SoilSensorPorts({ deviceMap, saveDeviceMap, usedPorts }) {
  const soilKeys = Object.keys(deviceMap?.sensor_ports || {})
    .filter(k => /^UMIDADE_SOLO_\d+$/.test(k))
    .sort((a, b) => {
      const na = parseInt(a.replace('UMIDADE_SOLO_', ''), 10)
      const nb = parseInt(b.replace('UMIDADE_SOLO_', ''), 10)
      return na - nb
    })

  function addSoil() {
    const indices = soilKeys.map(k => parseInt(k.replace('UMIDADE_SOLO_', ''), 10))
    const next = indices.length > 0 ? Math.max(...indices) + 1 : 1
    const key = `UMIDADE_SOLO_${next}`
    saveDeviceMap({ ...deviceMap, sensor_ports: { ...(deviceMap.sensor_ports || {}), [key]: '' } })
  }

  function removeSoil(key) {
    const sp = { ...(deviceMap.sensor_ports || {}) }
    delete sp[key]
    saveDeviceMap({ ...deviceMap, sensor_ports: sp })
  }

  function setSoil(key, v) {
    saveDeviceMap({ ...deviceMap, sensor_ports: { ...(deviceMap.sensor_ports || {}), [key]: v } })
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.8 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>Sensores de Solo (ADC)</Typography>
        <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={addSoil} disabled={soilKeys.length >= MAX_SOIL_SENSORS}>
          Adicionar
        </Button>
      </Stack>
      {soilKeys.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 0.5 }}>
          Nenhum sensor de solo configurado. Clique em Adicionar.
        </Typography>
      )}
      <Box sx={{ display: 'grid', gap: 1 }}>
        {soilKeys.map((key) => (
          <Stack key={key} direction="row" alignItems="center" gap={1}>
            <Typography variant="caption" sx={{ minWidth: 130, fontWeight: 600 }}>{key}</Typography>
            <PortSelect
              kind="sensor"
              sensorKey="UMIDADE_SOLO"
              value={deviceMap.sensor_ports[key] || ''}
              onChange={v => setSoil(key, v)}
              usedPorts={usedPorts}
            />
            <IconButton size="small" color="error" onClick={() => removeSoil(key)}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
      </Box>
    </Box>
  )
}

function validateRuleForm(rf) {
  const validateList = (list, label) => {
    if (!list || list.length === 0) return `${label}: adicione ao menos 1 ação`
    const byDev = {}
    for (const a of list) {
      if (!a.dispositivo || !a.comando) return `${label}: ação incompleta`
      if (byDev[a.dispositivo] && byDev[a.dispositivo] !== a.comando) {
        return `${label}: conflito no dispositivo ${a.dispositivo}`
      }
      byDev[a.dispositivo] = a.comando
    }
    return null
  }

  if (rf.tipo_parametro === 'LIMITE') {
    const err = validateList(rf.acoes_abaixo_minimo, 'Abaixo do mínimo') || validateList(rf.acoes_acima_maximo, 'Acima do máximo')
    if (err) return err
    const abaixo = {}
    for (const a of (rf.acoes_abaixo_minimo || [])) abaixo[a.dispositivo] = a.comando
    for (const a of (rf.acoes_acima_maximo || [])) {
      if (abaixo[a.dispositivo] && abaixo[a.dispositivo] === a.comando) {
        return `Atenção: "${a.dispositivo}" tem o mesmo comando (${a.comando}) abaixo do mínimo E acima do máximo. As ações devem ser opostas (ex: LIGAR abaixo, DESLIGAR acima).`
      }
    }
    return null
  }
  return validateList(rf.acoes, 'Ações')
}

const ACTUATOR_DEVICE_BY_KEY = {
  exhaust_on: 'EXAUSTAO',
  irrigation_on: 'IRRIGACAO',
  humidifier_on: 'UMIDIFICADOR',
  dehumidifier_on: 'DESUMIDIFICADOR',
  heater_on: 'AQUECEDOR',
  light_on: 'LUZ',
}

export default function ControlRulesPage(props) {
  const { act, saveAct, patchAct, setActuatorMode, showRuleForm, setShowRuleForm, ruleForm, setRuleForm, saveRule, savingRule, automationRules, deleteRule, editRule, deviceMap, saveDeviceMap, otaRelease, uploadOtaFirmware, publishOtaFirmware, events = [] } = props

  const rf = ruleForm
  const setRF = (k, v) => setRuleForm(f => ({ ...f, [k]: v }))
  const tipo = rf.tipo_parametro
  const needsSensor = tipo === 'COMPARACAO' || tipo === 'LIMITE'
  const needsHorario = tipo === 'HORARIO' || tipo === 'DIA_SEMANA'
  const needsDuracao = tipo === 'HORARIO' || tipo === 'DIA_SEMANA' || tipo === 'TEMPO'
  const selectedType = RULE_TYPES.find(t => t.value === tipo) || RULE_TYPES[0]
  const sensorUnit = SENSORS.find(s => s.value === rf.variavel_sensor)?.unit || ''

  const onSave = () => {
    const err = validateRuleForm(rf)
    if (err) {
      alert(err)
      return
    }
    saveRule()
  }

  const setSensorPort = (k, v) => saveDeviceMap({ ...deviceMap, sensor_ports: { ...(deviceMap.sensor_ports || {}), [k]: v } })
  const setActuatorPort = (k, v) => saveDeviceMap({ ...deviceMap, actuator_ports: { ...(deviceMap.actuator_ports || {}), [k]: v } })
  const usedMapPorts = [
    ...Object.values(deviceMap?.sensor_ports || {}),
    ...Object.values(deviceMap?.actuator_ports || {}),
  ].filter(Boolean)
  const [otaFile, setOtaFile] = useState(null)
  const [otaVersion, setOtaVersion] = useState('')
  const [otaDescription, setOtaDescription] = useState('')
  const [otaLoading, setOtaLoading] = useState(false)
  const iotLogs = events.filter(e => e?.type === 'iot_log').slice(0, 10)
  const activeRuleDevices = new Set((automationRules || [])
    .filter(r => r?.enabled)
    .flatMap(r => [
      ...(Array.isArray(r?.acoes) ? r.acoes : []),
      ...(Array.isArray(r?.acoes_abaixo_minimo) ? r.acoes_abaixo_minimo : []),
      ...(Array.isArray(r?.acoes_acima_maximo) ? r.acoes_acima_maximo : []),
      ...(Array.isArray(r?.acoes_abaixo) ? r.acoes_abaixo : []),
      ...(Array.isArray(r?.acoes_acima) ? r.acoes_acima : []),
    ])
    .map(a => a?.dispositivo)
    .filter(Boolean))

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
      <Box sx={{ display: 'grid', gap: 2, alignContent: 'start' }}>
        <Paper sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 2 }}>
            <BoltIcon color="warning" />
            <Typography variant="subtitle1" fontWeight={700}>Controle Manual</Typography>
            {act && <Chip size="small" label={`${ACTUATORS.filter(a => act[a.key]).length} ligados`} color={ACTUATORS.filter(a => act[a.key]).length > 0 ? 'warning' : 'default'} />}
            {act?.source && <Chip size="small" label={`origem: ${act.source}`} color={(act.source === 'manual' || act.source === 'manual_lock') ? 'primary' : 'default'} />}
          </Stack>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Typography variant="body2" fontWeight={600}>Modo manual travado (pausa automação)</Typography>
            <Switch
              size="small"
              checked={act?.source === 'manual_lock'}
              onChange={async (_, checked) => {
                try {
                  await setActuatorMode(checked ? 'manual' : 'auto')
                } catch (e) {
                  alert(e?.message || 'Falha ao alterar modo')
                }
              }}
            />
          </Stack>
          <Typography variant="caption" sx={{ display: 'block', mb: 1.2, color: '#8d6e63', fontWeight: 700 }}>
            Se existir regra ativa para um atuador, o botão manual dele fica bloqueado. Desative a regra para liberar.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1.2 }}>
            {act && ACTUATORS.map(a => {
              const device = ACTUATOR_DEVICE_BY_KEY[a.key]
              const blockedByRule = activeRuleDevices.has(device)
              return (
                <ActCard
                  key={a.key}
                  icon={a.icon}
                  label={a.label}
                  color={a.color}
                  active={!!act[a.key]}
                  disabled={blockedByRule}
                  disabledLabel={blockedByRule ? 'BLOQ. POR REGRA' : ''}
                  onChange={v => patchAct ? patchAct(device, v) : saveAct({ ...act, [a.key]: v })}
                />
              )
            })}
          </Box>
        </Paper>

        <Paper sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" alignItems="center" gap={1}><FlashOnIcon color="primary" /><Typography variant="subtitle1" fontWeight={700}>{rf.id ? 'Editar Regra de Automação' : 'Nova Regra de Automação'}</Typography></Stack>
            <Button size="small" variant={showRuleForm ? 'outlined' : 'contained'} startIcon={showRuleForm ? <ExpandLessIcon /> : <AddIcon />} onClick={() => { setShowRuleForm(v => !v); if (showRuleForm) setRuleForm(EMPTY_RULE) }} sx={{ borderRadius: 3 }}>{showRuleForm ? 'Cancelar' : 'Criar'}</Button>
          </Stack>
          <Collapse in={showRuleForm}>
            <Box sx={{ display: 'grid', gap: 2, mt: 2.5 }}>
              <Box>
                <SLabel>1 TIPO DE REGRA</SLabel>
                <TextField select size="small" label="Tipo" fullWidth value={rf.tipo_parametro} onChange={e => setRF('tipo_parametro', e.target.value)} sx={{ mb: 1 }}>
                  {RULE_TYPES.map(rt => <MenuItem key={rt.value} value={rt.value}>{rt.label}</MenuItem>)}
                </TextField>
                <Box sx={{ px: 1, py: 0.6, bgcolor: `${selectedType.color}10`, borderRadius: 1.5, border: `1px solid ${selectedType.color}30` }}><Typography variant="caption" sx={{ color: selectedType.color, fontWeight: 600 }}>{selectedType.desc}</Typography></Box>
              </Box>

              <Box><SLabel>2 NOME DA REGRA</SLabel><TextField size="small" placeholder="Ex: Ligar exaustão por calor" fullWidth value={rf.name} onChange={e => setRF('name', e.target.value)} /></Box>

              <SBox>
                <SLabel>3 PARÂMETROS</SLabel>
                <Box sx={{ display: 'grid', gap: 1.5 }}>
                  {needsSensor && <TextField select size="small" label="Variável do sensor" value={rf.variavel_sensor} onChange={e => setRF('variavel_sensor', e.target.value)}>{SENSORS.map(s => <MenuItem key={s.value} value={s.value}>{s.label} ({s.unit})</MenuItem>)}</TextField>}
                  {tipo === 'COMPARACAO' && <Box sx={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 1 }}><TextField select size="small" label="Condição" value={rf.operador} onChange={e => setRF('operador', e.target.value)}>{COMPARISON_OPS.map(op => <MenuItem key={op.value} value={op.value}>{op.label}</MenuItem>)}</TextField><TextField size="small" type="number" label="Valor" value={rf.valor} onChange={e => setRF('valor', e.target.value)} InputProps={{ endAdornment: <InputAdornment position="end">{sensorUnit}</InputAdornment> }} /></Box>}
                  {tipo === 'LIMITE' && <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}><TextField size="small" type="number" label="Valor mínimo" value={rf.valor_minimo} onChange={e => setRF('valor_minimo', e.target.value)} InputProps={{ endAdornment: <InputAdornment position="end">{sensorUnit}</InputAdornment> }} /><TextField size="small" type="number" label="Valor máximo" value={rf.valor_maximo} onChange={e => setRF('valor_maximo', e.target.value)} InputProps={{ endAdornment: <InputAdornment position="end">{sensorUnit}</InputAdornment> }} /></Box>}
                  {tipo === 'DIA_SEMANA' && <Box><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8, fontWeight: 600 }}>Dias da semana</Typography><Stack direction="row" gap={0.5} sx={{ flexWrap: 'wrap' }}>{WEEK_DAYS.map((d, i) => { const sel = rf.dias_semana.includes(i); return <Chip key={i} label={d} clickable size="small" onClick={() => setRF('dias_semana', sel ? rf.dias_semana.filter(x => x !== i) : [...rf.dias_semana, i].sort((a, b) => a - b))} sx={{ fontWeight: 800, minWidth: 38, bgcolor: sel ? '#0f6b4a18' : '#eee', border: `2px solid ${sel ? PRIMARY : 'transparent'}`, color: sel ? PRIMARY : '#666' }} /> })}</Stack></Box>}
                  {needsHorario && <TextField size="small" type="time" label="Horário de execução" value={rf.horario} onChange={e => setRF('horario', e.target.value)} InputLabelProps={{ shrink: true }} />}
                  {tipo === 'TEMPO' && <TextField size="small" type="number" label="Repetir a cada (minutos)" helperText="Ex: 30 = meia hora · 360 = 6 horas" value={rf.intervalo_minutos} onChange={e => setRF('intervalo_minutos', e.target.value)} />}
                  {needsDuracao && (
                    <TextField
                      size="small"
                      type="text"
                      label="Duração"
                      placeholder="Ex: 90, 10s, 01:30 ou 00:00:10"
                      helperText="Aceita minutos, sufixo s (ex: 10s) ou HH:MM / HH:MM:SS. 0 = sem desligar automaticamente."
                      value={rf.duracao_minutos}
                      onChange={e => setRF('duracao_minutos', e.target.value)}
                    />
                  )}
                </Box>
              </SBox>

              <SBox>
                <SLabel>4 AÇÃO</SLabel>
                {tipo !== 'LIMITE' && <ActionRows title="Ações" value={rf.acoes} onChange={v => setRF('acoes', v)} />}
                {tipo === 'LIMITE' && (
                  <Box sx={{ display: 'grid', gap: 1.5 }}>
                    <ActionRows title={<Stack direction="row" alignItems="center" gap={0.6}><ArrowDownwardIcon sx={{ fontSize: 15, color: '#1565c0' }} /><span>Abaixo do mínimo</span></Stack>} value={rf.acoes_abaixo_minimo} onChange={v => setRF('acoes_abaixo_minimo', v)} />
                    <Divider />
                    <ActionRows title={<Stack direction="row" alignItems="center" gap={0.6}><ArrowUpwardIcon sx={{ fontSize: 15, color: '#c62828' }} /><span>Acima do máximo</span></Stack>} value={rf.acoes_acima_maximo} onChange={v => setRF('acoes_acima_maximo', v)} />
                  </Box>
                )}
              </SBox>

              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <FormControlLabel control={<Switch size="small" checked={rf.enabled} onChange={e => setRF('enabled', e.target.checked)} />} label={<Typography variant="body2" fontWeight={600}>Habilitada ao salvar</Typography>} />
                <Button variant="contained" onClick={onSave} disabled={savingRule || !rf.name.trim()} sx={{ borderRadius: 3, px: 3.5, py: 1.2, fontWeight: 800, fontSize: '0.88rem', background: `linear-gradient(135deg, ${PRIMARY}, #1a8f63)`, boxShadow: `0 4px 12px ${PRIMARY}50` }}>{savingRule ? 'Salvando...' : (rf.id ? 'Atualizar Regra' : 'Salvar Regra')}</Button>
              </Stack>
            </Box>
          </Collapse>
        </Paper>

        <Paper sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1.5 }}>
            <SettingsInputAntennaIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>Mapeamento de Portas (dinâmico)</Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">ESP usa esse mapa no bootstrap para saber em qual porta está cada sensor/atuador.</Typography>
          <Box sx={{ mt: 1.5, display: 'grid', gap: 1.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Sensores</Typography>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
              <PortSelect label="TEMPERATURA" kind="sensor" sensorKey="TEMPERATURA" value={deviceMap?.sensor_ports?.TEMPERATURA || ''} onChange={v => setSensorPort('TEMPERATURA', v)} usedPorts={usedMapPorts} />
              <PortSelect label="UMIDADE_AR" kind="sensor" sensorKey="UMIDADE_AR" value={deviceMap?.sensor_ports?.UMIDADE_AR || ''} onChange={v => setSensorPort('UMIDADE_AR', v)} usedPorts={usedMapPorts} />
              <PortSelect label="LUMINOSIDADE" kind="sensor" sensorKey="LUMINOSIDADE" value={deviceMap?.sensor_ports?.LUMINOSIDADE || ''} onChange={v => setSensorPort('LUMINOSIDADE', v)} usedPorts={usedMapPorts} />
            </Box>
            <SoilSensorPorts deviceMap={deviceMap} saveDeviceMap={saveDeviceMap} usedPorts={usedMapPorts} />
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Atuadores</Typography>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
              <PortSelect label="EXAUSTAO" kind="actuator" value={deviceMap?.actuator_ports?.EXAUSTAO || ''} onChange={v => setActuatorPort('EXAUSTAO', v)} usedPorts={usedMapPorts} />
              <PortSelect label="IRRIGACAO" kind="actuator" value={deviceMap?.actuator_ports?.IRRIGACAO || ''} onChange={v => setActuatorPort('IRRIGACAO', v)} usedPorts={usedMapPorts} />
              <PortSelect label="UMIDIFICADOR" kind="actuator" value={deviceMap?.actuator_ports?.UMIDIFICADOR || ''} onChange={v => setActuatorPort('UMIDIFICADOR', v)} usedPorts={usedMapPorts} />
              <PortSelect label="DESUMIDIFICADOR" kind="actuator" value={deviceMap?.actuator_ports?.DESUMIDIFICADOR || ''} onChange={v => setActuatorPort('DESUMIDIFICADOR', v)} usedPorts={usedMapPorts} />
              <PortSelect label="AQUECEDOR" kind="actuator" value={deviceMap?.actuator_ports?.AQUECEDOR || ''} onChange={v => setActuatorPort('AQUECEDOR', v)} usedPorts={usedMapPorts} />
              <PortSelect label="LUZ" kind="actuator" value={deviceMap?.actuator_ports?.LUZ || ''} onChange={v => setActuatorPort('LUZ', v)} usedPorts={usedMapPorts} />
            </Box>
          </Box>
        </Paper>

        <Paper sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1.5 }}>
            <BoltIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>OTA Firmware</Typography>
            <Chip size="small" label={otaRelease?.version ? `v${otaRelease.version}` : 'sem release'} color={otaRelease?.version ? 'success' : 'default'} />
          </Stack>
          <Typography variant="caption" color="text.secondary">Envie um .bin e publique para o ESP baixar via OTA.</Typography>
          <Box sx={{ mt: 1.5, display: 'grid', gap: 1.2 }}>
            <Button variant="outlined" component="label">
              {otaFile ? `Arquivo: ${otaFile.name}` : 'Selecionar firmware .bin'}
              <input hidden type="file" accept=".bin,application/octet-stream" onChange={e => setOtaFile(e.target.files?.[0] || null)} />
            </Button>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
              <TextField size="small" label="Versão (opcional)" value={otaVersion} onChange={e => setOtaVersion(e.target.value)} placeholder="ex: 2" />
              <TextField size="small" label="Descrição (opcional)" value={otaDescription} onChange={e => setOtaDescription(e.target.value)} placeholder="ex: release de regras" />
            </Box>
            <Stack direction="row" gap={1}>
              <Button
                variant="contained"
                disabled={!otaFile || otaLoading}
                onClick={async () => {
                  try {
                    setOtaLoading(true)
                    await uploadOtaFirmware({ file: otaFile, version: otaVersion, description: otaDescription })
                    setOtaFile(null)
                    setOtaVersion('')
                    setOtaDescription('')
                    alert('Firmware enviado com sucesso.')
                  } catch (e) {
                    alert(e?.message || 'Falha no upload OTA')
                  } finally {
                    setOtaLoading(false)
                  }
                }}
              >
                {otaLoading ? 'Enviando...' : 'Enviar OTA'}
              </Button>
              <Button
                variant="outlined"
                disabled={!otaRelease?.version || otaLoading}
                onClick={async () => {
                  try {
                    setOtaLoading(true)
                    await publishOtaFirmware(otaRelease?.version)
                    alert(`OTA v${otaRelease?.version} publicada para o ESP.`)
                  } catch (e) {
                    alert(e?.message || 'Falha ao publicar OTA')
                  } finally {
                    setOtaLoading(false)
                  }
                }}
              >
                Publicar OTA
              </Button>
            </Stack>
          </Box>
        </Paper>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, alignContent: 'start' }}>
        <Paper sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 2 }}><TuneIcon color="primary" /><Typography variant="subtitle1" fontWeight={700}>Regras Cadastradas</Typography><Chip label={automationRules.length} size="small" color="primary" /></Stack>
          {automationRules.length === 0 ? <Box sx={{ textAlign: 'center', py: 5 }}><FlashOnIcon sx={{ fontSize: 52, color: '#b0bec5', mb: 1 }} /><Typography color="text.secondary" variant="body2" fontWeight={600}>Nenhuma regra criada ainda.</Typography><Typography color="text.secondary" variant="caption">Clique em "Criar" para começar.</Typography></Box> : <Box sx={{ display: 'grid', gap: 1 }}>{automationRules.map(rule => <RuleCard key={rule.id} rule={rule} onDelete={deleteRule} onEdit={editRule} />)}</Box>}
        </Paper>

        <Paper sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.2 }}>
            <Typography variant="subtitle1" fontWeight={700}>Logs IoT (MQTT)</Typography>
            <Chip size="small" label={iotLogs.length} />
          </Stack>
          {iotLogs.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Sem logs IoT recebidos ainda.</Typography>
          ) : (
            <Box sx={{ display: 'grid', gap: 0.8 }}>
              {iotLogs.map((e, idx) => (
                <Box key={`${e.timestamp || 't'}-${idx}`} sx={{ p: 1, borderRadius: 1.5, bgcolor: '#f7f7f7' }}>
                  <Typography variant="caption" color="text.secondary">{new Date(e.timestamp).toLocaleString()}</Typography>
                  <Typography variant="body2">{e.message}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  )
}

