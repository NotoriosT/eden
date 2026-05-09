import React from 'react'
import { Box, Paper, Typography, Stack, Button, Collapse, TextField, InputAdornment, MenuItem, Avatar } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import LocalFloristIcon from '@mui/icons-material/LocalFlorist'
import GrassIcon from '@mui/icons-material/Grass'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import WbTwilightIcon from '@mui/icons-material/WbTwilight'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import PlantCard from '../components/PlantCard'
import { PHASES } from '../constants/ui'

export default function PlantsPage({ plants, showPlantForm, setShowPlantForm, plantForm, setPlantForm, fileRef, handlePhoto, savePlant, savingPlant }) {
  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>Plantas ({plants.length})</Typography>
        <Button variant="contained" startIcon={showPlantForm ? <ExpandLessIcon /> : <AddIcon />} onClick={() => setShowPlantForm(v => !v)} sx={{ borderRadius: 3 }}>
          {showPlantForm ? 'Cancelar' : 'Nova Planta'}
        </Button>
      </Stack>
      <Collapse in={showPlantForm}>
        <Paper sx={{ p: 3, mb: 3, borderRadius: 3, border: '1px solid #b2dfdb' }}>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 2.5 }}><GrassIcon color="primary" /><Typography variant="subtitle1" fontWeight={700}>Cadastrar Nova Planta</Typography></Stack>
          <Box component="form" onSubmit={savePlant}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField label="Nome da planta" required value={plantForm.name} onChange={e => setPlantForm(f => ({ ...f, name: e.target.value }))} InputProps={{ startAdornment: <InputAdornment position="start"><LocalFloristIcon fontSize="small" color="primary" /></InputAdornment> }} />
              <TextField label="Especie / cultivar" value={plantForm.species} onChange={e => setPlantForm(f => ({ ...f, species: e.target.value }))} />
              <TextField select label="Fase inicial" value={plantForm.current_phase} onChange={e => setPlantForm(f => ({ ...f, current_phase: e.target.value }))}>{Object.entries(PHASES).map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}</TextField>
              <TextField label="Data de plantio" type="date" value={plantForm.planted_at} onChange={e => setPlantForm(f => ({ ...f, planted_at: e.target.value }))} InputLabelProps={{ shrink: true }} InputProps={{ startAdornment: <InputAdornment position="start"><CalendarMonthIcon fontSize="small" /></InputAdornment> }} />
              <TextField label="Dias para floracao" type="number" value={plantForm.expected_flowering_days} onChange={e => setPlantForm(f => ({ ...f, expected_flowering_days: e.target.value }))} InputProps={{ startAdornment: <InputAdornment position="start"><WbTwilightIcon fontSize="small" color="secondary" /></InputAdornment> }} />
              <TextField label="Dias para colheita" type="number" value={plantForm.expected_harvest_days} onChange={e => setPlantForm(f => ({ ...f, expected_harvest_days: e.target.value }))} InputProps={{ startAdornment: <InputAdornment position="start"><AccessTimeIcon fontSize="small" color="success" /></InputAdornment> }} />
            </Box>
            <Stack direction="row" alignItems="center" gap={2} sx={{ mt: 2 }}>
              <input type="file" accept="image/*" hidden ref={fileRef} onChange={handlePhoto} />
              <Button variant="outlined" startIcon={<PhotoCameraIcon />} onClick={() => fileRef.current.click()} sx={{ borderRadius: 3 }}>{plantForm.photo_base64 ? 'Trocar foto' : 'Adicionar foto'}</Button>
              {plantForm.photo_base64 && <Avatar src={`data:image/jpeg;base64,${plantForm.photo_base64}`} sx={{ width: 56, height: 56, border: '2px solid #0f6b4a' }} />}
            </Stack>
            <Button type="submit" variant="contained" size="large" disabled={savingPlant} startIcon={<CheckCircleOutlineIcon />} sx={{ mt: 2.5, borderRadius: 3, px: 4 }}>{savingPlant ? 'Salvando...' : 'Cadastrar Planta'}</Button>
          </Box>
        </Paper>
      </Collapse>
      {plants.length === 0 && !showPlantForm && (
        <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 3 }}>
          <LocalFloristIcon sx={{ fontSize: 48, color: '#b0bec5', mb: 1 }} />
          <Typography color="text.secondary">Nenhuma planta cadastrada ainda.</Typography>
        </Paper>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3,1fr)' }, gap: 2 }}>
        {plants.map(p => <PlantCard key={p.id} plant={p} />)}
      </Box>
    </>
  )
}
