import type MasterManager from './service/master/master-manager';
import type Farmer from './service/farm/farm-manager';
import type BanditCampManager from './service/farm/bandit-camp-manager';
import type CitySwitchManager from './service/city/city-switch-manager';
import type CityBuilder from './service/city/builder/city-builder';
import type Recruiter from './service/recruiter/recruiter';
import type Scheduler from './service/scheduler/Scheduler';
import type MasterQueue from './service/master-queue-rework/master-queue';
import type { Academy } from './service/academy/academy';
import type ArmyMovement from './service/army/army-movement';

declare global {
  interface Window {
    GPS: {
      master: MasterManager;
      farmer: Farmer;
      bandit: BanditCampManager;
      switchManager: CitySwitchManager;
      builder: CityBuilder;
      recruiter: Recruiter;
      scheduler: Scheduler;
      masterQueue: MasterQueue;
      academy: Academy;
      armyMovement: ArmyMovement;
    };
  }
}
