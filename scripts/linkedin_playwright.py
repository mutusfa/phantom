#!/usr/bin/env python3
"""
LinkedIn DM reader via Playwright browser automation.

Maintains a persistent browser session in ~/.linkedin_session/.
On first run (or when session expires), logs in with stored credentials.
Subsequent runs reuse the saved session without re-logging in.

Usage:
  python3 linkedin_playwright.py conversations [limit]
  python3 linkedin_playwright.py messages <backend_urn> [limit]
  python3 linkedin_playwright.py links <backend_urn>     # extract external URLs from thread
  python3 linkedin_playwright.py login                   # force a fresh login
"""

import sys
import json
import os
import time
import urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

SESSION_DIR = Path.home() / ".linkedin_session"
SESSION_FILE = SESSION_DIR / "context.json"
LINKEDIN_BASE = "https://www.linkedin.com"

# GraphQL queryIds - these are stable hashes of the query name.
# If LinkedIn rotates them, update by loading /messaging/ and capturing the request URLs.
QUERY_CONVERSATIONS = "messengerConversations.0d5e6781bbee71c3e51c8843c6519f48"
QUERY_MESSAGES = "messengerMessages.5846eeb71c981f11e0134cb6626cc314"


def get_credentials() -> tuple[str, str]:
    email = os.environ.get("LINKEDIN_EMAIL", "")
    password = os.environ.get("LINKEDIN_PASSWORD", "")
    if not email or not password:
        raise ValueError("LINKEDIN_EMAIL and LINKEDIN_PASSWORD env vars required for login")
    return email, password


def is_logged_in(page) -> bool:
    try:
        page.goto(f"{LINKEDIN_BASE}/feed", wait_until="domcontentloaded", timeout=20000)
        return "/login" not in page.url and "/checkpoint" not in page.url
    except PlaywrightTimeoutError:
        return False


def do_login(page, email: str, password: str) -> bool:
    page.goto(f"{LINKEDIN_BASE}/login", wait_until="domcontentloaded", timeout=20000)
    page.fill("#username", email)
    page.fill("#password", password)
    page.click('[type="submit"]')
    try:
        page.wait_for_url(
            lambda url: "/login" not in url and "/checkpoint" not in url,
            timeout=15000,
        )
        return True
    except PlaywrightTimeoutError:
        if "/checkpoint" in page.url:
            raise RuntimeError(
                "LinkedIn requires verification (CAPTCHA/2FA). "
                "Complete verification in a real browser first, then run 'login' again."
            )
        return False


def save_session(context) -> None:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    SESSION_FILE.write_text(json.dumps(context.storage_state()))


def voyager_fetch(page, path: str) -> dict:
    """Make an authenticated Voyager API call from within the browser context."""
    result = page.evaluate(f"""async () => {{
        const csrf = document.cookie.match(/JSESSIONID="?([^";]+)/)?.[1] || '';
        const res = await fetch({json.dumps(path)}, {{
            headers: {{
                'accept': 'application/vnd.linkedin.normalized+json+2.1',
                'x-li-lang': 'en_US',
                'x-restli-protocol-version': '2.0.0',
                'csrf-token': csrf,
            }},
            credentials: 'include',
        }});
        return {{ status: res.status, body: await res.text() }};
    }}""")
    if result["status"] != 200:
        raise RuntimeError(f"API {path} returned {result['status']}: {result['body'][:200]}")
    return json.loads(result["body"])


def get_profile_urn(page) -> str:
    data = voyager_fetch(page, "/voyager/api/me")
    # LinkedIn normalized format: miniProfile is in `included`, not top-level
    for item in data.get("included", []):
        urn = item.get("dashEntityUrn", "")
        if urn.startswith("urn:li:fsd_profile:"):
            return urn
    raise RuntimeError(f"Could not determine profile URN from /me response")


