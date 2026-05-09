#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdlib.h>
#include <strings.h>
#include <time.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"

#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"

#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "mqtt_client.h"
#include "nvs_flash.h"
#include "esp_wifi.h"
#include "cJSON.h"
#include "iot_types.h"
#include "sensors.h"

// ====== CONFIGURE AQUI ======
#define FIRMWARE_VERSION 18
#define WIFI_SSID "GlobalNET_Tiago"
#define WIFI_PASS "152728317t"
#define MQTT_BROKER_IP "192.168.1.104"
#define MQTT_BROKER_PORT 1883
// ============================

#define MQTT_SENSOR_TOPIC "eden/sensors/greenhouse"
#define MQTT_COMMAND_TOPIC "eden/actuators/cmd"
#define MQTT_ACK_TOPIC "eden/iot/ack"
#define MQTT_ACTUATOR_STATE_TOPIC "eden/actuators/state"
#define MQTT_LOG_TOPIC "eden/iot/logs"
#define BOOTSTRAP_URL     "http://192.168.1.104:8080/api/bootstrap/config"
#define OTA_FIRMWARE_BASE "http://192.168.1.104:8080/api/ota/firmware"
#define MQTT_MSG_QUEUE_LEN 16
#define MQTT_MSG_MAX_LEN 512
// Ajuste de fuso para regras horarias (Brasil: UTC-3).
#define RULES_TZ_OFFSET_MINUTES (-180)
#define SYSTEM_TIME_VALID_AFTER_EPOCH 1704067200LL  // 2024-01-01T00:00:00Z

// Relay polarity:
// active-low  -> GPIO 0 = ligado, GPIO 1 = desligado
// active-high -> GPIO 1 = ligado, GPIO 0 = desligado
// Ajuste para 0 se seu módulo for active-high.
#define ACTUATORS_ACTIVE_LOW 0
#if ACTUATORS_ACTIVE_LOW
#define ACTUATOR_ON_LEVEL 0
#define ACTUATOR_OFF_LEVEL 1
#else
#define ACTUATOR_ON_LEVEL 1
#define ACTUATOR_OFF_LEVEL 0
#endif
#define MAX_LOCAL_RULES 48
#define MAX_RULE_ACTIONS 8

#define EXHAUST_GPIO GPIO_NUM_2
#define IRRIGATION_GPIO GPIO_NUM_4
#define HUMIDIFIER_GPIO GPIO_NUM_5
#define DEHUMIDIFIER_GPIO GPIO_NUM_18
#define HEATER_GPIO GPIO_NUM_19
#define LIGHT_GPIO GPIO_NUM_21
#define DHT_GPIO GPIO_NUM_16

// Analog sensors (ADC1 â€” GPIO34 and GPIO35 are input-only, ADC1)
#define SOIL_ADC_CHANNEL  ADC_CHANNEL_6   // GPIO34 â€” capacitive soil moisture sensor
#define LIGHT_ADC_CHANNEL ADC_CHANNEL_7   // GPIO35 â€” LDR voltage divider

#define WIFI_CONNECTED_BIT BIT0

static const char *TAG = "EDEN_IOT";
static EventGroupHandle_t wifi_event_group;
static esp_mqtt_client_handle_t mqtt_client = NULL;
static char mqtt_uri[96];
static adc_oneshot_unit_handle_t adc1_handle = NULL;
static portMUX_TYPE dht_mux = portMUX_INITIALIZER_UNLOCKED;
static int dht_fail_stage = 0;
static QueueHandle_t mqtt_msg_queue = NULL;

static io_map_t g_io_map;

typedef struct {
    char payload[MQTT_MSG_MAX_LEN];
} mqtt_queue_msg_t;

typedef enum {
    CMD_NONE = 0,
    CMD_ACTUATOR_STATE = 1,
    CMD_BOOTSTRAP_REFRESH = 2,
    CMD_OTA_UPDATE = 3,
    CMD_ACTUATOR_PATCH = 4,
} cmd_type_t;

typedef struct {
    cmd_type_t type;
    bool exhaust_on;
    bool irrigation_on;
    bool humidifier_on;
    bool dehumidifier_on;
    bool heater_on;
    bool light_on;
    char patch_dispositivo[24];
    char patch_comando[16];
    char msg_id[64];
    char reason[96];
    char source[32];
    char server_time[40];
    int ota_version;
    char ota_url[256];
    char ota_sha256[65];
} parsed_cmd_t;

typedef struct {
    char dispositivo[24];
    char comando[16];
    int duracao_minutos;
    int duracao_segundos;
} local_action_t;

typedef struct {
    bool enabled;
    char id[48];
    char name[96];
    char tipo[16];
    char variavel_sensor[24];
    char operador[24];
    float valor;
    float valor_minimo;
    float valor_maximo;
    char horario[8];
    int dias_semana[7];
    int dias_count;
    int intervalo_minutos;
    int duracao_minutos;
    int duracao_segundos;
    local_action_t acoes[MAX_RULE_ACTIONS];
    int acoes_count;
    local_action_t acoes_abaixo[MAX_RULE_ACTIONS];
    int acoes_abaixo_count;
    local_action_t acoes_acima[MAX_RULE_ACTIONS];
    int acoes_acima_count;
    int64_t last_run_ms;
    int64_t last_run_minute_bucket;
} local_rule_t;

typedef struct {
    bool has_time;
    int year;
    int month;
    int day;
    int hour;
    int minute;
    int second;
    int weekday;
    int64_t base_uptime_ms;
} server_time_ref_t;

static local_rule_t g_local_rules[MAX_LOCAL_RULES];
static int g_local_rule_count = 0;
static int64_t g_auto_off_until_ms[6] = {0};
static server_time_ref_t g_server_time = {0};
static bool g_manual_lock = false;
static int64_t g_manual_lock_until_ms = 0;
static int64_t g_last_bootstrap_refresh_ms = 0;

static void apply_actuator_state(bool exhaust_on, bool irrigation_on, bool humidifier_on,
                                 bool dehumidifier_on, bool heater_on, bool light_on);
static void publish_actuator_state(const char *reason);
static void parse_rules_from_bootstrap(cJSON *root);
static void local_rules_tick(const sensor_snapshot_t *snapshot);
static esp_err_t perform_ota_update(const char *url, const char *expected_sha256);
static void publish_iot_log(const char *level, const char *message);
static bool sync_server_time_from_json(cJSON *obj, const char *ctx);
static bool sync_server_time_from_system(const char *ctx);
static void build_bootstrap_request_url(const char *base_url, char *out, size_t out_len);

static void publish_iot_log(const char *level, const char *message)
{
    if (mqtt_client == NULL || message == NULL || message[0] == '\0') {
        return;
    }
    char payload[320];
    int64_t now_ms = esp_timer_get_time() / 1000;
    snprintf(payload, sizeof(payload),
             "{\"level\":\"%s\",\"message\":\"%s\",\"ts_ms\":%lld}",
             level ? level : "info",
             message,
             (long long)now_ms);
    esp_mqtt_client_publish(mqtt_client, MQTT_LOG_TOPIC, payload, 0, 0, 0);
}

static int bool_to_gpio_level(bool on)
{
    return on ? ACTUATOR_ON_LEVEL : ACTUATOR_OFF_LEVEL;
}

static bool gpio_level_to_bool(int level)
{
    return level == ACTUATOR_ON_LEVEL;
}

static void publish_actuator_line(const char *name, int pin, bool requested_on, int gpio_level)
{
    char line[160];
    snprintf(line, sizeof(line), "actuator %s pin=%d req=%s gpio=%d",
             name ? name : "UNKNOWN",
             pin,
             requested_on ? "on" : "off",
             gpio_level);
    publish_iot_log("info", line);
}

static bool is_valid_gpio(int pin)
{
    return pin >= 0 && pin <= 39;
}

static bool is_flash_gpio(int pin)
{
    return pin >= 6 && pin <= 11;
}

static bool is_input_only_gpio(int pin)
{
    return pin >= 34 && pin <= 39;
}

static bool can_use_as_output(int pin)
{
    return is_valid_gpio(pin) && !is_flash_gpio(pin) && !is_input_only_gpio(pin);
}

static int parse_gpio_label(const char *s)
{
    if (s == NULL || s[0] == '\0') {
        return -1;
    }
    if (strncmp(s, "GPIO", 4) == 0) {
        s += 4;
    }
    char *end = NULL;
    long pin = strtol(s, &end, 10);
    if (end == s || pin < 0 || pin > 39) {
        return -1;
    }
    return (int)pin;
}

static bool adc_channel_from_gpio(int pin, adc_channel_t *out)
{
    switch (pin) {
        case 36: *out = ADC_CHANNEL_0; return true;
        case 39: *out = ADC_CHANNEL_3; return true;
        case 32: *out = ADC_CHANNEL_4; return true;
        case 33: *out = ADC_CHANNEL_5; return true;
        case 34: *out = ADC_CHANNEL_6; return true;
        case 35: *out = ADC_CHANNEL_7; return true;
        default: return false;
    }
}

static int device_index_from_name(const char *dispositivo)
{
    if (!dispositivo) return -1;
    if (strcmp(dispositivo, "EXAUSTAO") == 0) return 0;
    if (strcmp(dispositivo, "IRRIGACAO") == 0) return 1;
    if (strcmp(dispositivo, "UMIDIFICADOR") == 0) return 2;
    if (strcmp(dispositivo, "DESUMIDIFICADOR") == 0) return 3;
    if (strcmp(dispositivo, "AQUECEDOR") == 0) return 4;
    if (strcmp(dispositivo, "LUZ") == 0) return 5;
    return -1;
}

static bool read_current_actuator_state(bool out_states[6])
{
    if (!out_states) return false;
    gpio_num_t pins[6] = {
        g_io_map.exhaust_pin,
        g_io_map.irrigation_pin,
        g_io_map.humidifier_pin,
        g_io_map.dehumidifier_pin,
        g_io_map.heater_pin,
        g_io_map.light_pin,
    };
    for (int i = 0; i < 6; i++) {
        out_states[i] = can_use_as_output((int)pins[i]) ? gpio_level_to_bool(gpio_get_level(pins[i])) : false;
    }
    return true;
}

static int weekday_from_date(int y, int m, int d)
{
    if (m < 3) {
        m += 12;
        y -= 1;
    }
    int K = y % 100;
    int J = y / 100;
    int h = (d + (13 * (m + 1)) / 5 + K + K / 4 + J / 4 + 5 * J) % 7;
    int w = (h + 6) % 7; // 0=Sunday
    return w;
}

