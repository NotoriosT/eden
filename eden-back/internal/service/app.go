package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"eden-iot/backend-go/internal/domain"
	"eden-iot/backend-go/internal/repository"
)

var ErrActuatorLockedByRule = errors.New("actuator_locked_by_active_rule")

const (
	soilAdcWetDefault = 1200.0
	soilAdcDryDefault = 3200.0
)

type Publisher interface {
	PublishJSON(topic string, payload any)
}

type AppService struct {
	store            *repository.Store
	publisher        Publisher
	commandTopic     string
	bootstrapURL     string
	publicBaseURL    string
	automationEngine string
}

func normalizeBootstrapURL(base string) string {
	b := strings.TrimSpace(base)
	b = strings.TrimRight(b, "/")
	if strings.HasSuffix(b, "/api/bootstrap/config") {
		return b
	}
	return b + "/api/bootstrap/config"
}

func normalizeGPIOPort(v string) (string, error) {
	s := strings.TrimSpace(strings.ToUpper(v))
	if s == "" {
		return "", nil
	}
	if strings.HasPrefix(s, "COM") || strings.HasPrefix(s, "TTY") {
		return "", fmt.Errorf("porta invalida '%s': use GPIO (ex: GPIO16)", v)
	}
	if strings.HasPrefix(s, "GPIO") {
		n, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(s, "GPIO")))
		if err != nil || n < 0 || n > 39 {
			return "", fmt.Errorf("porta invalida '%s': GPIO fora do intervalo 0..39", v)
		}
		return fmt.Sprintf("GPIO%d", n), nil
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 || n > 39 {
		return "", fmt.Errorf("porta invalida '%s': use GPIO (ex: GPIO16)", v)
	}
	return fmt.Sprintf("GPIO%d", n), nil
}

func validateAndNormalizeDeviceMap(dm *domain.DeviceMap) error {
	for k, v := range dm.SensorPorts {
		nv, err := normalizeGPIOPort(v)
		if err != nil {
			return fmt.Errorf("sensor_ports.%s: %w", k, err)
		}
		dm.SensorPorts[k] = nv
	}
	for k, v := range dm.ActuatorPorts {
		nv, err := normalizeGPIOPort(v)
		if err != nil {
			return fmt.Errorf("actuator_ports.%s: %w", k, err)
		}
		dm.ActuatorPorts[k] = nv
	}
	return nil
}

func New(store *repository.Store, publisher Publisher, commandTopic, bootstrapURL, automationEngine string) *AppService {
	engine := strings.TrimSpace(strings.ToLower(automationEngine))
	if engine == "" {
		engine = "esp"
	}
	base := strings.TrimSpace(bootstrapURL)
	base = strings.TrimRight(base, "/")
	return &AppService{
		store:            store,
		publisher:        publisher,
		commandTopic:     commandTopic,
		bootstrapURL:     normalizeBootstrapURL(bootstrapURL),
		publicBaseURL:    base,
		automationEngine: engine,
	}
}

func (s *AppService) otaDownloadURL(version int) string {
	return fmt.Sprintf("%s/api/ota/firmware?v=%d", s.publicBaseURL, version)
}

func (s *AppService) publishBootstrapRefresh(reason string) {
	now := time.Now()
	s.publisher.PublishJSON(s.commandTopic, map[string]any{
		"type":          "bootstrap_refresh",
		"msg_id":        fmt.Sprintf("boot-%d", now.UnixNano()),
		"reason":        reason,
		"bootstrap_url": s.bootstrapURL,
		"updated_at":    now.UTC().Format(time.RFC3339),
		"server_time":   now.UTC().Format(time.RFC3339),
	})
}

func (s *AppService) publishActuatorState(a domain.ActuatorState, source string) {
	s.publisher.PublishJSON(s.commandTopic, map[string]any{
		"type":            "actuator_state",
		"msg_id":          fmt.Sprintf("act-%d", time.Now().UnixNano()),
		"source":          source,
		"updated_at":      time.Now().Format(time.RFC3339),
		"exhaust_on":      a.ExhaustOn,
		"irrigation_on":   a.IrrigationOn,
		"humidifier_on":   a.HumidifierOn,
		"dehumidifier_on": a.DehumidifierOn,
		"heater_on":       a.HeaterOn,
		"light_on":        a.LightOn,
	})
}

func (s *AppService) publishActuatorPatch(dispositivo string, on bool, source string) {
	s.publisher.PublishJSON(s.commandTopic, map[string]any{
		"type":        "actuator_patch",
		"msg_id":      fmt.Sprintf("apt-%d", time.Now().UnixNano()),
		"source":      source,
		"updated_at":  time.Now().Format(time.RFC3339),
		"dispositivo": strings.TrimSpace(strings.ToUpper(dispositivo)),
		"comando":     map[bool]string{true: "LIGAR", false: "DESLIGAR"}[on],
	})
}

type SensorPayload struct {
	TemperatureC float64            `json:"temperature"`
	AirHumidity  float64            `json:"humidity_air"`
	SoilHumidity float64            `json:"soil_moisture"` // backward compat (soil_1 alias)
	SoilSensors  map[string]float64 `json:"-"`             // preenchido pelo ParseSoilSensors
	LightLevel   float64            `json:"luminosity"`
}

