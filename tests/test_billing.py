from datetime import date

import pytest

from hotel_billing.billing import Bill, LineItem, fmt, nights_between, percent_of, to_paise


@pytest.mark.parametrize("text,expected", [
    ("1500", 150000), ("1499.5", 149950), ("0.05", 5), ("", 0), (".5", 50),
])
def test_to_paise(text, expected):
    assert to_paise(text) == expected


@pytest.mark.parametrize("text", ["-1", "abc", "1.234", "1.2.3"])
def test_to_paise_rejects_bad_input(text):
    with pytest.raises(ValueError):
        to_paise(text)


def test_fmt():
    assert fmt(12345678) == "123,456.78"
    assert fmt(5) == "0.05"


def test_nights():
    assert nights_between(date(2026, 1, 1), date(2026, 1, 4)) == 3
    assert nights_between(date(2026, 1, 1), date(2026, 1, 1)) == 1
    with pytest.raises(ValueError):
        nights_between(date(2026, 1, 2), date(2026, 1, 1))


def test_percent_rounds_half_up():
    assert percent_of(1000, 1250) == 125
    assert percent_of(5, 1000) == 1  # 0.5 paise rounds up


def test_bill_totals():
    bill = Bill(lines=[LineItem("Room", 2, 200000), LineItem("Laundry", 1, 30000)],
                discount=30000, tax_rate_bp=1200, paid=100000)
    assert bill.subtotal == 430000
    assert bill.taxable == 400000
    assert bill.tax == 48000
    assert bill.cgst + bill.sgst == bill.tax
    assert bill.total == 448000
    assert bill.balance == 348000


def test_discount_cannot_make_taxable_negative():
    bill = Bill(lines=[LineItem("Room", 1, 1000)], discount=5000, tax_rate_bp=1800)
    assert bill.taxable == 0
    assert bill.total == 0