static bool get_system_clock_fields(int *weekday, int *hour, int *minute, int64_t *minute_bucket)
{
    time_t epoch = time(NULL);
    if ((int64_t)epoch < SYSTEM_TIME_VALID_AFTER_EPOCH) {
        return false;
    }

    time_t local_epoch = epoch + ((time_t)RULES_TZ_OFFSET_MINUTES * 60);
    struct tm local_tm = {0};
    if (gmtime_r(&local_epoch, &local_tm) == NULL) {
        return false;
    }

    if (weekday) *weekday = local_tm.tm_wday;
    if (hour) *hour = local_tm.tm_hour;
    if (minute) *minute = local_tm.tm_min;
    if (minute_bucket) *minute_bucket = (int64_t)local_epoch / 60;
    return true;
}

static bool parse_server_time_iso(const char *iso, server_time_ref_t *out)
{
    if (!iso || !out) return false;
    int y = 0, mo = 0, d = 0, hh = 0, mm = 0, ss = 0;
    if (sscanf(iso, "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &hh, &mm, &ss) != 6) {
        return false;
    }
    out->year = y;
    out->month = mo;
    out->day = d;
    out->hour = hh;
    out->minute = mm;
    out->second = ss;
    out->weekday = weekday_from_date(y, mo, d);

    // Converte server_time (normalmente UTC) para fuso local usado nas regras.
    if (RULES_TZ_OFFSET_MINUTES != 0) {
        int total_minutes = out->hour * 60 + out->minute + RULES_TZ_OFFSET_MINUTES;
        while (total_minutes < 0) {
            total_minutes += 1440;
            out->weekday = (out->weekday + 6) % 7;
        }
        while (total_minutes >= 1440) {
            total_minutes -= 1440;
            out->weekday = (out->weekday + 1) % 7;
        }
        out->hour = total_minutes / 60;
        out->minute = total_minutes % 60;
    }

    out->base_uptime_ms = esp_timer_get_time() / 1000;
    out->has_time = true;
    return true;
}

static bool set_server_time_from_iso(const char *iso, const char *ctx)
{
    if (!iso || iso[0] == '\0') {
        return false;
    }
    server_time_ref_t parsed = {0};
    if (!parse_server_time_iso(iso, &parsed)) {
        ESP_LOGW(TAG, "%s: server_time invalido: %s", ctx ? ctx : "clock", iso);
        return false;
    }

    g_server_time = parsed;
    ESP_LOGI(TAG, "%s: server_time=%s (weekday=%d %02d:%02d)",
             ctx ? ctx : "clock", iso, g_server_time.weekday, g_server_time.hour, g_server_time.minute);
    return true;
}

static bool sync_server_time_from_json(cJSON *obj, const char *ctx)
{
    if (!cJSON_IsObject(obj)) return false;

    const char *time_keys[] = {
        "server_time",
        "server_datetime",
        "current_time",
        "requested_at",
        "timestamp",
    };
    for (size_t i = 0; i < sizeof(time_keys) / sizeof(time_keys[0]); i++) {
        cJSON *it = cJSON_GetObjectItemCaseSensitive(obj, time_keys[i]);
        if (cJSON_IsString(it) && it->valuestring && it->valuestring[0] != '\0') {
            return set_server_time_from_iso(it->valuestring, ctx);
        }
    }
    return false;
}

static bool sync_server_time_from_system(const char *ctx)
{
    time_t epoch = time(NULL);
    if ((int64_t)epoch < SYSTEM_TIME_VALID_AFTER_EPOCH) {
        return false;
    }

    time_t local_epoch = epoch + ((time_t)RULES_TZ_OFFSET_MINUTES * 60);
    struct tm local_tm = {0};
    if (gmtime_r(&local_epoch, &local_tm) == NULL) {
        return false;
    }

    server_time_ref_t sys_ref = {
        .has_time = true,
        .year = local_tm.tm_year + 1900,
        .month = local_tm.tm_mon + 1,
        .day = local_tm.tm_mday,
        .hour = local_tm.tm_hour,
        .minute = local_tm.tm_min,
        .second = local_tm.tm_sec,
        .weekday = local_tm.tm_wday,
        .base_uptime_ms = esp_timer_get_time() / 1000,
    };
    g_server_time = sys_ref;

    ESP_LOGI(TAG, "%s: server_time via relogio do sistema (epoch=%lld weekday=%d %02d:%02d)",
             ctx ? ctx : "clock",
             (long long)epoch,
             g_server_time.weekday,
             g_server_time.hour,
             g_server_time.minute);
    return true;
}

static void update_clock_fields(server_time_ref_t *t, int64_t delta_sec)
{
    if (!t) return;
    int total_sec = t->second + (int)delta_sec;
    int carry_min = total_sec / 60;
    t->second = total_sec % 60;

    int total_min = t->minute + carry_min;
    int carry_hour = total_min / 60;
    t->minute = total_min % 60;

    int total_hour = t->hour + carry_hour;
    int carry_day = total_hour / 24;
    t->hour = total_hour % 24;
    if (carry_day > 0) {
        t->weekday = (t->weekday + carry_day) % 7;
    }
}

static void get_estimated_server_time(int *weekday, int *hour, int *minute, int64_t *minute_bucket, int64_t *now_ms)
{
    int64_t up_ms = esp_timer_get_time() / 1000;
    if (now_ms) *now_ms = up_ms;
    if (!g_server_time.has_time) {
        if (get_system_clock_fields(weekday, hour, minute, minute_bucket)) {
            return;
        }
        if (weekday) *weekday = -1;
        if (hour) *hour = -1;
        if (minute) *minute = -1;
        if (minute_bucket) *minute_bucket = up_ms / 60000;
        return;
    }

    server_time_ref_t tmp = g_server_time;
    int64_t delta_sec = (up_ms - g_server_time.base_uptime_ms) / 1000;
    if (delta_sec < 0) delta_sec = 0;
    update_clock_fields(&tmp, delta_sec);

    if (weekday) *weekday = tmp.weekday;
    if (hour) *hour = tmp.hour;
    if (minute) *minute = tmp.minute;
    if (minute_bucket) *minute_bucket = (int64_t)tmp.hour * 60 + tmp.minute + ((up_ms / 60000) * 1440);
}

static bool action_command_is_on(const char *cmd)
{
    if (!cmd || cmd[0] == '\0') return false;
    return strcasecmp(cmd, "LIGAR") == 0 ||
           strcasecmp(cmd, "ON") == 0 ||
           strcasecmp(cmd, "TRUE") == 0 ||
           strcmp(cmd, "1") == 0;
}

static bool rule_sensor_value(const sensor_snapshot_t *s, const char *sensor, float *out, bool *available)
{
    if (!s || !sensor || !out || !available) return false;
    *available = false;
    if (strcmp(sensor, "TEMPERATURA") == 0) {
        if (s->dht_ok) {
            *out = s->temperature_c;
            *available = true;
        }
    } else if (strcmp(sensor, "UMIDADE_AR") == 0) {
        if (s->dht_ok) {
            *out = s->humidity_pct;
            *available = true;
        }
    } else if (strncmp(sensor, "UMIDADE_SOLO", 12) == 0) {
        int idx = 0;
        if (sensor[12] == '_') idx = atoi(sensor + 13) - 1;
        if (idx >= 0 && idx < s->soil_count && s->soil_ok[idx]) {
            *out = (float)s->soil_raw[idx];
            *available = true;
        }
    } else if (strcmp(sensor, "LUMINOSIDADE") == 0) {
        if (s->light_ok) {
            *out = (float)s->light_raw;
            *available = true;
        }
    }
    return true;
}

static bool compare_value(float v, const char *op, float threshold)
{
    if (!op) return false;
    if (strcmp(op, "MAIOR_QUE") == 0) return v > threshold;
    if (strcmp(op, "MENOR_QUE") == 0) return v < threshold;
    if (strcmp(op, "MAIOR_OU_IGUAL") == 0) return v >= threshold;
    if (strcmp(op, "MENOR_OU_IGUAL") == 0) return v <= threshold;
    if (strcmp(op, "IGUAL") == 0) return v == threshold;
    return false;
}

static void init_default_io_map(void)
{
    // Comeca "desligado de mapa": so aplica atuador/sensor quando vier porta valida do backend.
    g_io_map.exhaust_pin = (gpio_num_t)-1;
    g_io_map.irrigation_pin = (gpio_num_t)-1;
    g_io_map.humidifier_pin = (gpio_num_t)-1;
    g_io_map.dehumidifier_pin = (gpio_num_t)-1;
    g_io_map.heater_pin = (gpio_num_t)-1;
    g_io_map.light_pin = (gpio_num_t)-1;
    g_io_map.dht_pin = (gpio_num_t)-1;
    g_io_map.dht_enabled = false;
    g_io_map.soil_count = 0;
    g_io_map.light_adc_channel = LIGHT_ADC_CHANNEL;
    g_io_map.light_adc_enabled = false;
}

static void log_io_map(const char *ctx)
{
    ESP_LOGI(TAG,
             "[%s] MAP ex=%d ir=%d hum=%d dehum=%d heat=%d light=%d dht=%d(en=%d) soil_count=%d light_adc=%d(en=%d)",
             ctx ? ctx : "map",
             (int)g_io_map.exhaust_pin,
             (int)g_io_map.irrigation_pin,
             (int)g_io_map.humidifier_pin,
             (int)g_io_map.dehumidifier_pin,
             (int)g_io_map.heater_pin,
             (int)g_io_map.light_pin,
             (int)g_io_map.dht_pin,
             g_io_map.dht_enabled ? 1 : 0,
             g_io_map.soil_count,
             (int)g_io_map.light_adc_channel,
             g_io_map.light_adc_enabled ? 1 : 0);
}

static void configure_hardware_from_map(void)
{
    log_io_map("before_hw_config");
    uint64_t out_mask = 0;
    int out_pins[] = {
        g_io_map.exhaust_pin,
        g_io_map.irrigation_pin,
        g_io_map.humidifier_pin,
        g_io_map.dehumidifier_pin,
        g_io_map.heater_pin,
        g_io_map.light_pin,
    };
    for (size_t i = 0; i < sizeof(out_pins) / sizeof(out_pins[0]); i++) {
        int p = out_pins[i];
        if (!can_use_as_output(p)) {
            ESP_LOGW(TAG, "GPIO %d invalido para atuador", p);
            continue;
        }
        out_mask |= (1ULL << p);
    }

    if (out_mask != 0) {
        gpio_config_t out_conf = {
            .pin_bit_mask = out_mask,
            .mode = GPIO_MODE_INPUT_OUTPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE,
        };
        ESP_ERROR_CHECK(gpio_config(&out_conf));
        ESP_LOGI(TAG, "GPIO output mask aplicado: 0x%llx", (unsigned long long)out_mask);
    }

    if (g_io_map.dht_enabled && is_valid_gpio(g_io_map.dht_pin) && !is_flash_gpio(g_io_map.dht_pin)) {
        gpio_config_t dht_conf = {
            .pin_bit_mask = (1ULL << g_io_map.dht_pin),
            .mode = GPIO_MODE_INPUT_OUTPUT_OD,
            .pull_up_en = GPIO_PULLUP_ENABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE,
        };
        ESP_ERROR_CHECK(gpio_config(&dht_conf));
    } else if (g_io_map.dht_enabled) {
        ESP_LOGW(TAG, "GPIO DHT invalido: %d", g_io_map.dht_pin);
    }

    if (adc1_handle == NULL) {
        adc_oneshot_unit_init_cfg_t unit_cfg = {
            .unit_id = ADC_UNIT_1,
            .clk_src = ADC_RTC_CLK_SRC_DEFAULT,
            .ulp_mode = ADC_ULP_MODE_DISABLE,
        };
        ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit_cfg, &adc1_handle));
    }
    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12,
    };
    for (int i = 0; i < g_io_map.soil_count; i++) {
        ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, g_io_map.soil_channels[i], &chan_cfg));
        ESP_LOGI(TAG, "ADC solo[%d] configurado no canal %d", i + 1, (int)g_io_map.soil_channels[i]);
    }
    if (g_io_map.light_adc_enabled) {
        ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, g_io_map.light_adc_channel, &chan_cfg));
        ESP_LOGI(TAG, "ADC luz configurado no canal %d", (int)g_io_map.light_adc_channel);
    }
    log_io_map("after_hw_config");
}

