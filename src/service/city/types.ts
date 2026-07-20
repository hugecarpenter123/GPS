export type CityInfo = {
  name: string;
  cityId: string | null;
  isleId: string;
  switchAction: (jumpToTown?: boolean) => Promise<void>;
};
