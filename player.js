import { Entity } from './entity.js';

export class Player extends Entity {
  constructor(x, y, skin) {
    super(x, y);
    this.skin = skin; // SVG string for the player's skin
  }
  render(ctx) {
    // There is no native ctx.drawSvg, so you need to use an external library like canvg
    // Example (if using canvg):
    // const v = canvg.Canvg.fromString(ctx, this.skin);
    // v.render();
    // For now, this is a placeholder:
    // TODO: Integrate canvg or similar to render SVG directly
  }
} 