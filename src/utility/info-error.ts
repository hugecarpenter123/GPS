export class InfoError extends Error {
  public details: any;

  constructor(message: string, details: any) {
    super(message);
    this.details = details;
    this.name = 'InfoError';
  }
}