func ParseSoilSensors(raw map[string]any) map[string]float64 {
	out := map[string]float64{}
	for k, v := range raw {
		if !strings.HasPrefix(k, "soil_") {
			continue
		}
		idx := k[5:] // "1", "2", ...
		if idx == "moisture" {
			continue // campo legado tratado em SoilHumidity
		}
		if n, err := strconv.Atoi(idx); err == nil && n >= 1 {
			if f, ok := v.(float64); ok {
				out[idx] = f
			}
		}
	}
	return out
}

func normalizeSoilHumidity(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	if v >= 0 && v <= 100 {
		return v
	}
	span := soilAdcDryDefault - soilAdcWetDefault
	if span <= 0 {
		return v
	}
	pct := ((soilAdcDryDefault - v) * 100.0) / span
	if pct < 0 {
		return 0
	}
	if pct > 100 {
		return 100
	}
	return pct
}

func normalizeReading(r domain.SensorReading) domain.SensorReading {
	soilSensorsPct := map[string]float64{}
	for k, v := range r.SoilSensors {
		soilSensorsPct[k] = normalizeSoilHumidity(v)
	}

	soilPrimary := normalizeSoilHumidity(r.SoilHumidity)
	if len(soilSensorsPct) > 0 {
		if v, ok := soilSensorsPct["1"]; ok {
			soilPrimary = v
		} else {
			minIdx := 999
			for k, v := range soilSensorsPct {
				if n, err := strconv.Atoi(k); err == nil && n < minIdx {
					minIdx = n
					soilPrimary = v
				}
			}
		}
	}

	r.SoilHumidity = soilPrimary
	r.SoilSensors = soilSensorsPct
	return r
}

type ProgressInput struct {
	Phase       string `json:"phase"`
	Observation string `json:"observation"`
}

type IoTActuatorStatePayload struct {
	ExhaustOn      bool   `json:"exhaust_on"`
	IrrigationOn   bool   `json:"irrigation_on"`
	HumidifierOn   bool   `json:"humidifier_on"`
	DehumidifierOn bool   `json:"dehumidifier_on"`
	HeaterOn       bool   `json:"heater_on"`
	LightOn        bool   `json:"light_on"`
	Source         string `json:"source,omitempty"`
	Reason         string `json:"reason,omitempty"`
}

// ── helpers ────────────────────────────────────────────────────────────────

func sensorValue(r domain.SensorReading, sensor string) float64 {
	switch sensor {
	case "TEMPERATURA":
		return r.TemperatureC
	case "UMIDADE_AR":
		return r.AirHumidity
	case "UMIDADE_SOLO":
		return r.SoilHumidity
	case "LUMINOSIDADE":
		return r.LightLevel
	default:
		if strings.HasPrefix(sensor, "UMIDADE_SOLO_") {
			idx := sensor[13:]
			if r.SoilSensors != nil {
				if v, ok := r.SoilSensors[idx]; ok {
					return v
				}
			}
		}
		return math.NaN()
	}
}

func evalOperador(v float64, op string, threshold float64) bool {
	switch op {
	case "MAIOR_QUE":
		return v > threshold
	case "MENOR_QUE":
		return v < threshold
	case "MAIOR_OU_IGUAL":
		return v >= threshold
	case "MENOR_OU_IGUAL":
		return v <= threshold
	case "IGUAL":
		return v == threshold
	default:
		return false
	}
}

func setActuador(act *domain.ActuatorState, dispositivo string, on bool) bool {
	switch dispositivo {
	case "LUZ":
		if act.LightOn != on {
			act.LightOn = on
			return true
		}
	case "EXAUSTAO":
		if act.ExhaustOn != on {
			act.ExhaustOn = on
			return true
		}
	case "IRRIGACAO":
		if act.IrrigationOn != on {
			act.IrrigationOn = on
			return true
		}
	case "UMIDIFICADOR":
		if act.HumidifierOn != on {
			act.HumidifierOn = on
			return true
		}
	case "DESUMIDIFICADOR":
		if act.DehumidifierOn != on {
			act.DehumidifierOn = on
			return true
		}
	case "AQUECEDOR":
		if act.HeaterOn != on {
			act.HeaterOn = on
			return true
		}
	}
	return false
}

func actuatorStateByDevice(a domain.ActuatorState, dispositivo string) (bool, bool) {
	switch strings.TrimSpace(strings.ToUpper(dispositivo)) {
	case "LUZ":
		return a.LightOn, true
	case "EXAUSTAO":
		return a.ExhaustOn, true
	case "IRRIGACAO":
		return a.IrrigationOn, true
	case "UMIDIFICADOR":
		return a.HumidifierOn, true
	case "DESUMIDIFICADOR":
		return a.DehumidifierOn, true
	case "AQUECEDOR":
		return a.HeaterOn, true
	default:
		return false, false
	}
}

