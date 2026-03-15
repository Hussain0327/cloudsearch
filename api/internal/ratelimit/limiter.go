package ratelimit

import (
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type visitor struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// Limiter implements per-IP token-bucket rate limiting.
type Limiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	rps      rate.Limit
	burst    int
	done     chan struct{}
}

// New creates a rate limiter with the given requests/sec and burst size.
// Starts a background goroutine to clean stale entries every 5 minutes.
func New(rps float64, burst int) *Limiter {
	l := &Limiter{
		visitors: make(map[string]*visitor),
		rps:      rate.Limit(rps),
		burst:    burst,
		done:     make(chan struct{}),
	}

	go l.cleanup()
	return l
}

// Allow checks if the request from the given IP is allowed.
func (l *Limiter) Allow(ip string) bool {
	l.mu.Lock()
	v, exists := l.visitors[ip]
	if !exists {
		v = &visitor{
			limiter: rate.NewLimiter(l.rps, l.burst),
		}
		l.visitors[ip] = v
	}
	v.lastSeen = time.Now()
	l.mu.Unlock()

	return v.limiter.Allow()
}

// Middleware returns a Chi-compatible middleware that rate limits by IP.
func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if forwarded := r.Header.Get("X-Real-IP"); forwarded != "" {
			ip = forwarded
		}

		if !l.Allow(ip) {
			http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// Close stops the background cleanup goroutine.
func (l *Limiter) Close() {
	close(l.done)
}

func (l *Limiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			l.mu.Lock()
			for ip, v := range l.visitors {
				if time.Since(v.lastSeen) > 10*time.Minute {
					delete(l.visitors, ip)
				}
			}
			l.mu.Unlock()
		case <-l.done:
			return
		}
	}
}
