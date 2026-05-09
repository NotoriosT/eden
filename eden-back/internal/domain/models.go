package domain

import "time"

// LimiteAcao é a ação executada quando sensor sai do limite (min ou max)
type LimiteAcao struct {
	Dispositivo     string `json:"dispositivo" bson:"dispositivo"`
	Comando         string `json:"comando" bson:"comando"` // LIGAR | DESLIGAR
	DuracaoMinutos  int    `json:"duracao_minutos,omitempty" bson:"duracao_minutos,omitempty"`
	DuracaoSegundos int    `json:"duracao_segundos,omitempty" bson:"duracao_segundos,omitempty"`
}

// AutomationRule — regra única de automação com tipo de parâmetro
type AutomationRule struct {
	ID            string `json:"id" bson:"id"`
	Name          string `json:"name" bson:"name"`
	TipoParametro string `json:"tipo_parametro" bson:"tipo_parametro"` // COMPARACAO | LIMITE | HORARIO | DIA_SEMANA | TEMPO
	Enabled       bool   `json:"enabled" bson:"enabled"`

	// Usado em COMPARACAO
	Operador string  `json:"operador,omitempty" bson:"operador,omitempty"` // > < >= <= ==
	Valor    float64 `json:"valor,omitempty" bson:"valor,omitempty"`

	// Usado em COMPARACAO + LIMITE
	VariavelSensor string `json:"variavel_sensor,omitempty" bson:"variavel_sensor,omitempty"` // TEMPERATURA | UMIDADE_AR | UMIDADE_SOLO | LUMINOSIDADE

	// Usado em LIMITE
	ValorMinimo       float64      `json:"valor_minimo,omitempty" bson:"valor_minimo,omitempty"`
	ValorMaximo       float64      `json:"valor_maximo,omitempty" bson:"valor_maximo,omitempty"`
	AcaoAbaixoMinimo  *LimiteAcao  `json:"acao_abaixo_minimo,omitempty" bson:"acao_abaixo_minimo,omitempty"`
	AcaoAcimaMaximo   *LimiteAcao  `json:"acao_acima_maximo,omitempty" bson:"acao_acima_maximo,omitempty"`
	AcoesAbaixoMinimo []LimiteAcao `json:"acoes_abaixo_minimo,omitempty" bson:"acoes_abaixo_minimo,omitempty"`
	AcoesAcimaMaximo  []LimiteAcao `json:"acoes_acima_maximo,omitempty" bson:"acoes_acima_maximo,omitempty"`

	// Usado em HORARIO | DIA_SEMANA | TEMPO
	Horario          string `json:"horario,omitempty" bson:"horario,omitempty"`                     // HH:MM
	DiasDoSemana     []int  `json:"dias_semana,omitempty" bson:"dias_semana,omitempty"`             // 0=Dom…6=Sáb
	IntervaloMinutos int    `json:"intervalo_minutos,omitempty" bson:"intervalo_minutos,omitempty"` // TEMPO: a cada X min
	DuracaoMinutos   int    `json:"duracao_minutos,omitempty" bson:"duracao_minutos,omitempty"`     // tempo ligado (min)
	DuracaoSegundos  int    `json:"duracao_segundos,omitempty" bson:"duracao_segundos,omitempty"`   // tempo ligado (s)

	// Ação principal (todos exceto LIMITE)
	Dispositivo string       `json:"dispositivo,omitempty" bson:"dispositivo,omitempty"` // LUZ | EXAUSTAO | IRRIGACAO | UMIDIFICADOR | DESUMIDIFICADOR | AQUECEDOR
	Comando     string       `json:"comando,omitempty" bson:"comando,omitempty"`         // LIGAR | DESLIGAR
	Acoes       []LimiteAcao `json:"acoes,omitempty" bson:"acoes,omitempty"`

	// Meta
	LastRunAt time.Time `json:"last_run_at,omitempty" bson:"last_run_at,omitempty"`
	CreatedAt time.Time `json:"created_at" bson:"created_at"`
}

type SensorReading struct {
	Timestamp    time.Time          `json:"timestamp" bson:"timestamp"`
	TemperatureC float64            `json:"temperature_c" bson:"temperature_c"`
	AirHumidity  float64            `json:"air_humidity" bson:"air_humidity"`
	SoilHumidity float64            `json:"soil_humidity" bson:"soil_humidity"`                   // primeiro sensor, backward compat
	SoilSensors  map[string]float64 `json:"soil_sensors,omitempty" bson:"soil_sensors,omitempty"` // "1","2",... → valor
	LightLevel   float64            `json:"light_level" bson:"light_level"`
}

type Plant struct {
	ID                    int       `json:"id" bson:"id"`
	Name                  string    `json:"name" bson:"name"`
	Species               string    `json:"species" bson:"species"`
	PhotoBase64           string    `json:"photo_base64,omitempty" bson:"photo_base64,omitempty"`
	PlantedAt             time.Time `json:"planted_at" bson:"planted_at"`
	CurrentPhase          string    `json:"current_phase" bson:"current_phase"`
	ExpectedFloweringDays int       `json:"expected_flowering_days" bson:"expected_flowering_days"`
	ExpectedHarvestDays   int       `json:"expected_harvest_days" bson:"expected_harvest_days"`
}

