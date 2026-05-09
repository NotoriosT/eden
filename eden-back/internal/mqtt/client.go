package mqtt

import (
	"encoding/json"
	"log"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type Client struct {
	client mqtt.Client
}

func New(broker, clientID string, onConnect func(mqtt.Client)) *Client {
	opts := mqtt.NewClientOptions().AddBroker(broker).SetClientID(clientID).SetAutoReconnect(true)
	opts.SetOnConnectHandler(func(c mqtt.Client) { onConnect(c) })
	c := mqtt.NewClient(opts)
	if token := c.Connect(); token.Wait() && token.Error() != nil {
		log.Printf("mqtt connect warning: %v", token.Error())
	}
	return &Client{client: c}
}

func (c *Client) Subscribe(topic string, handler mqtt.MessageHandler) {
	if c == nil || c.client == nil {
		return
	}
	t := c.client.Subscribe(topic, 0, handler)
	if t.Wait() && t.Error() != nil {
		log.Printf("mqtt subscribe error: %v", t.Error())
	}
}

func (c *Client) PublishJSON(topic string, payload any) {
	if c == nil || c.client == nil || !c.client.IsConnected() {
		return
	}
	b, err := json.Marshal(payload)
	if err != nil {
		log.Printf("mqtt marshal error: %v", err)
		return
	}
	t := c.client.Publish(topic, 0, false, b)
	t.WaitTimeout(2 * time.Second)
}