func (s *AppService) activeRuleLockedDevices(ctx context.Context) (map[string]struct{}, error) {
	rules, err := s.store.ListAutomationRules(ctx)
	if err != nil {
		return nil, err
	}
	locked := make(map[string]struct{})
	for _, r := range rules {
		if !r.Enabled {
			continue
		}
		actions := append([]domain.LimiteAcao{}, normalizeActions(r)...)
		actions = append(actions, normalizeLimiteAbaixo(r)...)
		actions = append(actions, normalizeLimiteAcima(r)...)
		for _, a := range actions {
			d := strings.TrimSpace(strings.ToUpper(a.Dispositivo))
			if d != "" {
				locked[d] = struct{}{}
			}
		}
	}
	return locked, nil
}

func contemDia(dias []int, weekday int) bool {
	for _, d := range dias {
		if d == weekday {
			return true
		}
	}
	return false
}

func matchesHorario(horario string, now time.Time) bool {
	return now.Format("15:04") == horario
}

func normalizeActions(rule domain.AutomationRule) []domain.LimiteAcao {
	if len(rule.Acoes) > 0 {
		return rule.Acoes
	}
	if rule.Dispositivo != "" && rule.Comando != "" {
		return []domain.LimiteAcao{{
			Dispositivo:     rule.Dispositivo,
			Comando:         rule.Comando,
			DuracaoMinutos:  rule.DuracaoMinutos,
			DuracaoSegundos: rule.DuracaoSegundos,
		}}
	}
	return nil
}

func normalizeCommand(cmd string) string {
	s := strings.TrimSpace(strings.ToUpper(cmd))
	switch s {
	case "ON", "TRUE", "1":
		return "LIGAR"
	case "OFF", "FALSE", "0":
		return "DESLIGAR"
	default:
		return s
	}
}

func isOnCommand(cmd string) bool {
	return normalizeCommand(cmd) == "LIGAR"
}

func ruleDuration(r domain.AutomationRule) time.Duration {
	if r.DuracaoSegundos > 0 {
		return time.Duration(r.DuracaoSegundos) * time.Second
	}
	if r.DuracaoMinutos > 0 {
		return time.Duration(r.DuracaoMinutos) * time.Minute
	}
	return 0
}

func normalizeLimiteAbaixo(rule domain.AutomationRule) []domain.LimiteAcao {
	if len(rule.AcoesAbaixoMinimo) > 0 {
		return rule.AcoesAbaixoMinimo
	}
	if rule.AcaoAbaixoMinimo != nil {
		return []domain.LimiteAcao{*rule.AcaoAbaixoMinimo}
	}
	return nil
}

func normalizeLimiteAcima(rule domain.AutomationRule) []domain.LimiteAcao {
	if len(rule.AcoesAcimaMaximo) > 0 {
		return rule.AcoesAcimaMaximo
	}
	if rule.AcaoAcimaMaximo != nil {
		return []domain.LimiteAcao{*rule.AcaoAcimaMaximo}
	}
	return nil
}

func applyActions(
	act *domain.ActuatorState,
	rule domain.AutomationRule,
	actionsIn []domain.LimiteAcao,
	actions *[]string,
) bool {
	changed := false
	seen := map[string]string{}
	for _, a := range actionsIn {
		if a.Dispositivo == "" || a.Comando == "" {
			continue
		}
		device := strings.TrimSpace(strings.ToUpper(a.Dispositivo))
		command := normalizeCommand(a.Comando)
		if device == "" || (command != "LIGAR" && command != "DESLIGAR") {
			continue
		}
		if prev, ok := seen[device]; ok && prev != command {
			*actions = append(*actions, fmt.Sprintf("%s(conflicto interno ignorado em %s)", rule.Name, device))
			continue
		}
		seen[device] = command
		on := command == "LIGAR"
		if setActuador(act, device, on) {
			changed = true
			*actions = append(*actions, fmt.Sprintf("%s->%s %s", rule.Name, device, command))
		}
	}
	return changed
}

func validateActionList(kind string, list []domain.LimiteAcao) error {
	if len(list) == 0 {
		return nil
	}
	seen := map[string]string{}
	for _, a := range list {
		device := strings.TrimSpace(strings.ToUpper(a.Dispositivo))
		command := normalizeCommand(a.Comando)
		if device == "" || command == "" {
			return fmt.Errorf("%s contem acao incompleta", kind)
		}
		if command != "LIGAR" && command != "DESLIGAR" {
			return fmt.Errorf("%s possui comando invalido para %s: %s", kind, device, a.Comando)
		}
		if prev, ok := seen[device]; ok && prev != command {
			return fmt.Errorf("%s possui comandos conflitantes para %s", kind, device)
		}
		seen[device] = command
	}
	return nil
}

func inSet(v string, set map[string]struct{}) bool {
	_, ok := set[v]
	return ok
}

