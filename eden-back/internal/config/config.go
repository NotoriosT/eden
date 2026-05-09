package config

import "os"

type Config struct {
	Port             string
	PublicBaseURL    string
	MongoURI         string
	MongoDB          string
	MQTTBroker       string
	MQTTClientID     string
	MQTTSensorTopic  string
	MQTTCommandTopic string
	MQTTStateTopic   string
	MQTTLogTopic     string
	AutomationEngine string
}

func Load() Config {
	return Config{
		Port:             env("PORT", "8080"),
		PublicBaseURL:    env("PUBLIC_BASE_URL", "http://192.168.1.104:8080"),
		MongoURI:         env("MONGO_URI", "mongodb://localhost:27017"),
		MongoDB:          env("MONGO_DB", "eden"),
		MQTTBroker:       env("MQTT_BROKER", "tcp://localhost:1883"),
		MQTTClientID:     env("MQTT_CLIENT_ID", "eden-go-backend"),
		MQTTSensorTopic:  env("MQTT_SENSOR_TOPIC", "eden/sensors/greenhouse"),
		MQTTCommandTopic: env("MQTT_COMMAND_TOPIC", "eden/actuators/cmd"),
		MQTTStateTopic:   env("MQTT_STATE_TOPIC", "eden/actuators/state"),
		MQTTLogTopic:     env("MQTT_LOG_TOPIC", "eden/iot/logs"),
		AutomationEngine: env("AUTOMATION_ENGINE", "esp"),
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
