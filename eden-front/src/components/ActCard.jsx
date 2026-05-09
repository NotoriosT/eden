import React from 'react'
import { Paper, Avatar, Typography } from '@mui/material'

export default function ActCard({ icon, label, color, active, onChange, disabled = false, disabledLabel = '' }) {
  return (
    <Paper onClick={() => { if (!disabled) onChange(!active) }} sx={{
      p: 1.2, textAlign: 'center', cursor: disabled ? 'not-allowed' : 'pointer', userSelect: 'none', borderRadius: 3,
      transition: 'all .18s', border: `2px solid ${active ? color : 'transparent'}`,
      bgcolor: active ? `${color}12` : '#fafafa', boxShadow: active ? `0 0 0 1px ${color}30` : 'none',
      opacity: disabled ? 0.55 : 1,
      '&:hover': disabled ? undefined : { transform: 'scale(1.04)', boxShadow: 3 },
    }}>
      <Avatar sx={{ bgcolor: active ? color : '#e0e0e0', width: 36, height: 36, mx: 'auto', mb: 0.6, transition: 'background .18s' }}>
        {React.cloneElement(icon, { sx: { fontSize: 18, color: active ? '#fff' : '#757575' } })}
      </Avatar>
      <Typography variant="caption" fontWeight={700} display="block">{label}</Typography>
      <Typography variant="caption" sx={{ color: active ? color : '#9e9e9e', fontWeight: 800 }}>{active ? 'LIGADO' : 'DESL.'}</Typography>
      {disabled && disabledLabel ? <Typography variant="caption" sx={{ display: 'block', color: '#8d6e63', fontWeight: 700 }}>{disabledLabel}</Typography> : null}
    </Paper>
  )
}
