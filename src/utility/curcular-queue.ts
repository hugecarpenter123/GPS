export default class CircularQueue<T> {
  private items: T[];
  private size: number;

  constructor(items: T[]) {
    this.items = [...items];
    this.size = items.length;
  }
  getNext(): T {
    if (this.size === 0) {
      throw new Error('Queue is empty');
    }

    const item = this.items.shift();
    if (item !== undefined) {
      this.items.push(item);
      return item;
    }

    throw new Error('Unexpected error while getting next item');
  }

  getQueue(): T[] {
    return [...this.items];
  }
}