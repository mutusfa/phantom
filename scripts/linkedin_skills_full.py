#!/usr/bin/env python3
"""Extract full skills list from LinkedIn profile, clicking through all tabs."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

SESSION_FILE = Path.home() / ".linkedin_session" / "context.json"
PROFILE = "https://www.linkedin.com/in/julius-juodagalvis"

TABS = [
    ("All", ""),
    ("Industry Knowledge", ""),
    ("Tools & Technologies", ""),
    ("Interpersonal Skills", ""),
    ("Languages", ""),
    ("Other Skills", ""),
]

def extract_skills_from_text(text: str) -> list[str]:
    """Parse the page text to extract skill names, stopping at footer content."""
    lines = text.splitlines()
    skills = []
    in_skills = False
    stop_words = {"Load more", "Who your viewers also viewed", "About", "Accessibility", "LinkedIn Corporation"}

    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line == "Skills":
            in_skills = True
            continue
        if not in_skills:
            continue
        if any(line.startswith(sw) for sw in stop_words):
            break
        # Skip tab filter buttons
        if line in {"All", "Industry Knowledge", "Tools & Technologies", "Interpersonal Skills", "Languages", "Other Skills"}:
            continue
        # Skip endorsement context lines (they contain "at" and reference companies/schools)
        if (" at " in line and ("experience" in line or "educational" in line)):
            continue
        # Skip GitHub URLs
        if line.startswith("http"):
            continue
        # Skip very long lines (descriptions)
        if len(line) > 60:
            continue
        skills.append(line)

    return skills


with sync_playwright() as p:
    state = json.loads(SESSION_FILE.read_text())
    context = p.chromium.launch(headless=True).new_context(storage_state=state)
    page = context.new_page()

    all_skills_by_category = {}

    for tab_name, _ in TABS:
        url = f"{PROFILE}/details/skills/"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)

        # Click the tab if not "All"
        if tab_name != "All":
            try:
                tab_btn = page.get_by_role("button", name=tab_name, exact=True)
                if tab_btn.count() > 0:
                    tab_btn.first.click()
                    page.wait_for_timeout(1500)
                else:
                    continue
            except Exception as e:
                print(f"Tab {tab_name} not found: {e}")
                continue

        # Click "Load more" if present
        for _ in range(5):
            try:
                load_more = page.get_by_role("button", name="Load more")
                if load_more.count() > 0 and load_more.first.is_visible():
                    load_more.first.click()
                    page.wait_for_timeout(1000)
                else:
                    break
            except Exception:
                break

        text = page.evaluate("() => document.body.innerText")
        skills = extract_skills_from_text(text)
        all_skills_by_category[tab_name] = skills
        print(f"\n=== {tab_name} ({len(skills)} skills) ===")
        for s in skills:
            print(f"  - {s}")

    context.close()
    print("\n\nJSON output:")
    print(json.dumps(all_skills_by_category, indent=2))
