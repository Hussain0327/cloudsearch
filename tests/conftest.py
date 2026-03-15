"""Shared test fixtures."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture
def aws_s3_html() -> str:
    return (FIXTURES_DIR / "aws_s3_bucket_policy.html").read_text()


@pytest.fixture
def aws_lambda_html() -> str:
    return (FIXTURES_DIR / "aws_lambda_handler.html").read_text()


@pytest.fixture
def db_dsn() -> str:
    return os.environ.get(
        "TEST_DB_DSN",
        "postgresql://cloudsearch:cloudsearch@localhost:5432/cloudsearch",
    )
