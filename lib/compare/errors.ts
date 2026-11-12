export class CompareError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CompareError";
    this.status = status;
  }
}
