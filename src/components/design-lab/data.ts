import type { AtlasListing, AtlasMorph, AtlasPriceObservation } from "./atlas-types";

export const DESIGN_LAB_IMAGES = {
  lilly:
    "https://d2bjn9a420fiq0.cloudfront.net/media/raw_images/sunshine_geckos/2026/08/20260823052125.593-IMG_2092.jpeg",
  axanthic:
    "https://d2bjn9a420fiq0.cloudfront.net/media/raw_images/holliesballpython/2026/08/20260826185148.169-1000024330.jpg",
  cappuccino:
    "https://d2bjn9a420fiq0.cloudfront.net/media/raw_images/evolverreptiles/2026/08/20260814192504.261-IMG_20260814_152419.jpg",
  dalmatian:
    "https://d2bjn9a420fiq0.cloudfront.net/media/raw_images/traviswarren/2026/01/20260104200719.911-IMG_1159.jpeg",
} as const;

const DESIGN_LAB_MORPHS: AtlasMorph[] = [
  ["Harlequin", "pattern"], ["Extreme Harlequin", "pattern"], ["Tri-color", "pattern"],
  ["Pinstripe", "pattern"], ["Full Pinstripe", "pattern"], ["Partial Pinstripe", "pattern"],
  ["Quad-stripe", "pattern"], ["Reverse Pinstripe", "pattern"], ["Dalmatian", "pattern"],
  ["Super Dalmatian", "pattern"], ["Phantom", "pattern"], ["Empty Back", "pattern"],
  ["Drippy", "pattern"], ["Portholes", "pattern"], ["Tiger", "pattern"],
  ["Brindle", "pattern"], ["Lilly White", "color"], ["Cappuccino", "color"],
  ["Frappuccino", "color"], ["Moonglow", "color"], ["Sable", "color"],
  ["Axanthic", "color"], ["Red", "color"], ["Red Base", "color"],
  ["Yellow", "color"], ["Orange", "color"], ["Cream", "color"],
  ["Tangerine", "color"], ["Dark Base", "color"], ["Olive", "color"],
  ["Lavender", "color"], ["Buckskin", "color"], ["Patternless", "pattern"],
  ["White Wall", "pattern"], ["Soft Scale", "scale"], ["Hypo", "other"],
  ["Het Axanthic", "other"],
].map(([name, category]) => ({
  name,
  category,
  aliases: name === "Lilly White" ? ["lily white", "lilly"] : [],
  description: null,
}));

const sampleListing = (
  id: string,
  title: string,
  price: number,
  traits: string[],
  sellerId: string,
  maturity: string,
  sex: string,
  imageUrl: string,
  firstListedAt: string,
): AtlasListing => ({
  id,
  title,
  price,
  traits,
  sellerId,
  maturity,
  sex,
  firstListedAt,
  firstSeenAt: firstListedAt,
  lastSeenAt: "2026-08-29T18:00:00Z",
  imageUrl,
});

const DESIGN_LAB_LISTINGS: AtlasListing[] = [
  sampleListing("demo-01", "Lilly White female", 425, ["Lilly White", "Harlequin"], "crescent", "Adult", "female", DESIGN_LAB_IMAGES.lilly, "2026-08-22T12:00:00Z"),
  sampleListing("demo-02", "Lilly White juvenile", 300, ["Lilly White", "Pinstripe"], "ridge", "Juvenile", "male", DESIGN_LAB_IMAGES.lilly, "2026-08-24T12:00:00Z"),
  sampleListing("demo-03", "Axanthic pinstripe", 475, ["Axanthic", "Pinstripe"], "northstar", "Subadult", "female", DESIGN_LAB_IMAGES.axanthic, "2026-08-23T12:00:00Z"),
  sampleListing("demo-04", "Axanthic juvenile", 350, ["Axanthic"], "crescent", "Juvenile", "male", DESIGN_LAB_IMAGES.axanthic, "2026-08-25T12:00:00Z"),
  sampleListing("demo-05", "Cappuccino adult", 375, ["Cappuccino", "Harlequin"], "ember", "Adult", "female", DESIGN_LAB_IMAGES.cappuccino, "2026-08-22T12:00:00Z"),
  sampleListing("demo-06", "Cappuccino juvenile", 275, ["Cappuccino"], "ridge", "Juvenile", "male", DESIGN_LAB_IMAGES.cappuccino, "2026-08-27T12:00:00Z"),
  sampleListing("demo-07", "Dalmatian female", 225, ["Dalmatian", "Red"], "northstar", "Adult", "female", DESIGN_LAB_IMAGES.dalmatian, "2026-08-21T12:00:00Z"),
  sampleListing("demo-08", "Super Dalmatian", 325, ["Super Dalmatian"], "ember", "Subadult", "male", DESIGN_LAB_IMAGES.dalmatian, "2026-08-26T12:00:00Z"),
  sampleListing("demo-09", "Harlequin juvenile", 190, ["Harlequin"], "crescent", "Juvenile", "female", DESIGN_LAB_IMAGES.lilly, "2026-08-28T12:00:00Z"),
  sampleListing("demo-10", "Tri-color adult", 340, ["Tri-color", "Harlequin"], "ridge", "Adult", "female", DESIGN_LAB_IMAGES.lilly, "2026-08-20T12:00:00Z"),
  sampleListing("demo-11", "Red pinstripe", 260, ["Red", "Pinstripe"], "northstar", "Unreported", "unknown", DESIGN_LAB_IMAGES.dalmatian, "2026-08-24T12:00:00Z"),
  sampleListing("demo-12", "Phantom juvenile", 180, ["Phantom"], "ember", "Juvenile", "male", DESIGN_LAB_IMAGES.cappuccino, "2026-08-29T12:00:00Z"),
];

