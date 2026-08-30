export const DESIGN_LAB_SNAPSHOT = {
  generatedAt: "Aug 30, 2026 · 03:42 MDT",
  observedWindow: "Aug 22–29, 2026",
  recentListings: 564,
  medianAsk: 260,
  askingRange: "$35–$5,850",
  soldRecords: 2887,
  soldWindow: "May 11–Jun 7, 2026",
  dailyListings: [28, 128, 85, 84, 82, 93, 37, 27],
  days: ["22", "23", "24", "25", "26", "27", "28", "29"],
  traits: [
    { name: "Lilly White", median: 400, count: 120 },
    { name: "Harlequin", median: 195, count: 112 },
    { name: "Axanthic", median: 450, count: 58 },
    { name: "Cappuccino", median: 324.37, count: 68 },
    { name: "Tri-color", median: 289.81, count: 80 },
    { name: "Dalmatian", median: 150, count: 56 },
  ],
} as const;

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
