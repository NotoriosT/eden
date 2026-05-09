$env:PUBLIC_BASE_URL  = "http://192.168.1.104:8080"
$env:MQTT_BROKER      = "tcp://localhost:1883"
$env:MONGO_URI        = "mongodb://localhost:27017"
$env:MONGO_DB         = "eden"
$env:AUTOMATION_ENGINE = "esp"

.\backend-go.exe
