#include <stdbool.h>
#include <stdio.h>
#include <stdint.h>

#include "esp_err.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"

#include "sensors.h"

static const char *TAG = "EDEN_IOT_SENSORS";

static bool wait_level(gpio_num_t pin, int level, uint32_t timeout_us)
{
    int64_t start = esp_timer_get_time();
    while (gpio_get_level(pin) != level) {
        if ((esp_timer_get_time() - start) > timeout_us) {
            return false;
        }
    }
    return true;
}

static bool dht22_read(gpio_num_t pin, float *temperature_c, float *humidity_pct, int *dht_fail_stage)
{
    uint8_t data[5] = {0};
    bool ok = false;
    *dht_fail_stage = 0;

    gpio_set_level(pin, 0);
    esp_rom_delay_us(1200);
    gpio_set_level(pin, 1);
    esp_rom_delay_us(40);

    if (!wait_level(pin, 0, 500)) { *dht_fail_stage = 1; goto done; }
    if (!wait_level(pin, 1, 500)) { *dht_fail_stage = 2; goto done; }
    if (!wait_level(pin, 0, 500)) { *dht_fail_stage = 3; goto done; }

    for (int i = 0; i < 40; i++) {
        if (!wait_level(pin, 1, 150)) { *dht_fail_stage = 10; goto done; }
        int64_t t0 = esp_timer_get_time();
        if (!wait_level(pin, 0, 220)) { *dht_fail_stage = 11; goto done; }
        int64_t pulse_high_us = esp_timer_get_time() - t0;

        data[i / 8] <<= 1;
        if (pulse_high_us > 48) {
            data[i / 8] |= 1;
        }
    }

    uint8_t checksum = (uint8_t)(data[0] + data[1] + data[2] + data[3]);
    if (checksum != data[4]) { *dht_fail_stage = 20; goto done; }

    if (data[1] == 0 && data[3] == 0) {
        *humidity_pct = (float)data[0];
        *temperature_c = (float)data[2];
        ok = true;
        goto done;
    }

    uint16_t raw_h = ((uint16_t)data[0] << 8) | data[1];
    uint16_t raw_t = ((uint16_t)data[2] << 8) | data[3];

    *humidity_pct = raw_h / 10.0f;

    if (raw_t & 0x8000) {
        raw_t &= 0x7FFF;
        *temperature_c = -(raw_t / 10.0f);
    } else {
        *temperature_c = raw_t / 10.0f;
    }

    ok = true;

done:
    return ok;
}

sensor_snapshot_t read_all_sensors(const io_map_t *map,
                                   adc_oneshot_unit_handle_t adc1_handle,
                                   portMUX_TYPE *dht_mux,
                                   int *dht_fail_stage)
{
    sensor_snapshot_t s = {0};

    if (map->dht_enabled) {
        portENTER_CRITICAL(dht_mux);
        s.dht_ok = dht22_read(map->dht_pin, &s.temperature_c, &s.humidity_pct, dht_fail_stage);
        portEXIT_CRITICAL(dht_mux);
    }

    s.soil_count = map->soil_count;
    for (int i = 0; i < map->soil_count; i++) {
        s.soil_ok[i] = (adc_oneshot_read(adc1_handle, map->soil_channels[i], &s.soil_raw[i]) == ESP_OK);
    }

    if (map->light_adc_enabled) {
        s.light_ok = (adc_oneshot_read(adc1_handle, map->light_adc_channel, &s.light_raw) == ESP_OK);
    }

    return s;
}

void publish_sensor_snapshot(const sensor_snapshot_t *snapshot,
                             esp_mqtt_client_handle_t mqtt_client,
                             const char *topic,
                             bool dht_enabled,
                             int dht_fail_stage)
{
    if (mqtt_client == NULL || snapshot == NULL || topic == NULL || topic[0] == '\0') {
        return;
    }

    bool any_soil = false;
    for (int i = 0; i < snapshot->soil_count; i++) {
        if (snapshot->soil_ok[i]) { any_soil = true; break; }
    }

    if (!snapshot->dht_ok && !any_soil && !snapshot->light_ok) {
        if (dht_enabled) {
            ESP_LOGW(TAG, "Falha DHT stage=%d - sem dados para publicar", dht_fail_stage);
        }
        return;
    }

    if (!snapshot->dht_ok && dht_enabled) {
        ESP_LOGW(TAG, "Falha DHT stage=%d - publicando apenas ADC", dht_fail_stage);
    }

    char payload[320];
    int pos = 0;
    payload[pos++] = '{';

    if (snapshot->dht_ok) {
        pos += snprintf(payload + pos, sizeof(payload) - pos,
                        "\"temperature\":%.2f,\"humidity_air\":%.2f",
                        snapshot->temperature_c, snapshot->humidity_pct);
    }
    for (int i = 0; i < snapshot->soil_count; i++) {
        if (snapshot->soil_ok[i]) {
            if (pos > 1) payload[pos++] = ',';
            pos += snprintf(payload + pos, sizeof(payload) - pos,
                            "\"soil_%d\":%d", i + 1, snapshot->soil_raw[i]);
        }
    }
    if (snapshot->light_ok) {
        if (pos > 1) payload[pos++] = ',';
        pos += snprintf(payload + pos, sizeof(payload) - pos,
                        "\"luminosity\":%d", snapshot->light_raw);
    }
    payload[pos++] = '}';
    payload[pos] = '\0';

    esp_mqtt_client_publish(mqtt_client, topic, payload, 0, 0, 0);
    ESP_LOGI(TAG, "Sensor publish -> %s", payload);
}
