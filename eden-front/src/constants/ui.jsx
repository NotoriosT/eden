import React from 'react'
import ThermostatIcon from '@mui/icons-material/Thermostat'
import AirIcon from '@mui/icons-material/Air'
import WaterDropIcon from '@mui/icons-material/WaterDrop'
import WbSunnyIcon from '@mui/icons-material/WbSunny'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import AcUnitIcon from '@mui/icons-material/AcUnit'
import OpacityIcon from '@mui/icons-material/Opacity'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import ScheduleIcon from '@mui/icons-material/Schedule'
import DeviceThermostatIcon from '@mui/icons-material/DeviceThermostat'
import CompareArrowsIcon from '@mui/icons-material/CompareArrows'
import CalendarViewWeekIcon from '@mui/icons-material/CalendarViewWeek'

export const PRIMARY = '#0f6b4a'

export const PHASES = {
  germinacao: { label: 'Germinação', color: '#e65100', bg: '#fff3e0' },
  vegetativo: { label: 'Vegetativo', color: '#2e7d32', bg: '#e8f5e9' },
  floracao: { label: 'Floração', color: '#7b1fa2', bg: '#f3e5f5' },
  frutificacao: { label: 'Frutificação', color: '#1565c0', bg: '#e3f2fd' },
  colheita: { label: 'Colheita', color: '#f9a825', bg: '#fff8e1' },
}

export const ACTUATORS = [
  { key: 'exhaust_on', label: 'Exaustão', icon: <AirIcon />, color: '#0288d1' },
  { key: 'irrigation_on', label: 'Irrigação', icon: <WaterDropIcon />, color: '#1565c0' },
  { key: 'humidifier_on', label: 'Umidificador', icon: <OpacityIcon />, color: '#00796b' },
  { key: 'dehumidifier_on', label: 'Desumidificador', icon: <AcUnitIcon />, color: '#5c6bc0' },
  { key: 'heater_on', label: 'Aquecedor', icon: <WhatshotIcon />, color: '#d32f2f' },
  { key: 'light_on', label: 'Luz', icon: <WbSunnyIcon />, color: '#f57c00' },
]

export const RULE_TYPES = [
  { value: 'COMPARACAO', label: 'Comparação', color: '#1565c0', icon: <CompareArrowsIcon />, desc: 'Executa quando sensor ultrapassa um valor' },
  { value: 'LIMITE', label: 'Limite', color: '#6a1fa2', icon: <DeviceThermostatIcon />, desc: 'Ação diferente abaixo do mín. e acima do máx.' },
  { value: 'HORARIO', label: 'Horário', color: '#0f6b4a', icon: <AccessTimeIcon />, desc: 'Executa em hora fixa todos os dias' },
  { value: 'DIA_SEMANA', label: 'Dias', color: '#e65100', icon: <CalendarViewWeekIcon />, desc: 'Executa em dias específicos da semana' },
  { value: 'TEMPO', label: 'Intervalo', color: '#0288d1', icon: <ScheduleIcon />, desc: 'Repete automaticamente a cada X minutos' },
]

export const SENSORS = [
  { value: 'TEMPERATURA', label: 'Temperatura', unit: '°C' },
  { value: 'UMIDADE_AR', label: 'Umidade Ar', unit: '%' },
  { value: 'UMIDADE_SOLO_1', label: 'Solo 1 (ADC)', unit: '' },
  { value: 'UMIDADE_SOLO_2', label: 'Solo 2 (ADC)', unit: '' },
  { value: 'UMIDADE_SOLO_3', label: 'Solo 3 (ADC)', unit: '' },
  { value: 'UMIDADE_SOLO_4', label: 'Solo 4 (ADC)', unit: '' },
  { value: 'LUMINOSIDADE', label: 'Luminosidade', unit: '%' },
]

export const DEVICES = [
  { value: 'EXAUSTAO', label: 'Exaustão' },
  { value: 'IRRIGACAO', label: 'Irrigação' },
  { value: 'UMIDIFICADOR', label: 'Umidificador' },
  { value: 'DESUMIDIFICADOR', label: 'Desumidificador' },
  { value: 'AQUECEDOR', label: 'Aquecedor' },
  { value: 'LUZ', label: 'Luz' },
]

export const COMPARISON_OPS = [
  { value: 'MAIOR_QUE', label: 'Maior que (>)' },
  { value: 'MENOR_QUE', label: 'Menor que (<)' },
  { value: 'MAIOR_OU_IGUAL', label: 'Maior ou igual (>=)' },
  { value: 'MENOR_OU_IGUAL', label: 'Menor ou igual (<=)' },
  { value: 'IGUAL', label: 'Igual (=)' },
]

export const WEEK_DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export const EMPTY_PLANT = {
  name: '', species: '', current_phase: 'germinacao',
  planted_at: new Date().toISOString().slice(0, 10),
  expected_flowering_days: 60, expected_harvest_days: 90, photo_base64: '',
}

export const EMPTY_RULE = {
  name: '', tipo_parametro: 'LIMITE', enabled: true,
  variavel_sensor: 'TEMPERATURA', operador: 'MAIOR_QUE', valor: '',
  valor_minimo: '', valor_maximo: '',
  horario: '', dias_semana: [], intervalo_minutos: '', duracao_minutos: '',
  dispositivo: 'EXAUSTAO', comando: 'LIGAR',
  acoes: [{ dispositivo: 'EXAUSTAO', comando: 'LIGAR' }],
  acao_abaixo_minimo: { dispositivo: 'AQUECEDOR', comando: 'LIGAR' },
  acao_acima_maximo: { dispositivo: 'EXAUSTAO', comando: 'LIGAR' },
  acoes_abaixo_minimo: [{ dispositivo: 'AQUECEDOR', comando: 'LIGAR' }],
  acoes_acima_maximo: [{ dispositivo: 'EXAUSTAO', comando: 'LIGAR' }],
}