def parse_conversations(data: dict, limit: int, days: int = 30) -> list[dict]:
    included = data.get("included", [])
    cutoff_ms = (time.time() - days * 86400) * 1000 if days > 0 else 0

    # Build participant lookup: entityUrn -> display name
    participants_by_urn: dict[str, str] = {}
    for item in included:
        if item.get("$type") != "com.linkedin.messenger.MessagingParticipant":
            continue
        member = (item.get("participantType") or {}).get("member") or {}
        first = (member.get("firstName") or {}).get("text", "")
        last = (member.get("lastName") or {}).get("text", "")
        name = f"{first} {last}".strip()
        urn = item.get("entityUrn", "")
        if urn and name:
            participants_by_urn[urn] = name

    # Build last-message lookup: conversation backendUrn -> message body
    messages_by_convo: dict[str, str] = {}
    for item in included:
        if item.get("$type") != "com.linkedin.messenger.Message":
            continue
        convo_urn = item.get("*conversation", "")
        if convo_urn and convo_urn not in messages_by_convo:
            body_text = (item.get("body") or {}).get("text", "") or ""
            if not body_text:
                # Inline format
                body_text = (item.get("body") or {}).get("attributes", [{}])[0] if item.get("body") else ""
            messages_by_convo[convo_urn] = str(body_text)[:200] if body_text else ""

    conversations = []
    for item in included:
        if item.get("$type") != "com.linkedin.messenger.Conversation":
            continue
        participant_urns = item.get("*conversationParticipants") or []
        names = [participants_by_urn[u] for u in participant_urns if u in participants_by_urn]
        backend_urn = item.get("backendUrn", "")
        entity_urn = item.get("entityUrn", "")
        last_activity = item.get("lastActivityAt", 0)
        if cutoff_ms and last_activity < cutoff_ms:
            continue
        conversations.append({
            "backend_urn": backend_urn,
            "entity_urn": entity_urn,
            "participants": names,
            "unread_count": item.get("unreadCount", 0),
            "last_activity_at": last_activity,
            "last_message_preview": messages_by_convo.get(entity_urn, ""),
            "categories": item.get("categories", []),
        })
        if len(conversations) >= limit:
            break

    return conversations


def get_conversations(page, profile_urn: str, limit: int = 20, days: int = 30) -> list[dict]:
    encoded_urn = urllib.parse.quote(profile_urn, safe="")
    path = (
        f"/voyager/api/voyagerMessagingGraphQL/graphql"
        f"?queryId={QUERY_CONVERSATIONS}"
        f"&variables=(mailboxUrn:{encoded_urn},count:{limit},withPinnedConversation:true)"
    )
    data = voyager_fetch(page, path)
    return parse_conversations(data, limit, days)


def get_messages(page, backend_urn: str, limit: int = 20) -> list[dict]:
    """Fetch messages by navigating to the thread and scraping the DOM."""
    thread_id = backend_urn.split(":")[-1]
    page.goto(
        f"https://www.linkedin.com/messaging/thread/{thread_id}/",
        wait_until="domcontentloaded",
        timeout=30000,
    )
    time.sleep(6)

    raw_text = page.evaluate("""() => {
        const list = document.querySelector(".msg-s-message-list");
        return list ? list.innerText : null;
    }""")

    if not raw_text:
        return [{"error": "Could not find message list - session may have expired"}]

    return [{"text": raw_text, "format": "raw_dom_text"}]


def get_links(page, backend_urn: str) -> list[dict]:
    """Extract external URLs from a thread (excludes linkedin.com profile links)."""
    thread_id = backend_urn.split(":")[-1]
    page.goto(
        f"https://www.linkedin.com/messaging/thread/{thread_id}/",
        wait_until="domcontentloaded",
        timeout=30000,
    )
    time.sleep(6)

    links = page.evaluate("""() => {
        const list = document.querySelector(".msg-s-message-list");
        if (!list) return [];
        return Array.from(list.querySelectorAll("a[href]"))
            .map(a => ({ text: a.innerText.trim(), href: a.href }))
            .filter(l => l.href && !l.href.includes("linkedin.com/in/"));
    }""")

    return links