const DESIGN_LAB_OBSERVATIONS: AtlasPriceObservation[] = DESIGN_LAB_LISTINGS.flatMap((listing, index) => [
  { listingId: listing.id, date: "2026-08-23", price: listing.price ?? 0 },
  { listingId: listing.id, date: "2026-08-26", price: listing.price ?? 0 },
  { listingId: listing.id, date: "2026-08-29", price: (listing.price ?? 0) - (index % 4 === 0 ? 15 : 0) },
]);

export const DESIGN_LAB_SNAPSHOT = {
  generatedAt: "Aug 30, 2026 · 03:42 MDT",
  generatedAtIso: "2026-08-30T09:42:00Z",
  observedWindow: "Aug 22–29, 2026",
  observedWindowDays: 8,
  currentWindowHours: 192,
  recentListings: 564,
  medianAsk: 260,
  // Legacy preview aliases remain while the older concept pages still read
  // the original static shape. Production Atlas uses the explicit fields
  // below and never combines captured and inferred sold pools.
  askingRange: "$35–$5,850",
  soldRecords: 2887,
  soldWindow: "May 11–Jun 7, 2026",
  dailyListings: [28, 128, 85, 84, 82, 93, 37, 27],
  days: ["22", "23", "24", "25", "26", "27", "28", "29"],
  askingRangeNote: "recorded range $35–$5,850",
  latestObservationNote: "newest observation Aug 29, 2026",
  capturedSold: { count: 92, window: "May 10–14, 2026" },
  inferredSold: { count: 2840, window: "May 17–Jun 7, 2026" },
  dailyObservations: [
    { date: "2026-08-22", label: "Aug 22", count: 28 },
    { date: "2026-08-23", label: "Aug 23", count: 128 },
    { date: "2026-08-24", label: "Aug 24", count: 85 },
    { date: "2026-08-25", label: "Aug 25", count: 84 },
    { date: "2026-08-26", label: "Aug 26", count: 82 },
    { date: "2026-08-27", label: "Aug 27", count: 93 },
    { date: "2026-08-28", label: "Aug 28", count: 37 },
    { date: "2026-08-29", label: "Aug 29", count: 27 },
  ],
  morphs: DESIGN_LAB_MORPHS,
  listings: DESIGN_LAB_LISTINGS,
  priceObservations: DESIGN_LAB_OBSERVATIONS,
  traits: [
    { name: "Lilly White", median: 400, count: 120 },
    { name: "Harlequin", median: 195, count: 112 },
    { name: "Axanthic", median: 450, count: 58 },
    { name: "Cappuccino", median: 324.37, count: 68 },
    { name: "Tri-color", median: 289.81, count: 80 },
    { name: "Dalmatian", median: 150, count: 56 },
  ],
  specimens: [
    { src: DESIGN_LAB_IMAGES.dalmatian, label: "Dalmatian" },
    { src: DESIGN_LAB_IMAGES.lilly, label: "Lilly White" },
    { src: DESIGN_LAB_IMAGES.axanthic, label: "Axanthic" },
    { src: DESIGN_LAB_IMAGES.cappuccino, label: "Cappuccino" },
  ],
} as const;

export const DESIGN_DIRECTIONS = [
  {
    slug: "field-notes",
    number: "01",
    name: "Field Notes",
    thesis: "An editorial natural-history journal where evidence feels collected, annotated, and cared for.",
  },
  {
    slug: "hard-index",
    number: "02",
    name: "Hard Index",
    thesis: "A strict information poster that treats numbers as the primary visual material.",
  },
  {
    slug: "nocturne",
    number: "03",
    name: "Nocturne",
    thesis: "A black, photographic market brief with quiet controls and evidence at gallery scale.",
  },
  {
    slug: "poster-wall",
    number: "04",
    name: "Poster Wall",
    thesis: "A loud, kinetic studio identity that turns morphs into collectible market posters.",
  },
] as const;
