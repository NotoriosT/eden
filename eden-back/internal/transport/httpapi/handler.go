package httpapi

import (
	"crypto/sha256"
	"errors"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"eden-iot/backend-go/internal/domain"
	"eden-iot/backend-go/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type Handler struct{ svc *service.AppService }

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func NewHandler(svc *service.AppService) *Handler { return &Handler{svc: svc} }

func (h *Handler) Register(r *gin.Engine) {
	r.Use(cors())
	r.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	r.GET("/api/readings", h.getReadings)
	r.GET("/api/readings/latest", h.getLatest)
	r.GET("/api/plants", h.getPlants)
	r.POST("/api/plants", h.createPlant)
	r.PUT("/api/plants/:id/phase", h.updatePlantPhase)
	r.GET("/api/plants/:id/progress", h.getPlantProgress)
	r.POST("/api/plants/:id/progress", h.addPlantProgress)
	r.GET("/api/events", h.getEvents)
	r.GET("/api/automation-rules", h.listAutomationRules)
	r.POST("/api/automation-rules", h.createAutomationRule)
	r.PUT("/api/automation-rules/:id", h.updateAutomationRule)
	r.DELETE("/api/automation-rules/:id", h.deleteAutomationRule)
	r.GET("/api/rules", h.getRules)
	r.PUT("/api/rules", h.updateRules)
	r.GET("/api/actuators", h.getActuators)
	r.PUT("/api/actuators", h.updateActuators)
	r.PATCH("/api/actuators", h.patchActuator)
	r.POST("/api/actuators/mode", h.setActuatorsMode)
	r.GET("/api/device-map", h.getDeviceMap)
	r.PUT("/api/device-map", h.updateDeviceMap)
	r.GET("/api/bootstrap/config", h.getBootstrapConfig)
	r.POST("/api/iot/sync", h.notifyIoTSync)
	r.GET("/api/ota/release", h.getOTARelease)
	r.POST("/api/ota/upload", h.uploadOTA)
	r.POST("/api/ota/publish", h.publishOTA)
	r.GET("/api/ota/firmware", h.downloadOTA)
	r.GET("/ws", h.websocket)
}

func (h *Handler) getReadings(c *gin.Context) {
	limit, _ := strconv.ParseInt(c.DefaultQuery("limit", "120"), 10, 64)
	fromRaw := strings.TrimSpace(c.Query("from"))
	toRaw := strings.TrimSpace(c.Query("to"))

	var fromPtr *time.Time
	var toPtr *time.Time

	if fromRaw != "" {
		from, err := time.Parse(time.RFC3339, fromRaw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "from invalido (use RFC3339)"})
			return
		}
		fromPtr = &from
	}

	if toRaw != "" {
		to, err := time.Parse(time.RFC3339, toRaw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "to invalido (use RFC3339)"})
			return
		}
		toPtr = &to
	}

	if fromPtr != nil && toPtr != nil && fromPtr.After(*toPtr) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "from deve ser menor ou igual a to"})
		return
	}

	var (
		list []domain.SensorReading
		err  error
	)
	if fromPtr != nil || toPtr != nil {
		list, err = h.svc.ReadingsRange(c.Request.Context(), fromPtr, toPtr, limit)
	} else {
		list, err = h.svc.Readings(c.Request.Context(), limit)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handler) getLatest(c *gin.Context) {
	list, err := h.svc.Readings(c.Request.Context(), 1)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(list) == 0 {
		c.JSON(http.StatusOK, gin.H{})
		return
	}
	c.JSON(http.StatusOK, list[0])
}

func (h *Handler) getPlants(c *gin.Context) {
	v, e := h.svc.Plants(c.Request.Context())
	if e != nil {
		c.JSON(500, gin.H{"error": e.Error()})
		return
	}
	c.JSON(200, v)
}

func (h *Handler) createPlant(c *gin.Context) {
	var p domain.Plant
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.CreatePlant(c.Request.Context(), p)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(201, out)
}

