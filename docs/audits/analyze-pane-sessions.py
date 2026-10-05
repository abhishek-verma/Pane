"""Read-only local session census. Prints metrics and IDs, never transcript text.

Usage: python3 docs/audits/analyze-pane-sessions.py [--root ~/.browseros]
Classification is heuristic; ACP projections are excluded from native metrics.
Run against the same database snapshot to reproduce a historical census exactly.
"""

import argparse
import collections
import datetime
import json
import pathlib
import sqlite3
import statistics


def category(query):
    if query.startswith(("## Role", "Continue Personalised Internet", "Every day at")):
        return "background"
    if query.lower().startswith((
        "test", "codex provider diagnostic", "startup diagnostic",
        "use pane memory_add", "what temporary pane",
    )):
        return "diagnostic"
    return "interactive_candidate"


def acp_projection(tool):
    return (
        tool.get("providerExecuted") or tool.get("toolName")
        or tool["type"].startswith("tool-mcp__")
        or tool["type"] in ("tool-Terminal", "tool-ToolSearch")
    )


def collect(root):
    sessions = []
    for path in sorted(root.glob("profiles/*/db/browseros.sqlite")):
        with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
            db.row_factory = sqlite3.Row
            db.execute("BEGIN")
            for row in db.execute("SELECT * FROM chat_sessions"):
                session = dict(row)
                tools, user_text = {}, []
                raw_count = 0
                for message in db.execute(
                    "SELECT role, content FROM chat_messages WHERE session_id=? ORDER BY created_at",
                    (session["id"],),
                ):
                    content = json.loads(message["content"])
                    parts = content.get("parts", []) if isinstance(content, dict) else content
                    if not isinstance(parts, list):
                        continue
                    for part in parts:
                        kind = part.get("type", "")
                        if message["role"] == "user" and kind == "text":
                            user_text.append(part.get("text", ""))
                        if kind.startswith("tool-") or kind == "dynamic-tool":
                            raw_count += 1
                            tools[part.get("toolCallId", f"missing-{raw_count}")] = part
                session.update(
                    tools=list(tools.values()), raw_count=raw_count,
                    category=category(" ".join(user_text)),
                    turns=[dict(turn) for turn in db.execute(
                        "SELECT * FROM chat_turns WHERE session_id=?", (session["id"],)
                    )],
                )
                sessions.append(session)
    return sessions


def summarize(sessions, size):
    recent = sorted(
        (s for s in sessions if s["category"] == "interactive_candidate"),
        key=lambda s: s["created_at"], reverse=True,
    )[:size]
    native = [s for s in recent if not any(acp_projection(t) for t in s["tools"])]
    durations = sorted(
        (t["ended_at"] - t["started_at"]) / 1000
        for s in native for t in s["turns"]
        if t["status"] == "done" and t["ended_at"] is not None
    )
    counts = collections.Counter()
    affected = collections.defaultdict(set)
    for s in native:
        repeats = collections.Counter(
            (t["type"], json.dumps(t.get("input"), sort_keys=True)) for t in s["tools"]
        )
        extra = sum(n - 1 for n in repeats.values())
        counts["exact_repeat_candidates"] += extra
        if extra:
            affected["exact_repeat_candidates"].add(s["id"])
        for tool in s["tools"]:
            output = tool.get("output")
            flags = {
                "error_marked": tool.get("state") == "output-error"
                or isinstance(output, dict) and output.get("isError") is True,
                "context_search": tool["type"] == "tool-context_search",
                "memory_budget_rejection": "Memory add would exceed" in json.dumps(output),
                "relative_path_rejection": "Path must be relative" in json.dumps(output),
                "guard_marker": "chars for context]" in json.dumps(output),
            }
            for key, present in flags.items():
                if present:
                    counts[key] += 1
                    affected[key].add(s["id"])
    return {
        "sessions": len(sessions),
        "categories": dict(collections.Counter(s["category"] for s in sessions)),
        "raw_tool_parts": sum(s["raw_count"] for s in sessions),
        "deduplicated_tool_parts": sum(len(s["tools"]) for s in sessions),
        "recent_candidates": len(recent),
        "native_sessions": len(native),
        "native_tool_calls": sum(len(s["tools"]) for s in native),
        "native_run_records": sum(len(s["turns"]) for s in native),
        "done_run_records": len(durations),
        "done_elapsed_seconds_median": statistics.median(durations) if durations else None,
        "done_elapsed_seconds_p90": durations[int((len(durations) - 1) * .9)] if durations else None,
        "signals": {k: {"calls": v, "sessions": len(affected[k])} for k, v in counts.items()},
        "sample": [{
            "id": s["id"],
            "created_utc": datetime.datetime.fromtimestamp(
                s["created_at"] / 1000, datetime.timezone.utc
            ).isoformat(),
            "tool_calls": len(s["tools"]),
            "run_records": len(s["turns"]),
            "acp_projection": any(acp_projection(t) for t in s["tools"]),
        } for s in recent],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path.home() / ".browseros")
    parser.add_argument("--sample", type=int, default=80)
    args = parser.parse_args()
    if args.sample < 1:
        parser.error("--sample must be positive")
    print(json.dumps(summarize(collect(args.root.expanduser().resolve()), args.sample), indent=2))