static void clear_local_rules(void)
{
    memset(g_local_rules, 0, sizeof(g_local_rules));
    g_local_rule_count = 0;
    memset(g_auto_off_until_ms, 0, sizeof(g_auto_off_until_ms));
}

static void parse_action_object(cJSON *obj, local_action_t *out)
{
    if (!obj || !out || !cJSON_IsObject(obj)) return;
    cJSON *d = cJSON_GetObjectItemCaseSensitive(obj, "dispositivo");
    cJSON *c = cJSON_GetObjectItemCaseSensitive(obj, "comando");
    cJSON *dur = cJSON_GetObjectItemCaseSensitive(obj, "duracao_minutos");
    cJSON *dur_sec = cJSON_GetObjectItemCaseSensitive(obj, "duracao_segundos");
    if (cJSON_IsString(d) && d->valuestring) {
        strncpy(out->dispositivo, d->valuestring, sizeof(out->dispositivo) - 1);
    }
    if (cJSON_IsString(c) && c->valuestring) {
        strncpy(out->comando, c->valuestring, sizeof(out->comando) - 1);
    }
    if (cJSON_IsNumber(dur)) {
        out->duracao_minutos = dur->valueint;
    }
    if (cJSON_IsNumber(dur_sec)) {
        out->duracao_segundos = dur_sec->valueint;
    } else if (out->duracao_minutos > 0) {
        out->duracao_segundos = out->duracao_minutos * 60;
    }
}

static int parse_action_array(cJSON *arr, local_action_t *dest, int maxn)
{
    if (!cJSON_IsArray(arr) || !dest || maxn <= 0) return 0;
    int count = 0;
    cJSON *it = NULL;
    cJSON_ArrayForEach(it, arr) {
        if (count >= maxn) break;
        if (!cJSON_IsObject(it)) continue;
        local_action_t a = {0};
        parse_action_object(it, &a);
        if (a.dispositivo[0] == '\0' || a.comando[0] == '\0') continue;
        dest[count++] = a;
    }
    return count;
}

static void parse_rule_actions(cJSON *rule_obj, local_rule_t *r)
{
    cJSON *acoes = cJSON_GetObjectItemCaseSensitive(rule_obj, "acoes");
    r->acoes_count = parse_action_array(acoes, r->acoes, MAX_RULE_ACTIONS);

    cJSON *ab = cJSON_GetObjectItemCaseSensitive(rule_obj, "acoes_abaixo_minimo");
    r->acoes_abaixo_count = parse_action_array(ab, r->acoes_abaixo, MAX_RULE_ACTIONS);

    cJSON *ac = cJSON_GetObjectItemCaseSensitive(rule_obj, "acoes_acima_maximo");
    r->acoes_acima_count = parse_action_array(ac, r->acoes_acima, MAX_RULE_ACTIONS);

    if (r->acoes_abaixo_count == 0) {
        cJSON *ab1 = cJSON_GetObjectItemCaseSensitive(rule_obj, "acao_abaixo_minimo");
        if (cJSON_IsObject(ab1)) {
            local_action_t a = {0};
            parse_action_object(ab1, &a);
            if (a.dispositivo[0] && a.comando[0]) r->acoes_abaixo[r->acoes_abaixo_count++] = a;
        }
    }
    if (r->acoes_acima_count == 0) {
        cJSON *ac1 = cJSON_GetObjectItemCaseSensitive(rule_obj, "acao_acima_maximo");
        if (cJSON_IsObject(ac1)) {
            local_action_t a = {0};
            parse_action_object(ac1, &a);
            if (a.dispositivo[0] && a.comando[0]) r->acoes_acima[r->acoes_acima_count++] = a;
        }
    }

    if (r->acoes_count == 0) {
        cJSON *d = cJSON_GetObjectItemCaseSensitive(rule_obj, "dispositivo");
        cJSON *c = cJSON_GetObjectItemCaseSensitive(rule_obj, "comando");
        if (cJSON_IsString(d) && d->valuestring && cJSON_IsString(c) && c->valuestring) {
            local_action_t a = {0};
            strncpy(a.dispositivo, d->valuestring, sizeof(a.dispositivo) - 1);
            strncpy(a.comando, c->valuestring, sizeof(a.comando) - 1);
            cJSON *dur = cJSON_GetObjectItemCaseSensitive(rule_obj, "duracao_minutos");
            if (cJSON_IsNumber(dur)) a.duracao_minutos = dur->valueint;
            cJSON *dur_sec = cJSON_GetObjectItemCaseSensitive(rule_obj, "duracao_segundos");
            if (cJSON_IsNumber(dur_sec)) a.duracao_segundos = dur_sec->valueint;
            else if (a.duracao_minutos > 0) a.duracao_segundos = a.duracao_minutos * 60;
            r->acoes[r->acoes_count++] = a;
        }
    }
}

static void parse_rules_from_bootstrap(cJSON *root)
{
    clear_local_rules();

    bool synced = sync_server_time_from_json(root, "bootstrap");
    if (!synced) {
        synced = sync_server_time_from_system("bootstrap");
    }
    if (!synced) {
        g_server_time.has_time = false;
        ESP_LOGW(TAG, "bootstrap sem referencia de horario valida");
    }

    cJSON *rules = cJSON_GetObjectItemCaseSensitive(root, "regras_ativas");
    if (!cJSON_IsArray(rules)) {
        ESP_LOGW(TAG, "bootstrap sem regras_ativas");
        return;
    }

    cJSON *it = NULL;
    cJSON_ArrayForEach(it, rules) {
        if (g_local_rule_count >= MAX_LOCAL_RULES) break;
        if (!cJSON_IsObject(it)) continue;

        local_rule_t r = {0};
        cJSON *enabled = cJSON_GetObjectItemCaseSensitive(it, "enabled");
        r.enabled = !enabled || !cJSON_IsBool(enabled) || cJSON_IsTrue(enabled);

        cJSON *id = cJSON_GetObjectItemCaseSensitive(it, "id");
        if (cJSON_IsString(id) && id->valuestring) strncpy(r.id, id->valuestring, sizeof(r.id) - 1);
        cJSON *name = cJSON_GetObjectItemCaseSensitive(it, "name");
        if (cJSON_IsString(name) && name->valuestring) strncpy(r.name, name->valuestring, sizeof(r.name) - 1);
        cJSON *tipo = cJSON_GetObjectItemCaseSensitive(it, "tipo_parametro");
        if (cJSON_IsString(tipo) && tipo->valuestring) strncpy(r.tipo, tipo->valuestring, sizeof(r.tipo) - 1);
        cJSON *vs = cJSON_GetObjectItemCaseSensitive(it, "variavel_sensor");
        if (cJSON_IsString(vs) && vs->valuestring) strncpy(r.variavel_sensor, vs->valuestring, sizeof(r.variavel_sensor) - 1);
        cJSON *op = cJSON_GetObjectItemCaseSensitive(it, "operador");
        if (cJSON_IsString(op) && op->valuestring) strncpy(r.operador, op->valuestring, sizeof(r.operador) - 1);

        cJSON *valor = cJSON_GetObjectItemCaseSensitive(it, "valor");
        if (cJSON_IsNumber(valor)) r.valor = (float)valor->valuedouble;
        cJSON *vmin = cJSON_GetObjectItemCaseSensitive(it, "valor_minimo");
        if (cJSON_IsNumber(vmin)) r.valor_minimo = (float)vmin->valuedouble;
        cJSON *vmax = cJSON_GetObjectItemCaseSensitive(it, "valor_maximo");
        if (cJSON_IsNumber(vmax)) r.valor_maximo = (float)vmax->valuedouble;

        cJSON *horario = cJSON_GetObjectItemCaseSensitive(it, "horario");
        if (cJSON_IsString(horario) && horario->valuestring) strncpy(r.horario, horario->valuestring, sizeof(r.horario) - 1);
        cJSON *interval = cJSON_GetObjectItemCaseSensitive(it, "intervalo_minutos");
        if (cJSON_IsNumber(interval)) r.intervalo_minutos = interval->valueint;
        cJSON *dur = cJSON_GetObjectItemCaseSensitive(it, "duracao_minutos");
        if (cJSON_IsNumber(dur)) r.duracao_minutos = dur->valueint;
        cJSON *dur_sec = cJSON_GetObjectItemCaseSensitive(it, "duracao_segundos");
        if (cJSON_IsNumber(dur_sec)) r.duracao_segundos = dur_sec->valueint;
        else if (r.duracao_minutos > 0) r.duracao_segundos = r.duracao_minutos * 60;

        cJSON *dias = cJSON_GetObjectItemCaseSensitive(it, "dias_semana");
        if (cJSON_IsArray(dias)) {
            cJSON *d = NULL;
            cJSON_ArrayForEach(d, dias) {
                if (r.dias_count >= 7) break;
                if (!cJSON_IsNumber(d)) continue;
                int dv = d->valueint;
                if (dv < 0 || dv > 6) continue;
                r.dias_semana[r.dias_count++] = dv;
            }
        }

        parse_rule_actions(it, &r);
        g_local_rules[g_local_rule_count++] = r;
    }

    ESP_LOGI(TAG, "regras_ativas carregadas no ESP: %d", g_local_rule_count);
}

