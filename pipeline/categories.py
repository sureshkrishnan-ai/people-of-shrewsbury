"""OSM tag -> business / POI category mapping (shared by process.py and docs)."""

FOOD_SHOPS = {"bakery", "supermarket", "convenience", "deli", "butcher", "alcohol", "beverages",
              "greengrocer", "confectionery", "seafood", "pastry", "coffee", "tea", "wine", "cheese",
              "chocolate", "farm", "frozen_food", "spices"}
AUTO_SHOPS = {"car", "car_repair", "tyres", "car_parts", "motorcycle", "boat", "fuel", "truck"}
SERVICE_SHOPS = {"hairdresser", "beauty", "laundry", "dry_cleaning", "massage", "tailor",
                 "travel_agency", "copyshop", "funeral_directors", "pet_grooming", "tattoo",
                 "nail_salon", "cosmetics", "photo", "storage_rental", "rental", "money_lender",
                 "pawnbroker", "repair", "mobile_phone_repair", "shoe_repair", "locksmith"}
HEALTH_SHOPS = {"optician", "medical_supply", "hearing_aids", "chemist", "herbalist", "nutrition_supplements"}
TRADE_SHOPS = {"hardware", "doityourself", "trade", "building_materials", "plumbing", "electrical",
               "paint", "flooring", "kitchen", "bathroom_furnishing", "garden_centre"}

FOOD_AMEN = {"restaurant", "cafe", "fast_food", "bar", "pub", "ice_cream", "food_court", "biergarten"}
HEALTH_AMEN = {"pharmacy", "doctors", "dentist", "clinic", "hospital", "veterinary", "nursing_home"}
AUTO_AMEN = {"fuel", "car_wash", "car_rental", "vehicle_inspection", "driving_school"}
FINANCE_AMEN = {"bank", "bureau_de_change"}
SERVICE_AMEN = {"childcare", "post_office", "events_venue", "studio", "coworking_space", "cinema",
                "theatre", "nightclub", "animal_boarding", "conference_centre"}
CIVIC_AMEN = {"townhall", "library", "school", "kindergarten", "college", "university", "police",
              "fire_station", "place_of_worship", "community_centre", "courthouse", "social_facility",
              "arts_centre", "public_bookcase", "grave_yard", "prison", "ranger_station"}
FINANCE_OFFICE = {"insurance", "financial", "accountant", "tax_advisor", "financial_advisor", "estate_agent"}

CATEGORIES = ["food", "retail", "services", "health", "auto", "trades", "finance", "fitness",
              "lodging", "offices", "civic"]

COLORS = {  # used by the viewer's economy layer; engine-independent hex
    "food": "#e4572e", "retail": "#f3a712", "services": "#a86cc1", "health": "#29a3a3",
    "auto": "#5b6c8f", "trades": "#8c5e3c", "finance": "#2e8540", "fitness": "#d6336c",
    "lodging": "#4062bb", "offices": "#7a7a7a", "civic": "#1b998b",
}


def categorize(t: dict):
    """Return (category, osm_kind, is_business) or None if not a POI we keep."""
    a, s, o, c, h = (t.get(k) for k in ("amenity", "shop", "office", "craft", "healthcare"))
    l, tour = t.get("leisure"), t.get("tourism")
    if s and s not in ("vacant", "no"):
        if s in FOOD_SHOPS: return "food", f"shop={s}", True
        if s in AUTO_SHOPS: return "auto", f"shop={s}", True
        if s in SERVICE_SHOPS: return "services", f"shop={s}", True
        if s in HEALTH_SHOPS: return "health", f"shop={s}", True
        if s in TRADE_SHOPS: return "trades", f"shop={s}", True
        return "retail", f"shop={s}", True
    if a:
        if a in FOOD_AMEN: return "food", f"amenity={a}", True
        if a in HEALTH_AMEN: return "health", f"amenity={a}", True
        if a in AUTO_AMEN: return "auto", f"amenity={a}", True
        if a in FINANCE_AMEN: return "finance", f"amenity={a}", True
        if a in SERVICE_AMEN: return "services", f"amenity={a}", True
        if a in CIVIC_AMEN: return "civic", f"amenity={a}", False
    if c: return "trades", f"craft={c}", True
    if h: return "health", f"healthcare={h}", True
    if o:
        if o in FINANCE_OFFICE: return "finance", f"office={o}", True
        if o in ("government", "diplomatic"): return "civic", f"office={o}", False
        return "offices", f"office={o}", True
    if l in ("fitness_centre", "sports_centre", "dance", "bowling_alley", "golf_course", "ice_rink",
             "swimming_pool", "trampoline_park", "escape_game", "amusement_arcade"):
        if t.get("access") in ("private",) and l == "swimming_pool": return None
        return "fitness", f"leisure={l}", True
    if tour in ("hotel", "motel", "guest_house", "hostel", "camp_site"):
        return "lodging", f"tourism={tour}", True
    return None
