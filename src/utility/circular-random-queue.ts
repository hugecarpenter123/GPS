import { getRandomInt } from "./plain-utility";

export default class CircularRandomQueue<T> {
  private items: T[];
  private alreadyDoneitems: T[];
  private size: number;

  constructor(items: T[]) {
    this.items = [...items];
    this.alreadyDoneitems = [];
    this.size = items.length;
  }
  getNext(): T {
    if (this.size === 0) {
      throw new Error('Queue is empty');
    }

    if (!this.items.length) {
      this.resetQueue();
    }

    const randomIndex = getRandomInt(this.items.length);
    const item = this.items.splice(randomIndex, 1)[0];
    if (item !== undefined) {
      this.alreadyDoneitems.push(item);
      return item;
    }

    throw new Error('Unexpected error while getting next item');
  }

  private resetQueue = () => {
    this.items = Array.from(this.alreadyDoneitems);
    this.alreadyDoneitems.splice(0, this.alreadyDoneitems.length);
  }

  getQueue(): T[] {
    return [...this.items];
  }
}