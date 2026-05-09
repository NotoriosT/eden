#ifndef SENSORS_H
#define SENSORS_H

#include <stdbool.h>

#include "freertos/FreeRTOS.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "mqtt_client.h"

#include "iot_types.h"

typedef struct {
    bool dht_ok;
    float temperature_c;
    float humidity_pct;
    int soil_raw[MAX_SOIL_SENSORS];
    bool soil_ok[MAX_SOIL_SENSORS];
    int soil_count;
    bool light_ok;
    int light_raw;
} sensor_snapshot_t;

sensor_snapshot_t read_all_sensors(const io_map_t *map,
                                   adc_oneshot_unit_handle_t adc1_handle,
                                   portMUX_TYPE *dht_mux,
                                   int *dht_fail_stage);

void publish_sensor_snapshot(const sensor_snapshot_t *snapshot,
                             esp_mqtt_client_handle_t mqtt_client,
                             const char *topic,
                             bool dht_enabled,
                             int dht_fail_stage);

#endif