static int action_duration_seconds(const local_action_t *a)
{
    if (!a) return 0;
    if (a->duracao_segundos > 0) return a->duracao_segundos;
    if (a->duracao_minutos > 0) return a->duracao_minutos * 60;
    return 0;
}

static int rule_duration_seconds(const local_rule_t *r)
{
    if (!r) return 0;
    if (r->duracao_segundos > 0) return r->duracao_segundos;
    if (r->duracao_minutos > 0) return r->duracao_minutos * 60;
    return 0;
}

static int rule_duration_minutes_compat(const local_rule_t *r)
{
    int sec = rule_duration_seconds(r);
    if (sec <= 0) return 0;
    return (sec + 59) / 60;
}

static void apply_action_list_to_desired(local_action_t *list, int count, bool desired[6], int64_t now_ms)
{
    for (int i = 0; i < count; i++) {
        int idx = device_index_from_name(list[i].dispositivo);
        if (idx < 0 || idx >= 6) continue;
        bool on = action_command_is_on(list[i].comando);
        desired[idx] = on;
        int dur_sec = action_duration_seconds(&list[i]);
        if (on && dur_sec > 0) {
            g_auto_off_until_ms[idx] = now_ms + ((int64_t)dur_sec * 1000);
        }
        if (!on) {
            g_auto_off_until_ms[idx] = 0;
        }
    }
}

static bool parse_hhmm_to_minutes(const char *hhmm, int *out_minutes)
{
    if (!hhmm || !out_minutes) return false;
    int h = -1, m = -1;
    if (sscanf(hhmm, "%d:%d", &h, &m) != 2) return false;
    if (h < 0 || h > 23 || m < 0 || m > 59) return false;
    *out_minutes = h * 60 + m;
    return true;
}

static bool minute_matches(const char *hhmm, int hour, int minute)
{
    if (!hhmm || hhmm[0] == '\0' || hour < 0 || minute < 0) return false;
    int start_minutes = -1;
    if (!parse_hhmm_to_minutes(hhmm, &start_minutes)) return false;
    int now_minutes = (hour * 60) + minute;
    return start_minutes == now_minutes;
}

static bool day_in_rule(const local_rule_t *r, int weekday)
{
    if (!r || weekday < 0) return false;
    for (int i = 0; i < r->dias_count; i++) {
        if (r->dias_semana[i] == weekday) return true;
    }
    return false;
}

static bool is_rule_window_active_today(int now_minutes, int start_minutes, int duration_minutes, bool *from_prev_day)
{
    if (from_prev_day) *from_prev_day = false;
    if (duration_minutes <= 0) return false;

    int end_abs = start_minutes + duration_minutes;
    if (end_abs < 1440) {
        return now_minutes >= start_minutes && now_minutes < end_abs;
    }

    // Janela atravessou meia-noite.
    if (now_minutes >= start_minutes) {
        return true;
    }
    if (now_minutes < (end_abs - 1440)) {
        if (from_prev_day) *from_prev_day = true;
        return true;
    }
    return false;
}

static void apply_action_list_window(local_action_t *list, int count, bool desired[6], bool active_window)
{
    for (int i = 0; i < count; i++) {
        int idx = device_index_from_name(list[i].dispositivo);
        if (idx < 0 || idx >= 6) continue;
        bool on_when_active = action_command_is_on(list[i].comando);
        if (active_window) {
            desired[idx] = on_when_active;
        } else if (on_when_active) {
            desired[idx] = false;
        }
        // Em modo janela, duraÃ§Ã£o jÃ¡ Ã© tratada pela prÃ³pria janela.
        g_auto_off_until_ms[idx] = 0;
    }
}

static void local_rules_tick(const sensor_snapshot_t *snapshot)
{
    if (!snapshot || g_local_rule_count <= 0) return;
    if (g_manual_lock) {
        int64_t lock_now_ms = esp_timer_get_time() / 1000;
        if (g_manual_lock_until_ms > 0 && lock_now_ms >= g_manual_lock_until_ms) {
            g_manual_lock = false;
            g_manual_lock_until_ms = 0;
            ESP_LOGI(TAG, "Modo manual expirou - regras locais reativadas");
        } else {
            return;
        }
    }

    bool current[6] = {0};
    bool desired[6] = {0};
    read_current_actuator_state(current);
    memcpy(desired, current, sizeof(desired));

    int weekday = -1, hour = -1, minute = -1;
    int64_t minute_bucket = 0, now_ms = 0;
    get_estimated_server_time(&weekday, &hour, &minute, &minute_bucket, &now_ms);

    for (int i = 0; i < g_local_rule_count; i++) {
        local_rule_t *r = &g_local_rules[i];
        if (!r->enabled) continue;

        if (strcmp(r->tipo, "COMPARACAO") == 0) {
            float v = 0.0f;
            bool ok = false;
            rule_sensor_value(snapshot, r->variavel_sensor, &v, &ok);
            if (ok && compare_value(v, r->operador, r->valor)) {
                apply_action_list_to_desired(r->acoes, r->acoes_count, desired, now_ms);
            }
        } else if (strcmp(r->tipo, "LIMITE") == 0) {
            float v = 0.0f;
            bool ok = false;
            rule_sensor_value(snapshot, r->variavel_sensor, &v, &ok);
            if (ok && v < r->valor_minimo) {
                apply_action_list_to_desired(r->acoes_abaixo, r->acoes_abaixo_count, desired, now_ms);
                char lim_log[160];
                snprintf(lim_log, sizeof(lim_log), "LIMITE '%.48s' abaixo min: %.1f < %.1f", r->name, v, r->valor_minimo);
                publish_iot_log("warn", lim_log);
            }
            if (ok && v > r->valor_maximo) {
                apply_action_list_to_desired(r->acoes_acima, r->acoes_acima_count, desired, now_ms);
                char lim_log[160];
                snprintf(lim_log, sizeof(lim_log), "LIMITE '%.48s' acima max: %.1f > %.1f", r->name, v, r->valor_maximo);
                publish_iot_log("warn", lim_log);
            }
        } else if (strcmp(r->tipo, "HORARIO") == 0) {
            int duracao_minutos = rule_duration_minutes_compat(r);
            if (duracao_minutos > 0) {
                if (hour >= 0 && minute >= 0) {
                    int start_minutes = -1;
                    if (parse_hhmm_to_minutes(r->horario, &start_minutes)) {
                        int now_minutes = (hour * 60) + minute;
                        bool from_prev_day = false;
                        bool active_window = is_rule_window_active_today(now_minutes, start_minutes, duracao_minutos, &from_prev_day);
                        (void)from_prev_day;
                        apply_action_list_window(r->acoes, r->acoes_count, desired, active_window);
                    }
                } else {
                    // Fail-safe: sem horario valido, nao manter atuador ligado fora da janela.
                    apply_action_list_window(r->acoes, r->acoes_count, desired, false);
                }
            } else if (minute_matches(r->horario, hour, minute) && r->last_run_minute_bucket != minute_bucket) {
                apply_action_list_to_desired(r->acoes, r->acoes_count, desired, now_ms);
                r->last_run_minute_bucket = minute_bucket;
                r->last_run_ms = now_ms;
            }
        } else if (strcmp(r->tipo, "DIA_SEMANA") == 0) {
            int duracao_minutos = rule_duration_minutes_compat(r);
            if (duracao_minutos > 0) {
                if (hour >= 0 && minute >= 0 && weekday >= 0) {
                    int start_minutes = -1;
                    if (parse_hhmm_to_minutes(r->horario, &start_minutes)) {
                        int now_minutes = (hour * 60) + minute;
                        bool from_prev_day = false;
                        bool active_window = is_rule_window_active_today(now_minutes, start_minutes, duracao_minutos, &from_prev_day);
                        if (active_window) {
                            int anchor_day = from_prev_day ? ((weekday + 6) % 7) : weekday;
                            active_window = day_in_rule(r, anchor_day);
                        }
                        apply_action_list_window(r->acoes, r->acoes_count, desired, active_window);
                    }
                } else {
                    // Fail-safe: sem horario valido, nao manter atuador ligado fora da janela.
                    apply_action_list_window(r->acoes, r->acoes_count, desired, false);
                }
            } else if (day_in_rule(r, weekday) && minute_matches(r->horario, hour, minute) && r->last_run_minute_bucket != minute_bucket) {
                apply_action_list_to_desired(r->acoes, r->acoes_count, desired, now_ms);
                r->last_run_minute_bucket = minute_bucket;
                r->last_run_ms = now_ms;
            }
        } else if (strcmp(r->tipo, "TEMPO") == 0) {
            if (r->intervalo_minutos > 0) {
                int64_t interval_ms = (int64_t)r->intervalo_minutos * 60000;
                if (r->last_run_ms == 0 || (now_ms - r->last_run_ms) >= interval_ms) {
                    apply_action_list_to_desired(r->acoes, r->acoes_count, desired, now_ms);
                    r->last_run_ms = now_ms;
                    int dur_sec = rule_duration_seconds(r);
                    ESP_LOGI(TAG, "TEMPO '%s' disparou: duracao=%d s", r->name, dur_sec);
                    char tempo_log[160];
                    snprintf(tempo_log, sizeof(tempo_log), "TEMPO '%.48s' disparou: intervalo=%dmin duracao=%ds",
                             r->name, r->intervalo_minutos, dur_sec);
                    publish_iot_log("info", tempo_log);
                    if (dur_sec > 0) {
                        int64_t off_at = now_ms + ((int64_t)dur_sec * 1000);
                        for (int a = 0; a < r->acoes_count; a++) {
                            int idx = device_index_from_name(r->acoes[a].dispositivo);
                            if (idx >= 0 && idx < 6 && action_command_is_on(r->acoes[a].comando)) {
                                g_auto_off_until_ms[idx] = off_at;
                                ESP_LOGI(TAG, "TEMPO auto-off agendado: idx=%d off_at=%lld ms", idx, (long long)off_at);
                            }
                        }
                    }
                }
            }
        }

    }

    static const char *s_dev_names[6] = {"EXAUSTAO","IRRIGACAO","UMIDIFICADOR","DESUMIDIFICADOR","AQUECEDOR","LUZ"};
    for (int i = 0; i < 6; i++) {
        if (g_auto_off_until_ms[i] > 0 && now_ms >= g_auto_off_until_ms[i]) {
            ESP_LOGI(TAG, "TEMPO auto-off disparou: idx=%d now=%lld off_at=%lld", i, (long long)now_ms, (long long)g_auto_off_until_ms[i]);
            desired[i] = false;
            g_auto_off_until_ms[i] = 0;
            char ao_log[64];
            snprintf(ao_log, sizeof(ao_log), "TEMPO auto-off: %s desligado", s_dev_names[i]);
            publish_iot_log("info", ao_log);
        }
    }

    if (memcmp(current, desired, sizeof(desired)) != 0) {
        ESP_LOGI(TAG, "regras aplicaram mudanca: ex=%d ir=%d hum=%d dehum=%d heat=%d light=%d",
                 desired[0], desired[1], desired[2], desired[3], desired[4], desired[5]);
        apply_actuator_state(
            desired[0], desired[1], desired[2],
            desired[3], desired[4], desired[5]
        );
    }
}

