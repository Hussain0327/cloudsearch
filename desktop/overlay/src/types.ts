/**
 * The shared fact model. It mirrors `docs/EDGAR_SPIDER.md` with one extra
 * category, `custom`, for things the person asked the spider to look for.
 */

export type Category = 'revenue' | 'debt' | 'shares' | 'other' | 'custom';
export type Kind = 'money' | 'percent' | 'shares' | 'date' | 'entity' | 'text';
export type Unit = 'USD' | 'percent' | 'shares' | null;

/** Display order for chips and legends. */
export const CATEGORIES: readonly Category[] = ['revenue', 'debt', 'shares', 'other', 'custom'];

export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  revenue: 'Revenue',
  debt: 'Debt',
  shares: 'Shares',
  other: 'Other',
  custom: 'Custom',
};

export interface Fact {
  /** 0-based position in document order. */
  readonly index: number;
  /** `f-00042`; equals the span's `data-fact-id`. */
  readonly id: string;
  readonly category: Category;
  readonly kind: Kind;
  /** The matched text with whitespace collapsed. */
  readonly text: string;
  /** A few words from before the match. */
  readonly label: string;
  readonly value: number | null;
  readonly unit: Unit;
  /** Surrounding block text, at most 240 characters. */
  readonly context: string;
}

export type CategoryCounts = Record<Category, number>;

export function emptyCounts(): CategoryCounts {
  return {revenue: 0, debt: 0, shares: 0, other: 0, custom: 0};
}

export function countByCategory(facts: readonly Fact[]): CategoryCounts {
  const counts = emptyCounts();
  for (const fact of facts) {
    counts[fact.category] += 1;
  }
  return counts;
}
