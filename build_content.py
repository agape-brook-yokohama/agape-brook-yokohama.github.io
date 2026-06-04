#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将「牧师的话（网络登载用）」与「灵修笔记（网页登载用）」目录下的 .txt 文稿
解析为网站使用的结构化 JSON 数据。

输出：
  data/devotions-index.json        灵修笔记索引（轻量，供列表/搜索）
  data/devotions/{YYYYMM}.json     灵修笔记正文（按月分桶，点击时按需加载）
  data/pastor-words.json           牧师的话全文（数量少，单文件）
  data/home-latest.json            首页用：两类各取最新 3 篇

用法：在 church-website 目录下运行  python3 build_content.py
"""
import os
import re
import json
import glob

ROOT = os.path.dirname(os.path.abspath(__file__))
DEVOTION_DIR = os.path.join(ROOT, "灵修笔记（网页登载用）")
PASTOR_DIR = os.path.join(ROOT, "牧师的话（网络登载用）")
DATA_DIR = os.path.join(ROOT, "data")

SIGNATURE_RE = re.compile(r"^[\s　]*[馬马]宏[偉伟][\s　]*$")
SEP_RE = re.compile(r"^[\s　]*[-—─=*＝]{3,}[\s　]*$")
HEADER_RE = re.compile(r"^[\s　]*[靈灵]修[筆笔][記记][\s　]*[（(]")
# 日期：文件内题头 (230915) / (20231101) / (20220201Ma)
DATE_IN_HEADER_RE = re.compile(r"[（(]\s*(\d{6,8})")
# 文件名前导日期 0915 / 240117
FNAME_DATE_RE = re.compile(r"^(\d{4,8})")


def read_text(path):
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            with open(path, "r", encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def norm_lines(text):
    """统一换行、去掉行尾空白，返回行列表（保留空行用于分段）。"""
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("　", "　")
    return [ln.rstrip() for ln in text.split("\n")]


def parse_date(digits, fallback_year=None):
    """把 6 或 8 位数字解析为 (year, month, day)。"""
    if len(digits) == 8:
        y, m, d = int(digits[0:4]), int(digits[4:6]), int(digits[6:8])
    elif len(digits) == 6:
        y, m, d = 2000 + int(digits[0:2]), int(digits[2:4]), int(digits[4:6])
    elif len(digits) == 4 and fallback_year:
        y, m, d = fallback_year, int(digits[0:2]), int(digits[2:4])
    else:
        return None
    if not (2015 <= y <= 2035 and 1 <= m <= 12 and 1 <= d <= 31):
        return None
    return (y, m, d)


def year_from_path(path):
    """从路径里找一个 4 位年份。"""
    for part in path.split(os.sep):
        m = re.search(r"(20\d{2})", part)
        if m:
            return int(m.group(1))
    return None


# ---------- 灵修笔记 ----------

def parse_devotion(path):
    raw = read_text(path)
    lines = norm_lines(raw)
    stem = os.path.splitext(os.path.basename(path))[0]

    # 1) 日期：优先文件内题头，其次文件名前导数字 + 路径年份
    dt = None
    header_idx = None
    for i, ln in enumerate(lines[:4]):
        if HEADER_RE.match(ln):
            header_idx = i
            mm = DATE_IN_HEADER_RE.search(ln)
            if mm:
                dt = parse_date(mm.group(1))
            break
    if dt is None:
        fm = FNAME_DATE_RE.match(stem)
        if fm:
            dt = parse_date(fm.group(1), fallback_year=year_from_path(path))
    if dt is None:
        return None  # 无法定位日期，跳过（如外部转载文）

    y, m, d = dt

    # 2) 去掉题头行后的正文行
    body_start = (header_idx + 1) if header_idx is not None else 0
    content = lines[body_start:]
    # 去掉末尾的署名与空行
    while content and (content[-1].strip() == "" or SIGNATURE_RE.match(content[-1])):
        content.pop()

    # 3) 标题：第一段非空、且不是经文/方括号标记的行
    title = ""
    ti = 0
    for i, ln in enumerate(content):
        s = ln.strip()
        if not s:
            continue
        if s.startswith(("经文", "經文", "【", "经", "經")):
            break
        title = s
        ti = i + 1
        break

    # 4) 经文出处：正文「经文」行的【…】优先（最可靠）；
    #    其次文件名前导日期之后的部分——但仅当它含数字、像经节引用时才采用，
    #    否则那是标题而非经文。
    scripture = ""
    for ln in content:
        mm = re.search(r"[经經]文[^【]*【([^】]+)】", ln)
        if mm:
            scripture = mm.group(1).strip()
            break
    if not scripture:
        cand = re.sub(r"^\d+", "", stem).strip()
        cand = re.sub(r"^[\sMa　·\-—、:：]+", "", cand).strip()
        if re.search(r"\d", cand):  # 含数字 => 像经节引用
            scripture = cand
    if not title:
        title = scripture or "灵修笔记"

    # 5) 正文段落（含经文、默想、祷告等，保持原貌）
    paras = build_paragraphs(content[ti:] if title and ti else content)

    iso = f"{y:04d}-{m:02d}-{d:02d}"
    return {
        "id": f"d{y:04d}{m:02d}{d:02d}",
        "date": iso,
        "ym": f"{y:04d}{m:02d}",
        "title": title,
        "scripture": scripture,
        "paras": paras,
    }


# ---------- 牧师的话 ----------

PASTOR_TITLEHEAD_RE = re.compile(r"^[\s　]*[牧师牧師]+的[話话][\s　]*[（(]")
PASTOR_FNAME_DATE_RE = re.compile(r"^(\d{1,2})月(\d{1,2})日|^(\d{4})")
DATE_PAREN_RE = re.compile(r"[（(]\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")


def parse_pastor(path):
    raw = read_text(path)
    lines = norm_lines(raw)
    stem = os.path.splitext(os.path.basename(path))[0]
    year = year_from_path(path) or 2025

    month = day = None
    skip_idx = 0  # 正文起始前需跳过的行数

    # 1) 题头行 牧师的话（M月D日）
    if lines and PASTOR_TITLEHEAD_RE.match(lines[0]):
        mm = DATE_PAREN_RE.search(lines[0])
        if mm:
            month, day = int(mm.group(1)), int(mm.group(2))
        skip_idx = 1

    # 2) 文件名 MMDD / M月D日--题目
    title = ""
    fm = re.match(r"^(\d{1,2})月(\d{1,2})日[-—\s]*(.*)$", stem)
    if fm:
        if month is None:
            month, day = int(fm.group(1)), int(fm.group(2))
        title = fm.group(3).strip()
    else:
        fm2 = re.match(r"^(\d{4})(.*)$", stem)
        if fm2:
            md = fm2.group(1)
            if month is None:
                month, day = int(md[0:2]), int(md[2:4])
            title = fm2.group(2).strip()

    # 标题清理
    title = re.sub(r"^[-—\s　]+", "", title).strip()

    # 3) 正文行
    content = lines[skip_idx:]
    # 跳过紧随其后的标题行（如果与文件名标题相同或本身是短标题且下一行是分隔线）
    # 去掉分隔线
    cleaned = []
    title_from_body = ""
    for i, ln in enumerate(content):
        if SEP_RE.match(ln):
            # 分隔线之前若只有 1 行非空，视为标题
            cleaned = []  # 重置：分隔线前都是题头/标题
            continue
        cleaned.append(ln)

    # 若分隔线存在，cleaned 为分隔线之后的正文；标题取分隔线前最后一行非空
    has_sep = any(SEP_RE.match(ln) for ln in content)
    if has_sep:
        pre = []
        for ln in content:
            if SEP_RE.match(ln):
                break
            pre.append(ln)
        pre_nonblank = [p.strip() for p in pre if p.strip()]
        if pre_nonblank:
            title_from_body = pre_nonblank[-1]
    else:
        # 无分隔线：首个非空行可能是 "M月D日--题目"
        cleaned = content[:]
        for ln in content:
            s = ln.strip()
            if s:
                fm3 = re.match(r"^(\d{1,2})月(\d{1,2})日[-—\s]*(.*)$", s)
                if fm3 and not title:
                    if month is None:
                        month, day = int(fm3.group(1)), int(fm3.group(2))
                    title_from_body = fm3.group(3).strip()
                    # 从正文移除这一行
                    cleaned = [c for c in cleaned if c is not ln]
                break

    if not title and title_from_body:
        title = title_from_body
    if not title:
        title = "牧师的话"

    # 去掉首尾空行与署名
    while cleaned and (cleaned[0].strip() == "" or cleaned[0].strip() == title):
        cleaned.pop(0)
    while cleaned and (cleaned[-1].strip() == "" or SIGNATURE_RE.match(cleaned[-1])):
        cleaned.pop()

    if month is None or day is None:
        return None

    paras = build_paragraphs(cleaned)
    iso = f"{year:04d}-{month:02d}-{day:02d}"
    return {
        "id": f"p{year:04d}{month:02d}{day:02d}",
        "date": iso,
        "ym": f"{year:04d}{month:02d}",
        "title": title,
        "paras": paras,
    }


# ---------- 共用：分段 ----------

def build_paragraphs(lines):
    """把行合并为段落。空行分段；以【…】开头的行单独成段（小标题）。"""
    paras = []
    buf = []

    def flush():
        if buf:
            text = "".join(buf).strip("　 ")
            if text:
                paras.append(text)
            buf.clear()

    for ln in lines:
        s = ln.strip()
        if s == "":
            flush()
            continue
        if s.startswith("【") or HEADER_RE.match(s):
            flush()
            paras.append(s)
            continue
        # 同段落内：以中文缩进/空白开头视为新段
        if buf and (ln.startswith(("　", "  ", "\t")) and not buf[-1].endswith(("，", "、", "："))):
            flush()
        buf.append(s)
    flush()
    return paras


# ---------- 主流程 ----------

def main():
    os.makedirs(os.path.join(DATA_DIR, "devotions"), exist_ok=True)

    # 灵修笔记
    dev_files = glob.glob(os.path.join(DEVOTION_DIR, "**", "*.txt"), recursive=True)
    devotions = []
    skipped = []
    for p in sorted(dev_files):
        try:
            e = parse_devotion(p)
        except Exception as ex:
            e = None
            print("ERR dev:", p, ex)
        if e:
            devotions.append((e, p))
        else:
            skipped.append(p)

    # 去重：同一 id 取后者（更靠后的文件名），保留唯一
    by_id = {}
    for e, p in devotions:
        by_id[e["id"]] = e
    dev_list = sorted(by_id.values(), key=lambda x: x["date"], reverse=True)

    # 索引（轻量）
    index = [{"id": e["id"], "date": e["date"], "ym": e["ym"],
              "title": e["title"], "scripture": e["scripture"]} for e in dev_list]
    with open(os.path.join(DATA_DIR, "devotions-index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))

    # 按月分桶正文
    buckets = {}
    for e in dev_list:
        buckets.setdefault(e["ym"], {})[e["id"]] = {
            "date": e["date"], "title": e["title"],
            "scripture": e["scripture"], "paras": e["paras"]}
    for ym, obj in buckets.items():
        with open(os.path.join(DATA_DIR, "devotions", f"{ym}.json"), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

    # 牧师的话
    pastor_files = glob.glob(os.path.join(PASTOR_DIR, "**", "*.txt"), recursive=True)
    pastors = {}
    for p in sorted(pastor_files):
        try:
            e = parse_pastor(p)
        except Exception as ex:
            e = None
            print("ERR pastor:", p, ex)
        if e:
            pastors[e["id"]] = e
        else:
            skipped.append(p)
    pastor_list = sorted(pastors.values(), key=lambda x: x["date"], reverse=True)
    with open(os.path.join(DATA_DIR, "pastor-words.json"), "w", encoding="utf-8") as f:
        json.dump(pastor_list, f, ensure_ascii=False, separators=(",", ":"))

    # 首页最新
    def light(e, n=70):
        body = "".join(par for par in e["paras"] if not par.startswith("【"))
        return {"id": e["id"], "date": e["date"], "title": e["title"],
                "scripture": e.get("scripture", ""),
                "excerpt": body[:n]}
    home = {
        "devotion": [light(e) for e in dev_list[:3]],
        "pastor": [light(e) for e in pastor_list[:3]],
    }
    with open(os.path.join(DATA_DIR, "home-latest.json"), "w", encoding="utf-8") as f:
        json.dump(home, f, ensure_ascii=False, separators=(",", ":"))

    print(f"灵修笔记: {len(dev_list)} 篇  ->  {len(buckets)} 个月桶")
    print(f"牧师的话: {len(pastor_list)} 篇")
    print(f"跳过（无法解析日期）: {len(skipped)} 个文件")
    for s in skipped[:30]:
        print("   skip:", os.path.relpath(s, ROOT))
    # 日期范围
    if dev_list:
        print("灵修笔记日期范围:", dev_list[-1]["date"], "~", dev_list[0]["date"])
    if pastor_list:
        print("牧师的话日期范围:", pastor_list[-1]["date"], "~", pastor_list[0]["date"])


if __name__ == "__main__":
    main()
