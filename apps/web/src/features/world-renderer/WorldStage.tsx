import { useEffect, useRef } from "react";
import { Application, Graphics, Text } from "pixi.js";
import type { WorldState } from "@storyworld/contracts/model";
export function WorldStage({ world }: { world: WorldState }) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef(world);
  state.current = world;
  useEffect(() => {
    let disposed = false;
    const app = new Application();
    void app
      .init({ width: 1000, height: 600, backgroundAlpha: 0, antialias: true })
      .then(() => {
        if (disposed) {
          app.destroy(true);
          return;
        }
        host.current?.appendChild(app.canvas);
        const g = new Graphics();
        app.stage.addChild(g);
        const nova = new Graphics();
        app.stage.addChild(nova);
        const label = new Text({
          text: "NOVA",
          style: {
            fontFamily: "sans-serif",
            fontSize: 15,
            fill: "#244c40",
            letterSpacing: 3,
          },
        });
        app.stage.addChild(label);
        let x = 190;
        let clock = 0;
        app.ticker.add((t) => {
          clock += t.deltaMS / 1000;
          const w = state.current;
          g.clear();
          g.ellipse(200, 555, 450, 130).fill("#d2e1b2");
          g.ellipse(800, 580, 450, 150).fill("#b9d0a5");
          for (const e of w.entities) {
            const b = e.bounds;
            if (e.kind === "river") {
              g.rect(b.x, b.y, b.width, b.height).fill("#89bfcb");
              for (let i = 0; i < 10; i++)
                g.roundRect(
                  b.x + 15 + (i % 2) * 20,
                  i * 70 + Math.sin(clock + i) * 5,
                  50,
                  3,
                  2,
                ).fill("#cce4dd");
            }
            if (e.kind === "castle") {
              g.roundRect(b.x, b.y, b.width, b.height, 8).fill("#e1b087");
              g.rect(b.x - 10, b.y - 30, 40, b.height + 30).fill("#cf956f");
              g.rect(b.x + b.width - 30, b.y - 30, 40, b.height + 30).fill(
                "#cf956f",
              );
              g.roundRect(b.x + 50, b.y + 75, 40, 75, 18).fill("#855f52");
            }
            if (e.kind === "bridge") {
              g.roundRect(b.x, b.y, b.width, b.height, 5).fill("#ac7554");
              for (let i = 10; i < b.width; i += 18)
                g.rect(b.x + i, b.y, 2, b.height).fill("#deb08a");
            }
            if (e.kind === "cloud") {
              g.ellipse(
                b.x + b.width / 2,
                b.y + b.height / 2,
                b.width / 2,
                b.height / 2,
              ).fill("#7e8b98");
              for (let i = 0; i < 9; i++)
                g.rect(
                  b.x + i * 17,
                  b.y + b.height + ((clock * 130 + i * 41) % 330),
                  2,
                  15,
                ).fill("#88aebf");
            }
          }
          const target = w.pathStatus === "available" ? 690 : 320;
          x += (target - x) * Math.min(1, t.deltaMS / 900);
          nova
            .clear()
            .ellipse(0, 0, 35, 25)
            .fill("#688e67")
            .circle(25, -28, 24)
            .fill("#7fa277")
            .poly([-25, -5, -55, 8, -20, 12])
            .fill("#688e67")
            .poly([-5, -10, -25, -45, 15, -20])
            .fill("#b1c690")
            .circle(33, -33, 4)
            .fill("#243e33")
            .roundRect(-22, 16, 12, 16, 4)
            .fill("#537950")
            .roundRect(12, 16, 12, 16, 4)
            .fill("#537950");
          nova.position.set(x, 340 + Math.sin(clock * 4) * 3);
          label.position.set(x - 30, 395);
        });
      });
    return () => {
      disposed = true;
      if (app.renderer) app.destroy(true, { children: true });
    };
  }, []);
  return (
    <div
      ref={host}
      className="pixi-layer"
      aria-label={"Nova’s route is " + world.pathStatus}
    />
  );
}
