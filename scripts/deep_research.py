#!/usr/bin/env python3
"""
Deep research tool using Tongyi DeepResearch via OpenRouter.
Reads TOOL_INPUT env var (JSON with 'query' field), calls OpenRouter, prints result.
"""
import json
import os
import sys
import urllib.request
import urllib.error

KEY_FILE = os.path.expanduser("~/.secrets/openrouter_api_key")
MODEL = "alibaba/tongyi-deepresearch-30b-a3b"
API_URL = "https://openrouter.ai/api/v1/chat/completions"

def main():
    tool_input_raw = os.environ.get("TOOL_INPUT", "{}")
    try:
        tool_input = json.loads(tool_input_raw)
    except json.JSONDecodeError:
        print(json.dumps({"error": "Invalid TOOL_INPUT JSON"}))
        sys.exit(1)

    query = tool_input.get("query", "").strip()
    if not query:
        print(json.dumps({"error": "Missing 'query' field in input"}))
        sys.exit(1)

    try:
        with open(KEY_FILE) as f:
            api_key = f.read().strip()
    except FileNotFoundError:
        print(json.dumps({"error": "OpenRouter API key not found at ~/.secrets/openrouter_api_key"}))
        sys.exit(1)

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": query}],
        "stream": False,
    }

    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://phantom.local",
            "X-Title": "Phantom Deep Research",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        print(json.dumps({"error": f"HTTP {e.code}: {err_body}"}))
        sys.exit(1)
    except urllib.error.URLError as e:
        print(json.dumps({"error": f"Network error: {e.reason}"}))
        sys.exit(1)

    choices = body.get("choices", [])
    if not choices:
        print(json.dumps({"error": "No choices in response", "raw": body}))
        sys.exit(1)

    message = choices[0].get("message", {})
    content = message.get("content", "")

    # Some thinking models return reasoning separately
    reasoning = message.get("reasoning", "") or message.get("reasoning_content", "")

    output = {"result": content}
    if reasoning:
        output["reasoning_summary"] = reasoning[:500] + ("..." if len(reasoning) > 500 else "")

    usage = body.get("usage", {})
    if usage:
        output["tokens"] = usage

    print(json.dumps(output, ensure_ascii=False))

if __name__ == "__main__":
    main()
