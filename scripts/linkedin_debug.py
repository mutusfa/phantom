#!/usr/bin/env python3
"""Debug: dump raw HTML of LinkedIn skills page."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

SESSION_FILE = Path.home() / ".linkedin_session" / "context.json"

with sync_playwright() as p:
    state = json.loads(SESSION_FILE.read_text())
    context = p.chromium.launch(headless=True).new_context(storage_state=state)
    page = context.new_page()

    url = "https://www.linkedin.com/in/julius-juodagalvis/details/skills/"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(3000)
    # Scroll to load content
    for _ in range(5):
        page.keyboard.press("End")
        page.wait_for_timeout(800)

    html = page.content()
    # Write to file - it's large
    Path("/tmp/linkedin_skills.html").write_text(html)
    print(f"Page URL: {page.url}")
    print(f"HTML length: {len(html)}")

    # Try to extract any text that looks like skills
    import re
    # Look for common skill patterns
    text_content = page.evaluate("() => document.body.innerText")
    Path("/tmp/linkedin_text.txt").write_text(text_content)
    print("Text saved to /tmp/linkedin_text.txt")
    print("\nFirst 3000 chars of text:")
    print(text_content[:3000])
    context.close()
