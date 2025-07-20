export class Entity {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  render(ctx) {
    // To be implemented by subclasses
  }
} 