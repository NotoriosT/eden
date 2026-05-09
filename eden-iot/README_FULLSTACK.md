# Eden IoT - React + Go + EMQX + MongoDB

## Arquitetura
- `frontend-react`: painel grafico e telas de cadastro/regras/atuadores.
- `backend-go`: API REST, consumo MQTT, automacao por parametros e persistencia no MongoDB.
- `emqx`: broker MQTT.
- `mongo`: banco principal de historico e cadastro.
- `mongo-express`: interface web para Mongo.

## Estrutura clean (backend)
- `cmd/api/main.go`: bootstrap da aplicacao.
- `internal/config`: leitura de variaveis.
- `internal/domain`: entidades de negocio.
- `internal/repository`: acesso MongoDB.
- `internal/service`: regra de automacao e casos de uso.
- `internal/transport/httpapi`: endpoints REST.
- `internal/mqtt`: client MQTT (subscribe/publish).

## Subir tudo
```bash
docker compose up --build
```

## URLs
- Frontend: `http://localhost:5173`
- API: `http://localhost:8080`
- EMQX dashboard: `http://localhost:18083` (user `admin`, senha `public`)
- Mongo Express: `http://localhost:8081`

## Topicos MQTT
Entrada sensores:
- `eden/sensors/greenhouse`

Payload esperado:
```json
{"temperature_c":29.4,"air_humidity":63.1,"soil_humidity":41.2}
```

Saida comandos para atuadores:
- `eden/actuators/cmd`

Payload exemplo:
```json
{"exhaust_on":true,"irrigation_on":false,"humidifier_on":false,"updated_at":"2026-04-29T01:00:00Z","source":"auto"}
```

## Endpoints
- `GET /health`
- `GET /api/readings?limit=120`
- `GET /api/readings/latest`
- `GET /api/plants`
- `POST /api/plants`
- `GET /api/rules`
- `PUT /api/rules`
- `GET /api/actuators`
- `PUT /api/actuators`

## Colecoes Mongo
- `readings`: historico de telemetria.
- `plants`: cadastro de plantas e foto base64.
- `settings`: documentos `_id=rules` e `_id=actuators`.