static void apply_device_map_json(cJSON *root)
{
    cJSON *device_map = cJSON_GetObjectItemCaseSensitive(root, "device_map");
    if (!cJSON_IsObject(device_map)) {
        ESP_LOGW(TAG, "bootstrap sem device_map");
        return;
    }
    ESP_LOGI(TAG, "bootstrap com device_map recebido");

    cJSON *act = cJSON_GetObjectItemCaseSensitive(device_map, "actuator_ports");
    if (cJSON_IsObject(act)) {
        struct { const char *key; gpio_num_t *pin; } table[] = {
            {"EXAUSTAO", &g_io_map.exhaust_pin},
            {"IRRIGACAO", &g_io_map.irrigation_pin},
            {"UMIDIFICADOR", &g_io_map.humidifier_pin},
            {"DESUMIDIFICADOR", &g_io_map.dehumidifier_pin},
            {"AQUECEDOR", &g_io_map.heater_pin},
            {"LUZ", &g_io_map.light_pin},
        };
        for (size_t i = 0; i < sizeof(table) / sizeof(table[0]); i++) {
            cJSON *v = cJSON_GetObjectItemCaseSensitive(act, table[i].key);
            if (cJSON_IsString(v) && v->valuestring != NULL && v->valuestring[0] != '\0') {
                int pin = parse_gpio_label(v->valuestring);
                if (can_use_as_output(pin)) {
                    *table[i].pin = (gpio_num_t)pin;
                    ESP_LOGI(TAG, "atuador %s -> GPIO%d", table[i].key, pin);
                } else {
                    ESP_LOGW(TAG, "porta de atuador invalida %s=%s", table[i].key, v->valuestring);
                }
            }
        }
    }

    cJSON *sens = cJSON_GetObjectItemCaseSensitive(device_map, "sensor_ports");
    if (cJSON_IsObject(sens)) {
        g_io_map.dht_enabled = false;
        int temp_pin = -1, air_pin = -1;
        cJSON *t = cJSON_GetObjectItemCaseSensitive(sens, "TEMPERATURA");
        cJSON *a = cJSON_GetObjectItemCaseSensitive(sens, "UMIDADE_AR");
        if (cJSON_IsString(t) && t->valuestring != NULL && t->valuestring[0] != '\0') {
            temp_pin = parse_gpio_label(t->valuestring);
        }
        if (cJSON_IsString(a) && a->valuestring != NULL && a->valuestring[0] != '\0') {
            air_pin = parse_gpio_label(a->valuestring);
        }
        int dht_pin = -1;
        if (temp_pin >= 0 && air_pin >= 0) {
            if (temp_pin == air_pin) {
                dht_pin = temp_pin;
            } else {
                // DHT entrega temperatura e umidade no MESMO pino.
                ESP_LOGW(TAG, "DHT invalido: TEMPERATURA=GPIO%d e UMIDADE_AR=GPIO%d (precisa ser a mesma porta). DHT desativado.", temp_pin, air_pin);
                dht_pin = -1;
            }
        } else if (temp_pin >= 0) {
            dht_pin = temp_pin;
        } else if (air_pin >= 0) {
            dht_pin = air_pin;
        }

        if (can_use_as_output(dht_pin)) {
            g_io_map.dht_pin = (gpio_num_t)dht_pin;
            g_io_map.dht_enabled = true;
            ESP_LOGI(TAG, "DHT (temperatura+umidade ar) -> GPIO%d", dht_pin);
        } else if (dht_pin >= 0) {
            ESP_LOGW(TAG, "porta DHT invalida: %d", dht_pin);
        } else {
            ESP_LOGI(TAG, "DHT desativado (sem configuracao valida de TEMPERATURA/UMIDADE_AR)");
        }

        g_io_map.soil_count = 0;
        // backward compat: UMIDADE_SOLO sem nÃºmero = sensor 1
        cJSON *soil0 = cJSON_GetObjectItemCaseSensitive(sens, "UMIDADE_SOLO");
        if (cJSON_IsString(soil0) && soil0->valuestring && soil0->valuestring[0]) {
            int p = parse_gpio_label(soil0->valuestring);
            adc_channel_t ch;
            if (adc_channel_from_gpio(p, &ch) && g_io_map.soil_count < MAX_SOIL_SENSORS) {
                g_io_map.soil_channels[g_io_map.soil_count++] = ch;
                ESP_LOGI(TAG, "UMIDADE_SOLO -> GPIO%d (ch=%d)", p, (int)ch);
            } else {
                ESP_LOGW(TAG, "UMIDADE_SOLO invalido para ADC1: %s", soil0->valuestring);
            }
        }
        for (int n = 1; n <= MAX_SOIL_SENSORS; n++) {
            char skey[24];
            snprintf(skey, sizeof(skey), "UMIDADE_SOLO_%d", n);
            cJSON *soilN = cJSON_GetObjectItemCaseSensitive(sens, skey);
            if (cJSON_IsString(soilN) && soilN->valuestring && soilN->valuestring[0]) {
                int p = parse_gpio_label(soilN->valuestring);
                adc_channel_t ch;
                if (adc_channel_from_gpio(p, &ch) && g_io_map.soil_count < MAX_SOIL_SENSORS) {
                    g_io_map.soil_channels[g_io_map.soil_count++] = ch;
                    ESP_LOGI(TAG, "UMIDADE_SOLO_%d -> GPIO%d (ch=%d)", n, p, (int)ch);
                } else if (g_io_map.soil_count >= MAX_SOIL_SENSORS) {
                    ESP_LOGW(TAG, "limite de %d sensores de solo atingido", MAX_SOIL_SENSORS);
                    break;
                } else {
                    ESP_LOGW(TAG, "%s invalido para ADC1: %s", skey, soilN->valuestring);
                }
            }
        }

        cJSON *light = cJSON_GetObjectItemCaseSensitive(sens, "LUMINOSIDADE");
        if (cJSON_IsString(light) && light->valuestring != NULL && light->valuestring[0] != '\0') {
            int p = parse_gpio_label(light->valuestring);
            adc_channel_t ch;
            if (adc_channel_from_gpio(p, &ch)) {
                g_io_map.light_adc_channel = ch;
                g_io_map.light_adc_enabled = true;
                ESP_LOGI(TAG, "LUMINOSIDADE -> GPIO%d (ADC1 ch=%d)", p, (int)ch);
            } else {
                ESP_LOGW(TAG, "porta LUMINOSIDADE invalida para ADC1: %s", light->valuestring);
            }
        }
    }

    configure_hardware_from_map();
    log_io_map("bootstrap_applied");

    // Log MQTT do mapa configurado para debug remoto
    char dm_log[128];
    int dpos = snprintf(dm_log, sizeof(dm_log), "device_map: dht=%d solo=%d",
                        g_io_map.dht_enabled ? 1 : 0, g_io_map.soil_count);
    for (int i = 0; i < g_io_map.soil_count && dpos < (int)sizeof(dm_log) - 12; i++) {
        dpos += snprintf(dm_log + dpos, sizeof(dm_log) - dpos, " s%d=ch%d", i + 1, (int)g_io_map.soil_channels[i]);
    }
    if (g_io_map.light_adc_enabled) {
        snprintf(dm_log + dpos, sizeof(dm_log) - dpos, " luz=ch%d", (int)g_io_map.light_adc_channel);
    }
    publish_iot_log("info", dm_log);
}

static void publish_ack(const parsed_cmd_t *cmd, const char *status, const char *detail)
{
    if (mqtt_client == NULL) {
        return;
    }
    char payload[320];
    snprintf(payload, sizeof(payload),
             "{\"type\":\"ack\",\"msg_id\":\"%s\",\"cmd\":\"%s\",\"status\":\"%s\",\"detail\":\"%s\"}",
             cmd->msg_id[0] ? cmd->msg_id : "-",
             cmd->type == CMD_ACTUATOR_STATE ? "actuator_state" :
             (cmd->type == CMD_ACTUATOR_PATCH ? "actuator_patch" :
             (cmd->type == CMD_BOOTSTRAP_REFRESH ? "bootstrap_refresh" :
             (cmd->type == CMD_OTA_UPDATE ? "ota_update" : "unknown"))),
             status ? status : "unknown",
             detail ? detail : "");
    esp_mqtt_client_publish(mqtt_client, MQTT_ACK_TOPIC, payload, 0, 0, 0);
    ESP_LOGI(TAG, "ACK -> %s", payload);
}

static bool json_get_bool(cJSON *obj, const char *key, bool *out)
{
    cJSON *it = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (!it || !cJSON_IsBool(it)) {
        return false;
    }
    *out = cJSON_IsTrue(it);
    return true;
}

