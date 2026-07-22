"""
tests/test_auth.py
-------------------
Unit tests for auth.py. These run against config.py's defaults, with no
database or Redis connection required — auth is pure JWT logic plus a
static demo-user lookup, so it can (and should) be tested in isolation.

Run with:
    cd backend
    pytest tests/test_auth.py -v
"""

import time

import pytest
from fastapi import HTTPException

from auth import (
    authenticate_user,
    create_access_token,
    get_token_from_query,
    verify_token,
)


class TestAuthenticateUser:

    def test_valid_admin_credentials_succeed(self):
        user = authenticate_user("admin", "admin123")
        assert user is not None
        assert user["username"] == "admin"
        assert user["role"] == "admin"

    def test_valid_viewer_credentials_succeed(self):
        user = authenticate_user("viewer", "viewer123")
        assert user is not None
        assert user["role"] == "viewer"

    def test_wrong_password_fails(self):
        assert authenticate_user("admin", "wrong-password") is None

    def test_unknown_username_fails(self):
        assert authenticate_user("nobody", "whatever") is None

    def test_empty_credentials_fail(self):
        assert authenticate_user("", "") is None


class TestTokenRoundTrip:

    def test_create_then_verify_returns_original_claims(self):
        token = create_access_token({"sub": "admin", "role": "admin"})
        decoded = verify_token(token)
        assert decoded["sub"] == "admin"
        assert decoded["role"] == "admin"
        # exp claim should have been added automatically
        assert "exp" in decoded

    def test_token_expiry_is_in_the_future(self):
        token = create_access_token({"sub": "admin"})
        decoded = verify_token(token)
        assert decoded["exp"] > time.time()

    def test_garbage_token_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            verify_token("this-is-not-a-real-jwt")
        assert exc_info.value.status_code == 401

    def test_tampered_token_raises_401(self):
        token = create_access_token({"sub": "admin"})
        tampered = token[:-4] + "abcd"  # corrupt the signature
        with pytest.raises(HTTPException) as exc_info:
            verify_token(tampered)
        assert exc_info.value.status_code == 401


class TestGetTokenFromQuery:
    """Used by the WebSocket endpoint, which authenticates via ?token=."""

    def test_missing_token_raises_401(self):
        with pytest.raises(HTTPException) as exc_info:
            get_token_from_query(None)
        assert exc_info.value.status_code == 401

    def test_valid_token_returns_claims(self):
        token = create_access_token({"sub": "viewer"})
        decoded = get_token_from_query(token)
        assert decoded["sub"] == "viewer"
