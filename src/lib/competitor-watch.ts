export type WatchVideo = {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  url: string;
  views?: number;
  durationSeconds: number;
};
export type WatchChannel = {
  id: string;
  input: string;
  name: string;
  avatar: string;
  subscribers?: number;
  recordedAt: string;
  videos: WatchVideo[];
};
export type CompetitorWatchData = {
  channels: WatchChannel[];
  inputs: string[];
  updatedAt?: string;
  warnings: string[];
};