static bool parse_command_payload(const char *payload, parsed_cmd_t *out, char *err, size_t err_len)
{
    memset(out, 0, sizeof(*out));
    strncpy(out->msg_id, "-", sizeof(out->msg_id) - 1);
    cJSON *root = cJSON_Parse(payload);
    if (!root || !cJSON_IsObject(root)) {
        snprintf(err, err_len, "json_invalido");
        if (root) cJSON_Delete(root);
        return false;
    }

    cJSON *msg_id = cJSON_GetObjectItemCaseSensitive(root, "msg_id");
    if (cJSON_IsString(msg_id) && msg_id->valuestring != NULL) {
        strncpy(out->msg_id, msg_id->valuestring, sizeof(out->msg_id) - 1);
    }

    cJSON *src = cJSON_GetObjectItemCaseSensitive(root, "source");
    if (cJSON_IsString(src) && src->valuestring != NULL) {
        strncpy(out->source, src->valuestring, sizeof(out->source) - 1);
    }

    cJSON *type = cJSON_GetObjectItemCaseSensitive(root, "type");
    if (!cJSON_IsString(type) || type->valuestring == NULL) {
        snprintf(err, err_len, "type_obrigatorio");
        cJSON_Delete(root);
        return false;
    }

    if (strcmp(type->valuestring, "bootstrap_refresh") == 0) {
        out->type = CMD_BOOTSTRAP_REFRESH;
        cJSON *reason = cJSON_GetObjectItemCaseSensitive(root, "reason");
        if (cJSON_IsString(reason) && reason->valuestring != NULL) {
            strncpy(out->reason, reason->valuestring, sizeof(out->reason) - 1);
        }
        const char *time_keys[] = {
            "server_time",
            "server_datetime",
            "current_time",
            "requested_at",
            "timestamp",
        };
        for (size_t i = 0; i < sizeof(time_keys) / sizeof(time_keys[0]); i++) {
            cJSON *t = cJSON_GetObjectItemCaseSensitive(root, time_keys[i]);
            if (cJSON_IsString(t) && t->valuestring != NULL && t->valuestring[0] != '\0') {
                strncpy(out->server_time, t->valuestring, sizeof(out->server_time) - 1);
                break;
            }
        }
        ESP_LOGI(TAG, "CMD parseado: bootstrap_refresh msg_id=%s reason=%s",
                 out->msg_id, out->reason[0] ? out->reason : "-");
        cJSON_Delete(root);
        return true;
    }
    if (strcmp(type->valuestring, "ota_update") == 0) {
        out->type = CMD_OTA_UPDATE;

        cJSON *version_pre = cJSON_GetObjectItemCaseSensitive(root, "version");
        if (!cJSON_IsNumber(version_pre)) {
            snprintf(err, err_len, "ota_version_invalida");
            cJSON_Delete(root);
            return false;
        }
        out->ota_version = version_pre->valueint;
        snprintf(out->ota_url, sizeof(out->ota_url), OTA_FIRMWARE_BASE "?v=%d", out->ota_version);

        cJSON *sha = cJSON_GetObjectItemCaseSensitive(root, "sha256");
        if (cJSON_IsString(sha) && sha->valuestring != NULL) {
            strncpy(out->ota_sha256, sha->valuestring, sizeof(out->ota_sha256) - 1);
        }

        ESP_LOGI(TAG, "CMD parseado: ota_update msg_id=%s version=%d url=%s",
                 out->msg_id, out->ota_version, out->ota_url);
        cJSON_Delete(root);
        return true;
    }
    if (strcmp(type->valuestring, "actuator_patch") == 0) {
        out->type = CMD_ACTUATOR_PATCH;
        cJSON *disp = cJSON_GetObjectItemCaseSensitive(root, "dispositivo");
        cJSON *cmd = cJSON_GetObjectItemCaseSensitive(root, "comando");
        if (!cJSON_IsString(disp) || disp->valuestring == NULL || disp->valuestring[0] == '\0' ||
            !cJSON_IsString(cmd) || cmd->valuestring == NULL || cmd->valuestring[0] == '\0') {
            snprintf(err, err_len, "actuator_patch_invalido");
            cJSON_Delete(root);
            return false;
        }
        strncpy(out->patch_dispositivo, disp->valuestring, sizeof(out->patch_dispositivo) - 1);
        strncpy(out->patch_comando, cmd->valuestring, sizeof(out->patch_comando) - 1);
        ESP_LOGI(TAG, "CMD parseado: actuator_patch msg_id=%s %s=%s",
                 out->msg_id, out->patch_dispositivo, out->patch_comando);
        cJSON_Delete(root);
        return true;
    }
    if (strcmp(type->valuestring, "actuator_state") == 0) {
        out->type = CMD_ACTUATOR_STATE;
    } else {
        snprintf(err, err_len, "type_desconhecido");
        cJSON_Delete(root);
        return false;
    }

    bool ok =
        json_get_bool(root, "exhaust_on", &out->exhaust_on) &&
        json_get_bool(root, "irrigation_on", &out->irrigation_on) &&
        json_get_bool(root, "humidifier_on", &out->humidifier_on) &&
        json_get_bool(root, "dehumidifier_on", &out->dehumidifier_on) &&
        json_get_bool(root, "heater_on", &out->heater_on) &&
        json_get_bool(root, "light_on", &out->light_on);
    cJSON_Delete(root);
    if (!ok) {
        snprintf(err, err_len, "campos_atuador_invalidos");
        return false;
    }
    ESP_LOGI(TAG,
             "CMD parseado: actuator_state msg_id=%s ex=%d ir=%d hum=%d dehum=%d heat=%d light=%d",
             out->msg_id,
             out->exhaust_on ? 1 : 0,
             out->irrigation_on ? 1 : 0,
             out->humidifier_on ? 1 : 0,
             out->dehumidifier_on ? 1 : 0,
             out->heater_on ? 1 : 0,
             out->light_on ? 1 : 0);
    return true;
}

static esp_err_t perform_ota_update(const char *url, const char *expected_sha256)
{
    if (url == NULL || url[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }

    const esp_partition_t *update_partition = esp_ota_get_next_update_partition(NULL);
    if (update_partition == NULL) {
        ESP_LOGE(TAG, "OTA sem particao de update (configure TWO_OTA)");
        return ESP_FAIL;
    }

    esp_http_client_config_t cfg = {
        .url = url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = 10000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        return ESP_FAIL;
    }

    esp_err_t err = esp_http_client_open(client, 0);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "OTA open falhou: %s", esp_err_to_name(err));
        esp_http_client_cleanup(client);
        return err;
    }

    int64_t hdr_len = esp_http_client_fetch_headers(client);
    int status = esp_http_client_get_status_code(client);
    bool chunked = esp_http_client_is_chunked_response(client);
    ESP_LOGI(TAG, "OTA HTTP status=%d hdr_len=%lld chunked=%d",
             status, (long long)hdr_len, chunked ? 1 : 0);
    if (status < 200 || status >= 300) {
        ESP_LOGE(TAG, "OTA HTTP status invalido: %d", status);
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        return ESP_FAIL;
    }

    esp_ota_handle_t ota_handle = 0;
    err = esp_ota_begin(update_partition, OTA_SIZE_UNKNOWN, &ota_handle);
    if (err != ESP_OK) {
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        return err;
    }

    char buf[1024];
    int total = 0;
    while (1) {
        int n = esp_http_client_read(client, buf, sizeof(buf));
        if (n < 0) {
            err = ESP_FAIL;
            break;
        }
        if (n == 0) {
            break;
        }
        err = esp_ota_write(ota_handle, buf, n);
        if (err != ESP_OK) {
            break;
        }
        total += n;
    }
    esp_http_client_close(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK || total <= 0) {
        esp_ota_end(ota_handle);
        return err != ESP_OK ? err : ESP_FAIL;
    }

    if (expected_sha256 != NULL && expected_sha256[0] != '\0') {
        ESP_LOGW(TAG, "SHA256 recebido (%s), mas validacao local desabilitada neste build", expected_sha256);
    }

    err = esp_ota_end(ota_handle);
    if (err != ESP_OK) {
        return err;
    }
    err = esp_ota_set_boot_partition(update_partition);
    if (err != ESP_OK) {
        return err;
    }

    ESP_LOGI(TAG, "OTA concluido com sucesso (%d bytes)", total);
    publish_iot_log("info", "ota_update_ok");
    return ESP_OK;
}

static esp_err_t bootstrap_http_refresh(const char *url)
{
    esp_err_t result = ESP_FAIL;
    char *body = NULL;
    char request_url[384] = {0};

    build_bootstrap_request_url(url, request_url, sizeof(request_url));

    ESP_LOGI(TAG, "Bootstrap HTTP GET: %s", request_url);
    esp_http_client_config_t cfg = {
        .url = request_url,
        .method = HTTP_METHOD_GET,
        .timeout_ms = 5000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        return ESP_FAIL;
    }
    esp_err_t err = esp_http_client_open(client, 0);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Bootstrap open falhou: %s", esp_err_to_name(err));
        result = err;
        goto cleanup;
    }
    int64_t hdr_len = esp_http_client_fetch_headers(client);
    int status = esp_http_client_get_status_code(client);
    bool chunked = esp_http_client_is_chunked_response(client);
    ESP_LOGI(TAG, "Bootstrap HTTP status=%d hdr_len=%lld chunked=%d", status, (long long)hdr_len, chunked ? 1 : 0);
    if (status < 200 || status >= 300) {
        goto cleanup;
    }

    int content_len = esp_http_client_get_content_length(client);
    size_t body_cap = 4096;
    if (content_len > 0 && content_len < 16384) {
        body_cap = (size_t)content_len + 1;
    }

    body = malloc(body_cap);
    if (body == NULL) {
        ESP_LOGW(TAG, "Bootstrap sem memoria para body (%u bytes)", (unsigned)body_cap);
        result = ESP_ERR_NO_MEM;
        goto cleanup;
    }

    int total = 0;
    while (total < (int)body_cap - 1) {
        int r = esp_http_client_read(client, body + total, (int)body_cap - 1 - total);
        if (r < 0) {
            ESP_LOGW(TAG, "Bootstrap read falhou");
            goto cleanup;
        }
        if (r == 0) {
            break;
        }
        total += r;
    }
    if (total <= 0) {
        ESP_LOGW(TAG, "Bootstrap sem body");
        goto cleanup;
    }
    body[total] = '\0';
    ESP_LOGI(TAG, "Bootstrap body bytes=%d", total);

    cJSON *root = cJSON_Parse(body);
    if (!root || !cJSON_IsObject(root)) {
        if (root) cJSON_Delete(root);
        ESP_LOGW(TAG, "Bootstrap JSON invalido");
        goto cleanup;
    }

    apply_device_map_json(root);
    parse_rules_from_bootstrap(root);

    cJSON *st = cJSON_GetObjectItemCaseSensitive(root, "estado_atual_atuadores");
    if (cJSON_IsObject(st)) {
        bool ex = false, ir = false, hu = false, de = false, he = false, li = false;
        if (json_get_bool(st, "exhaust_on", &ex) &&
            json_get_bool(st, "irrigation_on", &ir) &&
            json_get_bool(st, "humidifier_on", &hu) &&
            json_get_bool(st, "dehumidifier_on", &de) &&
            json_get_bool(st, "heater_on", &he) &&
            json_get_bool(st, "light_on", &li)) {
            apply_actuator_state(ex, ir, hu, de, he, li);
        }
    }

    g_manual_lock = false;
    g_manual_lock_until_ms = 0;

    // Aplica imediatamente as regras de janela para evitar ligar atuador fora do periodo.
    sensor_snapshot_t bootstrap_snapshot = {0};
    local_rules_tick(&bootstrap_snapshot);

    cJSON_Delete(root);
    ESP_LOGI(TAG, "Bootstrap aplicado com sucesso - modo auto ativo");
    publish_iot_log("info", "bootstrap_aplicado");
    result = ESP_OK;

