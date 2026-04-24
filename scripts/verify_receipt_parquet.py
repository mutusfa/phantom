"""Verify data/receipt.parquet matches CombinedReceipts table.

For the first 100 rows in the parquet, fetch the matching CombinedReceipts row
by Id, then compare every parquet column that maps to a CombinedReceipts column.

Column mapping:
    mapid        <-> MappingGroupId
    retid        <-> RetailerFormatId
    storecode    <-> RetailerStoreCode
    till         <-> RetailerTill
    receiptid    <-> Id
    counter      <-> RetailerTillCounter
    date         <-> PurchaseDate
    upload_date  <-> UploadDate

`address` is not on CombinedReceipts (it joins via RetailerStores), so it's
excluded from the mismatch check.
"""

import re
import sys
from pathlib import Path

import pyarrow.parquet as pq
import pyodbc

sys.path.insert(0, str(Path("/home/dietpi/repos/llm-receipt-reading/src")))
from llm_receipt_reading.auth import get_sync_database_url  # noqa: E402


PARQUET_PATH = Path("/home/dietpi/phantom/app/data/receipt.parquet")
N_ROWS = 100

MAPPING = {
    "mapid": "MappingGroupId",
    "retid": "RetailerFormatId",
    "storecode": "RetailerStoreCode",
    "till": "RetailerTill",
    "receiptid": "Id",
    "counter": "RetailerTillCounter",
    "date": "PurchaseDate",
    "upload_date": "UploadDate",
}


def connect() -> pyodbc.Connection:
    url = get_sync_database_url()
    m = re.match(r"mssql\+(?:pyodbc|aioodbc)://([^:]+):([^@]+)@([^/]+)/([^?]+)", url)
    if not m:
        raise ValueError(f"Cannot parse DB URL")
    user, password, server_part, database = m.groups()
    database = database.split("?")[0]
    server_host = server_part.rsplit(":", 1)[0] if ":" in server_part else server_part
    port = int(server_part.rsplit(":", 1)[1]) if ":" in server_part else 1433
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={server_host},{port};DATABASE={database};UID={user};PWD={password};"
        "Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;"
    )
    return pyodbc.connect(conn_str, timeout=30)


def normalize(v):
    """Coerce to comparable form (strip strings, int->int, NaT->None)."""
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if isinstance(v, str):
        return v.strip()
    try:
        import pandas as pd
        if pd.isna(v):
            return None
    except Exception:
        pass
    return v


def main() -> None:
    df = pq.ParquetFile(PARQUET_PATH).read_row_group(0).to_pandas().head(N_ROWS)
    ids = [int(x) for x in df["receiptid"].tolist()]
    print(f"Parquet: {len(df)} rows. Id range {min(ids)}..{max(ids)}")

    conn = connect()
    cur = conn.cursor()
    cols = ["Id", "MappingGroupId", "RetailerFormatId", "RetailerStoreCode",
            "RetailerTill", "RetailerTillCounter", "PurchaseDate", "UploadDate"]
    placeholders = ",".join("?" * len(ids))
    cur.execute(
        f"SELECT {', '.join(cols)} FROM CombinedReceipts WITH (NOLOCK) "
        f"WHERE Id IN ({placeholders})",
        *ids,
    )
    rows = cur.fetchall()
    db = {r[0]: dict(zip(cols, r)) for r in rows}
    print(f"DB: fetched {len(db)} / {len(ids)} rows")

    missing = [i for i in ids if i not in db]
    if missing:
        print(f"MISSING FROM DB ({len(missing)}): {missing[:10]}...")

    mismatches = []
    compared = 0
    for _, prow in df.iterrows():
        rid = int(prow["receiptid"])
        if rid not in db:
            continue
        drow = db[rid]
        for pcol, dcol in MAPPING.items():
            pv = normalize(prow[pcol])
            dv = normalize(drow[dcol])
            # Int tolerance: parquet has storecode/till/counter as strings
            # but DB might return int-like strings. Normalize both.
            if isinstance(pv, str) and isinstance(dv, (int, float)):
                try:
                    pv = int(pv)
                except ValueError:
                    pass
            if isinstance(dv, str) and isinstance(pv, (int, float)):
                try:
                    dv = int(dv)
                except ValueError:
                    pass
            if pv != dv:
                mismatches.append((rid, pcol, dcol, pv, dv))
        compared += 1

    print(f"\nCompared {compared} rows across {len(MAPPING)} columns "
          f"({compared * len(MAPPING)} value checks)")
    if not mismatches:
        print("PASS: every value in every mapped column is identical.")
        return
    print(f"FAIL: {len(mismatches)} mismatches")
    for rid, pcol, dcol, pv, dv in mismatches[:20]:
        print(f"  Id={rid}  {pcol}={pv!r}  vs  {dcol}={dv!r}")
    if len(mismatches) > 20:
        print(f"  ... {len(mismatches) - 20} more")


if __name__ == "__main__":
    main()
