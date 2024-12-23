import { CityInfo } from "../service/city/city-switch-manager";

/*
Każdy manager, któremu zależy na kolejności i sychronizacji z innymi elementami
może się kolejkować w tej kolejce. Jeżeli kolejność nie odgrywa roli nie musi korzystać.

-Każdy item posiada callbacka do wywołania swojego flow.
  :Manger odustepnia API "performNext()", który wrappuje actionCallbacka, by zapisać jego timeout jako props (do poźniejszgo wstrzymwania)

*/

type QueueItem = {
  city: CityInfo;
  action: 'recruiter' | 'builder';
  actionCallback: () => void | Promise<void>;
  scheduleId: NodeJS.Timeout | null;
  scheduleDate: Date | null;
  details: any;
}


export default class MasterQueue {
  private queue: QueueItem[];

  private constructor() {
    this.queue = [];
  }

  private static instance: MasterQueue;

  public static getInstance(): MasterQueue {
    if (!MasterQueue.instance) {
      MasterQueue.instance = new MasterQueue();
    }
    return MasterQueue.instance;
  }
}