func validateRuleByType(r domain.AutomationRule) error {
	validTipos := map[string]struct{}{
		"COMPARACAO": {}, "LIMITE": {}, "HORARIO": {}, "DIA_SEMANA": {}, "TEMPO": {},
	}
	validSensores := map[string]struct{}{
		"TEMPERATURA": {}, "UMIDADE_AR": {}, "UMIDADE_SOLO": {}, "LUMINOSIDADE": {},
	}
	validOps := map[string]struct{}{
		"MAIOR_QUE": {}, "MENOR_QUE": {}, "MAIOR_OU_IGUAL": {}, "MENOR_OU_IGUAL": {}, "IGUAL": {},
	}
	validSensor := func(s string) bool {
		return inSet(s, validSensores) || strings.HasPrefix(s, "UMIDADE_SOLO_")
	}
	if !inSet(r.TipoParametro, validTipos) {
		return fmt.Errorf("tipo_parametro invalido: %s", r.TipoParametro)
	}

	switch r.TipoParametro {
	case "COMPARACAO":
		if !validSensor(r.VariavelSensor) {
			return errors.New("variavel_sensor invalida para COMPARACAO")
		}
		if !inSet(r.Operador, validOps) {
			return errors.New("operador invalido para COMPARACAO")
		}
		if len(normalizeActions(r)) == 0 {
			return errors.New("COMPARACAO requer ao menos uma acao")
		}

	case "LIMITE":
		if !validSensor(r.VariavelSensor) {
			return errors.New("variavel_sensor invalida para LIMITE")
		}
		if r.ValorMinimo >= r.ValorMaximo {
			return errors.New("valor_minimo deve ser menor que valor_maximo")
		}
		if len(normalizeLimiteAbaixo(r)) == 0 {
			return errors.New("LIMITE requer ao menos uma acao_abaixo_minimo")
		}
		if len(normalizeLimiteAcima(r)) == 0 {
			return errors.New("LIMITE requer ao menos uma acao_acima_maximo")
		}

	case "HORARIO":
		if strings.TrimSpace(r.Horario) == "" {
			return errors.New("HORARIO requer campo horario")
		}
		if _, err := time.Parse("15:04", r.Horario); err != nil {
			return errors.New("horario invalido (use HH:MM)")
		}
		if len(normalizeActions(r)) == 0 {
			return errors.New("HORARIO requer ao menos uma acao")
		}

	case "DIA_SEMANA":
		if strings.TrimSpace(r.Horario) == "" {
			return errors.New("DIA_SEMANA requer campo horario")
		}
		if _, err := time.Parse("15:04", r.Horario); err != nil {
			return errors.New("horario invalido (use HH:MM)")
		}
		if len(r.DiasDoSemana) == 0 {
			return errors.New("DIA_SEMANA requer ao menos um dia")
		}
		for _, d := range r.DiasDoSemana {
			if d < 0 || d > 6 {
				return errors.New("dias_semana invalido (use 0..6)")
			}
		}
		if len(normalizeActions(r)) == 0 {
			return errors.New("DIA_SEMANA requer ao menos uma acao")
		}

	case "TEMPO":
		if r.IntervaloMinutos <= 0 {
			return errors.New("TEMPO requer intervalo_minutos > 0")
		}
		if len(normalizeActions(r)) == 0 {
			return errors.New("TEMPO requer ao menos uma acao")
		}
	}

	return nil
}

// ── ProcessReading ─────────────────────────────────────────────────────────

