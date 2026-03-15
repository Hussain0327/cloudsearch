FROM golang:1.22-alpine AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /cloudsearch-api ./cmd/server

FROM alpine:3.19

RUN apk --no-cache add ca-certificates
COPY --from=builder /cloudsearch-api /usr/local/bin/cloudsearch-api

EXPOSE 8080

ENTRYPOINT ["cloudsearch-api"]