type PlantProgress struct {
	PlantID      int       `json:"plant_id" bson:"plant_id"`
	Date         time.Time `json:"date" bson:"date"`
	DayNumber    int       `json:"day_number" bson:"day_number"`
	Phase        string    `json:"phase" bson:"phase"`
	Observation  string    `json:"observation" bson:"observation"`
	ExpectedNext string    `json:"expected_next" bson:"expected_next"`
}

type EventLog struct {
	Timestamp time.Time `json:"timestamp" bson:"timestamp"`
	Type      string    `json:"type" bson:"type"`
	Message   string    `json:"message" bson:"message"`
	Source    string    `json:"source" bson:"source"`
}

type AutomationCondition struct {
	Parameter string  `json:"parameter" bson:"parameter"`
	Operator  string  `json:"operator" bson:"operator"`
	Value     float64 `json:"value" bson:"value"`
}

type AutomationAction struct {
	Target        string  `json:"target" bson:"target"`
	State         bool    `json:"state" bson:"state"`
	TimeStart     string  `json:"time_start" bson:"time_start"`         // HH:MM - início da janela ativa
	TimeEnd       string  `json:"time_end" bson:"time_end"`             // HH:MM - fim da janela ativa
	MinValue      float64 `json:"min_value" bson:"min_value"`           // limite inferior para disparar
	MaxValue      float64 `json:"max_value" bson:"max_value"`           // limite superior para disparar
	PeriodMinutes int     `json:"period_minutes" bson:"period_minutes"` // minutos por hora de operação
}

type AutomationGroup struct {
	Name       string                `json:"name" bson:"name"`
	Enabled    bool                  `json:"enabled" bson:"enabled"`
	Logic      string                `json:"logic" bson:"logic"` // and/or
	Conditions []AutomationCondition `json:"conditions" bson:"conditions"`
	Actions    []AutomationAction    `json:"actions" bson:"actions"`
}

type Rule struct {
	MinTemp           float64 `json:"min_temp" bson:"min_temp"`
	MaxTemp           float64 `json:"max_temp" bson:"max_temp"`
	MinAirHumidity    float64 `json:"min_air_humidity" bson:"min_air_humidity"`
	MaxAirHumidity    float64 `json:"max_air_humidity" bson:"max_air_humidity"`
	MinSoilHumidity   float64 `json:"min_soil_humidity" bson:"min_soil_humidity"`
	MaxSoilHumidity   float64 `json:"max_soil_humidity" bson:"max_soil_humidity"`
	MinLightLevel     float64 `json:"min_light_level" bson:"min_light_level"`
	MaxLightLevel     float64 `json:"max_light_level" bson:"max_light_level"`
	LightStartTime    string  `json:"light_start_time" bson:"light_start_time"`
	LightEndTime      string  `json:"light_end_time" bson:"light_end_time"`
	LightMode         string  `json:"light_mode" bson:"light_mode"` // "schedule" | "duration"
	LightHoursPerDay  int     `json:"light_hours_per_day" bson:"light_hours_per_day"`
	LightDaysOfWeek   []int   `json:"light_days_of_week" bson:"light_days_of_week"`
	LinkedPlantID     int     `json:"linked_plant_id" bson:"linked_plant_id"`
	EnableAutoExhaust bool    `json:"enable_auto_exhaust" bson:"enable_auto_exhaust"`
	EnableAutoIrrig   bool    `json:"enable_auto_irrigation" bson:"enable_auto_irrigation"`
}

type ActuatorState struct {
	ExhaustOn      bool      `json:"exhaust_on" bson:"exhaust_on"`
	IrrigationOn   bool      `json:"irrigation_on" bson:"irrigation_on"`
	HumidifierOn   bool      `json:"humidifier_on" bson:"humidifier_on"`
	DehumidifierOn bool      `json:"dehumidifier_on" bson:"dehumidifier_on"`
	HeaterOn       bool      `json:"heater_on" bson:"heater_on"`
	LightOn        bool      `json:"light_on" bson:"light_on"`
	UpdatedAt      time.Time `json:"updated_at" bson:"updated_at"`
	Source         string    `json:"source" bson:"source"`
}

type DeviceMap struct {
	SensorPorts   map[string]string `json:"sensor_ports" bson:"sensor_ports"`
	ActuatorPorts map[string]string `json:"actuator_ports" bson:"actuator_ports"`
	UpdatedAt     time.Time         `json:"updated_at" bson:"updated_at"`
}

type BootstrapConfig struct {
	ServerTime         string           `json:"server_time"`
	RegrasAtivas       []AutomationRule `json:"regras_ativas"`
	LeituraSensorAtual SensorReading    `json:"leitura_sensor_atual"`
	EstadoAtuadores    ActuatorState    `json:"estado_atual_atuadores"`
	DeviceMap          DeviceMap        `json:"device_map"`
}

type OTARelease struct {
	Version     int       `json:"version" bson:"version"`
	FileName    string    `json:"file_name" bson:"file_name"`
	FilePath    string    `json:"file_path" bson:"file_path"`
	SHA256      string    `json:"sha256" bson:"sha256"`
	SizeBytes   int64     `json:"size_bytes" bson:"size_bytes"`
	UploadedAt  time.Time `json:"uploaded_at" bson:"uploaded_at"`
	PublishedAt time.Time `json:"published_at,omitempty" bson:"published_at,omitempty"`
	DownloadURL string    `json:"download_url,omitempty" bson:"-"`
	ContentType string    `json:"content_type,omitempty" bson:"content_type,omitempty"`
	Description string    `json:"description,omitempty" bson:"description,omitempty"`
}
