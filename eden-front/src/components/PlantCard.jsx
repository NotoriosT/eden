import React from 'react'
import { Box, Card, CardContent, Typography, Stack, Chip, LinearProgress } from '@mui/material'
import LocalFloristIcon from '@mui/icons-material/LocalFlorist'
import WbTwilightIcon from '@mui/icons-material/WbTwilight'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import { PHASES, PRIMARY } from '../constants/ui'

function InfoChip({ icon, label, color }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderRadius: 2, bgcolor: `${color}12` }}>
      <Box sx={{ color, display: 'flex' }}>{icon}</Box>
      <Typography variant="caption" fontWeight={600} sx={{ color }}>{label}</Typography>
    </Box>
  )
}

export default function PlantCard({ plant }) {
  const phase = PHASES[plant.current_phase] || { label: plant.current_phase, color: '#666', bg: '#f5f5f5' }
  const daysSince = plant.planted_at ? Math.floor((Date.now() - new Date(plant.planted_at)) / 86400000) : null
  const harvestPct = daysSince != null && plant.expected_harvest_days ? Math.min(100, Math.round((daysSince / plant.expected_harvest_days) * 100)) : 0
  const daysToFlower = daysSince != null ? plant.expected_flowering_days - daysSince : null
  const daysToHarvest = daysSince != null ? plant.expected_harvest_days - daysSince : null

  return (
    <Card sx={{ borderRadius: 3, border: `1px solid ${phase.color}40`, overflow: 'hidden' }}>
      {plant.photo_base64 ? (
        <Box component="img" src={`data:image/jpeg;base64,${plant.photo_base64}`} sx={{ width: '100%', height: 160, objectFit: 'cover' }} />
      ) : (
        <Box sx={{ height: 80, background: `linear-gradient(135deg,${phase.bg},#fff)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LocalFloristIcon sx={{ fontSize: 40, color: phase.color, opacity: 0.6 }} />
        </Box>
      )}
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="h6" fontWeight={800} lineHeight={1.2}>{plant.name}</Typography>
            {plant.species && <Typography variant="body2" color="text.secondary" fontStyle="italic">{plant.species}</Typography>}
          </Box>
          <Chip label={phase.label} size="small" sx={{ bgcolor: phase.bg, color: phase.color, fontWeight: 700, border: `1px solid ${phase.color}50` }} />
        </Stack>
        {daysSince != null && (
          <Box sx={{ mt: 1.5 }}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">Progresso ate colheita</Typography>
              <Typography variant="caption" fontWeight={700} color="primary">Dia {daysSince}</Typography>
            </Stack>
            <LinearProgress variant="determinate" value={harvestPct} sx={{ borderRadius: 4, height: 6 }} />
          </Box>
        )}
        <Box sx={{ mt: 1.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.8 }}>
          <InfoChip icon={<WbTwilightIcon sx={{ fontSize: 14 }} />} label={daysToFlower != null ? (daysToFlower > 0 ? `Flores em ${daysToFlower}d` : 'Em floracao!') : `${plant.expected_flowering_days}d p/ flor`} color="#7b1fa2" />
          <InfoChip icon={<AccessTimeIcon sx={{ fontSize: 14 }} />} label={daysToHarvest != null ? (daysToHarvest > 0 ? `Colheita em ${daysToHarvest}d` : 'Pronta!') : `${plant.expected_harvest_days}d p/ colher`} color={PRIMARY} />
        </Box>
      </CardContent>
    </Card>
  )
}
