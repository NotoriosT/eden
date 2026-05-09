package repository

import (
	"context"
	"fmt"
	"time"

	"eden-iot/backend-go/internal/domain"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type Store struct{ db *mongo.Database }

func NewStore(db *mongo.Database) *Store { return &Store{db: db} }

func (s *Store) SaveReading(ctx context.Context, r domain.SensorReading) error {
	_, err := s.db.Collection("readings").InsertOne(ctx, r)
	return err
}

func (s *Store) LatestReadings(ctx context.Context, limit int64) ([]domain.SensorReading, error) {
	return s.ReadingsRange(ctx, nil, nil, limit)
}

func (s *Store) ReadingsRange(ctx context.Context, from, to *time.Time, limit int64) ([]domain.SensorReading, error) {
	if limit <= 0 {
		limit = 120
	}
	filter := bson.M{}
	if from != nil || to != nil {
		ts := bson.M{}
		if from != nil {
			ts["$gte"] = *from
		}
		if to != nil {
			ts["$lte"] = *to
		}
		filter["timestamp"] = ts
	}

	opts := options.Find().
		SetSort(bson.D{{Key: "timestamp", Value: -1}}).
		SetLimit(limit)
	cur, err := s.db.Collection("readings").Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []domain.SensorReading
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

func (s *Store) ListPlants(ctx context.Context) ([]domain.Plant, error) {
	cur, err := s.db.Collection("plants").Find(ctx, bson.D{}, options.Find().SetSort(bson.D{{Key: "id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []domain.Plant
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) GetPlant(ctx context.Context, id int) (domain.Plant, error) {
	var p domain.Plant
	err := s.db.Collection("plants").FindOne(ctx, bson.M{"id": id}).Decode(&p)
	return p, err
}

func (s *Store) NextPlantID(ctx context.Context) (int, error) {
	var p domain.Plant
	err := s.db.Collection("plants").FindOne(ctx, bson.D{}, options.FindOne().SetSort(bson.D{{Key: "id", Value: -1}})).Decode(&p)
	if err == mongo.ErrNoDocuments {
		return 1, nil
	}
	if err != nil {
		return 0, err
	}
	return p.ID + 1, nil
}

func (s *Store) SavePlant(ctx context.Context, p domain.Plant) error {
	_, err := s.db.Collection("plants").InsertOne(ctx, p)
	return err
}

func (s *Store) UpdatePlantPhase(ctx context.Context, id int, phase string) error {
	_, err := s.db.Collection("plants").UpdateOne(ctx, bson.M{"id": id}, bson.M{"$set": bson.M{"current_phase": phase}})
	return err
}

func (s *Store) SavePlantProgress(ctx context.Context, p domain.PlantProgress) error {
	_, err := s.db.Collection("plant_progress").InsertOne(ctx, p)
	return err
}

func (s *Store) ListPlantProgress(ctx context.Context, plantID int, limit int64) ([]domain.PlantProgress, error) {
	if limit <= 0 {
		limit = 60
	}
	opts := options.Find().SetSort(bson.D{{Key: "date", Value: -1}}).SetLimit(limit)
	cur, err := s.db.Collection("plant_progress").Find(ctx, bson.M{"plant_id": plantID}, opts)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []domain.PlantProgress
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

func (s *Store) SaveEvent(ctx context.Context, e domain.EventLog) error {
	_, err := s.db.Collection("events").InsertOne(ctx, e)
	return err
}

func (s *Store) ListEvents(ctx context.Context, limit int64) ([]domain.EventLog, error) {
	if limit <= 0 {
		limit = 80
	}
	opts := options.Find().SetSort(bson.D{{Key: "timestamp", Value: -1}}).SetLimit(limit)
	cur, err := s.db.Collection("events").Find(ctx, bson.D{}, opts)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	var out []domain.EventLog
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

// AutomationRule CRUD

func (s *Store) ListAutomationRules(ctx context.Context) ([]domain.AutomationRule, error) {
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}})
	cur, err := s.db.Collection("automation_rules").Find(ctx, bson.D{}, opts)
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	out := []domain.AutomationRule{}
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) SaveAutomationRule(ctx context.Context, r domain.AutomationRule) (domain.AutomationRule, error) {
	if r.ID == "" {
		r.ID = primitive.NewObjectID().Hex()
	}
	_, err := s.db.Collection("automation_rules").InsertOne(ctx, r)
	return r, err
}

func (s *Store) UpdateAutomationRule(ctx context.Context, id string, r domain.AutomationRule) (domain.AutomationRule, error) {
	r.ID = id
	_, err := s.db.Collection("automation_rules").UpdateOne(
		ctx,
		bson.M{"id": id},
		bson.M{"$set": r},
	)
	return r, err
}

func (s *Store) DeleteAutomationRule(ctx context.Context, id string) error {
	_, err := s.db.Collection("automation_rules").DeleteOne(ctx, bson.M{"id": id})
	return err
}

func (s *Store) UpdateRuleLastRun(ctx context.Context, id string, t time.Time) error {
	_, err := s.db.Collection("automation_rules").UpdateOne(
		ctx, bson.M{"id": id}, bson.M{"$set": bson.M{"last_run_at": t}},
	)
	return err
}

func (s *Store) GetRules(ctx context.Context) (domain.Rule, error) {
	var r domain.Rule
	err := s.db.Collection("settings").FindOne(ctx, bson.M{"_id": "rules"}).Decode(&r)
	if err == mongo.ErrNoDocuments {
		return domain.Rule{}, mongo.ErrNoDocuments
	}
	return r, err
}

func (s *Store) SaveRules(ctx context.Context, r domain.Rule) error {
	_, err := s.db.Collection("settings").UpdateByID(ctx, "rules", bson.M{"$set": r}, options.Update().SetUpsert(true))
	return err
}

func (s *Store) GetActuators(ctx context.Context) (domain.ActuatorState, error) {
	var a domain.ActuatorState
	err := s.db.Collection("settings").FindOne(ctx, bson.M{"_id": "actuators"}).Decode(&a)
	if err == mongo.ErrNoDocuments {
		return domain.ActuatorState{}, mongo.ErrNoDocuments
	}
	return a, err
}

func (s *Store) SaveActuators(ctx context.Context, a domain.ActuatorState) error {
	_, err := s.db.Collection("settings").UpdateByID(ctx, "actuators", bson.M{"$set": a}, options.Update().SetUpsert(true))
	return err
}

func (s *Store) GetDeviceMap(ctx context.Context) (domain.DeviceMap, error) {
	var dm domain.DeviceMap
	err := s.db.Collection("settings").FindOne(ctx, bson.M{"_id": "device_map"}).Decode(&dm)
	if err == mongo.ErrNoDocuments {
		return domain.DeviceMap{}, mongo.ErrNoDocuments
	}
	return dm, err
}

func (s *Store) SaveDeviceMap(ctx context.Context, dm domain.DeviceMap) error {
	dm.UpdatedAt = time.Now()
	_, err := s.db.Collection("settings").UpdateByID(ctx, "device_map", bson.M{"$set": dm}, options.Update().SetUpsert(true))
	return err
}

func (s *Store) GetOTARelease(ctx context.Context) (domain.OTARelease, error) {
	var rel domain.OTARelease
	err := s.db.Collection("settings").FindOne(ctx, bson.M{"_id": "ota_release"}).Decode(&rel)
	if err == mongo.ErrNoDocuments {
		return domain.OTARelease{}, mongo.ErrNoDocuments
	}
	return rel, err
}

func (s *Store) SaveOTARelease(ctx context.Context, rel domain.OTARelease) error {
	_, err := s.db.Collection("settings").UpdateByID(ctx, "ota_release", bson.M{"$set": rel}, options.Update().SetUpsert(true))
	return err
}

func (s *Store) SeedDefaults(ctx context.Context) error {
	_, _ = s.db.Collection("settings").UpdateByID(ctx, "rules", bson.M{"$setOnInsert": bson.M{
		"min_temp": 18.0, "max_temp": 32.0,
		"min_air_humidity": 45.0, "max_air_humidity": 75.0,
		"min_soil_humidity": 35.0, "max_soil_humidity": 70.0,
		"min_light_level": 0.0, "max_light_level": 100.0,
		"light_start_time": "06:00", "light_end_time": "18:00",
		"enable_auto_exhaust": true, "enable_auto_irrigation": true,
	}}, options.Update().SetUpsert(true))
	_, _ = s.db.Collection("settings").UpdateByID(ctx, "actuators", bson.M{"$setOnInsert": bson.M{
		"exhaust_on": false, "irrigation_on": false, "humidifier_on": false,
		"dehumidifier_on": false, "heater_on": false, "light_on": false,
		"updated_at": time.Now(), "source": "boot",
	}}, options.Update().SetUpsert(true))
	_, _ = s.db.Collection("settings").UpdateByID(ctx, "device_map", bson.M{"$setOnInsert": bson.M{
		"sensor_ports": bson.M{
			"TEMPERATURA":  "",
			"UMIDADE_AR":   "",
			"UMIDADE_SOLO": "",
			"LUMINOSIDADE": "",
		},
		"actuator_ports": bson.M{
			"EXAUSTAO":        "",
			"IRRIGACAO":       "",
			"UMIDIFICADOR":    "",
			"DESUMIDIFICADOR": "",
			"AQUECEDOR":       "",
			"LUZ":             "",
		},
		"updated_at": time.Now(),
	}}, options.Update().SetUpsert(true))
	_, _ = s.db.Collection("settings").UpdateByID(ctx, "ota_release", bson.M{"$setOnInsert": bson.M{
		"version":      0,
		"file_name":    "",
		"file_path":    "",
		"sha256":       "",
		"size_bytes":   int64(0),
		"uploaded_at":  time.Now(),
		"published_at": time.Time{},
		"content_type": "application/octet-stream",
	}}, options.Update().SetUpsert(true))
	_ = s.SaveEvent(ctx, domain.EventLog{
		Timestamp: time.Now(), Type: "system", Source: "boot",
		Message: fmt.Sprintf("Eden backend iniciado em %s", time.Now().Format(time.RFC3339)),
	})
	return nil
}
