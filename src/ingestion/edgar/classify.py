"""Map iXBRL concepts and free-text matches onto the four fact categories.

Categories (see docs/EDGAR_SPIDER.md): revenue, debt, shares, other.
Kinds: money, percent, shares, date, entity, text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

CATEGORIES = ("revenue", "debt", "shares", "other")
KINDS = ("money", "percent", "shares", "date", "entity", "text")


@dataclass(frozen=True)
class Classification:
    category: str
    kind: str
    label: str


# --- iXBRL concept rules -----------------------------------------------------
# (regex on the concept local name, category, kind, label). First match wins.
# Labels are short because the viewer shows them next to the value.
_CONCEPT_RULES: list[tuple[re.Pattern[str], str, str, str]] = [
    # Revenue
    (re.compile(r"^Revenues$"), "revenue", "money", "Revenue"),
    (
        re.compile(r"^RevenueFromContractWithCustomer(Excluding|Including)AssessedTax$"),
        "revenue",
        "money",
        "Net sales",
    ),
    (re.compile(r"^SalesRevenue(Net|GoodsNet|ServicesNet)$"), "revenue", "money", "Net sales"),
    (
        re.compile(r"^RevenueRemainingPerformanceObligation$"),
        "revenue",
        "money",
        "Remaining performance obligation",
    ),
    (re.compile(r"^RevenueFromContractWithCustomer.*"), "revenue", "money", "Revenue"),
    (re.compile(r"^(Net)?Revenue"), "revenue", "money", "Revenue"),
    # Debt and financing
    (
        re.compile(r"^DebtInstrumentInterestRate(Stated|Effective)Percentage"),
        "debt",
        "percent",
        "Interest rate",
    ),
    (
        re.compile(r"^DebtWeightedAverageInterestRate"),
        "debt",
        "percent",
        "Weighted-average interest rate",
    ),
    (re.compile(r"^DebtInstrumentFaceAmount$"), "debt", "money", "Notes principal amount"),
    (re.compile(r"^DebtInstrumentCarryingAmount$"), "debt", "money", "Debt carrying amount"),
    (re.compile(r"^DebtInstrumentMaturityDate"), "debt", "date", "Maturity date"),
    (re.compile(r"^LongTermDebtFairValue$"), "debt", "money", "Term debt fair value"),
    (re.compile(r"^LongTermDebtNoncurrent$"), "debt", "money", "Non-current term debt"),
    (re.compile(r"^LongTermDebtCurrent$"), "debt", "money", "Current term debt"),
    (re.compile(r"^LongTermDebt$"), "debt", "money", "Total term debt"),
    (
        re.compile(r"^LongTermDebtMaturitiesRepaymentsOfPrincipal"),
        "debt",
        "money",
        "Principal repayments due",
    ),
    (re.compile(r"^CommercialPaper"), "debt", "money", "Commercial paper"),
    (re.compile(r"^ShortTermBorrowings$"), "debt", "money", "Short-term borrowings"),
    (re.compile(r"^DebtCurrent$"), "debt", "money", "Current debt"),
    (
        re.compile(r"^LineOfCreditFacilityMaximumBorrowingCapacity"),
        "debt",
        "money",
        "Credit facility capacity",
    ),
    (re.compile(r"^LineOfCredit"), "debt", "money", "Line of credit"),
    (re.compile(r"^ProceedsFromIssuanceOf.*Debt"), "debt", "money", "Debt issued"),
    (re.compile(r"^Repayments?Of.*Debt"), "debt", "money", "Debt repaid"),
    (re.compile(r"^InterestExpense"), "debt", "money", "Interest expense"),
    (re.compile(r"^InterestPaid"), "debt", "money", "Interest paid"),
    (re.compile(r".*(Debt|Borrowing|SeniorNotes|UnsecuredDebt|Indenture).*"), "debt", "money", ""),
    # Shares
    (re.compile(r"^EntityCommonStockSharesOutstanding$"), "shares", "shares", "Shares outstanding"),
    (re.compile(r"^CommonStockSharesOutstanding$"), "shares", "shares", "Shares outstanding"),
    (re.compile(r"^CommonStockSharesIssued$"), "shares", "shares", "Shares issued"),
    (re.compile(r"^CommonStockSharesAuthorized$"), "shares", "shares", "Shares authorized"),
    (
        re.compile(r"^WeightedAverageNumberOfDilutedSharesOutstanding$"),
        "shares",
        "shares",
        "Diluted weighted-average shares",
    ),
    (
        re.compile(r"^WeightedAverageNumberOfSharesOutstandingBasic$"),
        "shares",
        "shares",
        "Basic weighted-average shares",
    ),
    (re.compile(r"^StockRepurchased.*Shares$"), "shares", "shares", "Shares repurchased"),
    (re.compile(r"^TreasuryStockSharesAcquired$"), "shares", "shares", "Shares repurchased"),
    (re.compile(r"^StockIssuedDuringPeriodShares"), "shares", "shares", "Shares issued"),
    (
        re.compile(r"^StockRepurchasedAndRetiredDuringPeriodValue$"),
        "shares",
        "money",
        "Share repurchases",
    ),
    (re.compile(r"^PaymentsForRepurchaseOfCommonStock$"), "shares", "money", "Share repurchases"),
    (
        re.compile(r"^StockRepurchaseProgramRemainingAuthorizedRepurchaseAmount"),
        "shares",
        "money",
        "Repurchase authorization remaining",
    ),
    (re.compile(r"^StockRepurchaseProgram"), "shares", "money", "Repurchase authorization"),
    (re.compile(r"^CommonStockDividendsPerShare"), "shares", "money", "Dividends per share"),
    (re.compile(r"^EarningsPerShare(Basic|Diluted)$"), "shares", "money", "Earnings per share"),
    # Cover-page items (dei)
    (
        re.compile(r"^EntityPublicFloat$"),
        "other",
        "money",
        "Aggregate market value held by non-affiliates",
    ),
    (re.compile(r"^TradingSymbol$"), "other", "text", "Trading symbol"),
    (re.compile(r"^EntityRegistrantName$"), "other", "text", "Registrant"),
    (re.compile(r"^DocumentPeriodEndDate$"), "other", "date", "Fiscal year end"),
    # Common statement lines (kept as "other" but with readable labels)
    (re.compile(r"^NetIncomeLoss$"), "other", "money", "Net income"),
    (re.compile(r"^OperatingIncomeLoss$"), "other", "money", "Operating income"),
    (re.compile(r"^GrossProfit$"), "other", "money", "Gross margin"),
    (re.compile(r"^CostOfGoodsAndServicesSold$"), "other", "money", "Cost of sales"),
    (re.compile(r"^ResearchAndDevelopmentExpense$"), "other", "money", "Research and development"),
    (re.compile(r"^IncomeTaxExpenseBenefit$"), "other", "money", "Income taxes"),
    (
        re.compile(r"^EffectiveIncomeTaxRateContinuingOperations$"),
        "other",
        "percent",
        "Effective tax rate",
    ),
    (
        re.compile(r"^CashAndCashEquivalentsAtCarryingValue$"),
        "other",
        "money",
        "Cash and cash equivalents",
    ),
    (re.compile(r"^Assets$"), "other", "money", "Total assets"),
    (re.compile(r"^Liabilities$"), "other", "money", "Total liabilities"),
    (re.compile(r"^StockholdersEquity$"), "other", "money", "Shareholders' equity"),
    (
        re.compile(r"^NetCashProvidedByUsedInOperatingActivities$"),
        "other",
        "money",
        "Operating cash flow",
    ),
]

_CAMEL_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")


def humanize_concept(local_name: str) -> str:
    """'AccountsPayableCurrent' -> 'Accounts payable current'."""
    words = _CAMEL_RE.split(local_name)
    text = " ".join(w for w in words if w)
    return text[:1].upper() + text[1:].lower() if text else local_name


def classify_concept(concept: str, unit: str | None) -> Classification:
    """Classify an iXBRL concept such as 'us-gaap:LongTermDebt'."""
    local = concept.split(":", 1)[1] if ":" in concept else concept
    for pattern, category, kind, label in _CONCEPT_RULES:
        if pattern.search(local):
            return Classification(category, kind, label or humanize_concept(local))
    # Unit-driven fallbacks for the thousands of untagged-by-rule concepts.
    if unit == "shares":
        return Classification("shares", "shares", humanize_concept(local))
    if unit == "percent":
        return Classification("other", "percent", humanize_concept(local))
    return Classification("other", "money" if unit == "USD" else "text", humanize_concept(local))


# --- Security 12(b) titles ("3.600% Notes due 2042", "Common Stock, $0.00001 par value")
_NOTES_TITLE_RE = re.compile(
    r"(?P<rate>\d+(?:\.\d+)?)%\s+(?P<name>.*?Notes?\s+due\s+(?P<year>\d{4}))", re.IGNORECASE
)


def classify_security_title(text: str) -> tuple[Classification, float | None, str | None]:
    """Returns (classification, value, unit) for a dei:Security12bTitle string."""
    m = _NOTES_TITLE_RE.search(text)
    if m:
        label = f"Notes due {m.group('year')}"
        return Classification("debt", "percent", label), float(m.group("rate")), "percent"
    if re.search(r"common\s+stock", text, re.IGNORECASE):
        return Classification("shares", "text", "Common stock"), None, None
    return Classification("other", "text", text.strip()[:60]), None, None


# --- Free-text context classification ---------------------------------------
_DEBT_WORDS = re.compile(
    r"\b(notes?|debt|borrow\w*|interest|coupon|commercial paper|credit (?:facility|agreement)|"
    r"indenture|principal|matur\w*|repay\w*|financing|term loan|lease liabilit\w*)\b",
    re.IGNORECASE,
)
_REVENUE_WORDS = re.compile(r"\b(net sales|revenues?|sales)\b", re.IGNORECASE)
_SHARES_WORDS = re.compile(r"\b(shares?|repurchas\w*|dividends?|outstanding)\b", re.IGNORECASE)


def classify_context(context: str, kind: str) -> str:
    """Pick a category for a regex-found value from the words around it."""
    if kind == "shares":
        return "shares"
    if _DEBT_WORDS.search(context):
        return "debt"
    if _REVENUE_WORDS.search(context):
        return "revenue"
    if _SHARES_WORDS.search(context):
        return "shares"
    return "other"


_STOP_PREFIX = re.compile(
    r"^(?:(?:in|during|for|as of|at)\s+(?:fiscal\s+(?:year\s+)?)?\d{4},?\s+)?(?:the|a|an|our|its|approximately)?\s*",
    re.IGNORECASE,
)
_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\u2019\-]*")
# Words that carry no meaning at the end of a label ("... was approximately").
_WEAK_TAIL = {
    "was",
    "were",
    "is",
    "are",
    "of",
    "to",
    "by",
    "or",
    "and",
    "at",
    "approximately",
    "totaled",
    "totaling",
    "the",
    "a",
    "an",
    "for",
    "from",
    "in",
    "with",
    "had",
    "has",
    "have",
    "be",
    "about",
    "up",
    "than",
    "on",
    "as",
    "its",
    "our",
}


def label_from_sentence(sentence: str, max_words: int = 6) -> str:
    """First few meaningful words of the sentence, e.g.
    'The aggregate market value of the voting and ...' -> 'aggregate market value of the voting'.
    """
    s = _STOP_PREFIX.sub("", sentence.strip(), count=1)
    words = _WORD_RE.findall(s)
    return " ".join(words[:max_words]) if words else "Figure"


def label_for_match(sentence: str, match_text: str, max_words: int = 6) -> str:
    """Label a figure found by regex from the words around it.

    Prefers the clause leading up to the figure ("Total net sales increased"),
    drops trailing filler ("was approximately"), and falls back to the start of
    the sentence when what is left is too short to mean anything.
    """
    pos = sentence.find(match_text)
    if pos < 0:
        return label_from_sentence(sentence, max_words)
    before = _STOP_PREFIX.sub("", sentence[:pos].strip(), count=1)
    words = _WORD_RE.findall(before)
    while words and words[-1].lower() in _WEAK_TAIL:
        words.pop()
    tail = words[-max_words:]
    if len(tail) >= 2:
        return " ".join(tail)
    return label_from_sentence(sentence, max_words)