cleanup:
    if (body != NULL) {
        free(body);
    }
    esp_http_client_cleanup(client);
    return result;
}

static void apply_actuator_state(bool exhaust_on, bool irrigation_on, bool humidifier_on,
                                 bool dehumidifier_on, bool heater_on, bool light_on)
{
    // Atuador sem GPIO mapeado/valido nunca deve permanecer "on" no estado logico.
    if (!can_use_as_output(g_io_map.exhaust_pin)) exhaust_on = false;
    if (!can_use_as_output(g_io_map.irrigation_pin)) irrigation_on = false;
    if (!can_use_as_output(g_io_map.humidifier_pin)) humidifier_on = false;
    if (!can_use_as_output(g_io_map.dehumidifier_pin)) dehumidifier_on = false;
    if (!can_use_as_output(g_io_map.heater_pin)) heater_on = false;
    if (!can_use_as_output(g_io_map.light_pin)) light_on = false;

    int ex_lvl = bool_to_gpio_level(exhaust_on);
    int ir_lvl = bool_to_gpio_level(irrigation_on);
    int hu_lvl = bool_to_gpio_level(humidifier_on);
    int de_lvl = bool_to_gpio_level(dehumidifier_on);
    int he_lvl = bool_to_gpio_level(heater_on);
    int li_lvl = bool_to_gpio_level(light_on);

    if (can_use_as_output(g_io_map.exhaust_pin)) gpio_set_level(g_io_map.exhaust_pin, ex_lvl);
    if (can_use_as_output(g_io_map.irrigation_pin)) gpio_set_level(g_io_map.irrigation_pin, ir_lvl);
    if (can_use_as_output(g_io_map.humidifier_pin)) gpio_set_level(g_io_map.humidifier_pin, hu_lvl);
    if (can_use_as_output(g_io_map.dehumidifier_pin)) gpio_set_level(g_io_map.dehumidifier_pin, de_lvl);
    if (can_use_as_output(g_io_map.heater_pin)) gpio_set_level(g_io_map.heater_pin, he_lvl);
    if (can_use_as_output(g_io_map.light_pin)) gpio_set_level(g_io_map.light_pin, li_lvl);

    ESP_LOGI(TAG, "Actuators req -> ex=%d ir=%d hum=%d dehum=%d heat=%d light=%d",
             exhaust_on, irrigation_on, humidifier_on, dehumidifier_on, heater_on, light_on);
    ESP_LOGI(TAG, "Actuators gpio_lvl -> ex=%d ir=%d hum=%d dehum=%d heat=%d light=%d",
             ex_lvl, ir_lvl, hu_lvl, de_lvl, he_lvl, li_lvl);
    char log_msg[160];
    snprintf(log_msg, sizeof(log_msg),
             "actuators ex=%d ir=%d hum=%d dehum=%d heat=%d light=%d",
             exhaust_on ? 1 : 0, irrigation_on ? 1 : 0, humidifier_on ? 1 : 0,
             dehumidifier_on ? 1 : 0, heater_on ? 1 : 0, light_on ? 1 : 0);
    publish_iot_log("info", log_msg);
    publish_actuator_line("EXAUSTAO", (int)g_io_map.exhaust_pin, exhaust_on, ex_lvl);
    publish_actuator_line("IRRIGACAO", (int)g_io_map.irrigation_pin, irrigation_on, ir_lvl);
    publish_actuator_line("UMIDIFICADOR", (int)g_io_map.humidifier_pin, humidifier_on, hu_lvl);
    publish_actuator_line("DESUMIDIFICADOR", (int)g_io_map.dehumidifier_pin, dehumidifier_on, de_lvl);
    publish_actuator_line("AQUECEDOR", (int)g_io_map.heater_pin, heater_on, he_lvl);
    publish_actuator_line("LUZ", (int)g_io_map.light_pin, light_on, li_lvl);
    publish_actuator_state("local_apply");
}

static void build_bootstrap_request_url(const char *base_url, char *out, size_t out_len)
{
    if (!out || out_len == 0) return;
    out[0] = '\0';

    if (!base_url || base_url[0] == '\0') {
        return;
    }

    int64_t uptime_ms = esp_timer_get_time() / 1000;
    time_t epoch = time(NULL);
    const char *sep = strchr(base_url, '?') ? "&" : "?";

    if ((int64_t)epoch >= SYSTEM_TIME_VALID_AFTER_EPOCH) {
        snprintf(out, out_len, "%s%sdevice_epoch=%lld&device_uptime_ms=%lld",
                 base_url, sep, (long long)epoch, (long long)uptime_ms);
    } else {
        snprintf(out, out_len, "%s%sdevice_uptime_ms=%lld",
                 base_url, sep, (long long)uptime_ms);
    }
}

static void publish_actuator_state(const char *reason)
{
    if (mqtt_client == NULL) {
        return;
    }

    bool ex = can_use_as_output(g_io_map.exhaust_pin) ? gpio_level_to_bool(gpio_get_level(g_io_map.exhaust_pin)) : false;
    bool ir = can_use_as_output(g_io_map.irrigation_pin) ? gpio_level_to_bool(gpio_get_level(g_io_map.irrigation_pin)) : false;
    bool hu = can_use_as_output(g_io_map.humidifier_pin) ? gpio_level_to_bool(gpio_get_level(g_io_map.humidifier_pin)) : false;
    bool de = can_use_as_output(g_io_map.dehumidifier_pin) ? gpio_level_to_bool(gpio_get_level(g_io_map.dehumidifier_pin)) : false;
    bool he = can_use_as_output(g_io_map.heater_pin) ? gpio_level_to_bool(gpio_get_level(g_io_map.heater_pin)) : false;
    bool li = can_use_as_output(g_io_map.light_pin) ? gpio_level_to_bool(gpio_get_level(g_io_map.light_pin)) : false;

    char payload[320];
    snprintf(payload, sizeof(payload),
             "{\"source\":\"iot\",\"reason\":\"%s\",\"exhaust_on\":%s,\"irrigation_on\":%s,\"humidifier_on\":%s,\"dehumidifier_on\":%s,\"heater_on\":%s,\"light_on\":%s}",
             reason ? reason : "unknown",
             ex ? "true" : "false",
             ir ? "true" : "false",
             hu ? "true" : "false",
             de ? "true" : "false",
             he ? "true" : "false",
             li ? "true" : "false");

    esp_mqtt_client_publish(mqtt_client, MQTT_ACTUATOR_STATE_TOPIC, payload, 0, 0, 0);
    ESP_LOGI(TAG, "Actuator state TX -> %s", payload);
}

static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    (void)handler_args;
    (void)base;
    esp_mqtt_event_handle_t event = event_data;

    if (event_id == MQTT_EVENT_CONNECTED) {
        ESP_LOGI(TAG, "MQTT connected");
        int mid = esp_mqtt_client_subscribe(mqtt_client, MQTT_COMMAND_TOPIC, 0);
        ESP_LOGI(TAG, "MQTT subscribe topic=%s mid=%d", MQTT_COMMAND_TOPIC, mid);
        publish_iot_log("info", "mqtt_connected");
        publish_actuator_state("mqtt_connected");
        return;
    }

    if (event_id == MQTT_EVENT_DISCONNECTED) {
        ESP_LOGW(TAG, "MQTT disconnected");
        publish_iot_log("warn", "mqtt_disconnected");
        return;
    }

    if (event_id == MQTT_EVENT_DATA) {
        char topic[128] = {0};
        char payload[384] = {0};

        int tlen = event->topic_len < (int)sizeof(topic) - 1 ? event->topic_len : (int)sizeof(topic) - 1;
        int plen = event->data_len < (int)sizeof(payload) - 1 ? event->data_len : (int)sizeof(payload) - 1;

        memcpy(topic, event->topic, tlen);
        memcpy(payload, event->data, plen);
        ESP_LOGI(TAG, "MQTT RX topic=%s payload=%s", topic, payload);

        if (strcmp(topic, MQTT_COMMAND_TOPIC) == 0 && mqtt_msg_queue != NULL) {
            mqtt_queue_msg_t msg = {0};
            strncpy(msg.payload, payload, sizeof(msg.payload) - 1);
            if (xQueueSend(mqtt_msg_queue, &msg, 0) != pdTRUE) {
                ESP_LOGW(TAG, "Fila MQTT cheia, descartando comando");
            } else {
                ESP_LOGI(TAG, "Comando enfileirado para processamento");
            }
        }
    }
}

