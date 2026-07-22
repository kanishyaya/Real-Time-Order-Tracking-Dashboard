"""
auth.py — JWT auth for OrderStream
No hashing at module load time. Plain-text demo credentials.
"""
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, status
from jose import JWTError, jwt
from config import settings

DEMO_USERS = {
    "admin":  {"username": "admin",  "password": "admin123",  "role": "admin"},
    "viewer": {"username": "viewer", "password": "viewer123", "role": "viewer"},
}

def create_access_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRY_MINUTES)
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def verify_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token.")

def authenticate_user(username: str, password: str) -> dict | None:
    user = DEMO_USERS.get(username)
    if not user or user["password"] != password:
        return None
    return user

def get_token_from_query(token: str | None) -> dict:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token required.")
    return verify_token(token)
