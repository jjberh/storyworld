import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SceneDraft, StoryDocument } from "@storyworld/contracts";
import type { Bounds } from "@storyworld/contracts/model";
import paintbrushIcon from "../assets/figma/paintbrush.svg";
import scribblesImage from "../assets/figma/scribbles.svg";
import sunIcon from "../assets/figma/sun.svg";
import { DrawingCanvas } from "../features/canvas/DrawingCanvas";
import {
  createBlankDrawing,
  readDrawing,
} from "../features/canvas/drawing-image";
import { interpretScene } from "../services/intelligence-client";
import { SceneConfirmation } from "./SceneConfirmation";

type Phase = "choice" | "authoring" | "reading" | "error" | "ready";

function newDocument(sourceImage: string): StoryDocument {
  return {
    sourceImage,
    drawing: { strokes: [], compositeImage: sourceImage },
  };
}

function StoryworldHeader({ action }: { action?: ReactNode }) {
  return (
    <header>
      <div className="brand">
        <span className="brand-mark">
          <img src={paintbrushIcon} alt="" />
        </span>
        <span className="brand-name">Storyworld</span>
        <span>A little drawing. A whole world.</span>
      </div>
      {action && <div className="status">{action}</div>}
    </header>
  );
}

export function InitialAuthoring() {
  const [phase, setPhase] = useState<Phase>("choice");
  const [draft, setDraft] = useState<SceneDraft>();
  const [error, setError] = useState("");
  const [submittedDocument, setSubmittedDocument] = useState<StoryDocument>();
  const [interpretationKey, setInterpretationKey] = useState(0);
  const [creationLocked, setCreationLocked] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(1000);

  useEffect(() => {
    if (!canvasHost.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setCanvasWidth(entry!.contentRect.width),
    );
    observer.observe(canvasHost.current);
    return () => observer.disconnect();
  }, [phase]);

  function begin(sourceImage: string) {
    setDraft({ document: newDocument(sourceImage) });
    setError("");
    setPhase("authoring");
  }

  async function selectUpload(file?: File) {
    if (!file) return;
    try {
      begin(await readDrawing(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function bringWorldToLife() {
    if (!draft) return;
    setPhase("reading");
    setError("");
    try {
      const interpretation = await interpretScene({
        image: draft.document.drawing.compositeImage,
        transcript: draft.document.description || undefined,
      });
      setDraft((current) =>
        current ? { ...current, interpretation } : current,
      );
      setSubmittedDocument(structuredClone(draft.document));
      setInterpretationKey((key) => key + 1);
      setPhase("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPhase("error");
    }
  }

  if (phase === "choice")
    return (
      <main className="shell starter-shell">
        <StoryworldHeader />
        <section className="intro starter-intro" aria-labelledby="start-title">
          <img className="starter-scribble" src={scribblesImage} alt="" />
          <img className="starter-sun" src={sunIcon} alt="" />
          <p className="eyebrow">YOUR STORY BEGINS HERE</p>
          <h1 id="start-title">
            Make a little drawing.
            <br />
            <em>Begin a whole world.</em>
          </h1>
          <p>Start a new picture, or bring in one you have already made.</p>
        </section>
        <section className="starter-choices" aria-label="Choose how to start">
          <button
            className="starter-choice"
            onClick={() => begin(createBlankDrawing())}
          >
            <strong>Start from scratch</strong>
            <span>Make your first mark on a blank page.</span>
          </button>
          <button
            className="starter-choice"
            onClick={() => upload.current?.click()}
          >
            <strong>Upload a drawing</strong>
            <span>Begin with a picture you have already made.</span>
          </button>
          <input
            ref={upload}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void selectUpload(file);
            }}
          />
        </section>
        {error && (
          <p role="alert" className="starter-error">
            {error}
          </p>
        )}
      </main>
    );

  if (!draft) return null;
  const busy = phase === "reading" || creationLocked;
  const strokeCount = draft.document.drawing.strokes.length;
  const hasStaleInterpretation =
    !!submittedDocument &&
    JSON.stringify(submittedDocument) !== JSON.stringify(draft.document);
  return (
    <main className="shell">
      <StoryworldHeader
        action={
          <button
            className="quiet choose-another"
            disabled={busy}
            onClick={() => setPhase("choice")}
          >
            Choose another drawing
          </button>
        }
      />
      <section className="intro">
        <div>
          <p className="eyebrow">YOUR STORY BEGINS HERE</p>
          <h1>
            Every line opens
            <br />
            <em>a possibility.</em>
          </h1>
          <p>
            Draw your world, then tell us what happens there. We will find the
            characters, places, and important things in your picture.
          </p>
        </div>
      </section>
      <section className="workspace" aria-labelledby="canvas-title">
        <div className="paper-column">
          <div className="drawing-intro">
            <h2 id="canvas-title">Tell your story what happens next.</h2>
            <p>
              Draw on the page, then add your own words below. Your picture is
              the beginning of this world.
            </p>
          </div>
          <div className="canvas-tools">
            <span className="tool-chip authoring-tool-chip">
              <img src={paintbrushIcon} alt="" /> Drawing layer
            </span>
            <span className="world-status">
              {strokeCount === 0
                ? "Your canvas is ready"
                : `${strokeCount} ${strokeCount === 1 ? "mark" : "marks"} on the page`}
            </span>
          </div>
          <div className="authoring-paper-wrap" ref={canvasHost}>
            <img className="authoring-scribble" src={scribblesImage} alt="" />
            <img className="authoring-sun" src={sunIcon} alt="" />
            {draft.interpretation && submittedDocument ? (
              <SceneConfirmation
                key={interpretationKey}
                document={submittedDocument}
                interpretation={draft.interpretation}
                stale={phase === "reading" || hasStaleInterpretation}
                onLocked={setCreationLocked}
              />
            ) : (
              <div className="paper authoring-paper">
                <div className="drawing-layer">
                  <DrawingCanvas
                    width={canvasWidth}
                    disabled={busy}
                    reference={draft.document.sourceImage}
                    referenceOpacity={1}
                    onFinish={(_bounds: Bounds, _image: string) => undefined}
                    onChange={(drawing) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              document: { ...current.document, drawing },
                            }
                          : current,
                      )
                    }
                  />
                </div>
              </div>
            )}
          </div>
          <div className="narration">
            <label htmlFor="description">What happens in your story?</label>
            <textarea
              id="description"
              value={draft.document.description ?? ""}
              placeholder="Tell us about your picture (optional)"
              maxLength={2000}
              disabled={busy}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        document: {
                          ...current.document,
                          description: event.target.value || undefined,
                        },
                      }
                    : current,
                )
              }
            />
            <small>
              Use your own words. You can keep drawing whenever you want.
            </small>
          </div>
        </div>
        <aside>
          <div className="room-card">
            <h2>Your Story</h2>
            <strong>
              {strokeCount === 0
                ? "A new world starts here"
                : "Your drawing is ready to grow"}
            </strong>
            <button
              className="primary-action"
              disabled={busy}
              onClick={() => setPhase("choice")}
            >
              Choose another drawing
            </button>
          </div>
          <div className="proposals-card authoring-action-card">
            <h2>The World Listens</h2>
            <p className="card-help">
              Storyworld uses your picture and words to find the beginning of
              your story.
            </p>
            {phase === "reading" && (
              <p className="drawing-status" role="status">
                Finding the characters and places in your world…
              </p>
            )}
            {error && (
              <p role="alert" className="authoring-error">
                {error}
              </p>
            )}
            {phase === "ready" && !hasStaleInterpretation ? (
              <p className="draft-ready" role="status">
                I found some parts of your picture. Check them right on the
                page.
              </p>
            ) : (
              <button
                className="primary-action"
                disabled={busy}
                onClick={() => void bringWorldToLife()}
              >
                {creationLocked
                  ? "Scene submitted"
                  : busy
                    ? "Finding your world…"
                    : phase === "error"
                      ? "Try bringing it to life again"
                      : "Bring my world to life"}
              </button>
            )}
          </div>
          <div className="moments-card authoring-moments-card">
            <h2>Story Moments</h2>
            <div className="timeline-item" aria-live="polite">
              <i />
              <span>
                <strong>
                  {phase === "ready"
                    ? "A world is ready to meet you"
                    : "Your picture is the first moment"}
                </strong>
                <small>
                  {phase === "ready"
                    ? "Check what Storyworld found on your picture"
                    : "Draw and describe what happens next"}
                </small>
              </span>
            </div>
          </div>
        </aside>
      </section>
      <footer>
        <span>Built for small imaginations with big ideas.</span>
        <span>Your drawing stays yours while Storyworld listens.</span>
      </footer>
    </main>
  );
}
