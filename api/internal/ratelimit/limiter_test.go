package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAllow_WithinRate(t *testing.T) {
	l := New(10, 5) // 10 rps, burst of 5
	defer l.Close()

	// First request should always be allowed (within burst)
	if !l.Allow("192.168.1.1") {
		t.Error("first request should be allowed")
	}
}

func TestAllow_ExceedingBurst(t *testing.T) {
	l := New(1, 2) // 1 rps, burst of 2
	defer l.Close()

	ip := "10.0.0.1"

	// First two should succeed (burst = 2)
	if !l.Allow(ip) {
		t.Error("request 1 should be allowed (within burst)")
	}
	if !l.Allow(ip) {
		t.Error("request 2 should be allowed (within burst)")
	}

	// Third request should be denied (burst exhausted, not enough time for refill)
	if l.Allow(ip) {
		t.Error("request 3 should be denied (burst exceeded)")
	}
}

func TestAllow_IndependentLimitersPerIP(t *testing.T) {
	l := New(1, 1) // 1 rps, burst of 1
	defer l.Close()

	ip1 := "10.0.0.1"
	ip2 := "10.0.0.2"

	// Exhaust IP1's burst
	if !l.Allow(ip1) {
		t.Error("ip1 first request should be allowed")
	}
	if l.Allow(ip1) {
		t.Error("ip1 second request should be denied")
	}

	// IP2 should still have its full burst available
	if !l.Allow(ip2) {
		t.Error("ip2 first request should be allowed (independent limiter)")
	}
}

func TestMiddleware_Returns429WhenExceeded(t *testing.T) {
	l := New(1, 1) // 1 rps, burst of 1
	defer l.Close()

	handler := l.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))

	// First request should pass through
	req1 := httptest.NewRequest(http.MethodGet, "/", nil)
	req1.RemoteAddr = "10.0.0.1:12345"
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, req1)

	if w1.Code != http.StatusOK {
		t.Errorf("first request: expected status 200, got %d", w1.Code)
	}

	// Second request from same IP should be rate limited
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.RemoteAddr = "10.0.0.1:12345"
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)

	if w2.Code != http.StatusTooManyRequests {
		t.Errorf("second request: expected status 429, got %d", w2.Code)
	}
}

func TestMiddleware_UsesXRealIP(t *testing.T) {
	l := New(1, 1)
	defer l.Close()

	handler := l.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// First request with X-Real-IP
	req1 := httptest.NewRequest(http.MethodGet, "/", nil)
	req1.RemoteAddr = "127.0.0.1:9999"
	req1.Header.Set("X-Real-IP", "203.0.113.50")
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, req1)

	if w1.Code != http.StatusOK {
		t.Errorf("first request: expected 200, got %d", w1.Code)
	}

	// Second request from same X-Real-IP (different RemoteAddr) should be limited
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.RemoteAddr = "127.0.0.1:8888" // different RemoteAddr
	req2.Header.Set("X-Real-IP", "203.0.113.50") // same real IP
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)

	if w2.Code != http.StatusTooManyRequests {
		t.Errorf("second request from same X-Real-IP: expected 429, got %d", w2.Code)
	}
}

func TestMiddleware_DifferentIPsPassThrough(t *testing.T) {
	l := New(1, 1)
	defer l.Close()

	handler := l.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Exhaust first IP
	req1 := httptest.NewRequest(http.MethodGet, "/", nil)
	req1.RemoteAddr = "10.0.0.1:1234"
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, req1)

	// Second IP should still work
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.RemoteAddr = "10.0.0.2:1234"
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Errorf("different IP should get 200, got %d", w2.Code)
	}
}
