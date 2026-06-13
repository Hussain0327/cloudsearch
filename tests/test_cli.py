"""Tests for CLI helpers (no pipeline/embedder imports required)."""

from __future__ import annotations

from ingestion.cli import _read_urls_file


def test_read_urls_file_skips_indented_comments(tmp_path):
    f = tmp_path / "urls.txt"
    f.write_text(
        "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html\n"
        "# top-level comment\n"
        "  # indented comment\n"
        "\n"
        "   \n"
        "  https://docs.aws.amazon.com/s3/latest/userguide/x.html  \n"
    )
    urls = _read_urls_file(str(f))
    assert urls == [
        "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html",
        "https://docs.aws.amazon.com/s3/latest/userguide/x.html",
    ]
    # The indented comment must never become a seed URL.
    assert "# indented comment" not in urls
    assert all(not u.startswith("#") for u in urls)
