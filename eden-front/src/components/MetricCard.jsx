import React from 'react'
import { Box, Card, CardContent, Typography, Avatar, Stack } from '@mui/material'

export default function MetricCard({ icon, label, value, color }) {
  return (
    <Card sx={{ background: `linear-gradient(135deg,#fff 60%,${color}18)`, borderTop: `3px solid ${color}` }}>
      <CardContent sx={{ pb: '12px !important' }}>
        <Stack direction="row" alignItems="center" gap={0.8} sx={{ mb: 0.8 }}>
          <Avatar sx={{ bgcolor: `${color}20`, width: 32, height: 32 }}>
            {React.cloneElement(icon, { sx: { color, fontSize: 18 } })}
          </Avatar>
          <Typography variant="body2" color="text.secondary" fontWeight={600}>{label}</Typography>
        </Stack>
        <Typography variant="h5" fontWeight={800} sx={{ color }}>{value}</Typography>
      </CardContent>
    </Card>
  )
}
