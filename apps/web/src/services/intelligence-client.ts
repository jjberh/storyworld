import {
  interpretationOutput,
  type InterpretationInput,
} from "@storyworld/contracts";
export async function interpretEdit(input: InterpretationInput) {
  const response = await fetch("/api/interpret/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      "Interpretation unavailable. Your drawing is preserved; try again.",
    );
  return interpretationOutput.parse(await response.json());
}
