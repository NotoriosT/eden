package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"eden-iot/backend-go/internal/config"
	"eden-iot/backend-go/internal/domain"
	"eden-iot/backend-go/internal/mqtt"
	"eden-iot/backend-go/internal/repository"
	"eden-iot/backend-go/internal/service"
	"eden-iot/backend-go/internal/transport/httpapi"
	pmqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func main() {
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	mc, err := mongo.Connect(ctx, options.Client().ApplyURI(cfg.MongoURI))
	if err != nil {
		log.Fatal(err)
	}
	store := repository.NewStore(mc.Database(cfg.MongoDB))
	if err := store.SeedDefaults(context.Background()); err != nil {
		log.Fatal(err)
	}

	// Handlers defined before app so closures can reference app after assignment.
	var app *service.AppService

	sensorHandler := func(_ pmqtt.Client, msg pmqtt.Message) {
		var p service.SensorPayload
		if err := json.Unmarshal(msg.Payload(), &p); err != nil {
			log.Printf("invalid mqtt payload: %v", err)
			return
		}
		var raw map[string]any
		if err := json.Unmarshal(msg.Payload(), &raw); err == nil {
			p.SoilSensors = service.ParseSoilSensors(raw)
		}
		_ = app.ProcessReading(context.Background(), p)
	}

	stateHandler := func(_ pmqtt.Client, msg pmqtt.Message) {
		var st service.IoTActuatorStatePayload
		if err := json.Unmarshal(msg.Payload(), &st); err != nil {
			log.Printf("invalid actuator state payload: %v", err)
			return
		}
		if _, err := app.UpdateActuatorsFromIoT(context.Background(), st); err != nil {
			log.Printf("failed to persist actuator state from iot: %v", err)
		}
	}

	logHandler := func(_ pmqtt.Client, msg pmqtt.Message) {
		var in struct {
			Level   string `json:"level"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(msg.Payload(), &in); err != nil {
			log.Printf("invalid iot log payload: %v", err)
			return
		}
		if in.Message == "" {
			return
		}
		level := in.Level
		if level == "" {
			level = "info"
		}
		_ = store.SaveEvent(context.Background(), domain.EventLog{
			Timestamp: time.Now(),
			Type:      "iot_log",
			Source:    "iot",
			Message:   "[" + level + "] " + in.Message,
		})
	}

	// onConnect re-subscribes after reconnects (app is always ready by then).
	mq := mqtt.New(cfg.MQTTBroker, cfg.MQTTClientID, func(client pmqtt.Client) {
		if app == nil {
			return
		}
		client.Subscribe(cfg.MQTTSensorTopic, 0, sensorHandler)
		log.Printf("mqtt re-subscribed: %s", cfg.MQTTSensorTopic)
		client.Subscribe(cfg.MQTTStateTopic, 0, stateHandler)
		log.Printf("mqtt re-subscribed: %s", cfg.MQTTStateTopic)
		client.Subscribe(cfg.MQTTLogTopic, 0, logHandler)
		log.Printf("mqtt re-subscribed: %s", cfg.MQTTLogTopic)
	})

	app = service.New(store, mq, cfg.MQTTCommandTopic, cfg.PublicBaseURL, cfg.AutomationEngine)

	// Explicit initial subscription: onConnect fired during mqtt.New before app
	// was assigned, so we subscribe here now that app is ready.
	mq.Subscribe(cfg.MQTTSensorTopic, sensorHandler)
	log.Printf("mqtt subscribed: %s", cfg.MQTTSensorTopic)
	mq.Subscribe(cfg.MQTTStateTopic, stateHandler)
	log.Printf("mqtt subscribed: %s", cfg.MQTTStateTopic)
	mq.Subscribe(cfg.MQTTLogTopic, logHandler)
	log.Printf("mqtt subscribed: %s", cfg.MQTTLogTopic)

	r := gin.Default()
	h := httpapi.NewHandler(app)
	h.Register(r)

	log.Printf("api listening on :%s", cfg.Port)
	log.Fatal(r.Run(":" + cfg.Port))
}
