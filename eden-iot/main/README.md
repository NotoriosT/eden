# IoT ESP32 (Firmware)

## O que faz
- Conecta no Wi-Fi
- Conecta no EMQX (MQTT)
- Publica sensores no tópico
- Recebe comandos de atuadores

## Ajustes obrigatórios
No `main.c`, alterar:
- `WIFI_SSID`
- `WIFI_PASS`
- `MQTT_BROKER_IP`
- `MQTT_BROKER_PORT`

## Tópicos
- Publica: `eden/sensors/greenhouse`
- Escuta: `eden/actuators/cmd`

## Atuadores (GPIO)
- `exhaust_on` -> GPIO2
- `irrigation_on` -> GPIO4
- `humidifier_on` -> GPIO5
- `dehumidifier_on` -> GPIO18
- `heater_on` -> GPIO19
- `light_on` -> GPIO21

## Sensor payload publicado
```json
{"temperature_c":28.7,"air_humidity":59.0,"soil_humidity":38.5,"light_level":50.0}
```

## Comando esperado
```json
{
  "exhaust_on": false,
  "irrigation_on": true,
  "humidifier_on": false,
  "dehumidifier_on": false,
  "heater_on": false,
  "light_on": true
}
```

## Observação
- `soil_humidity` e `light_level` estão como placeholder no firmware atual.
- Você pode trocar por leitura real de sensor de solo e sensor de luz depois.

## Build/flash
Use seu ambiente ESP-IDF:
```bash
idf.py build
idf.py flash
idf.py monitor
```
