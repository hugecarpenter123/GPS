import { CityInfo } from '../service/city/city-switch-manager';
import { ScheduleOperationDetails } from '../service/master-queue/master-queue';

export default interface IMasterQueueService<
  QueueItemType extends { supplierCities: CityInfo[]; maxShipmentTime: number },
> {
  execute: (operationDetails: ScheduleOperationDetails<QueueItemType>) => void | Promise<void>;
}
