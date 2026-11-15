export class NoneField {
  static async create() {
    return new NoneField();
  }

  constructor() {
    this.id = "none";
    this.empty = true;
    this.revision = 0;
  }

  destroy() {}
}
