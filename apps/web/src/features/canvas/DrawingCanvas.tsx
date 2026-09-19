import { useState } from "react";
import { Stage, Layer, Line } from "react-konva";
import type { Bounds } from "@storyworld/contracts/model";
export function DrawingCanvas({
  width,
  onFinish,
  disabled,
}: {
  width: number;
  onFinish: (bounds: Bounds) => void;
  disabled: boolean;
}) {
  const [lines, setLines] = useState<number[][]>([]);
  const [drawing, setDrawing] = useState(false);
  const scale = width / 1000;
  return (
    <Stage
      width={width}
      height={width * 0.6}
      scaleX={scale}
      scaleY={scale}
      onPointerDown={(e) => {
        if (disabled) return;
        const p = e.target.getStage()?.getPointerPosition();
        if (!p) return;
        setLines((v) => [...v, [p.x / scale, p.y / scale]]);
        setDrawing(true);
      }}
      onPointerMove={(e) => {
        if (!drawing) return;
        const p = e.target.getStage()?.getPointerPosition();
        if (!p) return;
        setLines((v) => [
          ...v.slice(0, -1),
          [...v[v.length - 1]!, p.x / scale, p.y / scale],
        ]);
      }}
      onPointerUp={() => {
        if (!drawing) return;
        setDrawing(false);
        const points = lines.at(-1) ?? [];
        if (points.length < 4) return;
        const xs = points.filter((_, i) => i % 2 === 0),
          ys = points.filter((_, i) => i % 2 === 1);
        const x = Math.max(0, Math.min(...xs) - 5),
          y = Math.max(0, Math.min(...ys) - 5);
        onFinish({
          x,
          y,
          width: Math.min(1000 - x, Math.max(12, Math.max(...xs) - x + 5)),
          height: Math.min(600 - y, Math.max(12, Math.max(...ys) - y + 5)),
        });
      }}
    >
      <Layer>
        {lines.map((points, i) => (
          <Line
            key={i}
            points={points}
            stroke="#dd855c"
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        ))}
      </Layer>
    </Stage>
  );
}