def send_message(page, backend_urn: str, message: str) -> dict:
    """Send a message to an existing conversation thread."""
    thread_id = backend_urn.split(":")[-1]
    page.goto(
        f"https://www.linkedin.com/messaging/thread/{thread_id}/",
        wait_until="domcontentloaded",
        timeout=30000,
    )
    time.sleep(5)

    editor = page.locator(".msg-form__contenteditable").first
    editor.wait_for(timeout=10000)
    editor.click()
    time.sleep(0.5)

    lines = message.split("\n")
    page.evaluate(
        """(lines) => {
        const el = document.querySelector('.msg-form__contenteditable');
        el.focus();
        for (let i = 0; i < lines.length; i++) {
            if (i > 0) document.execCommand('insertLineBreak');
            if (lines[i]) document.execCommand('insertText', false, lines[i]);
        }
    }""",
        lines,
    )
    time.sleep(1)

    send_btn = page.locator(".msg-form__send-button")
    send_btn.click()
    time.sleep(3)

    last = page.evaluate("""() => {
        const msgs = document.querySelectorAll(".msg-s-event-listitem");
        const last = msgs[msgs.length - 1];
        return last ? last.innerText.slice(0, 200) : null;
    }""")

    if last and message[:30].replace("\n", "") in last.replace("\n", ""):
        return {"ok": True, "sent_preview": last[:150]}
    return {"ok": False, "error": "Message may not have sent - verify manually", "last_visible": last}


def make_browser_context(p, with_session: bool):
    browser = p.chromium.launch(
        headless=True,
        args=["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
    )
    kwargs = {
        "viewport": {"width": 1280, "height": 800},
        "user_agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "extra_http_headers": {"Accept-Language": "en-US,en;q=0.9"},
    }
    if with_session and SESSION_FILE.exists():
        kwargs["storage_state"] = str(SESSION_FILE)
    context = browser.new_context(**kwargs)
    context.add_init_script("Object.defineProperty(navigator, 'webdriver', { get: () => undefined })")
    return browser, context


def run_with_session(command: str, args: list[str]) -> dict:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    force_login = command == "login"

    with sync_playwright() as p:
        browser, context = make_browser_context(p, with_session=not force_login)
        page = context.new_page()

        try:
            logged_in = is_logged_in(page) if not force_login else False
            if not logged_in:
                email, password = get_credentials()
                ok = do_login(page, email, password)
                if not ok:
                    return {"error": "Login failed - check credentials"}
                save_session(context)

            # Load messaging page to establish full session context
            page.goto(f"{LINKEDIN_BASE}/messaging/", wait_until="domcontentloaded", timeout=30000)
            time.sleep(4)

            if command == "login":
                save_session(context)
                return {"ok": True, "message": "Logged in and session saved"}

            profile_urn = get_profile_urn(page)

            if command == "conversations":
                limit = int(args[0]) if args else 20
                days = int(args[1]) if len(args) > 1 else 30
                result = get_conversations(page, profile_urn, limit, days)
                save_session(context)
                return {"conversations": result, "profile_urn": profile_urn}

            elif command == "messages":
                if not args:
                    return {"error": "backend_urn required (from conversations output)"}
                backend_urn = args[0]
                limit = int(args[1]) if len(args) > 1 else 20
                result = get_messages(page, backend_urn, limit)
                save_session(context)
                return {"messages": result}

            elif command == "links":
                if not args:
                    return {"error": "backend_urn required"}
                backend_urn = args[0]
                result = get_links(page, backend_urn)
                save_session(context)
                return {"links": result}

            elif command == "send":
                if len(args) < 2:
                    return {"error": "usage: send <backend_urn> <message>"}
                backend_urn = args[0]
                message = args[1]
                result = send_message(page, backend_urn, message)
                save_session(context)
                return result

            else:
                return {"error": f"unknown command: {command}"}

        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "conversations"
    rest = sys.argv[2:]
    output = run_with_session(cmd, rest)
    print(json.dumps(output, indent=2))
