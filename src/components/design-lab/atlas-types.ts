export type AtlasObservationDay = {
  date: string;
  label: string;
  count: number;
};

export type AtlasTrait = {
  name: string;
  median: number;
  count: number;
};

export type AtlasSoldPool = {
  count: number | null;
  window: string;
};

export type AtlasSpecimen = {
  src: string;
  label: string;
  href?: string;
};

export type AtlasMorph = {
  name: string;
  category: string;
  aliases: ReadonlyArray<string>;
  description: string | null;
};

export type AtlasListing = {
  id: string;
  title: string;
  price: number | null;
  traits: ReadonlyArray<string>;
  sellerId: string | null;
  maturity: string | null;
  sex: string | null;
  firstListedAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  imageUrl: string | null;
};

export type AtlasPriceObservation = {
  listingId: string;
  date: string;
  price: number;
};

export type AtlasSnapshot = {
  generatedAt: string;
  generatedAtIso: string;
  observedWindow: string;
  observedWindowDays: number;
  currentWindowHours: number;
  recentListings: number | null;
  medianAsk: number | null;
  askingRangeNote: string;
  latestObservationNote: string;
  capturedSold: AtlasSoldPool;
  inferredSold: AtlasSoldPool;
  dailyObservations: ReadonlyArray<AtlasObservationDay>;
  morphs: ReadonlyArray<AtlasMorph>;
  listings: ReadonlyArray<AtlasListing>;
  priceObservations: ReadonlyArray<AtlasPriceObservation>;
  /** Legacy preview surface retained while the earlier design studies still render. */
  traits: ReadonlyArray<AtlasTrait>;
  specimens: ReadonlyArray<AtlasSpecimen>;
};
