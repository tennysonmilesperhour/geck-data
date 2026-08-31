export type AtlasTrait = {
  name: string;
  median: number;
  count: number;
};

export type AtlasObservationDay = {
  date: string;
  label: string;
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

export type AtlasSnapshot = {
  generatedAt: string;
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
  traits: ReadonlyArray<AtlasTrait>;
  specimens: ReadonlyArray<AtlasSpecimen>;
};
