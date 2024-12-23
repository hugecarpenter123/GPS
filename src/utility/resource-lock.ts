import EventEmitter from "events";
import { CityInfo } from "../service/city/city-switch-manager";


export default class ResourceLock extends EventEmitter {
  private static instance: ResourceLock;
  private lockList: CityInfo[];

  private constructor() {
    super();
    this.lockList = [];
  }

  public static getInstance(): ResourceLock {
    if (!ResourceLock.instance) {
      ResourceLock.instance = new ResourceLock();
    }
    return ResourceLock.instance;
  }

  public lockResources(city: CityInfo): void {
    if (!this.lockList.find(c => c.name === city.name)) {
      this.lockList.push(city);
      this.emit('resource-lock-change', city);
    }
  }

  public releaseResources(city: CityInfo): void {
    const countBefore = this.lockList.length;
    this.lockList = this.lockList.filter(c => c.name !== city.name);
    if (this.lockList.length !== countBefore) {
      this.emit('resource-lock-change', city);
    }
  }

  public isResourceLocked(city: CityInfo): boolean {
    return this.lockList.find(c => c.name === city.name) !== undefined;
  }

  public getLockList(): CityInfo[] {
    return this.lockList;
  }
}