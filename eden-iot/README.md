# Eden IoT - Guia Geral

Este projeto tem 3 partes:
- `backend-go` (API + regras automáticas + MQTT + MongoDB)
- `frontend-react` (painel web)
- `main/main.c` (firmware ESP32)

## Uso rápido (sem dor de cabeça)

### 1) Subir sistema web completo
Na pasta `eden-iot`, rode:

```bash
docker compose up --build
```

Depois abra no navegador:
- Painel: `http://localhost:5173`
- API: `http://localhost:8080`
- EMQX: `http://localhost:18083` (admin/public)
- Mongo Express: `http://localhost:8081`

### 2) Configurar ESP32
No arquivo `main/main.c`, ajuste:
- `WIFI_SSID`
- `WIFI_PASS`
- `MQTT_URI` (IP do broker EMQX)

Exemplo:
```c
#define MQTT_URI "mqtt://192.168.0.10:1883"
```

### 3) Fluxo automático
- ESP32 publica sensores em `eden/sensors/greenhouse`
- Backend lê, compara com parâmetros e executa ações
- Backend publica comando em `eden/actuators/cmd`
- ESP32 recebe comando e liga/desliga atuadores

## Regras e ações automáticas
Se valor sair da faixa:
- Temperatura baixa -> aquecedor liga
- Temperatura alta -> exaustão liga
- Ar seco -> umidificador liga
- Ar úmido demais -> desumidificador liga
- Solo seco -> irrigação liga
- Luz fora da faixa no horário ativo -> luz liga/desliga

## Documentação por módulo
- Backend: [README](./backend-go/README.md)
- Frontend: [README](./frontend-react/README.md)
- IoT ESP32: [README](./main/README.md)
