"""Pure billing calculations. All money is handled in integer paise (1/100 of a rupee)."""
from dataclasses import dataclass, field
from datetime import date


def to_paise(value) -> int:
    """Parse a user-entered amount like '1500' or '1499.50' into paise."""
    text = str(value).strip()
    if not text:
        return 0
    if text.startswith("-"):
        raise ValueError("Amount cannot be negative")
    whole, _, frac = text.partition(".")
    if not whole.isdigit() and whole != "":
        raise ValueError(f"Invalid amount: {value!r}")
    if frac and (not frac.isdigit() or len(frac) > 2):
        raise ValueError(f"Invalid amount: {value!r}")
    return int(whole or 0) * 100 + int(frac.ljust(2, "0") or 0)


def fmt(paise: int) -> str:
    sign = "-" if paise < 0 else ""
    paise = abs(paise)
    return f"{sign}{paise // 100:,}.{paise % 100:02d}"


def nights_between(check_in: date, check_out: date) -> int:
    """Billable nights; a same-day stay is charged as one night."""
    if check_out < check_in:
        raise ValueError("Check-out cannot be before check-in")
    return max(1, (check_out - check_in).days)


def percent_of(amount: int, rate_bp: int) -> int:
    """rate_bp is the rate in basis points (1800 = 18%). Rounds half up."""
    return (amount * rate_bp + 5000) // 10000


@dataclass
class LineItem:
    description: str
    quantity: int
    unit_price: int

    @property
    def amount(self) -> int:
        return self.quantity * self.unit_price


@dataclass
class Bill:
    lines: list = field(default_factory=list)
    discount: int = 0
    tax_rate_bp: int = 0
    paid: int = 0

    @property
    def subtotal(self) -> int:
        return sum(line.amount for line in self.lines)

    @property
    def taxable(self) -> int:
        return max(0, self.subtotal - self.discount)

    @property
    def tax(self) -> int:
        return percent_of(self.taxable, self.tax_rate_bp)

    @property
    def cgst(self) -> int:
        return self.tax // 2

    @property
    def sgst(self) -> int:
        return self.tax - self.cgst

    @property
    def total(self) -> int:
        return self.taxable + self.tax

    @property
    def balance(self) -> int:
        return self.total - self.paid


def build_bill(booking, room, extras, payments, tax_rate_bp: int) -> Bill:
    check_in = date.fromisoformat(booking["check_in"])
    check_out = date.fromisoformat(booking["check_out"])
    nights = nights_between(check_in, check_out)
    lines = [LineItem(f"Room {room['number']} ({room['room_type']}) - {nights} night(s)",
                      nights, booking["rate"])]
    lines += [LineItem(e["description"], e["quantity"], e["unit_price"]) for e in extras]
    return Bill(lines=lines, discount=booking["discount"], tax_rate_bp=tax_rate_bp,
                paid=sum(p["amount"] for p in payments))
