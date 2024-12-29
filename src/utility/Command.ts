export interface ICommand {
  execute(): Promise<void>;
  cancel(): void;
}