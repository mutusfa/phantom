#!/usr/bin/env python3
"""LinkedIn DM reader via unofficial linkedin-api library."""

import sys
import json
import os
from linkedin_api import Linkedin

def get_client():
    email = os.environ.get("LINKEDIN_EMAIL")
    password = os.environ.get("LINKEDIN_PASSWORD")
    if not email or not password:
        raise ValueError("LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set")
    return Linkedin(email, password)

def get_conversations(limit: int = 20) -> list[dict]:
    client = get_client()
    convos = client.get_conversations()
    results = []
    for c in (convos.get("elements") or [])[:limit]:
        participants = []
        for p in (c.get("participants") or {}).get("elements") or []:
            profile = p.get("com.linkedin.voyager.messaging.MessagingMember", {})
            mini = profile.get("miniProfile", {})
            name = f"{mini.get('firstName', '')} {mini.get('lastName', '')}".strip()
            participants.append(name)
        last_msg = c.get("events", [{}])
        last_text = ""
        if last_msg:
            body = last_msg[0].get("eventContent", {})
            last_text = body.get("com.linkedin.voyager.messaging.event.MessageEvent", {}).get("attributedBody", {}).get("text", "")
        results.append({
            "conversation_id": c.get("entityUrn", "").split(":")[-1],
            "participants": participants,
            "last_message": last_text[:200],
            "unread": c.get("read") == False,
        })
    return results

def get_messages(conversation_id: str, limit: int = 20) -> list[dict]:
    client = get_client()
    msgs = client.get_conversation(conversation_id)
    results = []
    for e in (msgs.get("elements") or [])[:limit]:
        sender_profile = e.get("from", {}).get("com.linkedin.voyager.messaging.MessagingMember", {}).get("miniProfile", {})
        sender = f"{sender_profile.get('firstName', '')} {sender_profile.get('lastName', '')}".strip()
        body = e.get("eventContent", {})
        text = body.get("com.linkedin.voyager.messaging.event.MessageEvent", {}).get("attributedBody", {}).get("text", "")
        created = e.get("createdAt", 0)
        results.append({
            "sender": sender,
            "text": text,
            "created_at": created,
        })
    return results

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "conversations"
    if cmd == "conversations":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        print(json.dumps(get_conversations(limit), indent=2))
    elif cmd == "messages":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "usage: linkedin_dms.py messages <conversation_id> [limit]"}))
            sys.exit(1)
        conv_id = sys.argv[2]
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 20
        print(json.dumps(get_messages(conv_id, limit), indent=2))
    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}))
        sys.exit(1)
