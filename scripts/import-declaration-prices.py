#!/usr/bin/env python3
"""Import the FTS table by PDF cell boundaries, never by a trailing-number regex.

Usage: python3 scripts/import-declaration-prices.py SOURCE.pdf
Requires pdfplumber. Stops on missing rows or malformed prices.
Duplicate source names are preserved so the bot can ask the user to choose.
"""
import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re

import pdfplumber


def parse_cells(cells):
    if len(cells) != 3:
        raise ValueError(f"Expected three columns: {cells!r}")
    number, name, price = (str(cell or "").strip() for cell in cells)
    if not number.isdigit():
        return None  # Repeated table headings are not price records.
    name = re.sub(r"\s+", " ", name).strip()
    price = re.sub(r"\s+", "", price)
    if not name or not re.fullmatch(r"\d+,\d{2}", price):
        raise ValueError(f"Malformed row {number}: {cells!r}")
    amount = Decimal(price.replace(",", "."))
    if amount <= 0:
        raise ValueError(f"Non-positive price in row {number}")
    return {"number": int(number), "name": name, "price": float(amount)}


def import_pdf(source):
    records = []
    with pdfplumber.open(source) as pdf:
        pages = len(pdf.pages)
        for page_index, page in enumerate(pdf.pages, 1):
            tables = page.find_tables()
            if len(tables) != 1:
                raise ValueError(f"Page {page_index}: expected one three-column table, found {len(tables)}")
            count = 0
            words = page.extract_words()
            for grid_row in tables[0].rows:
                if len(grid_row.cells) != 3 or any(cell is None for cell in grid_row.cells):
                    raise ValueError(f"Page {page_index}: incomplete table row")
                cells = []
                for x0, top, x1, bottom in grid_row.cells:
                    # Assign whole words by their starting column: a long model word
                    # can extend over the cell border, but still belongs to the model.
                    selected = [word for word in words if
                                x0 <= word["x0"] < x1 and top <= (word["top"] + word["bottom"]) / 2 < bottom]
                    selected.sort(key=lambda word: (round(word["top"], 1), word["x0"]))
                    cells.append(" ".join(word["text"] for word in selected))
                record = parse_cells(cells)
                if record:
                    expected = len(records) + 1
                    if record["number"] != expected:
                        raise ValueError(f"Page {page_index}: expected row {expected}, found {record['number']}")
                    records.append(record)
                    count += 1
            if not count:
                raise ValueError(f"Page {page_index}: no price rows extracted")
            page.close()
            if page_index % 20 == 0 or page_index == pages:
                print(f"Pages {page_index}/{pages}; rows {len(records)}", flush=True)
    if not records:
        raise ValueError("Empty price list")
    return records, pages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "bot/src/declaration-price-list.js")
    args = parser.parse_args()
    records, pages = import_pdf(args.source)
    # Validate everything before replacing the generated module.
    rows = [{"name": row["name"], "price": row["price"]} for row in records]
    metadata = {"sha256": hashlib.sha256(args.source.read_bytes()).hexdigest(), "pages": pages, "rows": len(rows)}
    module = "// Generated from the owner-provided FTS PDF by scripts/import-declaration-prices.py.\n"
    module += "// Columns are extracted independently using PDF table boundaries. Do not edit manually.\n"
    module += "export const DECLARATION_PRICE_SOURCE = " + json.dumps(metadata) + ";\n"
    module += "export const DECLARATION_PRICE_LIST = [\n"
    module += ",\n".join("  " + json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in rows)
    module += "\n];\n"
    args.output.write_text(module, encoding="utf-8")
    print(f"Saved {len(rows)} rows from {pages} pages to {args.output}")


if __name__ == "__main__":
    main()