func (s *AppService) ProcessReading(ctx context.Context, p SensorPayload) error {
	r := domain.SensorReading{
		Timestamp:    time.Now(),
		TemperatureC: p.TemperatureC,
		AirHumidity:  p.AirHumidity,
		SoilHumidity: p.SoilHumidity,
		SoilSensors:  p.SoilSensors,
		LightLevel:   p.LightLevel,
	}
	r = normalizeReading(r)
	if err := s.store.SaveReading(ctx, r); err != nil {
		return err
	}
	if s.automationEngine != "backend" {
		return nil
	}

	ruleList, err := s.store.ListAutomationRules(ctx)
	if err != nil || len(ruleList) == 0 {
		return nil
	}

	act, err := s.store.GetActuators(ctx)
	if err != nil {
		act = domain.ActuatorState{UpdatedAt: time.Now(), Source: "auto"}
	}
	now := time.Now()
	changed := false
	var actions []string

	for _, rule := range ruleList {
		if !rule.Enabled {
			continue
		}

		switch rule.TipoParametro {

		case "COMPARACAO":
			v := sensorValue(r, rule.VariavelSensor)
			if !math.IsNaN(v) && evalOperador(v, rule.Operador, rule.Valor) {
				if applyActions(&act, rule, normalizeActions(rule), &actions) {
					changed = true
				}
			}

		case "LIMITE":
			v := sensorValue(r, rule.VariavelSensor)
			if !math.IsNaN(v) {
				if v < rule.ValorMinimo {
					if applyActions(&act, rule, normalizeLimiteAbaixo(rule), &actions) {
						changed = true
					}
				}
				if v > rule.ValorMaximo {
					if applyActions(&act, rule, normalizeLimiteAcima(rule), &actions) {
						changed = true
					}
				}
			}

		case "HORARIO":
			nowMin := now.Format("2006-01-02 15:04")
			lastMin := rule.LastRunAt.Format("2006-01-02 15:04")
			if matchesHorario(rule.Horario, now) && nowMin != lastMin {
				if applyActions(&act, rule, normalizeActions(rule), &actions) {
					changed = true
					_ = s.store.UpdateRuleLastRun(ctx, rule.ID, now)
				}
			}
			// Auto-off after duration (only meaningful for LIGAR)
			dur := ruleDuration(rule)
			if dur > 0 && isOnCommand(rule.Comando) && !rule.LastRunAt.IsZero() &&
				time.Since(rule.LastRunAt) >= dur {
				if setActuador(&act, rule.Dispositivo, false) {
					changed = true
					actions = append(actions, fmt.Sprintf("%s(auto-off)", rule.Name))
				}
			}

		case "DIA_SEMANA":
			nowMin := now.Format("2006-01-02 15:04")
			lastMin := rule.LastRunAt.Format("2006-01-02 15:04")
			weekday := int(now.Weekday())
			if contemDia(rule.DiasDoSemana, weekday) && matchesHorario(rule.Horario, now) && nowMin != lastMin {
				if applyActions(&act, rule, normalizeActions(rule), &actions) {
					changed = true
					_ = s.store.UpdateRuleLastRun(ctx, rule.ID, now)
				}
			}
			dur := ruleDuration(rule)
			if dur > 0 && isOnCommand(rule.Comando) && !rule.LastRunAt.IsZero() &&
				time.Since(rule.LastRunAt) >= dur {
				if setActuador(&act, rule.Dispositivo, false) {
					changed = true
					actions = append(actions, fmt.Sprintf("%s(auto-off)", rule.Name))
				}
			}

		case "TEMPO":
			if rule.IntervaloMinutos <= 0 {
				continue
			}
			interval := time.Duration(rule.IntervaloMinutos) * time.Minute
			duracao := ruleDuration(rule)
			since := time.Since(rule.LastRunAt)

			if rule.LastRunAt.IsZero() || since >= interval {
				if applyActions(&act, rule, normalizeActions(rule), &actions) {
					changed = true
					_ = s.store.UpdateRuleLastRun(ctx, rule.ID, now)
				}
			} else if duracao > 0 && isOnCommand(rule.Comando) && since >= duracao {
				if setActuador(&act, rule.Dispositivo, false) {
					changed = true
					actions = append(actions, fmt.Sprintf("%s(auto-off)", rule.Name))
				}
			}

		}
	}

	if changed {
		act.Source = "automation"
		act.UpdatedAt = now
		if err := s.store.SaveActuators(ctx, act); err == nil {
			s.publishActuatorState(act, "automation")
			_ = s.store.SaveEvent(ctx, domain.EventLog{
				Timestamp: now,
				Type:      "automation",
				Source:    "auto",
				Message:   fmt.Sprintf("Regras executadas: %v", actions),
			})
		}
	}
	return nil
}

// ── Service methods ────────────────────────────────────────────────────────

func (s *AppService) Readings(ctx context.Context, limit int64) ([]domain.SensorReading, error) {
	list, err := s.store.LatestReadings(ctx, limit)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i] = normalizeReading(list[i])
	}
	return list, nil
}

func (s *AppService) ReadingsRange(ctx context.Context, from, to *time.Time, limit int64) ([]domain.SensorReading, error) {
	list, err := s.store.ReadingsRange(ctx, from, to, limit)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i] = normalizeReading(list[i])
	}
	return list, nil
}

func (s *AppService) Plants(ctx context.Context) ([]domain.Plant, error) {
	return s.store.ListPlants(ctx)
}

func (s *AppService) Rules(ctx context.Context) (domain.Rule, error) {
	return s.store.GetRules(ctx)
}

func (s *AppService) Actuators(ctx context.Context) (domain.ActuatorState, error) {
	return s.store.GetActuators(ctx)
}

func (s *AppService) DeviceMap(ctx context.Context) (domain.DeviceMap, error) {
	return s.store.GetDeviceMap(ctx)
}

func (s *AppService) OTARelease(ctx context.Context) (domain.OTARelease, error) {
	rel, err := s.store.GetOTARelease(ctx)
	if err != nil {
		return rel, err
	}
	if rel.Version > 0 {
		rel.DownloadURL = s.otaDownloadURL(rel.Version)
	}
	return rel, nil
}

func (s *AppService) SaveOTARelease(ctx context.Context, rel domain.OTARelease) (domain.OTARelease, error) {
	if rel.Version <= 0 {
		return rel, errors.New("version must be > 0")
	}
	rel.UploadedAt = time.Now()
	if err := s.store.SaveOTARelease(ctx, rel); err != nil {
		return rel, err
	}
	out, err := s.store.GetOTARelease(ctx)
	if err != nil {
		return rel, err
	}
	out.DownloadURL = s.otaDownloadURL(out.Version)
	return out, nil
}

func (s *AppService) PublishOTA(ctx context.Context, version int) (domain.OTARelease, error) {
	rel, err := s.store.GetOTARelease(ctx)
	if err != nil {
		return rel, err
	}
	if rel.Version <= 0 || rel.FilePath == "" {
		return rel, errors.New("no OTA release uploaded")
	}
	if version > 0 && version != rel.Version {
		return rel, fmt.Errorf("requested version %d does not match latest %d", version, rel.Version)
	}
	rel.PublishedAt = time.Now()
	if err := s.store.SaveOTARelease(ctx, rel); err != nil {
		return rel, err
	}

	msgID := fmt.Sprintf("ota-%d", time.Now().UnixNano())
	s.publisher.PublishJSON(s.commandTopic, map[string]any{
		"type":       "ota_update",
		"msg_id":     msgID,
		"version":    rel.Version,
		"url":        s.otaDownloadURL(rel.Version),
		"sha256":     rel.SHA256,
		"updated_at": time.Now().Format(time.RFC3339),
	})

	rel.DownloadURL = s.otaDownloadURL(rel.Version)
	_ = s.store.SaveEvent(ctx, domain.EventLog{
		Timestamp: time.Now(),
		Type:      "iot_sync",
		Source:    "api",
		Message:   fmt.Sprintf("OTA publish v%d msg_id=%s", rel.Version, msgID),
	})
	return rel, nil
}

