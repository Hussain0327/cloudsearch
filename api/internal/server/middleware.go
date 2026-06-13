package server

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog/log"
)

// RequestLogger is a zerolog-based request logging middleware.
// It injects a context-scoped logger with the request ID so all
// downstream log calls include it automatically.
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		// Inject request-scoped logger into context
		reqID := middleware.GetReqID(r.Context())
		logger := log.With().Str("request_id", reqID).Logger()
		ctx := logger.WithContext(r.Context())
		r = r.WithContext(ctx)

		defer func() {
			logger.Info().
				Str("method", r.Method).
				Str("path", r.URL.Path).
				Int("status", ww.Status()).
				Int("bytes", ww.BytesWritten()).
				Dur("duration", time.Since(start)).
				Str("remote", r.RemoteAddr).
				Msg("request")
		}()

		next.ServeHTTP(ww, r)
	})
}

// CORS returns a middleware that emits CORS headers scoped to the configured
// allowed origins. If a configured origin is the literal "*", it falls back to
// a wildcard (dev opt-in) WITHOUT Allow-Credentials, since the browser rejects
// wildcard + credentials. Otherwise, a matching Origin is echoed back exactly
// with Allow-Credentials so credentialed requests work.
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	wildcard := false
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		o = strings.TrimSpace(o)
		if o == "*" {
			wildcard = true
		} else if o != "" {
			allowed[o] = struct{}{}
		}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if _, ok := allowed[origin]; ok && origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Add("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			} else if wildcard {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Max-Age", "86400")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// TimeoutExempt sets a context value to exempt a route from the global timeout.
type timeoutExemptKey struct{}

// WithTimeoutExempt marks the context as exempt from the global timeout middleware.
func WithTimeoutExempt(ctx context.Context) context.Context {
	return context.WithValue(ctx, timeoutExemptKey{}, true)
}

// IsTimeoutExempt checks whether the context is marked exempt.
func IsTimeoutExempt(ctx context.Context) bool {
	v, _ := ctx.Value(timeoutExemptKey{}).(bool)
	return v
}
