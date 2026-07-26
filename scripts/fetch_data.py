#!/usr/bin/env python3
"""
Task03: 双均线策略 - 数据获取脚本
获取全部标的(5 只原有 + 9 只新增)的最新前复权日线数据，约 2 年(≈510 交易日)
"""
import subprocess
import json
import os
import time
from datetime import datetime
from pathlib import Path

NODE_PATH = "/Users/zhangxiao/.workbuddy/binaries/node/versions/22.22.2/bin/node"
SCRIPT_PATH = "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/builtin-skills/westock-data/scripts/index.js"

# 5 只原有 + 9 只新增 = 14 只标的
STOCKS = [
    {"code": "sh688981", "name": "中芯国际", "market": "A", "currency": "CNY", "group": "中芯国际", "industry": "半导体"},
    {"code": "hk00981", "name": "中芯国际", "market": "HK", "currency": "HKD", "group": "中芯国际", "industry": "半导体"},
    {"code": "sz002594", "name": "比亚迪", "market": "A", "currency": "CNY", "group": "比亚迪", "industry": "新能源汽车"},
    {"code": "hk01211", "name": "比亚迪股份", "market": "HK", "currency": "HKD", "group": "比亚迪", "industry": "新能源汽车"},
    {"code": "sh600900", "name": "长江电力", "market": "A", "currency": "CNY", "group": "长江电力", "industry": "电力"},
    # ===== 新增 9 只标的 =====
    {"code": "sz300433", "name": "蓝思科技", "market": "A", "currency": "CNY", "group": "蓝思科技", "industry": "消费电子"},
    {"code": "sz003021", "name": "兆威机电", "market": "A", "currency": "CNY", "group": "兆威机电", "industry": "机械设备"},
    {"code": "sz300308", "name": "中际旭创", "market": "A", "currency": "CNY", "group": "中际旭创", "industry": "通信设备"},
    {"code": "sh601200", "name": "上海环境", "market": "A", "currency": "CNY", "group": "上海环境", "industry": "环保"},
    {"code": "sh600649", "name": "城投控股", "market": "A", "currency": "CNY", "group": "城投控股", "industry": "房地产"},
    {"code": "sh600109", "name": "国金证券", "market": "A", "currency": "CNY", "group": "国金证券", "industry": "非银金融"},
    {"code": "sh601169", "name": "北京银行", "market": "A", "currency": "CNY", "group": "北京银行", "industry": "银行"},
    {"code": "sh600177", "name": "雅戈尔", "market": "A", "currency": "CNY", "group": "雅戈尔", "industry": "服装家纺"},
    {"code": "sh600021", "name": "上海电力", "market": "A", "currency": "CNY", "group": "上海电力", "industry": "电力"},
]

OUTPUT_DIR = Path(__file__).parent / "data"
KLINE_LIMIT = 510  # ≈ 2 年交易日(略超，便于时间窗口筛选)


def fetch_kline(stock_code, retries=2):
    """调用 westock-data CLI 获取K线数据"""
    cmd = [NODE_PATH, SCRIPT_PATH, "kline", stock_code, "--period", "day", "--fq", "qfq", "--limit", str(KLINE_LIMIT)]
    for attempt in range(retries + 1):
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=40)
            if result.stdout.strip():
                return result.stdout
        except subprocess.TimeoutExpired:
            pass
        if attempt < retries:
            time.sleep(2)
    return ""


def parse_table(output):
    """解析 markdown 表格输出为字典列表"""
    if not output:
        return []

    lines = output.strip().split("\n")
    if len(lines) < 3:
        return []

    # 解析表头
    headers = [h.strip() for h in lines[0].split("|")[1:-1]]

    # 解析数据行（跳过分隔线）
    data = []
    for line in lines[2:]:
        if line.strip() and not line.strip().startswith("---"):
            values = [v.strip() for v in line.split("|")[1:-1]]
            if len(values) == len(headers):
                row = dict(zip(headers, values))
                data.append(row)

    return data


def transform_row(row):
    """转换数据类型，统一字段名"""
    return {
        "date": row.get("date", ""),
        "open": float(row.get("open", 0)),
        "close": float(row.get("last", 0)),  # westock 输出 last -> close
        "high": float(row.get("high", 0)),
        "low": float(row.get("low", 0)),
        "volume": int(float(row.get("volume", 0))),
        "amount": float(row.get("amount", 0)),
    }


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    stocks_meta = {"stocks": []}

    for stock in STOCKS:
        code = stock["code"]
        name = stock["name"]

        print(f"\n{'='*50}")
        print(f"获取 {name} ({code}) 日线数据...")

        output = fetch_kline(code)
        raw_data = parse_table(output)

        if not raw_data:
            print(f"  [错误] 未获取到数据，跳过")
            continue

        # 转换数据类型并按日期升序排列
        data = [transform_row(row) for row in raw_data]
        data.sort(key=lambda x: x["date"])

        # 保存 JSON
        filename = f"{code}_daily.json"
        filepath = OUTPUT_DIR / filename
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        # 元数据
        meta_entry = {
            "code": code,
            "name": name,
            "market": stock["market"],
            "currency": stock["currency"],
            "group": stock["group"],
            "industry": stock["industry"],
            "data_file": filename,
            "data_count": len(data),
            "first_date": data[0]["date"] if data else "",
            "last_date": data[-1]["date"] if data else "",
            "last_close": data[-1]["close"] if data else 0,
        }
        stocks_meta["stocks"].append(meta_entry)

        print(f"  数据: {len(data)} 条")
        print(f"  日期范围: {meta_entry['first_date']} ~ {meta_entry['last_date']}")
        print(f"  最新收盘价: {meta_entry['last_close']}")
        print(f"  保存到: {filepath}")

    # 保存元数据
    meta_path = OUTPUT_DIR / "stocks.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(stocks_meta, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*50}")
    print(f"全部完成！共 {len(stocks_meta['stocks'])} 只股票")
    print(f"数据目录: {OUTPUT_DIR.absolute()}")
    print(f"更新时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    main()
