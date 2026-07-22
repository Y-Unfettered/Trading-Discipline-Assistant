import csv
import io
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "a-share-stocks.json"
SYMBOL_SOURCE = (
    "https://huggingface.co/datasets/kjhq/"
    "China-Stock-Symbols-and-Metadata/resolve/main/china.csv"
)
QUOTE_SOURCE = "https://qt.gtimg.cn/q="
EASTMONEY_SOURCE = "https://push2.eastmoney.com/api/qt/clist/get"
EASTMONEY_FILTER = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048"


def download(url, encoding="utf-8"):
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/"},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read().decode(encoding, errors="replace")
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1 + attempt)


def market_for_code(code):
    if code.startswith(("4", "8", "9")):
        return "BJ"
    return "SH" if code.startswith("6") else "SZ"


def load_legacy_codes():
    rows = csv.DictReader(io.StringIO(download(SYMBOL_SOURCE)))
    codes = set()
    for row in rows:
        code = str(row.get("ticker") or "").zfill(6)
        if re.fullmatch(r"(0|3|4|6|8|9)\d{5}", code):
            codes.add(code)
    return sorted(codes)


def quote_symbol(code):
    market = market_for_code(code)
    return {"SH": "sh", "SZ": "sz", "BJ": "bj"}[market] + code


def load_eastmoney_catalog():
    page_size = 100
    page = 1
    total = None
    stocks = {}
    while total is None or (page - 1) * page_size < total:
        params = urllib.parse.urlencode({
            "pn": page,
            "pz": page_size,
            "po": 1,
            "np": 1,
            "fltt": 2,
            "invt": 2,
            "fid": "f12",
            "fields": "f12,f13,f14",
            "fs": EASTMONEY_FILTER,
        })
        payload = json.loads(download(f"{EASTMONEY_SOURCE}?{params}"))
        data = payload.get("data") or {}
        total = int(data.get("total") or 0)
        rows = data.get("diff") or []
        if isinstance(rows, dict):
            rows = rows.values()
        rows = list(rows)
        for row in rows:
            code = str(row.get("f12") or "").zfill(6)
            name = str(row.get("f14") or "").strip()
            if re.fullmatch(r"(0|3|4|6|8|9)\d{5}", code) and name and name != "-":
                stocks[code] = {"code": code, "name": name, "market": market_for_code(code)}
        if not rows:
            break
        page += 1
    if len(stocks) < 5000:
        raise RuntimeError(f"东方财富证券目录数量异常：{len(stocks)}")
    return stocks


def load_legacy_catalog():
    codes = load_legacy_codes()
    stocks = {}
    batch_size = 50
    for offset in range(0, len(codes), batch_size):
        batch = codes[offset:offset + batch_size]
        payload = download(QUOTE_SOURCE + ",".join(map(quote_symbol, batch)), "gb18030")
        for line in payload.splitlines():
            match = re.search(r'v_(?:sh|sz|bj)(\d{6})="[^~]*~([^~]+)~', line)
            if not match:
                continue
            code, name = match.groups()
            name = name.strip()
            if name:
                stocks[code] = {"code": code, "name": name, "market": market_for_code(code)}
        time.sleep(0.08)
    return stocks


def main():
    try:
        stocks = load_eastmoney_catalog()
        source = "eastmoney"
    except Exception as error:
        print(f"warning=eastmoney_failed detail={error}")
        stocks = {}
        if OUTPUT.exists():
            try:
                existing = json.loads(OUTPUT.read_text(encoding="utf-8-sig"))
                stocks.update({str(item["code"]): item for item in existing if item.get("code") and item.get("name")})
            except Exception:
                pass
        stocks.update(load_legacy_catalog())
        source = "legacy+tencent"

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(sorted(stocks.values(), key=lambda item: item["code"]), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(OUTPUT)
    print(f"saved={len(stocks)} source={source} file={OUTPUT}")


if __name__ == "__main__":
    main()
