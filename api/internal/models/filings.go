package models

import (
	"fmt"
	"strings"
	"time"
)

// Date is a calendar date that serializes as "YYYY-MM-DD" (or null when nil).
// It exists so DATE columns don't leak a time-of-day/timezone into the API.
type Date struct {
	time.Time
}

// NewDate wraps a *time.Time (as scanned from a nullable DATE column) into a
// *Date, preserving nil.
func NewDate(t *time.Time) *Date {
	if t == nil {
		return nil
	}
	return &Date{Time: *t}
}

// MarshalJSON renders the date as a quoted YYYY-MM-DD string.
func (d Date) MarshalJSON() ([]byte, error) {
	return []byte(`"` + d.Time.Format("2006-01-02") + `"`), nil
}

// UnmarshalJSON parses a quoted YYYY-MM-DD string.
func (d *Date) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		return nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return fmt.Errorf("parsing date %q: %w", s, err)
	}
	d.Time = t
	return nil
}

// FilingCounts is the per-category fact count for a filing.
type FilingCounts struct {
	Revenue int `json:"revenue"`
	Debt    int `json:"debt"`
	Shares  int `json:"shares"`
	Other   int `json:"other"`
}

// Filing is the list/detail DTO for an indexed EDGAR filing.
type Filing struct {
	ID              int64        `json:"id"`
	CIK             string       `json:"cik"`
	Ticker          string       `json:"ticker"`
	CompanyName     string       `json:"company_name"`
	FormType        string       `json:"form_type"`
	AccessionNumber string       `json:"accession_number"`
	FiledAt         *Date        `json:"filed_at"`
	PeriodOfReport  *Date        `json:"period_of_report"`
	FiscalYear      *int         `json:"fiscal_year"`
	SourceURL       string       `json:"source_url"`
	FactCount       int          `json:"fact_count"`
	Counts          FilingCounts `json:"counts"`
	UpdatedAt       time.Time    `json:"updated_at"`
}

// Fact is one extracted fact in document order.
type Fact struct {
	ID           int64    `json:"id"`
	FilingID     int64    `json:"filing_id"`
	FactIndex    int      `json:"fact_index"`
	DomID        string   `json:"dom_id"`
	Category     string   `json:"category"`
	Kind         string   `json:"kind"`
	RawText      string   `json:"raw_text"`
	Label        string   `json:"label"`
	ValueNumeric *float64 `json:"value_numeric"`
	Unit         *string  `json:"unit"`
	Context      string   `json:"context"`
	Section      string   `json:"section"`
	Concept      *string  `json:"concept"`
	Source       string   `json:"source"`
}

// FilingLink connects an entity-mention fact to another company's filing.
type FilingLink struct {
	ID             int64  `json:"id"`
	FilingID       int64  `json:"filing_id"`
	FactIndex      int    `json:"fact_index"`
	DomID          string `json:"dom_id"`
	TargetTicker   string `json:"target_ticker"`
	TargetFilingID *int64 `json:"target_filing_id"`
	MentionText    string `json:"mention_text"`
}

// FilingDetail is the response for GET /filings/{id} and /filings/by-ticker/{t}.
type FilingDetail struct {
	Filing Filing       `json:"filing"`
	Facts  []Fact       `json:"facts"`
	Links  []FilingLink `json:"links"`
}

// FilingsResponse is the response for GET /filings.
type FilingsResponse struct {
	Filings []Filing `json:"filings"`
}

// CrawlStart is the payload of the SSE "start" event.
type CrawlStart struct {
	FilingID    int64  `json:"filing_id"`
	Ticker      string `json:"ticker"`
	CompanyName string `json:"company_name"`
	Total       int    `json:"total"`
	Streaming   int    `json:"streaming"`
}

// FactCategories is the closed set of fact categories.
var FactCategories = map[string]bool{
	"revenue": true,
	"debt":    true,
	"shares":  true,
	"other":   true,
}
