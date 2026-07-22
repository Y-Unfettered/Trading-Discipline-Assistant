#!/usr/bin/env python3
"""Dependency-free client for the local Trade Discipline Assistant API."""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path


DEFAULT_URL = os.environ.get("TRADE_ASSISTANT_URL", "http://127.0.0.1:3768").rstrip("/")


def request(base_url, method, route, body=None, timeout=30):
    url = f"{base_url}{route}"
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Accept": "application/json", "Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(payload).get("error", payload)
        except json.JSONDecodeError:
            message = payload
        raise RuntimeError(f"HTTP {error.code}: {message}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"无法连接交易纪律助手：{error.reason}") from error


def load_packet(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def dump(value, output=None):
    text = json.dumps(value, ensure_ascii=False, indent=2)
    if output:
        Path(output).write_text(text + "\n", encoding="utf-8")
        print(str(Path(output).resolve()))
    else:
        print(text)


def status(base_url):
    dashboard = request(base_url, "GET", "/api/dashboard")
    catalog = request(base_url, "GET", "/api/stocks/status")
    now = datetime.now(timezone(timedelta(hours=8))).isoformat()
    return {
        "nowAsiaShanghai": now,
        "account": dashboard.get("account"),
        "dataHealth": dashboard.get("health"),
        "discipline": dashboard.get("discipline"),
        "dailyWorkflow": dashboard.get("dailyWorkflow"),
        "plan": dashboard.get("plan"),
        "nextTradingDate": dashboard.get("nextTradingDate"),
        "latestMarketClose": dashboard.get("latestMarketClose"),
        "stockCatalog": catalog,
    }


def import_packet(base_url, kind, path, confirmed):
    packet = load_packet(path)
    routes = {
        "research": ("/api/research-import/preview", "/api/research-import/commit"),
        "plan-ai": ("/api/plan-ai-import/preview", "/api/plan-ai-import/commit"),
        "analysis": ("/api/analysis/import/preview", "/api/analysis/import"),
    }
    preview, commit = routes[kind]
    route = commit if confirmed else preview
    body = {"packet": packet}
    if confirmed:
        body["confirmed"] = True
    return request(base_url, "POST", route, body, timeout=60)


def build_parser():
    parser = argparse.ArgumentParser(description="交易纪律助手通用 AI 代理客户端")
    parser.add_argument("--base-url", default=DEFAULT_URL)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    sub.add_parser("snapshot")
    search = sub.add_parser("stock-search")
    search.add_argument("query")
    sub.add_parser("stock-status")
    refresh = sub.add_parser("stock-refresh")
    refresh.add_argument("--confirm", action="store_true", required=True)
    review = sub.add_parser("review-export")
    review.add_argument("--output")
    plan = sub.add_parser("plan-context")
    plan.add_argument("plan_id")
    prompts = sub.add_parser("research-prompts")
    prompts.add_argument("target", nargs="?", default="")
    for kind in ("research", "plan-ai", "analysis"):
        command = sub.add_parser(kind)
        command.add_argument("file")
        command.add_argument("--confirm", action="store_true")
    return parser


def main():
    args = build_parser().parse_args()
    base = args.base_url.rstrip("/")
    try:
        if args.command == "status":
            result = status(base)
        elif args.command == "snapshot":
            result = request(base, "GET", "/api/store")
        elif args.command == "stock-search":
            query = urllib.parse.quote(args.query)
            result = request(base, "GET", f"/api/stocks/search?q={query}")
        elif args.command == "stock-status":
            result = request(base, "GET", "/api/stocks/status")
        elif args.command == "stock-refresh":
            result = request(base, "POST", "/api/stocks/refresh", {}, timeout=120)
        elif args.command == "review-export":
            result = request(base, "POST", "/api/review/export", {})
            if args.output:
                dump(result["packet"], args.output)
                return
        elif args.command == "plan-context":
            plan_id = urllib.parse.quote(args.plan_id)
            result = request(base, "GET", f"/api/plan-ai-import/context?planId={plan_id}")
        elif args.command == "research-prompts":
            target = urllib.parse.quote(args.target)
            result = request(base, "GET", f"/api/research-import/prompts?target={target}")
        else:
            result = import_packet(base, args.command, args.file, args.confirm)
        dump(result)
    except (RuntimeError, OSError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
