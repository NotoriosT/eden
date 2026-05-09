#ifndef IOT_TYPES_H
#define IOT_TYPES_H

#include <stdbool.h>
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"

#define MAX_SOIL_SENSORS 4

typedef struct {
    gpio_num_t exhaust_pin;
    gpio_num_t irrigation_pin;
    gpio_num_t humidifier_pin;
    gpio_num_t dehumidifier_pin;
    gpio_num_t heater_pin;
    gpio_num_t light_pin;
    gpio_num_t dht_pin;
    bool dht_enabled;
    adc_channel_t soil_channels[MAX_SOIL_SENSORS];
    int soil_count;
    adc_channel_t light_adc_channel;
    bool light_adc_enabled;
} io_map_t;

#endif
