// Package filings provides read access to EDGAR filings, extracted facts, and
// cross-filing links (alembic revision 002).
package filings

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hussain/cloudsearch/api/internal/models"
)

// ErrNotFound is returned when a filing does not exist.
var ErrNotFound = errors.New("filing not found")

// Store is the read interface used by the HTTP handlers.
type Store interface {
	ListFilings(ctx context.Context) ([]models.Filing, error)
	GetFiling(ctx context.Context, id int64) (*models.FilingDetail, error)
	GetFilingByTicker(ctx context.Context, ticker string) (*models.FilingDetail, error)
	GetDocument(ctx context.Context, id int64) (string, error)
}

// PGStore implements Store over a pgx pool.
type PGStore struct {
	pool *pgxpool.Pool
}

// Compile-time interface check.
var _ Store = (*PGStore)(nil)

// NewPGStore creates a Postgres-backed Store.
func NewPGStore(pool *pgxpool.Pool) *PGStore {
	return &PGStore{pool: pool}
}

const filingColumns = `
	f.id, f.cik, f.ticker, f.company_name, f.form_type, f.accession_number,
	f.filed_at, f.period_of_report, f.fiscal_year, f.source_url, f.fact_count,
	f.updated_at`

// filingRow scans one filing from a row produced with filingColumns.
func scanFiling(row pgx.Row) (*models.Filing, error) {
	var (
		f        models.Filing
		filedAt  *time.Time
		period   *time.Time
		fiscalYr *int32
	)
	if err := row.Scan(
		&f.ID, &f.CIK, &f.Ticker, &f.CompanyName, &f.FormType, &f.AccessionNumber,
		&filedAt, &period, &fiscalYr, &f.SourceURL, &f.FactCount, &f.UpdatedAt,
	); err != nil {
		return nil, err
	}
	f.FiledAt = models.NewDate(filedAt)
	f.PeriodOfReport = models.NewDate(period)
	if fiscalYr != nil {
		y := int(*fiscalYr)
		f.FiscalYear = &y
	}
	return &f, nil
}

// ListFilings returns all filings, newest first, with per-category counts.
func (s *PGStore) ListFilings(ctx context.Context) ([]models.Filing, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+filingColumns+`
		FROM filings f
		ORDER BY f.filed_at DESC NULLS LAST, f.id DESC`)
	if err != nil {
		return nil, fmt.Errorf("listing filings: %w", err)
	}
	defer rows.Close()

	filings := make([]models.Filing, 0)
	index := map[int64]int{}
	for rows.Next() {
		f, err := scanFiling(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning filing: %w", err)
		}
		index[f.ID] = len(filings)
		filings = append(filings, *f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	if len(filings) == 0 {
		return filings, nil
	}

	// One GROUP BY over facts for every filing's category counts.
	countRows, err := s.pool.Query(ctx, `
		SELECT filing_id, category, COUNT(*)
		FROM facts
		GROUP BY filing_id, category`)
	if err != nil {
		return nil, fmt.Errorf("counting facts: %w", err)
	}
	defer countRows.Close()
	for countRows.Next() {
		var (
			filingID int64
			category string
			n        int64
		)
		if err := countRows.Scan(&filingID, &category, &n); err != nil {
			return nil, fmt.Errorf("scanning fact counts: %w", err)
		}
		i, ok := index[filingID]
		if !ok {
			continue
		}
		applyCount(&filings[i].Counts, category, int(n))
	}
	return filings, countRows.Err()
}

func applyCount(c *models.FilingCounts, category string, n int) {
	switch category {
	case "revenue":
		c.Revenue = n
	case "debt":
		c.Debt = n
	case "shares":
		c.Shares = n
	case "other":
		c.Other = n
	}
}

// GetFiling returns a filing with all of its facts and links.
func (s *PGStore) GetFiling(ctx context.Context, id int64) (*models.FilingDetail, error) {
	f, err := scanFiling(s.pool.QueryRow(ctx, `SELECT `+filingColumns+` FROM filings f WHERE f.id = $1`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("getting filing %d: %w", id, err)
	}
	return s.detail(ctx, f)
}

// GetFilingByTicker returns the most recently filed filing for a ticker.
func (s *PGStore) GetFilingByTicker(ctx context.Context, ticker string) (*models.FilingDetail, error) {
	f, err := scanFiling(s.pool.QueryRow(ctx, `
		SELECT `+filingColumns+`
		FROM filings f
		WHERE f.ticker = $1
		ORDER BY f.filed_at DESC NULLS LAST, f.id DESC
		LIMIT 1`, strings.ToUpper(ticker)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("getting filing for %s: %w", ticker, err)
	}
	return s.detail(ctx, f)
}

func (s *PGStore) detail(ctx context.Context, f *models.Filing) (*models.FilingDetail, error) {
	facts, err := s.facts(ctx, f.ID)
	if err != nil {
		return nil, err
	}
	for _, fact := range facts {
		applyIncrement(&f.Counts, fact.Category)
	}
	links, err := s.links(ctx, f.ID)
	if err != nil {
		return nil, err
	}
	return &models.FilingDetail{Filing: *f, Facts: facts, Links: links}, nil
}

func applyIncrement(c *models.FilingCounts, category string) {
	switch category {
	case "revenue":
		c.Revenue++
	case "debt":
		c.Debt++
	case "shares":
		c.Shares++
	case "other":
		c.Other++
	}
}

func (s *PGStore) facts(ctx context.Context, filingID int64) ([]models.Fact, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, filing_id, fact_index, dom_id, category, kind, raw_text, label,
		       value_numeric::float8, unit, context, section, concept, source
		FROM facts
		WHERE filing_id = $1
		ORDER BY fact_index`, filingID)
	if err != nil {
		return nil, fmt.Errorf("listing facts: %w", err)
	}
	defer rows.Close()

	facts := make([]models.Fact, 0)
	for rows.Next() {
		var f models.Fact
		if err := rows.Scan(
			&f.ID, &f.FilingID, &f.FactIndex, &f.DomID, &f.Category, &f.Kind, &f.RawText, &f.Label,
			&f.ValueNumeric, &f.Unit, &f.Context, &f.Section, &f.Concept, &f.Source,
		); err != nil {
			return nil, fmt.Errorf("scanning fact: %w", err)
		}
		facts = append(facts, f)
	}
	return facts, rows.Err()
}

func (s *PGStore) links(ctx context.Context, filingID int64) ([]models.FilingLink, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, filing_id, fact_index, dom_id, target_ticker, target_filing_id, mention_text
		FROM filing_links
		WHERE filing_id = $1
		ORDER BY fact_index`, filingID)
	if err != nil {
		return nil, fmt.Errorf("listing filing links: %w", err)
	}
	defer rows.Close()

	links := make([]models.FilingLink, 0)
	for rows.Next() {
		var l models.FilingLink
		if err := rows.Scan(
			&l.ID, &l.FilingID, &l.FactIndex, &l.DomID, &l.TargetTicker, &l.TargetFilingID, &l.MentionText,
		); err != nil {
			return nil, fmt.Errorf("scanning filing link: %w", err)
		}
		links = append(links, l)
	}
	return links, rows.Err()
}

// GetDocument returns the annotated HTML for a filing.
func (s *PGStore) GetDocument(ctx context.Context, id int64) (string, error) {
	var html string
	err := s.pool.QueryRow(ctx, `SELECT annotated_html FROM filings WHERE id = $1`, id).Scan(&html)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("getting document %d: %w", id, err)
	}
	return html, nil
}
