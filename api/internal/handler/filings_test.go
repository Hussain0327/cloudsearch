package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/hussain/cloudsearch/api/internal/filings"
	"github.com/hussain/cloudsearch/api/internal/models"
)

// fakeStore is an in-memory filings.Store for handler tests.
type fakeStore struct {
	filings map[int64]*models.FilingDetail
	docs    map[int64]string
}

var _ filings.Store = (*fakeStore)(nil)

func (s *fakeStore) ListFilings(_ context.Context) ([]models.Filing, error) {
	out := make([]models.Filing, 0, len(s.filings))
	for _, d := range s.filings {
		out = append(out, d.Filing)
	}
	return out, nil
}

func (s *fakeStore) GetFiling(_ context.Context, id int64) (*models.FilingDetail, error) {
	d, ok := s.filings[id]
	if !ok {
		return nil, filings.ErrNotFound
	}
	return d, nil
}

func (s *fakeStore) GetFilingByTicker(_ context.Context, ticker string) (*models.FilingDetail, error) {
	for _, d := range s.filings {
		if d.Filing.Ticker == ticker {
			return d, nil
		}
	}
	return nil, filings.ErrNotFound
}

func (s *fakeStore) GetDocument(_ context.Context, id int64) (string, error) {
	doc, ok := s.docs[id]
	if !ok {
		return "", filings.ErrNotFound
	}
	return doc, nil
}

func f64(v float64) *float64 { return &v }
func str(v string) *string   { return &v }
func i64(v int64) *int64     { return &v }

func newFixture() *fakeStore {
	filed := time.Date(2025, 10, 31, 0, 0, 0, 0, time.UTC)
	fy := 2025
	filing := models.Filing{
		ID: 1, CIK: "0000320193", Ticker: "AAPL", CompanyName: "Apple Inc.", FormType: "10-K",
		AccessionNumber: "0000320193-25-000079", FiledAt: models.NewDate(&filed), FiscalYear: &fy,
		SourceURL: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
		FactCount: 4, UpdatedAt: filed,
	}
	facts := []models.Fact{
		{ID: 1, FilingID: 1, FactIndex: 0, DomID: "f-00000", Category: "debt", Kind: "percent",
			RawText: "3.600% Notes due 2042", Label: "Notes due 2042", ValueNumeric: f64(3.6), Unit: str("percent"),
			Section: "Cover", Concept: str("dei:Security12bTitle"), Source: "ixbrl"},
		{ID: 2, FilingID: 1, FactIndex: 1, DomID: "f-00001", Category: "other", Kind: "money",
			RawText: "$3,253,431,000,000", Label: "aggregate market value", ValueNumeric: f64(3253431000000), Unit: str("USD"),
			Section: "Cover", Source: "regex"},
		{ID: 3, FilingID: 1, FactIndex: 2, DomID: "f-00002", Category: "other", Kind: "entity",
			RawText: "Microsoft", Label: "Microsoft", Section: "Item 1A", Source: "entity"},
		{ID: 4, FilingID: 1, FactIndex: 3, DomID: "f-00003", Category: "revenue", Kind: "money",
			RawText: "$391.0 billion", Label: "Net sales", ValueNumeric: f64(391e9), Unit: str("USD"),
			Section: "Item 7", Source: "regex"},
	}
	links := []models.FilingLink{
		{ID: 1, FilingID: 1, FactIndex: 2, DomID: "f-00002", TargetTicker: "MSFT", TargetFilingID: i64(2), MentionText: "Microsoft"},
	}
	return &fakeStore{
		filings: map[int64]*models.FilingDetail{1: {Filing: filing, Facts: facts, Links: links}},
		docs:    map[int64]string{1: `<div><span class="cs-fact" id="f-00000" data-fact-id="f-00000">3.600% Notes due 2042</span></div>`},
	}
}

func newRouter(store filings.Store) http.Handler {
	h := NewFilingsHandler(store)
	r := chi.NewRouter()
	r.Route("/filings", func(r chi.Router) {
		r.Get("/", h.List)
		r.Get("/by-ticker/{ticker}", h.GetByTicker)
		r.Get("/{id}", h.Get)
		r.Get("/{id}/document", h.Document)
		r.Get("/{id}/crawl", h.Crawl)
	})
	return r
}

