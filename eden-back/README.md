# Backend Go (API + Automação)

## O que faz
- Consome sensores via MQTT
- Salva histórico no MongoDB
- Aplica regras automáticas
- Publica comandos para atuadores
- Guarda eventos de execução

## Rodar com Docker (recomendado)
Use o `docker-compose.yml` da raiz do projeto.

## Rodar local
```bash
cd backend-go
go run ./cmd/api
```

## Variáveis
- `PORT` (padrão `8080`)
- `MONGO_URI` (padrão `mongodb://localhost:27017`)
- `MONGO_DB` (padrão `eden`)
- `MQTT_BROKER` (padrão `tcp://localhost:1883`)
- `MQTT_SENSOR_TOPIC` (padrão `eden/sensors/greenhouse`)
- `MQTT_COMMAND_TOPIC` (padrão `eden/actuators/cmd`)

## Endpoints principais
- `GET /api/readings`
- `GET /api/events`
- `GET /api/plants`
- `POST /api/plants`
- `PUT /api/plants/:id/phase`
- `GET /api/plants/:id/progress`
- `POST /api/plants/:id/progress`
- `GET /api/rules`
- `PUT /api/rules`
- `GET /api/actuators`
- `PUT /api/actuators`

## Payload de sensores (entrada)
```json
{"temperature_c":29.4,"air_humidity":63.1,"soil_humidity":41.2,"light_level":55.0}
```

## Payload de comandos (saída)
```json
{
  "exhaust_on": true,
  "irrigation_on": false,
  "humidifier_on": false,
  "dehumidifier_on": false,
  "heater_on": false,
  "light_on": true,
  "updated_at": "2026-04-29T12:00:00Z",
  "source": "auto"
}
```
