"""
tests/test_models.py
---------------------
Tests for the Pydantic request/response models in models.py -- these
define the actual API contract, so it's worth locking in what's valid
and what isn't.

Run with:
    cd backend
    pytest tests/test_models.py -v
"""

import pytest
from pydantic import ValidationError

from models import OrderCreate, OrderUpdate


class TestOrderCreate:

    def test_valid_order_defaults_status_to_pending(self):
        order = OrderCreate(customer_name="Alice", product_name="Headphones")
        assert order.status == "pending"

    def test_valid_order_with_explicit_status(self):
        order = OrderCreate(
            customer_name="Bob", product_name="Keyboard", status="shipped"
        )
        assert order.status == "shipped"

    def test_invalid_status_rejected(self):
        with pytest.raises(ValidationError):
            OrderCreate(
                customer_name="Bob",
                product_name="Keyboard",
                status="on_the_moon",  # not one of the allowed literals
            )

    def test_empty_customer_name_rejected(self):
        with pytest.raises(ValidationError):
            OrderCreate(customer_name="", product_name="Keyboard")

    def test_missing_required_field_rejected(self):
        with pytest.raises(ValidationError):
            OrderCreate(customer_name="Bob")  # product_name missing


class TestOrderUpdate:

    def test_all_fields_optional(self):
        # Should not raise -- every field on OrderUpdate is optional
        update = OrderUpdate()
        assert update.customer_name is None
        assert update.product_name is None
        assert update.status is None

    def test_partial_update_status_only(self):
        update = OrderUpdate(status="delivered")
        assert update.status == "delivered"
        assert update.customer_name is None

    def test_invalid_status_rejected(self):
        with pytest.raises(ValidationError):
            OrderUpdate(status="not-a-real-status")
