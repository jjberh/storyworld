import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Line, Image as CanvasImage } from "react-konva";
import { captureDrawing } from "./drawing-image";
import type { DrawingData } from "@storyworld/contracts";
import type { Bounds } from "@storyworld/contracts/model";
export function DrawingCanvas({
  width,
  onFinish,
  disabled,
  reference,
  onChange,
  onStart,
  onCancel,
  referenceOpacity = 0.35,
}: {
  width: number;
  onFinish: (bounds: Bounds, image: string) => void;
  disabled: boolean;
  reference?: string;
  onChange?: (drawing: DrawingData) => void;
  /** A stroke has begun. */
  onStart?: () => void;
  /** A stroke ended too short to keep (a tap). */
  onCancel?: () => void;
  referenceOpacity?: number;
}) {
  const [lines, setLines] = useState<number[][]>([]);
  const [drawing, setDrawing] = useState(false);
  const strokes = useRef<number[][]>([]);
  const [referenceImage, setReferenceImage] = useState<HTMLImageElement>();
  useEffect(() => {
    setReferenceImage(undefined);
    if (!reference) return;
    const image = new window.Image();
    image.onload = () => setReferenceImage(image);
    image.src = reference;
    return () => {
      image.onload = null;
    };
  }, [reference]);
  const scale = width / 1000;
  // Mirrors `drawing` for handlers that run outside React's render.
  const drawingRef = useRef(false);
  // Ends the stroke in progress once, however the pointer lets go.
  const endStroke = useRef(() => {});
  endStroke.current = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setDrawing(false);
    const points = strokes.current.at(-1) ?? [];
    if (points.length < 4) {
      strokes.current = strokes.current.slice(0, -1);
      setLines(strokes.current);
      onCancel?.();
      return;
    }
    const xs = points.filter((_, i) => i % 2 === 0),
      ys = points.filter((_, i) => i % 2 === 1);
    const x = Math.max(0, Math.min(...xs) - 5),
      y = Math.max(0, Math.min(...ys) - 5);
    const compositeImage = captureDrawing(strokes.current, referenceImage);
    onChange?.({ strokes: strokes.current, compositeImage });
    onFinish(
      {
        x,
        y,
        width: Math.min(1000 - x, Math.max(12, Math.max(...xs) - x + 5)),
        height: Math.min(600 - y, Math.max(12, Math.max(...ys) - y + 5)),
      },
      compositeImage,
    );
  };
  // A stroke that ends outside the stage, or that the browser cancels,
  // still finishes (or is dropped) so the page never waits on it.
  useEffect(() => {
    if (!drawing) return;
    const end = () => endStroke.current();
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [drawing]);
  return (
    <div
      className={
        disabled ? "drawing-stage drawing-stage--disabled" : "drawing-stage"
      }
    >
      <Stage
        width={width}
        height={width * 0.6}
        scaleX={scale}
        scaleY={scale}
        onPointerDown={(e) => {
          if (disabled || (reference && !referenceImage)) return;
          const p = e.target.getStage()?.getPointerPosition();
          if (!p) return;
          strokes.current = [
            ...strokes.current,
            [
              Math.min(999, Math.max(0, p.x / scale)),
              Math.min(599, Math.max(0, p.y / scale)),
            ],
          ];
          setLines(strokes.current);
          drawingRef.current = true;
          setDrawing(true);
          onStart?.();
        }}
        onPointerMove={(e) => {
          if (!drawing) return;
          const p = e.target.getStage()?.getPointerPosition();
          if (!p) return;
          strokes.current = [
            ...strokes.current.slice(0, -1),
            [
              ...strokes.current.at(-1)!,
              Math.min(999, Math.max(0, p.x / scale)),
              Math.min(599, Math.max(0, p.y / scale)),
            ],
          ];
          setLines(strokes.current);
        }}
        onPointerUp={() => endStroke.current()}
      >
        <Layer>
          {referenceImage && (
            <CanvasImage
              image={referenceImage}
              width={1000}
              height={600}
              opacity={referenceOpacity}
              listening={false}
            />
          )}
        </Layer>
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
    </div>
  );
}