func (s *AppService) SaveDeviceMap(ctx context.Context, dm domain.DeviceMap) (domain.DeviceMap, error) {
	if dm.SensorPorts == nil {
		dm.SensorPorts = map[string]string{}
	}
	if dm.ActuatorPorts == nil {
		dm.ActuatorPorts = map[string]string{}
	}
	if err := validateAndNormalizeDeviceMap(&dm); err != nil {
		return dm, err
	}
	if err := s.store.SaveDeviceMap(ctx, dm); err != nil {
		return dm, err
	}
	s.publishBootstrapRefresh("device_map_updated")
	return s.store.GetDeviceMap(ctx)
}

func (s *AppService) BootstrapConfig(ctx context.Context) (domain.BootstrapConfig, error) {
	now := time.Now()
	rules, _ := s.store.ListAutomationRules(ctx)
	active := make([]domain.AutomationRule, 0, len(rules))
	for _, r := range rules {
		if r.Enabled {
			active = append(active, r)
		}
	}
	readings, _ := s.store.LatestReadings(ctx, 1)
	var latest domain.SensorReading
	if len(readings) > 0 {
		latest = normalizeReading(readings[len(readings)-1])
	}
	act, _ := s.store.GetActuators(ctx)
	dm, _ := s.store.GetDeviceMap(ctx)
	return domain.BootstrapConfig{
		ServerTime:         now.UTC().Format(time.RFC3339),
		RegrasAtivas:       active,
		LeituraSensorAtual: latest,
		EstadoAtuadores:    act,
		DeviceMap:          dm,
	}, nil
}

func (s *AppService) Events(ctx context.Context, limit int64) ([]domain.EventLog, error) {
	return s.store.ListEvents(ctx, limit)
}

func (s *AppService) ListAutomationRules(ctx context.Context) ([]domain.AutomationRule, error) {
	return s.store.ListAutomationRules(ctx)
}

func (s *AppService) CreateAutomationRule(ctx context.Context, r domain.AutomationRule) (domain.AutomationRule, error) {
	if strings.TrimSpace(r.Name) == "" {
		return r, errors.New("name required")
	}
	if r.TipoParametro == "" {
		return r, errors.New("tipo_parametro required")
	}
	if err := validateRuleByType(r); err != nil {
		return r, err
	}

	if err := validateActionList("acoes", normalizeActions(r)); err != nil {
		return r, err
	}
	if err := validateActionList("acoes_abaixo_minimo", normalizeLimiteAbaixo(r)); err != nil {
		return r, err
	}
	if err := validateActionList("acoes_acima_maximo", normalizeLimiteAcima(r)); err != nil {
		return r, err
	}

	r.Acoes = normalizeActions(r)
	r.AcoesAbaixoMinimo = normalizeLimiteAbaixo(r)
	r.AcoesAcimaMaximo = normalizeLimiteAcima(r)
	if len(r.AcoesAbaixoMinimo) > 0 {
		r.AcaoAbaixoMinimo = &r.AcoesAbaixoMinimo[0]
	}
	if len(r.AcoesAcimaMaximo) > 0 {
		r.AcaoAcimaMaximo = &r.AcoesAcimaMaximo[0]
	}
	if len(r.Acoes) > 0 {
		r.Dispositivo = r.Acoes[0].Dispositivo
		r.Comando = r.Acoes[0].Comando
	}

	r.CreatedAt = time.Now()
	out, err := s.store.SaveAutomationRule(ctx, r)
	if err == nil {
		s.publishBootstrapRefresh("automation_rule_created")
	}
	return out, err
}

func (s *AppService) UpdateAutomationRule(ctx context.Context, id string, r domain.AutomationRule) (domain.AutomationRule, error) {
	if strings.TrimSpace(id) == "" {
		return r, errors.New("id required")
	}
	if strings.TrimSpace(r.Name) == "" {
		return r, errors.New("name required")
	}
	if r.TipoParametro == "" {
		return r, errors.New("tipo_parametro required")
	}
	if err := validateRuleByType(r); err != nil {
		return r, err
	}

	if err := validateActionList("acoes", normalizeActions(r)); err != nil {
		return r, err
	}
	if err := validateActionList("acoes_abaixo_minimo", normalizeLimiteAbaixo(r)); err != nil {
		return r, err
	}
	if err := validateActionList("acoes_acima_maximo", normalizeLimiteAcima(r)); err != nil {
		return r, err
	}

	r.ID = id
	r.Acoes = normalizeActions(r)
	r.AcoesAbaixoMinimo = normalizeLimiteAbaixo(r)
	r.AcoesAcimaMaximo = normalizeLimiteAcima(r)
	if len(r.AcoesAbaixoMinimo) > 0 {
		r.AcaoAbaixoMinimo = &r.AcoesAbaixoMinimo[0]
	}
	if len(r.AcoesAcimaMaximo) > 0 {
		r.AcaoAcimaMaximo = &r.AcoesAcimaMaximo[0]
	}
	if len(r.Acoes) > 0 {
		r.Dispositivo = r.Acoes[0].Dispositivo
		r.Comando = r.Acoes[0].Comando
	}
	if r.CreatedAt.IsZero() {
		r.CreatedAt = time.Now()
	}

	out, err := s.store.UpdateAutomationRule(ctx, id, r)
	if err == nil {
		s.publishBootstrapRefresh("automation_rule_updated")
	}
	return out, err
}

