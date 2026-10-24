"""Entry point: ``python -m ingestion.edgar.mcp_server`` (stdio transport)."""

import sys

# stdout is the MCP channel. Route all logging to stderr before anything else
# imports structlog loggers (structlog prints to stdout by default).
import structlog

structlog.configure(logger_factory=structlog.PrintLoggerFactory(file=sys.stderr))

from ingestion.edgar.mcp_server.server import mcp

if __name__ == "__main__":
    mcp.run(transport="stdio")