func (h *Handler) updatePlantPhase(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "id invalido"})
		return
	}
	var in struct {
		Phase string `json:"phase"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdatePlantPhase(c.Request.Context(), id, in.Phase); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (h *Handler) getPlantProgress(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "id invalido"})
		return
	}
	limit, _ := strconv.ParseInt(c.DefaultQuery("limit", "60"), 10, 64)
	out, err := h.svc.PlantProgress(c.Request.Context(), id, limit)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (h *Handler) addPlantProgress(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "id invalido"})
		return
	}
	var in service.ProgressInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.AddPlantProgress(c.Request.Context(), id, in)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(201, out)
}

func (h *Handler) getEvents(c *gin.Context) {
	limit, _ := strconv.ParseInt(c.DefaultQuery("limit", "80"), 10, 64)
	v, e := h.svc.Events(c.Request.Context(), limit)
	if e != nil {
		c.JSON(500, gin.H{"error": e.Error()})
		return
	}
	c.JSON(200, v)
}

func (h *Handler) listAutomationRules(c *gin.Context) {
	v, e := h.svc.ListAutomationRules(c.Request.Context())
	if e != nil {
		c.JSON(500, gin.H{"error": e.Error()})
		return
	}
	c.JSON(200, v)
}

func (h *Handler) createAutomationRule(c *gin.Context) {
	var r domain.AutomationRule
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.CreateAutomationRule(c.Request.Context(), r)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(201, out)
}

func (h *Handler) updateAutomationRule(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(400, gin.H{"error": "id invalido"})
		return
	}
	var r domain.AutomationRule
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.UpdateAutomationRule(c.Request.Context(), id, r)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (h *Handler) deleteAutomationRule(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(400, gin.H{"error": "id invalido"})
		return
	}
	if err := h.svc.DeleteAutomationRule(c.Request.Context(), id); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (h *Handler) getRules(c *gin.Context) {
	v, e := h.svc.Rules(c.Request.Context())
	if e != nil {
		c.JSON(500, gin.H{"error": e.Error()})
		return
	}
	c.JSON(200, v)
}

func (h *Handler) updateRules(c *gin.Context) {
	var p domain.Rule
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateRules(c.Request.Context(), p); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, p)
}

func (h *Handler) getActuators(c *gin.Context) {
	v, e := h.svc.Actuators(c.Request.Context())
	if e != nil {
		c.JSON(500, gin.H{"error": e.Error()})
		return
	}
	c.JSON(200, v)
}

func (h *Handler) updateActuators(c *gin.Context) {
	var p domain.ActuatorState
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.UpdateActuatorsManual(c.Request.Context(), p)
	if err != nil {
		if errors.Is(err, service.ErrActuatorLockedByRule) {
			c.JSON(http.StatusConflict, gin.H{"error": "atuador bloqueado por regra ativa; desative a regra para usar manual"})
			return
		}
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (h *Handler) patchActuator(c *gin.Context) {
	var in struct {
		Dispositivo string `json:"dispositivo"`
		On          *bool  `json:"on"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(in.Dispositivo) == "" || in.On == nil {
		c.JSON(400, gin.H{"error": "dispositivo e on sao obrigatorios"})
		return
	}
	out, err := h.svc.UpdateSingleActuatorManual(c.Request.Context(), in.Dispositivo, *in.On)
	if err != nil {
		if errors.Is(err, service.ErrActuatorLockedByRule) {
			c.JSON(http.StatusConflict, gin.H{"error": "atuador bloqueado por regra ativa; desative a regra para usar manual"})
			return
		}
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (h *Handler) setActuatorsMode(c *gin.Context) {
	var in struct {
		Mode string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.SetActuatorMode(c.Request.Context(), in.Mode)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (h *Handler) getDeviceMap(c *gin.Context) {
	v, e := h.svc.DeviceMap(c.Request.Context())
	if e != nil {
		c.JSON(500, gin.H{"error": e.Error()})
		return
	}
	c.JSON(200, v)
}

func (h *Handler) updateDeviceMap(c *gin.Context) {
	var p domain.DeviceMap
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.SaveDeviceMap(c.Request.Context(), p)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (h *Handler) getBootstrapConfig(c *gin.Context) {
	v, e := h.svc.BootstrapConfig(c.Request.Context())
	if e != nil {
		c.JSON(500, gin.H{"error": e.Error()})
		return
	}
	c.JSON(200, v)
}

func (h *Handler) notifyIoTSync(c *gin.Context) {
	var in struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&in)
	if err := h.svc.NotifyIoTSync(c.Request.Context(), in.Reason); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true})
}

func (h *Handler) getOTARelease(c *gin.Context) {
	v, err := h.svc.OTARelease(c.Request.Context())
	if err != nil {
		c.JSON(404, gin.H{"error": "ota release not found"})
		return
	}
	c.JSON(200, v)
}

func (h *Handler) uploadOTA(c *gin.Context) {
	fileHeader, err := c.FormFile("firmware")
	if err != nil {
		c.JSON(400, gin.H{"error": "firmware file is required"})
		return
	}

	versionRaw := strings.TrimSpace(c.PostForm("version"))
	var version int
	if versionRaw != "" {
		version, err = strconv.Atoi(versionRaw)
		if err != nil || version <= 0 {
			c.JSON(400, gin.H{"error": "version must be a positive integer"})
			return
		}
	} else {
		cur, e := h.svc.OTARelease(c.Request.Context())
		if e == nil && cur.Version > 0 {
			version = cur.Version + 1
		} else {
			version = 1
		}
	}

	otaDir := filepath.Join("data", "ota")
	if err := os.MkdirAll(otaDir, 0o755); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	dstName := "eden_iot_v" + strconv.Itoa(version) + ".bin"
	dstPath := filepath.Join(otaDir, dstName)

	src, err := fileHeader.Open()
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer src.Close()

	dst, err := os.Create(dstPath)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer dst.Close()

	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(dst, hasher), src)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	rel, err := h.svc.SaveOTARelease(c.Request.Context(), domain.OTARelease{
		Version:     version,
		FileName:    dstName,
		FilePath:    dstPath,
		SHA256:      hex.EncodeToString(hasher.Sum(nil)),
		SizeBytes:   written,
		ContentType: "application/octet-stream",
		Description: strings.TrimSpace(c.PostForm("description")),
	})
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(201, rel)
}

func (h *Handler) publishOTA(c *gin.Context) {
	var in struct {
		Version int `json:"version"`
	}
	_ = c.ShouldBindJSON(&in)
	out, err := h.svc.PublishOTA(c.Request.Context(), in.Version)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, out)
}