func (s *AppService) DeleteAutomationRule(ctx context.Context, id string) error {
	if err := s.store.DeleteAutomationRule(ctx, id); err != nil {
		return err
	}
	s.publishBootstrapRefresh("automation_rule_deleted")
	return nil
}

func (s *AppService) PlantProgress(ctx context.Context, plantID int, limit int64) ([]domain.PlantProgress, error) {
	return s.store.ListPlantProgress(ctx, plantID, limit)
}

func (s *AppService) CreatePlant(ctx context.Context, p domain.Plant) (domain.Plant, error) {
	if p.Name == "" {
		return p, errors.New("name required")
	}
	if p.PhotoBase64 != "" {
		if _, err := base64.StdEncoding.DecodeString(p.PhotoBase64); err != nil {
			return p, errors.New("photo_base64 invalida")
		}
	}
	next, err := s.store.NextPlantID(ctx)
	if err != nil {
		return p, err
	}
	p.ID = next
	if p.CurrentPhase == "" {
		p.CurrentPhase = "germinacao"
	}
	if p.PlantedAt.IsZero() {
		p.PlantedAt = time.Now()
	}
	if p.ExpectedFloweringDays == 0 {
		p.ExpectedFloweringDays = 45
	}
	if p.ExpectedHarvestDays == 0 {
		p.ExpectedHarvestDays = 90
	}
	if err := s.store.SavePlant(ctx, p); err != nil {
		return p, err
	}
	_ = s.store.SaveEvent(ctx, domain.EventLog{
		Timestamp: time.Now(), Type: "plant", Source: "manual",
		Message: fmt.Sprintf("Planta cadastrada: %s", p.Name),
	})
	return p, nil
}

func (s *AppService) UpdatePlantPhase(ctx context.Context, plantID int, phase string) error {
	if phase == "" {
		return errors.New("phase required")
	}
	if err := s.store.UpdatePlantPhase(ctx, plantID, phase); err != nil {
		return err
	}
	_ = s.store.SaveEvent(ctx, domain.EventLog{
		Timestamp: time.Now(), Type: "plant_phase", Source: "manual",
		Message: fmt.Sprintf("Planta %d mudou para fase: %s", plantID, phase),
	})
	return nil
}

func (s *AppService) AddPlantProgress(ctx context.Context, plantID int, input ProgressInput) (domain.PlantProgress, error) {
	plant, err := s.store.GetPlant(ctx, plantID)
	if err != nil {
		return domain.PlantProgress{}, err
	}
	day := int(time.Since(plant.PlantedAt).Hours()/24) + 1
	var next string
	if day < plant.ExpectedFloweringDays {
		next = fmt.Sprintf("Faltam ~%d dias para floracao", plant.ExpectedFloweringDays-day)
	} else if day < plant.ExpectedHarvestDays {
		next = fmt.Sprintf("Faltam ~%d dias para frutificacao/colheita", plant.ExpectedHarvestDays-day)
	} else {
		next = "Periodo de frutificacao/colheita"
	}
	out := domain.PlantProgress{
		PlantID: plantID, Date: time.Now(), DayNumber: day,
		Phase: input.Phase, Observation: input.Observation, ExpectedNext: next,
	}
	if out.Phase == "" {
		out.Phase = plant.CurrentPhase
	}
	if err := s.store.SavePlantProgress(ctx, out); err != nil {
		return out, err
	}
	_ = s.store.SaveEvent(ctx, domain.EventLog{
		Timestamp: time.Now(), Type: "plant_progress", Source: "manual",
		Message: fmt.Sprintf("Acompanhamento da planta %d no dia %d", plantID, day),
	})
	return out, nil
}

func (s *AppService) UpdateRules(ctx context.Context, r domain.Rule) error {
	if err := s.store.SaveRules(ctx, r); err != nil {
		return err
	}
	s.publishBootstrapRefresh("rules_updated")
	return nil
}

