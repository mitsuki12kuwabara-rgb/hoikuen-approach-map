# -*- coding: utf-8 -*-
"""
世田谷区・杉並区 保育園アプローチマップ の data.js を作るスクリプト

元データ
  1) 子どもマップ（child-maps/setagaya.html の FACILITIES）… 施設名・住所・座標・定員・種別
  2) 区の公式一覧（tools/src/*.html）… 電話番号・定員（区のサイトから保存したもの）
       sg_1578〜1582 : 世田谷区 認可保育園(定員数) 世田谷/北沢/玉川/砧/烏山 地域
       su_kuritsu     : 杉並区 区立保育園
       su_shiritsu    : 杉並区 私立保育園 一覧表
  3) seed.json … これまでの進捗（PC内のインタビュー資料から作った初期値）

使い方
  python -I build_data.py            # data.js を作り直す
  python -I build_data.py --fetch    # 区のサイトから一覧ページを取り直してから作る

座標が子どもマップにない施設は、国土地理院の住所検索で座標を求め geocache.json に保存します。
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from difflib import SequenceMatcher

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, "src")
CHILD_MAP = os.path.join(os.path.expanduser("~"), "OneDrive", "デスクトップ", "child-maps", "setagaya.html")
GEOCACHE = os.path.join(HERE, "geocache.json")
SEED = os.path.join(HERE, "seed.json")
OUT = os.path.join(ROOT, "data.js")

PAGES = {
    "sg_1578": ("https://www.city.setagaya.lg.jp/02243/1578.html", "世田谷区", "世田谷"),
    "sg_1579": ("https://www.city.setagaya.lg.jp/02243/1579.html", "世田谷区", "北沢"),
    "sg_1580": ("https://www.city.setagaya.lg.jp/02243/1580.html", "世田谷区", "玉川"),
    "sg_1581": ("https://www.city.setagaya.lg.jp/02243/1581.html", "世田谷区", "砧"),
    "sg_1582": ("https://www.city.setagaya.lg.jp/02243/1582.html", "世田谷区", "烏山"),
    "su_kuritsu": ("https://www.city.suginami.tokyo.jp/shisetsu/kosodate/kuritsu/index.html", "杉並区", ""),
    "su_shiritsu": ("https://www.city.suginami.tokyo.jp/s058/1101.html", "杉並区", ""),
}
TEL = re.compile(r"0\d{1,4}[-‐－ー]\d{2,4}[-‐－ー]\d{3,4}")
Z2H = str.maketrans("０１２３４５６７８９（）－　", "0123456789()- ")


def fetch():
    for k, (u, _, _) in PAGES.items():
        req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (hoikuen-approach-map build)"})
        data = urllib.request.urlopen(req, timeout=30).read()
        with open(os.path.join(SRC, k + ".html"), "wb") as f:
            f.write(data)
        print("取得", k, len(data))
        time.sleep(1)


def cells_of(tr):
    out = []
    for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S):
        c = html.unescape(re.sub(r"<[^>]+>", " ", c))
        out.append(re.sub(r"\s+", " ", c).strip())
    return out


def norm_addr(a):
    a = (a or "").translate(Z2H)
    a = re.sub(r"\s+", "", a)
    a = re.sub(r"^東京都", "", a)
    a = a.replace("ー", "-").replace("‐", "-").replace("－", "-")
    # 1丁目2番3号 / 1-2-3 → 1-2-3
    a = re.sub(r"(\d+)丁目", r"\1-", a)
    a = re.sub(r"(\d+)番地?", r"\1-", a)
    a = re.sub(r"(\d+)号", r"\1", a)
    m = re.match(r"^(.*?区[^\d]*)([\d-]+)", a)
    if m:
        nums = [x for x in m.group(2).split("-") if x]
        return m.group(1) + "-".join(nums[:3])
    return a


def town_of(addr):
    a = re.sub(r"^東京都", "", addr or "")
    a = re.sub(r"^(世田谷区|杉並区)", "", a)
    m = re.match(r"^[^0-9０-９]+", a)
    return m.group(0).strip() if m else ""


def norm_name(n):
    n = (n or "").translate(Z2H)
    n = re.sub(r"\((区立|私立|注\d|本園)\)|（(区立|私立|注\d|本園)）", "", n)
    n = re.sub(r"[\(（][^)）]*(事業|こども園|型)[^)）]*[\)）]", "", n)
    n = re.sub(r"\s+", "", n)
    for w in ("保育園", "保育所", "ほいくえん", "園"):
        n = n.replace(w, "")
    return n.lower()


def kind_of(raw_name, fallback):
    s = raw_name
    if "区立認定こども園" in s:
        return "認定こども園"
    if "認定こども園" in s:
        return "認定こども園"
    if "小規模" in s:
        return "小規模"
    if "家庭的保育" in s:
        return "家庭的保育"
    if "事業所内" in s:
        return "事業所内"
    if "区立" in s:
        return "区立"
    if "私立" in s:
        return "私立"
    return fallback


def clean_name(raw):
    n = raw.translate(Z2H)
    n = re.sub(r"\s*[\(（](区立|私立)[\)）]\s*", "", n)
    n = re.sub(r"\s*[\(（]注\d[\)）]", "", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def load_official():
    rows = []
    for k, (url, ku, region) in PAGES.items():
        p = os.path.join(SRC, k + ".html")
        if not os.path.exists(p):
            continue
        t = open(p, encoding="utf8", errors="ignore").read()
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
            c = cells_of(tr)
            if len(c) < 3 or not TEL.search(c[2]):
                continue
            raw = c[0]
            addr = c[1].translate(Z2H)
            if not addr.startswith(ku):
                addr = ku + addr
            addr = "東京都" + addr
            cap = None
            if k.startswith("sg") and len(c) > 9:
                cap = c[9]
            elif k == "su_shiritsu" and len(c) > 9:
                cap = c[9]
            try:
                cap = int(re.sub(r"[^\d]", "", cap)) if cap else None
            except ValueError:
                cap = None
            name = clean_name(raw)
            if k == "su_shiritsu" and not re.search(r"保育|園|ナーサリー|NURSERY|ほいく|キッズ|プラッツ|ハウス|スクール", name, re.I):
                name = name + "保育園"
            fallback = "区立" if k == "su_kuritsu" else "私立"
            note = ""
            if k == "su_shiritsu" and len(c) > 3:
                note = c[3]
            if k.startswith("sg") and len(c) > 12 and c[12]:
                note = c[12]
            rows.append({
                "name": name, "raw": raw, "addr": addr, "tel": TEL.search(c[2]).group(0).translate(Z2H),
                "ku": ku, "region": region, "kind": kind_of(raw, fallback), "cap": cap,
                "src": url, "note": note,
            })
    return rows


def load_child_map():
    s = open(CHILD_MAP, encoding="utf8").read()
    i = s.index("const FACILITIES = [")
    j = s.index("];", i)
    out = []
    for r in re.findall(r"\{[^{}]*\}", s[i:j]):
        d = {}
        for k, v in re.findall(r'(\w+):("(?:[^"\\]|\\.)*"|[-\d.]+)', r):
            d[k] = json.loads(v) if v.startswith('"') else float(v)
        if d.get("area") == "品川":
            continue
        out.append(d)
    return out


def geocode(addr, cache):
    if addr in cache:
        return cache[addr]
    q = re.sub(r"\s.*$", "", addr)  # 建物名を除く
    url = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + urllib.parse.quote(q)
    try:
        res = json.loads(urllib.request.urlopen(url, timeout=20).read().decode("utf8"))
        if res:
            lng, lat = res[0]["geometry"]["coordinates"]
            cache[addr] = [round(lat, 6), round(lng, 6)]
        else:
            cache[addr] = None
    except Exception as e:  # noqa: BLE001
        print("  住所検索に失敗:", addr, e)
        return None
    time.sleep(0.3)
    return cache[addr]


def main():
    if "--fetch" in sys.argv:
        fetch()
    official = load_official()
    child = load_child_map()
    cache = json.load(open(GEOCACHE, encoding="utf8")) if os.path.exists(GEOCACHE) else {}
    seed = json.load(open(SEED, encoding="utf8")) if os.path.exists(SEED) else {}

    by_addr = {}
    for c in child:
        by_addr.setdefault(norm_addr(c["a"]), []).append(c)
    used = set()
    facilities = []

    def best_child(o):
        cands = [c for c in by_addr.get(norm_addr(o["addr"]), []) if id(c) not in used]
        if not cands:
            nn = norm_name(o["name"])
            cands = [c for c in child if id(c) not in used and norm_name(c["n"]) == nn and c["a"][:6] == o["addr"][:6]]
        if not cands:
            return None
        return max(cands, key=lambda c: SequenceMatcher(None, norm_name(c["n"]), norm_name(o["name"])).ratio())

    geocoded = 0
    for o in official:
        c = best_child(o)
        f = {"name": o["name"], "addr": o["addr"], "tel": o["tel"], "ku": o["ku"], "kind": o["kind"],
             "cap": o["cap"], "src": o["src"], "note": o["note"], "region": o["region"]}
        if c:
            used.add(id(c))
            f["lat"], f["lng"] = c["lat"], c["lng"]
            if not f["cap"] and c.get("c"):
                f["cap"] = int(c["c"])
            if c.get("t") == "小規模" and f["kind"] == "私立":
                f["kind"] = "小規模"
            f["from"] = "子どもマップ"
        else:
            ll = geocode(o["addr"], cache)
            geocoded += 1
            if not ll:
                print("  座標なし（地図に出ません）:", o["name"], o["addr"])
                continue
            f["lat"], f["lng"] = ll
            f["from"] = "区の一覧（住所から座標）"
        facilities.append(f)

    # 子どもマップにだけある施設（幼稚園など）も載せる（電話は手入力）
    region_map = {"世田谷": "世田谷", "北沢": "北沢", "玉川": "玉川", "砧": "砧", "烏山": "烏山"}
    extra = 0
    for c in child:
        if id(c) in used:
            continue
        ku = "杉並区" if c.get("area") == "杉並" else "世田谷区"
        facilities.append({
            "name": c["n"], "addr": c["a"], "tel": "", "ku": ku, "kind": c.get("t", ""),
            "cap": int(c["c"]) if c.get("c") else None, "src": "",
            "note": "区の最新一覧に見当たりません（閉園・名称変更の可能性。電話番号は要確認）",
            "region": region_map.get(c.get("area"), ""), "lat": c["lat"], "lng": c["lng"], "from": "子どもマップ",
        })
        extra += 1

    # 番号・地域・町名・同じ場所のずらし
    facilities.sort(key=lambda f: (f["ku"], f["region"], f["addr"]))
    seen_ll = {}
    for i, f in enumerate(facilities, 1):
        f["id"] = ("S" if f["ku"] == "世田谷区" else "G") + "%03d" % i
        f["town"] = town_of(f["addr"])
        key = (round(f["lat"], 5), round(f["lng"], 5))
        n = seen_ll.get(key, 0)
        seen_ll[key] = n + 1
        if n:
            f["lat"] = round(f["lat"] + 0.00012 * n, 6)
            f["lng"] = round(f["lng"] + 0.00012 * n, 6)

    # これまでの進捗（seed）を名前で当てる
    hit = 0
    for f in facilities:
        for key, s in seed.items():
            if key.startswith("_"):
                continue
            if norm_name(key) == norm_name(f["name"]) and (not s.get("ku") or s["ku"] == f["ku"]):
                f["seed"] = {k: v for k, v in s.items() if k != "ku"}
                hit += 1
    missing = [k for k in seed if not k.startswith("_") and not any(norm_name(k) == norm_name(f["name"]) for f in facilities)]

    json.dump(cache, open(GEOCACHE, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    meta = {
        "generated": date.today().isoformat(),
        "total": len(facilities),
        "setagaya": sum(1 for f in facilities if f["ku"] == "世田谷区"),
        "suginami": sum(1 for f in facilities if f["ku"] == "杉並区"),
        "with_tel": sum(1 for f in facilities if f["tel"]),
        "sources": {k: v[0] for k, v in PAGES.items()},
    }
    with open(OUT, "w", encoding="utf8", newline="\n") as fp:
        fp.write("// 自動生成ファイル。手で編集せず tools/build_data.py を再実行してください。\n")
        fp.write("window.HOIKU_DATA = ")
        json.dump({"meta": meta, "facilities": facilities}, fp, ensure_ascii=False, separators=(",", ":"))
        fp.write(";\n")
    print(f"施設 {meta['total']}件（世田谷 {meta['setagaya']} / 杉並 {meta['suginami']}）電話あり {meta['with_tel']}件")
    print(f"区の一覧 {len(official)}件、うち住所から座標 {geocoded}件 / 子どもマップのみ {extra}件 / 進捗の初期値 {hit}件")
    if missing:
        print("進捗の初期値で見つからない施設:", missing)


if __name__ == "__main__":
    main()
