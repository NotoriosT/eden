import React from 'react'
import { Box, Paper, Stack, Typography, Chip, Button } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditIcon from '@mui/icons-material/Edit'
import { RULE_TYPES, SENSORS, COMPARISON_OPS, DEVICES, WEEK_DAYS } from '../constants/ui'

export default function RuleCard({ rule, onDelete, onEdit }) {
  const typeInfo = RULE_TYPES.find(t => t.value === rule.tipo_parametro) || RULE_TYPES[0]
  const sensor = SENSORS.find(s => s.value === rule.variavel_sensor)
  const opLabel = v => COMPARISON_OPS.find(o => o.value === v)?.label?.replace(/\s*\(.*\)/, '') || v
  const devLabel = v => DEVICES.find(d => d.value === v)?.label || v

  const listToText = (arr = []) => arr.map(a => `${devLabel(a.dispositivo)} ${a.comando}`).join(' + ')
  const durationLabel = () => {
    const sec = Number(rule?.duracao_segundos || 0)
    if (sec > 0) {
      if (sec % 60 === 0) return `${sec / 60}min`
      return `${sec}s`
    }
    const min = Number(rule?.duracao_minutos || 0)
    if (min > 0) return `${min}min`
    return ''
  }

  const summary = () => {
    const acoes = rule.acoes?.length ? rule.acoes : (rule.dispositivo && rule.comando ? [{ dispositivo: rule.dispositivo, comando: rule.comando }] : [])
    const abaixo = rule.acoes_abaixo_minimo?.length ? rule.acoes_abaixo_minimo : (rule.acao_abaixo_minimo ? [rule.acao_abaixo_minimo] : [])
    const acima = rule.acoes_acima_maximo?.length ? rule.acoes_acima_maximo : (rule.acao_acima_maximo ? [rule.acao_acima_maximo] : [])

    switch (rule.tipo_parametro) {
      case 'COMPARACAO':
        return `Se ${sensor?.label || rule.variavel_sensor} ${opLabel(rule.operador)} ${rule.valor}${sensor?.unit || ''} -> ${listToText(acoes)}`
      case 'LIMITE':
        return `${sensor?.label}: < ${rule.valor_minimo} -> ${listToText(abaixo)} | > ${rule.valor_maximo} -> ${listToText(acima)}`
      case 'HORARIO':
        return `${listToText(acoes)} as ${rule.horario}${durationLabel() ? ` · ${durationLabel()}` : ''}`
      case 'DIA_SEMANA': {
        const dias = (rule.dias_semana || []).map(d => WEEK_DAYS[d]).join(', ')
        return `${listToText(acoes)} · ${dias} as ${rule.horario}${durationLabel() ? ` · ${durationLabel()}` : ''}`
      }
      case 'TEMPO':
        return `${listToText(acoes)} a cada ${rule.intervalo_minutos}min${durationLabel() ? ` · por ${durationLabel()}` : ''}`
      default:
        return ''
    }
  }

  const hasRun = rule.last_run_at && rule.last_run_at !== '0001-01-01T00:00:00Z'

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, borderLeft: `3px solid ${typeInfo.color}`, '&:hover': { boxShadow: 2 } }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" gap={0.7} sx={{ mb: 0.5, flexWrap: 'wrap' }}>
            <Box sx={{ color: typeInfo.color, display: 'flex', '& svg': { fontSize: 15 } }}>{typeInfo.icon}</Box>
            <Typography variant="body2" fontWeight={800}>{rule.name}</Typography>
            <Chip label={typeInfo.label} size="small" sx={{ fontSize: '0.62rem', height: 17, bgcolor: `${typeInfo.color}12`, color: typeInfo.color, fontWeight: 700 }} />
            <Chip label={rule.enabled ? 'ATIVA' : 'INATIVA'} size="small" color={rule.enabled ? 'success' : 'default'} sx={{ fontSize: '0.62rem', height: 17 }} />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.5 }}>{summary()}</Typography>
          {hasRun && <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.3, fontSize: '0.62rem' }}>Ultima execucao: {new Date(rule.last_run_at).toLocaleString('pt-BR')}</Typography>}
        </Box>
        <Stack direction="row" gap={0.4}>
          <Button size="small" color="primary" onClick={() => onEdit(rule)} sx={{ minWidth: 'auto', p: 0.5, borderRadius: 2, opacity: 0.7, '&:hover': { opacity: 1 } }}>
            <EditIcon fontSize="small" />
          </Button>
          <Button size="small" color="error" onClick={() => onDelete(rule.id)} sx={{ minWidth: 'auto', p: 0.5, borderRadius: 2, opacity: 0.7, '&:hover': { opacity: 1 } }}>
            <DeleteOutlineIcon fontSize="small" />
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}
