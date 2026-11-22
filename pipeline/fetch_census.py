"""Fetch public economic stats for Shrewsbury town, MA from the US Census API (no key, few calls).

- ACS 5-year data profile (DP03/DP05) for the county subdivision "Shrewsbury town" (Worcester County).
- County Business Patterns for ZIP 01545 (establishments by 2-digit NAICS).
Writes public/tiles/census.json with source URLs, years and labels. Raw responses cached in data/raw/census/.
"""
import json, os, time, urllib.parse, urllib.request
from common import RAW, OUT

UA = {"User-Agent": "people-of-shrewsbury-pipeline/0.1"}
C = RAW / "census"; C.mkdir(parents=True, exist_ok=True)


def get(url, cache):
    p = C / cache
    if p.exists(): return json.loads(p.read_text())
    key = os.environ.get("CENSUS_API_KEY")
    if not key: raise RuntimeError("CENSUS_API_KEY not set (free key: https://api.census.gov/data/key_signup.html)")
    time.sleep(1)
    full = url + ("&" if "?" in url else "?") + "key=" + key
    with urllib.request.urlopen(urllib.request.Request(full, headers=UA), timeout=60) as r: body = r.read()
    data = json.loads(body)  # raises on the HTML "Missing Key" page; nothing cached then
    p.write_bytes(body); return data


def first_year(fn, years):
    for y in years:
        try: return y, fn(y)
        except Exception as e: print("year", y, "failed:", e)
    return None, None


DP = {"DP05_0001E": "population", "DP03_0062E": "median_household_income_usd",
      "DP03_0063E": "mean_household_income_usd", "DP03_0004E": "employed_civilian_16plus",
      "DP03_0009PE": "unemployment_rate_pct", "DP03_0088E": "per_capita_income_usd",
      "DP03_0033E": "ind_agriculture_mining", "DP03_0034E": "ind_construction",
      "DP03_0035E": "ind_manufacturing", "DP03_0036E": "ind_wholesale", "DP03_0037E": "ind_retail",
      "DP03_0038E": "ind_transport_utilities", "DP03_0039E": "ind_information",
      "DP03_0040E": "ind_finance_insurance_real_estate", "DP03_0041E": "ind_professional_scientific_admin",
      "DP03_0042E": "ind_education_health_social", "DP03_0043E": "ind_arts_recreation_food_lodging",
      "DP03_0044E": "ind_other_services", "DP03_0045E": "ind_public_administration"}


def acs(y):
    url = (f"https://api.census.gov/data/{y}/acs/acs5/profile?" +
           urllib.parse.urlencode({"get": "NAME," + ",".join(DP), "for": "county subdivision:*",
                                   "in": "state:25 county:027"}))
    rows = get(url, f"acs5_profile_{y}.json")
    hdr = rows[0]
    row = next(r for r in rows[1:] if r[0].startswith("Shrewsbury town"))
    rec = dict(zip(hdr, row))
    labels = {}
    for v in DP:
        try:
            labels[v] = get(f"https://api.census.gov/data/{y}/acs/acs5/profile/variables/{v}.json", f"var_{y}_{v}.json")["label"]
        except Exception: labels[v] = None
    return {"dataset": f"ACS 5-year {y} (data profile)", "url": url, "geography": rec["NAME"],
            "fips": f"{rec['state']}{rec['county']}{rec['county subdivision']}",
            "values": {DP[v]: float(rec[v]) if rec[v] not in (None, "") else None for v in DP},
            "census_labels": {DP[v]: labels[v] for v in DP}}


def cbp(y):
    url = (f"https://api.census.gov/data/{y}/cbp?" +
           urllib.parse.urlencode({"get": "ESTAB,EMP,PAYANN,NAICS2017,NAICS2017_LABEL", "for": "zip code:01545"}))
    rows = get(url, f"cbp_{y}_01545.json")
    hdr = rows[0]
    recs = [dict(zip(hdr, r)) for r in rows[1:]]
    return {"dataset": f"County Business Patterns {y}, ZIP 01545 (Shrewsbury; ZIP area differs from town boundary)",
            "url": url,
            "by_naics": [{"naics": r["NAICS2017"], "label": r["NAICS2017_LABEL"], "establishments": int(r["ESTAB"]),
                          "employees": int(r["EMP"]) if r.get("EMP") not in (None, "", "0") else None}
                         for r in recs]}


def main():
    if not os.environ.get("CENSUS_API_KEY"):
        print("CENSUS_API_KEY not set: writing placeholder census.json")
    out = {"status": "ok" if os.environ.get("CENSUS_API_KEY") else "placeholder - CENSUS_API_KEY not set, no numbers fetched",
           "note": "Public US Census data. Values are estimates with margins of error (ACS) - cite dataset and year."}
    y, a = first_year(acs, [2023, 2022])
    out["acs"] = a
    y2, b = first_year(cbp, [2022, 2021, 2020])
    out["cbp"] = b
    out["bls"] = {"status": "placeholder", "note": "BLS LAUS town-level unemployment / QCEW (county-level) not fetched in v0."}
    (OUT / "census.json").write_text(json.dumps(out, indent=1))
    print("ACS", y, a and a["values"]["population"], a and a["values"]["median_household_income_usd"])
    print("CBP", y2, b and len(b["by_naics"]))


if __name__ == "__main__": main()