func (h *Handler) downloadOTA(c *gin.Context) {
	reqVersion, _ := strconv.Atoi(strings.TrimSpace(c.Query("v")))
	rel, err := h.svc.OTARelease(c.Request.Context())
	if err != nil || rel.Version <= 0 || rel.FilePath == "" {
		c.JSON(404, gin.H{"error": "ota release not found"})
		return
	}
	if reqVersion > 0 && reqVersion != rel.Version {
		c.JSON(404, gin.H{"error": "requested OTA version not found"})
		return
	}
	if _, err := os.Stat(rel.FilePath); err != nil {
		c.JSON(404, gin.H{"error": "firmware file not found on server"})
		return
	}
	c.Header("Cache-Control", "no-cache")
	c.FileAttachment(rel.FilePath, rel.FileName)
}

type wsSnapshot struct {
	ServerTime      string                  `json:"server_time"`
	Readings        []domain.SensorReading  `json:"readings"`
	Plants          []domain.Plant          `json:"plants"`
	Rules           domain.Rule             `json:"rules"`
	Actuators       domain.ActuatorState    `json:"actuators"`
	Events          []domain.EventLog       `json:"events"`
	AutomationRules []domain.AutomationRule `json:"automation_rules"`
	DeviceMap       domain.DeviceMap        `json:"device_map"`
}

func (h *Handler) websocket(c *gin.Context) {
	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	send := func() error {
		ctx := c.Request.Context()
		readings, _ := h.svc.Readings(ctx, 120)
		plants, _ := h.svc.Plants(ctx)
		rules, _ := h.svc.Rules(ctx)
		actuators, _ := h.svc.Actuators(ctx)
		events, _ := h.svc.Events(ctx, 80)
		automationRules, _ := h.svc.ListAutomationRules(ctx)
		deviceMap, _ := h.svc.DeviceMap(ctx)

		return conn.WriteJSON(wsSnapshot{
			ServerTime:      time.Now().Format(time.RFC3339),
			Readings:        readings,
			Plants:          plants,
			Rules:           rules,
			Actuators:       actuators,
			Events:          events,
			AutomationRules: automationRules,
			DeviceMap:       deviceMap,
		})
	}

	if err := send(); err != nil {
		return
	}

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if err := send(); err != nil {
			return
		}
	}
}

func cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
