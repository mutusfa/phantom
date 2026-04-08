#!/usr/bin/env python3
"""Scrape the currently logged-in LinkedIn user's own profile for skills/technologies."""

import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

SESSION_DIR = Path.home() / ".linkedin_session"
SESSION_FILE = SESSION_DIR / "context.json"
LINKEDIN_BASE = "https://www.linkedin.com"


def get_own_profile_url(page) -> str:
    """Get the profile URL of the currently logged-in user."""
    page.goto(f"{LINKEDIN_BASE}/feed", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(2000)

    # Try to find self-profile link in the nav (left sidebar)
    selectors = [
        'a[href*="/in/"][data-control-name="identity_profile_photo"]',
        'a.ember-view[href*="/in/"]',
        '.nav__secondary-items a[href*="/in/"]',
        'a[data-test-app-aware-link][href*="/in/"]',
    ]
    for sel in selectors:
        try:
            el = page.query_selector(sel)
            if el:
                href = el.get_attribute("href") or ""
                if "/in/" in href:
                    return LINKEDIN_BASE + href if href.startswith("/") else href
        except Exception:
            pass

    # Navigate to /me and follow the redirect
    page.goto(f"{LINKEDIN_BASE}/in/me", wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(2000)
    url = page.url
    if "/in/" in url:
        return url

    # Last resort: check mini-profile API via page evaluation
    try:
        slug = page.evaluate("""() => {
            const links = document.querySelectorAll('a[href*="/in/"]');
            for (const l of links) {
                const m = l.href.match(/\\/in\\/([^/?#]+)/);
                if (m) return m[1];
            }
            return null;
        }""")
        if slug:
            return f"{LINKEDIN_BASE}/in/{slug}/"
    except Exception:
        pass

    return url


def scrape_profile(page, profile_url: str) -> dict:
    """Scrape skills and technologies from a LinkedIn profile."""
    # Normalize URL - ensure it ends cleanly
    if "?" in profile_url:
        profile_url = profile_url.split("?")[0]
    if not profile_url.endswith("/"):
        profile_url += "/"

    print(f"Navigating to profile: {profile_url}", file=sys.stderr)
    page.goto(profile_url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2000)

    result = {
        "profile_url": profile_url,
        "name": "",
        "headline": "",
        "about": "",
        "skills": [],
        "experience": [],
        "education": [],
    }

    # Name
    try:
        name_el = page.query_selector("h1.text-heading-xlarge")
        if name_el:
            result["name"] = name_el.inner_text().strip()
    except Exception:
        pass

    # Headline
    try:
        headline_el = page.query_selector(".text-body-medium.break-words")
        if headline_el:
            result["headline"] = headline_el.inner_text().strip()
    except Exception:
        pass

    # About section
    try:
        about_el = page.query_selector("#about ~ * .full-width")
        if not about_el:
            about_el = page.query_selector("section:has(#about) .display-flex.ph5 span[aria-hidden='true']")
        if about_el:
            result["about"] = about_el.inner_text().strip()[:500]
    except Exception:
        pass

    # Experience section - company names and titles
    try:
        exp_items = page.query_selector_all("section:has(#experience) li.artdeco-list__item")
        for item in exp_items[:10]:
            text = item.inner_text().strip()
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            if lines:
                result["experience"].append(lines[:3])  # title, company, duration
    except Exception:
        pass

    # Skills section - navigate to skills tab
    try:
        skills_url = profile_url.rstrip("/") + "/details/skills/"
        print(f"Loading skills page: {skills_url}", file=sys.stderr)
        page.goto(skills_url, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(2000)

        # Scroll to load all skills
        for _ in range(3):
            page.keyboard.press("End")
            page.wait_for_timeout(500)

        skill_items = page.query_selector_all(".pvs-list__item--line-separated")
        for item in skill_items:
            try:
                skill_name_el = item.query_selector("span[aria-hidden='true']")
                if skill_name_el:
                    name = skill_name_el.inner_text().strip()
                    if name and len(name) < 80:
                        result["skills"].append(name)
            except Exception:
                pass

        # Deduplicate while preserving order
        seen = set()
        deduped = []
        for s in result["skills"]:
            if s not in seen:
                seen.add(s)
                deduped.append(s)
        result["skills"] = deduped

    except Exception as e:
        print(f"Skills scrape error: {e}", file=sys.stderr)

    return result


def main():
    profile_url = sys.argv[1] if len(sys.argv) > 1 else None

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()

        if SESSION_FILE.exists():
            state = json.loads(SESSION_FILE.read_text())
            context = p.chromium.launch(headless=True).new_context(storage_state=state)

        page = context.new_page()

        if not profile_url:
            profile_url = get_own_profile_url(page)
            print(f"Detected profile URL: {profile_url}", file=sys.stderr)

        data = scrape_profile(page, profile_url)
        print(json.dumps(data, ensure_ascii=False, indent=2))

        context.close()


if __name__ == "__main__":
    main()
