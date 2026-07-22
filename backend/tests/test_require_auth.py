"""
tests/test_require_auth.py
---------------------------
Regression test for a real bug found during review: `require_auth()`
used to return `None` instead of raising when no credentials were
supplied, which meant every write endpoint (POST/PUT/DELETE on /orders)
was callable with zero authentication -- despite the API docs stating a
Bearer token is required on every endpoint.

This tests the dependency function directly (no live DB/Redis needed),
since require_auth's job is purely "was a usable token supplied or not".

Run with:
    cd backend
    pytest tests/test_require_auth.py -v
"""

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from auth import create_access_token
from routes_orders import require_auth


class TestRequireAuth:

    def test_missing_credentials_raises_401(self):
        """
        This is the bug: previously, calling require_auth(None) returned
        None silently instead of rejecting the request, so any endpoint
        depending on it was effectively unauthenticated when no header
        was sent at all.
        """
        with pytest.raises(HTTPException) as exc_info:
            require_auth(credentials=None)
        assert exc_info.value.status_code == 401

    def test_valid_bearer_token_is_accepted(self):
        token = create_access_token({"sub": "admin", "role": "admin"})
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        decoded = require_auth(credentials=creds)

        assert decoded["sub"] == "admin"
        assert decoded["role"] == "admin"

    def test_invalid_bearer_token_raises_401(self):
        creds = HTTPAuthorizationCredentials(
            scheme="Bearer", credentials="not-a-real-token"
        )
        with pytest.raises(HTTPException) as exc_info:
            require_auth(credentials=creds)
        assert exc_info.value.status_code == 401
