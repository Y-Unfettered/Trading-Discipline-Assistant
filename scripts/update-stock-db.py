import csv
import io
import json
import re
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "a-share-stocks.json"
SYMBOL_SOURCE = (
    "https://huggingface.co/datasets/kjhq/"
    "China-Stock-Symbols-and-Metadata/resolve/main/china.csv"
)
QUOTE_SOURCE = "http://qt.gtimg.cn/q="


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


def load_codes():
    rows = csv.DictReader(io.StringIO(download(SYMBOL_SOURCE)))
    codes = set()
    for row in rows:
        code = str(row.get("ticker") or "").zfill(6)
        if re.fullmatch(r"(0|3|6)\d{5}", code):
            codes.add(code)
    return sorted(codes)


def quote_symbol(code):
    return ("sh" if code.startswith("6") else "sz") + code


def main():
    codes = load_codes()
    stocks = {}
    batch_size = 50

    for offset in range(0, len(codes), batch_size):
        batch = codes[offset:offset + batch_size]
        payload = download(QUOTE_SOURCE + ",".join(map(quote_symbol, batch)), "gb18030")
        for line in payload.splitlines():
            match = re.search(r'v_(?:sh|sz)(\d{6})="[^~]*~([^~]+)~', line)
            if not match:
                continue
            code, name = match.groups()
            name = name.strip()
            if not name:
                continue
            stocks[code] = {
                "code": code,
                "name": name,
                "market": "SH" if code.startswith("6") else "SZ",
            }
        time.sleep(0.08)

    OUTPUT.write_text(
        json.dumps(sorted(stocks.values(), key=lambda item: item["code"]), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"saved={len(stocks)} file={OUTPUT}")
    for stock in stocks.values():
        if "华天" in stock["name"]:
            print(stock)


if __name__ == "__main__":
    main()
