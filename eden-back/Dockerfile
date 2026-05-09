FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /bin/backend ./cmd/api

FROM alpine:3.20
WORKDIR /app
COPY --from=build /bin/backend /usr/local/bin/backend
EXPOSE 8080
CMD ["backend"]