static void mqtt_command_worker_task(void *arg)
{
    (void)arg;
    mqtt_queue_msg_t msg;
    while (1) {
        if (xQueueReceive(mqtt_msg_queue, &msg, portMAX_DELAY) != pdTRUE) {
            continue;
        }
        ESP_LOGI(TAG, "Worker recebeu comando: %s", msg.payload);

        parsed_cmd_t cmd = {0};
        char err[80] = {0};
        if (!parse_command_payload(msg.payload, &cmd, err, sizeof(err))) {
            parsed_cmd_t unknown = {0};
            strncpy(unknown.msg_id, "-", sizeof(unknown.msg_id) - 1);
            publish_ack(&unknown, "error", err);
            ESP_LOGW(TAG, "Comando invalido: %s", err);
            continue;
        }

        if (cmd.type == CMD_ACTUATOR_STATE) {
            if (strcmp(cmd.source, "manual_lock") == 0) {
                g_manual_lock = true;
                g_manual_lock_until_ms = 0;
                ESP_LOGI(TAG, "Modo manual travado ativado - regras locais pausadas");
                publish_iot_log("info", "cmd_manual_lock_on");
            } else if (strcmp(cmd.source, "manual") == 0) {
                g_manual_lock = true;
                g_manual_lock_until_ms = (esp_timer_get_time() / 1000) + (120 * 1000);
                ESP_LOGI(TAG, "Modo manual ativado por 120s - regras locais pausadas");
                publish_iot_log("info", "cmd_manual_received");
            } else if (strcmp(cmd.source, "auto") == 0) {
                g_manual_lock = false;
                g_manual_lock_until_ms = 0;
                ESP_LOGI(TAG, "Modo automatico reativado");
                publish_iot_log("info", "cmd_manual_lock_off");
            } else if (g_manual_lock && cmd.source[0] != '\0') {
                g_manual_lock = false;
                g_manual_lock_until_ms = 0;
                ESP_LOGI(TAG, "Modo auto restaurado via cmd source=%s", cmd.source);
                publish_iot_log("info", "cmd_auto_restore");
            }
            apply_actuator_state(
                cmd.exhaust_on,
                cmd.irrigation_on,
                cmd.humidifier_on,
                cmd.dehumidifier_on,
                cmd.heater_on,
                cmd.light_on
            );
            sensor_snapshot_t cmd_snapshot = {0};
            local_rules_tick(&cmd_snapshot);
            publish_ack(&cmd, "ok", "atuadores_aplicados");
            continue;
        }

        if (cmd.type == CMD_ACTUATOR_PATCH) {
            bool ex = false, ir = false, hu = false, de = false, he = false, li = false;
            bool cur[6] = {0};
            read_current_actuator_state(cur);
            ex = cur[0]; ir = cur[1]; hu = cur[2]; de = cur[3]; he = cur[4]; li = cur[5];

            int idx = device_index_from_name(cmd.patch_dispositivo);
            bool on = action_command_is_on(cmd.patch_comando);
            if (idx < 0) {
                publish_ack(&cmd, "error", "actuator_patch_dispositivo_invalido");
                continue;
            }
            if (idx == 0) ex = on;
            if (idx == 1) ir = on;
            if (idx == 2) hu = on;
            if (idx == 3) de = on;
            if (idx == 4) he = on;
            if (idx == 5) li = on;

            if (strcmp(cmd.source, "manual_lock") == 0) {
                g_manual_lock = true;
                g_manual_lock_until_ms = 0;
                publish_iot_log("info", "cmd_manual_lock_on");
            } else if (strcmp(cmd.source, "manual") == 0) {
                g_manual_lock = true;
                g_manual_lock_until_ms = (esp_timer_get_time() / 1000) + (120 * 1000);
                publish_iot_log("info", "cmd_manual_received");
            } else if (strcmp(cmd.source, "auto") == 0) {
                g_manual_lock = false;
                g_manual_lock_until_ms = 0;
                publish_iot_log("info", "cmd_manual_lock_off");
            }

            apply_actuator_state(ex, ir, hu, de, he, li);
            sensor_snapshot_t cmd_snapshot = {0};
            local_rules_tick(&cmd_snapshot);
            publish_ack(&cmd, "ok", "actuator_patch_aplicado");
            continue;
        }

        if (cmd.type == CMD_BOOTSTRAP_REFRESH) {
            if (cmd.server_time[0] != '\0') {
                set_server_time_from_iso(cmd.server_time, "cmd/bootstrap_refresh");
            } else {
                sync_server_time_from_system("cmd/bootstrap_refresh");
            }
            int64_t now_ms = esp_timer_get_time() / 1000;
            if (g_last_bootstrap_refresh_ms > 0 && (now_ms - g_last_bootstrap_refresh_ms) < 1000) {
                ESP_LOGW(TAG, "bootstrap_refresh ignorado por debounce");
                publish_iot_log("warn", "bootstrap_refresh_debounced");
                publish_ack(&cmd, "ok", "bootstrap_refresh_debounced");
                continue;
            }
            g_last_bootstrap_refresh_ms = now_ms;
            ESP_LOGI(TAG, "Executando bootstrap_refresh");
            publish_iot_log("info", "bootstrap_refresh_start");
            esp_err_t rc = bootstrap_http_refresh(BOOTSTRAP_URL);
            if (rc == ESP_OK) {
                publish_ack(&cmd, "ok", "bootstrap_refresh_executado");
                publish_iot_log("info", "bootstrap_refresh_ok");
            } else {
                publish_ack(&cmd, "error", "bootstrap_refresh_falhou");
                publish_iot_log("warn", "bootstrap_refresh_fail");
            }
            continue;
        }

        if (cmd.type == CMD_OTA_UPDATE) {
            ESP_LOGI(TAG, "Executando ota_update version=%d", cmd.ota_version);
            esp_err_t rc = perform_ota_update(cmd.ota_url, cmd.ota_sha256);
            if (rc == ESP_OK) {
                publish_ack(&cmd, "ok", "ota_aplicada_reiniciando");
                vTaskDelay(pdMS_TO_TICKS(800));
                esp_restart();
            } else {
                publish_ack(&cmd, "error", "ota_falhou");
            }
            continue;
        }

        publish_ack(&cmd, "error", "comando_nao_suportado");
    }
}

static void mqtt_start(void)
{
    snprintf(mqtt_uri, sizeof(mqtt_uri), "mqtt://%s:%d", MQTT_BROKER_IP, MQTT_BROKER_PORT);
    ESP_LOGI(TAG, "MQTT broker: %s", mqtt_uri);

    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = mqtt_uri,
    };

    mqtt_client = esp_mqtt_client_init(&mqtt_cfg);
    esp_mqtt_client_register_event(mqtt_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    ESP_LOGI(TAG, "Iniciando cliente MQTT");
    esp_mqtt_client_start(mqtt_client);
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    (void)arg;

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        ESP_LOGI(TAG, "Wi-Fi STA start");
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        esp_wifi_connect();
        xEventGroupClearBits(wifi_event_group, WIFI_CONNECTED_BIT);
        ESP_LOGW(TAG, "Wi-Fi disconnected, reconnecting");
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
        ip_event_got_ip_t *evt = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Wi-Fi connected ip=" IPSTR, IP2STR(&evt->ip_info.ip));
    }
}

static void wifi_init_sta(void)
{
    wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, NULL));

    wifi_config_t wifi_config = {
        .sta = {
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };

    strncpy((char *)wifi_config.sta.ssid, WIFI_SSID, sizeof(wifi_config.sta.ssid) - 1);
    strncpy((char *)wifi_config.sta.password, WIFI_PASS, sizeof(wifi_config.sta.password) - 1);

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    xEventGroupWaitBits(wifi_event_group, WIFI_CONNECTED_BIT, pdFALSE, pdFALSE, portMAX_DELAY);
}

static void gpio_init_all(void)
{
    init_default_io_map();
    configure_hardware_from_map();
    apply_actuator_state(false, false, false, false, false, false);
}

void app_main(void)
{
    ESP_ERROR_CHECK(nvs_flash_init());

    mqtt_msg_queue = xQueueCreate(MQTT_MSG_QUEUE_LEN, sizeof(mqtt_queue_msg_t));
    if (mqtt_msg_queue == NULL) {
        ESP_LOGE(TAG, "Falha ao criar fila MQTT");
        return;
    }
    xTaskCreate(mqtt_command_worker_task, "mqtt_cmd_worker", 6144, NULL, 8, NULL);

    gpio_init_all();
    wifi_init_sta();
    mqtt_start();
    ESP_LOGI(TAG, "Relay logic: %s (ON=%d OFF=%d)",
             ACTUATORS_ACTIVE_LOW ? "active-low" : "active-high",
             ACTUATOR_ON_LEVEL, ACTUATOR_OFF_LEVEL);
    char boot_msg[48];
    snprintf(boot_msg, sizeof(boot_msg), "firmware_boot_ok v%d", FIRMWARE_VERSION);
    publish_iot_log("info", boot_msg);

    esp_err_t b = bootstrap_http_refresh(BOOTSTRAP_URL);
    if (b == ESP_OK) {
        ESP_LOGI(TAG, "Bootstrap inicial aplicado");
    } else {
        ESP_LOGW(TAG, "Falha bootstrap inicial: %s", esp_err_to_name(b));
    }

    ESP_LOGI(TAG, "IoT Eden iniciado: DHT + MQTT");
    log_io_map("runtime_start");

    int loop_count = 0;
    while (1) {
        sensor_snapshot_t snapshot = {0};
        // Regras locais (HORARIO/DIA_SEMANA/TEMPO) devem funcionar mesmo sem sensores mapeados.
        local_rules_tick(&snapshot);

        if (!g_io_map.dht_enabled && g_io_map.soil_count == 0 && !g_io_map.light_adc_enabled) {
            ESP_LOGI(TAG, "Nenhum sensor configurado no bootstrap; sem publicacao de sensores");
            vTaskDelay(pdMS_TO_TICKS(3000));
            continue;
        }
        snapshot = read_all_sensors(&g_io_map, adc1_handle, &dht_mux, &dht_fail_stage);
        local_rules_tick(&snapshot);
        publish_sensor_snapshot(&snapshot, mqtt_client, MQTT_SENSOR_TOPIC, g_io_map.dht_enabled, dht_fail_stage);
        loop_count++;
        if ((loop_count % 10) == 0) {
            UBaseType_t hw = uxTaskGetStackHighWaterMark(NULL);
            ESP_LOGI(TAG, "main_task stack high-water=%u words", (unsigned)hw);
        }
        // Log de sensor a cada ~60s (20 ciclos de 3s)
        if ((loop_count % 20) == 0) {
            // Erros de leitura
            if (g_io_map.dht_enabled && !snapshot.dht_ok) {
                char err[64];
                snprintf(err, sizeof(err), "ERRO DHT leitura falhou (stage=%d)", dht_fail_stage);
                publish_iot_log("warn", err);
            }
            for (int si = 0; si < snapshot.soil_count; si++) {
                if (!snapshot.soil_ok[si]) {
                    char err[64];
                    snprintf(err, sizeof(err), "ERRO solo_%d nao leu (ADC ch=%d)", si + 1, (int)g_io_map.soil_channels[si]);
                    publish_iot_log("warn", err);
                }
            }
            // Leituras bem-sucedidas
            char slog[200];
            int pos = 0;
            if (snapshot.dht_ok) {
                pos += snprintf(slog + pos, sizeof(slog) - pos,
                                "sensor t=%.1f h_ar=%.1f",
                                snapshot.temperature_c, snapshot.humidity_pct);
            }
            for (int si = 0; si < snapshot.soil_count; si++) {
                if (snapshot.soil_ok[si]) {
                    pos += snprintf(slog + pos, sizeof(slog) - pos,
                                    " solo_%d=%d", si + 1, snapshot.soil_raw[si]);
                }
            }
            if (snapshot.light_ok) {
                pos += snprintf(slog + pos, sizeof(slog) - pos,
                                " luz=%d", snapshot.light_raw);
            }
            if (pos > 0) {
                publish_iot_log("info", slog);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(3000));
    }
}
