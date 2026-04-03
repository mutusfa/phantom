#!/usr/bin/env python3
"""Wrapper for linkedin_send_message MCP tool."""
import sys
import json
import os
import subprocess

tool_input = json.loads(os.environ.get("TOOL_INPUT", "{}"))
backend_urn = tool_input.get("backend_urn", "")
message = tool_input.get("message", "")

if not backend_urn or not message:
    print(json.dumps({"error": "backend_urn and message are required"}))
    sys.exit(1)

result = subprocess.run(
    [sys.executable, "/home/dietpi/phantom/app/scripts/linkedin_playwright.py", "send", backend_urn, message],
    capture_output=True,
    text=True,
)

if result.returncode != 0:
    print(json.dumps({"error": result.stderr[-300:] or "Script failed"}))
else:
    print(result.stdout)
