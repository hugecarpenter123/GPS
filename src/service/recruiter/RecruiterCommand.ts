import { ICommand } from '../../utility/Command';
import Recruiter, { RecruiterQueueItem } from './recruiter';

export default class RecruiterCommand implements ICommand {
  private itemData: RecruiterQueueItem;
  private onComplete: () => void;

  constructor(itemData: RecruiterQueueItem, onComplete: () => void) {
    this.itemData = itemData;
    this.onComplete = onComplete;
  }

  public async execute(): Promise<void> {
    // await Recruiter.getInstance().performNext(this.itemData);
    this.onComplete();
  }
  public cancel(): void {
    throw new Error('Method not implemented.');
  }
}