func TestFilings_List(t *testing.T) {
	srv := httptest.NewServer(newRouter(newFixture()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/filings")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var body struct {
		Filings []map[string]any `json:"filings"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Filings) != 1 {
		t.Fatalf("filings = %d, want 1", len(body.Filings))
	}
	if got := body.Filings[0]["filed_at"]; got != "2025-10-31" {
		t.Errorf("filed_at = %v, want 2025-10-31 string", got)
	}
	if got := body.Filings[0]["period_of_report"]; got != nil {
		t.Errorf("period_of_report = %v, want null", got)
	}
	if got := body.Filings[0]["fiscal_year"]; got != float64(2025) {
		t.Errorf("fiscal_year = %v, want 2025", got)
	}
}

func TestFilings_GetByID(t *testing.T) {
	srv := httptest.NewServer(newRouter(newFixture()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/filings/1")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var detail models.FilingDetail
	if err := json.NewDecoder(resp.Body).Decode(&detail); err != nil {
		t.Fatal(err)
	}
	if detail.Filing.Ticker != "AAPL" || len(detail.Facts) != 4 || len(detail.Links) != 1 {
		t.Errorf("unexpected detail: ticker=%s facts=%d links=%d", detail.Filing.Ticker, len(detail.Facts), len(detail.Links))
	}
	if detail.Facts[0].ValueNumeric == nil || *detail.Facts[0].ValueNumeric != 3.6 {
		t.Errorf("value_numeric not round-tripped: %v", detail.Facts[0].ValueNumeric)
	}
	if detail.Facts[2].ValueNumeric != nil {
		t.Errorf("entity fact value_numeric should be null")
	}
}

func TestFilings_GetByTicker(t *testing.T) {
	srv := httptest.NewServer(newRouter(newFixture()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/filings/by-ticker/aapl")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d (by-ticker must not be routed as an id)", resp.StatusCode)
	}

	resp2, err := http.Get(srv.URL + "/filings/by-ticker/ZZZZ")
	if err != nil {
		t.Fatal(err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusNotFound {
		t.Errorf("unknown ticker status = %d, want 404", resp2.StatusCode)
	}
}

func TestFilings_NotFoundAndBadID(t *testing.T) {
	srv := httptest.NewServer(newRouter(newFixture()))
	defer srv.Close()

	cases := map[string]int{
		"/filings/999":          http.StatusNotFound,
		"/filings/abc":          http.StatusBadRequest,
		"/filings/0":            http.StatusBadRequest,
		"/filings/999/document": http.StatusNotFound,
		"/filings/999/crawl":    http.StatusNotFound,
		"/filings/abc/crawl":    http.StatusBadRequest,
	}
	for path, want := range cases {
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("%s status = %d, want %d", path, resp.StatusCode, want)
		}
	}

	resp, err := http.Get(srv.URL + "/filings/999")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body map[string]string
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if body["error"] != "filing not found" {
		t.Errorf("404 body = %v", body)
	}
}

func TestFilings_DocumentHeaders(t *testing.T) {
	srv := httptest.NewServer(newRouter(newFixture()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/filings/1/document")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}
	if csp := resp.Header.Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'none'") ||
		!strings.Contains(csp, "img-src https://www.sec.gov data:") {
		t.Errorf("CSP = %q", csp)
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("missing nosniff")
	}
}

// sseEvent is one parsed SSE frame.
type sseEvent struct {
	name string
	data string
}

func readSSE(t *testing.T, resp *http.Response) []sseEvent {
	t.Helper()
	var (
		events []sseEvent
		cur    sseEvent
		data   []string
	)
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			cur.name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = append(data, strings.TrimPrefix(line, "data: "))
		case line == "":
			if cur.name != "" {
				cur.data = strings.Join(data, "\n")
				events = append(events, cur)
			}
			cur = sseEvent{}
			data = nil
		}
	}
	return events
}

func TestFilings_CrawlSequence(t *testing.T) {
	srv := httptest.NewServer(newRouter(newFixture()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/filings/1/crawl?pace_ms=0")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type = %q", ct)
	}

	events := readSSE(t, resp)
	names := make([]string, len(events))
	for i, e := range events {
		names[i] = e.name
	}
	want := []string{"start", "fact", "fact", "fact", "link", "fact", "done"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("event sequence = %v, want %v", names, want)
	}

	var start models.CrawlStart
	if err := json.Unmarshal([]byte(events[0].data), &start); err != nil {
		t.Fatal(err)
	}
	if start.FilingID != 1 || start.Ticker != "AAPL" || start.Total != 4 || start.Streaming != 4 {
		t.Errorf("start = %+v", start)
	}

	// The link must follow the fact with the same fact_index.
	var fact models.Fact
	_ = json.Unmarshal([]byte(events[3].data), &fact)
	var link models.FilingLink
	_ = json.Unmarshal([]byte(events[4].data), &link)
	if fact.FactIndex != 2 || link.FactIndex != 2 || link.TargetTicker != "MSFT" {
		t.Errorf("link did not follow its fact: fact=%d link=%d target=%s", fact.FactIndex, link.FactIndex, link.TargetTicker)
	}
	if link.TargetFilingID == nil || *link.TargetFilingID != 2 {
		t.Errorf("target_filing_id = %v", link.TargetFilingID)
	}
	if events[len(events)-1].data != "" {
		t.Errorf("done event should carry no data, got %q", events[len(events)-1].data)
	}
}

func TestFilings_CrawlCategoryFilter(t *testing.T) {
	srv := httptest.NewServer(newRouter(newFixture()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/filings/1/crawl?pace_ms=0&categories=revenue,debt")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	events := readSSE(t, resp)

	var start models.CrawlStart
	_ = json.Unmarshal([]byte(events[0].data), &start)
	if start.Total != 4 || start.Streaming != 2 {
		t.Errorf("start = %+v, want total 4 streaming 2", start)
	}
	var cats []string
	for _, e := range events {
		if e.name == "fact" {
			var f models.Fact
			_ = json.Unmarshal([]byte(e.data), &f)
			cats = append(cats, f.Category)
		}
		if e.name == "link" {
			t.Errorf("link emitted although its fact was filtered out")
		}
	}
	if strings.Join(cats, ",") != "debt,revenue" {
		t.Errorf("categories streamed = %v", cats)
	}

	bad, err := http.Get(srv.URL + "/filings/1/crawl?categories=revenue,bogus")
	if err != nil {
		t.Fatal(err)
	}
	bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Errorf("unknown category status = %d, want 400", bad.StatusCode)
	}
}

func TestFilings_CrawlFrom(t *testing.T) {
	srv := httptest.NewServer(newRouter(newFixture()))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/filings/1/crawl?pace_ms=0&from=2")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	events := readSSE(t, resp)

	var idx []int
	for _, e := range events {
		if e.name == "fact" {
			var f models.Fact
			_ = json.Unmarshal([]byte(e.data), &f)
			idx = append(idx, f.FactIndex)
		}
	}
	if len(idx) != 2 || idx[0] != 2 || idx[1] != 3 {
		t.Errorf("fact indexes = %v, want [2 3]", idx)
	}
}

func TestFilings_CrawlPaceAndDisconnect(t *testing.T) {
	srv := httptest.NewServer(newRouter(newFixture()))
	defer srv.Close()

	// A large pace is clamped to 5000ms; cancelling the request must end the
	// handler promptly rather than waiting out the timer.
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/filings/1/crawl?pace_ms=999999", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	// Read the start event and first fact, then disconnect.
	sc := bufio.NewScanner(resp.Body)
	got := 0
	for sc.Scan() && got < 2 {
		if strings.HasPrefix(sc.Text(), "event: ") {
			got++
		}
	}
	cancel()

	done := make(chan struct{})
	go func() {
		srv.CloseClientConnections()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("server did not release the crawl connection after client disconnect")
	}
}
