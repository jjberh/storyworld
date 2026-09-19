import { useEffect, useRef } from "react";
import { Application, Graphics, Text } from "pixi.js";
import type { WorldEvent, WorldState } from "@storyworld/contracts/model";
export function WorldStage({
  world,
  latestEvent,
}: {
  world: WorldState;
  latestEvent?: WorldEvent;
}) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef(world);
  const event = useRef(latestEvent);
  state.current = world;
  event.current = latestEvent;
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
        const cue = new Text({
          text: "",
          style: {
            fontFamily: "Georgia, serif",
            fontSize: 18,
            fill: "#315445",
            fontStyle: "italic",
          },
        });
        cue.anchor.set(0.5, 1);
        app.stage.addChild(cue);
        let x = 190;
        let clock = 0;
        let eventElapsed = 1200;
        let activeEventId = event.current?.id;
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        app.ticker.add((t) => {
          clock += t.deltaMS / 1000;
          const latest = event.current;
          if (latest?.id !== activeEventId) {
            activeEventId = latest?.id;
            eventElapsed = 0;
          } else {
            eventElapsed += t.deltaMS;
          }
          const bridgeEvent = latest?.summary.toLowerCase().includes("bridge");
          const reveal =
            reduceMotion || !bridgeEvent ? 1 : Math.min(1, eventElapsed / 700);
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
            if (e.kind === "bridge") {
              const shownWidth = Math.max(8, b.width * reveal);
              const nearMiss = w.pathStatus === "blocked";
              g.roundRect(b.x, b.y, shownWidth, b.height, 5).fill(
                nearMiss ? "#bd765c" : "#ac7554",
              );
              for (let i = 10; i < shownWidth; i += 18)
                g.rect(b.x + i, b.y, 2, b.height).fill(
                  nearMiss ? "#e0a080" : "#deb08a",
                );
              if (nearMiss) {
                g.rect(b.x - 5, b.y - 8, 8, b.height + 16).fill("#d45f50");
                g.rect(b.x + b.width - 3, b.y - 8, 8, b.height + 16).fill(
                  "#d45f50",
                );
              }
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
          if (reduceMotion) x = target;
          else x += (target - x) * Math.min(1, t.deltaMS / 900);
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
          const blockedWobble =
            !reduceMotion && w.pathStatus === "blocked" && eventElapsed < 900
              ? Math.sin(eventElapsed / 70) * 4
              : 0;
          nova.position.set(x + blockedWobble, 340 + Math.sin(clock * 4) * 3);
          label.position.set(x - 30, 395);
          if (w.pathStatus === "available") {
            cue.text =
              reveal < 1 ? "A way through!" : "Nova can reach the castle";
            cue.style.fill = "#315445";
            cue.position.set(510, 250);
          } else if (w.entities.some((e) => e.kind === "bridge")) {
            cue.text = "Almost — reach both riverbanks";
            cue.style.fill = "#a44d3f";
            cue.position.set(480, 250);
          } else {
            cue.text = "The river is in the way";
            cue.style.fill = "#315445";
            cue.position.set(340, 250);
          }
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