func (s *AppService) UpdateActuatorsManual(ctx context.Context, a domain.ActuatorState) (domain.ActuatorState, error) {
	cur, err := s.store.GetActuators(ctx)
	if err != nil {
		cur = domain.ActuatorState{}
	}
	locked, err := s.activeRuleLockedDevices(ctx)
	if err != nil {
		return a, err
	}
	for dispositivo := range locked {
		curVal, ok := actuatorStateByDevice(cur, dispositivo)
		if !ok {
			continue
		}
		nextVal, ok := actuatorStateByDevice(a, dispositivo)
		if !ok {
			continue
		}
		if curVal != nextVal {
			return a, fmt.Errorf("%w:%s", ErrActuatorLockedByRule, dispositivo)
		}
	}

	a.Source = "manual"
	a.UpdatedAt = time.Now()
	if err := s.store.SaveActuators(ctx, a); err != nil {
		return a, err
	}
	s.publishActuatorState(a, "manual")
	_ = s.store.SaveEvent(ctx, domain.EventLog{
		Timestamp: time.Now(), Type: "actuator", Source: "manual",
		Message: "Comando manual de atuadores aplicado",
	})
	return a, nil
}

func (s *AppService) UpdateSingleActuatorManual(ctx context.Context, dispositivo string, on bool) (domain.ActuatorState, error) {
	device := strings.TrimSpace(strings.ToUpper(dispositivo))
	locked, err := s.activeRuleLockedDevices(ctx)
	if err != nil {
		return domain.ActuatorState{}, err
	}
	if _, blocked := locked[device]; blocked {
		return domain.ActuatorState{}, fmt.Errorf("%w:%s", ErrActuatorLockedByRule, device)
	}

	act, err := s.store.GetActuators(ctx)
	if err != nil {
		act = domain.ActuatorState{}
	}
	if !setActuador(&act, device, on) {
		// Mesmo sem mudanca, garantimos origem/manual para manter consistencia de estado.
	}
	act.Source = "manual"
	act.UpdatedAt = time.Now()
	if err := s.store.SaveActuators(ctx, act); err != nil {
		return act, err
	}
	s.publishActuatorPatch(dispositivo, on, "manual")
	_ = s.store.SaveEvent(ctx, domain.EventLog{
		Timestamp: time.Now(),
		Type:      "actuator",
		Source:    "manual",
		Message:   fmt.Sprintf("Comando manual aplicado: %s=%t", strings.ToUpper(dispositivo), on),
	})
	return act, nil
}

func (s *AppService) SetActuatorMode(ctx context.Context, mode string) (domain.ActuatorState, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode != "manual" && mode != "auto" {
		return domain.ActuatorState{}, errors.New("mode invalido: use manual ou auto")
	}

	act, err := s.store.GetActuators(ctx)
	if err != nil {
		act = domain.ActuatorState{}
	}

	if mode == "manual" {
		act.Source = "manual_lock"
		act.UpdatedAt = time.Now()
		if err := s.store.SaveActuators(ctx, act); err != nil {
			return act, err
		}
		s.publishActuatorState(act, "manual_lock")
		_ = s.store.SaveEvent(ctx, domain.EventLog{
			Timestamp: time.Now(), Type: "actuator_mode", Source: "manual",
			Message: "Modo manual travado ativado",
		})
		return act, nil
	}

	act.Source = "auto"
	act.UpdatedAt = time.Now()
	if err := s.store.SaveActuators(ctx, act); err != nil {
		return act, err
	}
	s.publishActuatorState(act, "auto")
	_ = s.store.SaveEvent(ctx, domain.EventLog{
		Timestamp: time.Now(), Type: "actuator_mode", Source: "manual",
		Message: "Modo automático reativado",
	})
	return act, nil
}

func (s *AppService) NotifyIoTSync(ctx context.Context, reason string) error {
	if strings.TrimSpace(reason) == "" {
		reason = "manual_frontend_sync"
	}
	s.publishBootstrapRefresh(reason)
	_ = s.store.SaveEvent(ctx, domain.EventLog{
		Timestamp: time.Now(),
		Type:      "iot_sync",
		Source:    "manual",
		Message:   fmt.Sprintf("Solicitado refresh de bootstrap para IoT (%s)", reason),
	})
	return nil
}

func (s *AppService) UpdateActuatorsFromIoT(ctx context.Context, in IoTActuatorStatePayload) (domain.ActuatorState, error) {
	current, err := s.store.GetActuators(ctx)
	if err != nil {
		current = domain.ActuatorState{}
	}

	next := current
	next.ExhaustOn = in.ExhaustOn
	next.IrrigationOn = in.IrrigationOn
	next.HumidifierOn = in.HumidifierOn
	next.DehumidifierOn = in.DehumidifierOn
	next.HeaterOn = in.HeaterOn
	next.LightOn = in.LightOn
	next.UpdatedAt = time.Now()

	inSource := strings.TrimSpace(strings.ToLower(in.Source))
	curSource := strings.TrimSpace(strings.ToLower(current.Source))

	// Se o frontend acabou de operar manualmente, nao deixar o "espelho" do IoT
	// derrubar o modo manual no estado salvo.
	if (curSource == "manual" || curSource == "manual_lock") && inSource == "iot" {
		next.Source = current.Source
	} else if strings.TrimSpace(in.Source) != "" {
		next.Source = in.Source
	} else if strings.TrimSpace(current.Source) != "" {
		next.Source = current.Source
	} else {
		next.Source = "iot"
	}

	if err := s.store.SaveActuators(ctx, next); err != nil {
		return next, err
	}
	return next, nil
}
