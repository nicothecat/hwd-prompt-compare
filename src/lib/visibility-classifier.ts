export function buildClassifierPrompt(
  promptText: string,
  rawResponse: string,
  brandName: string,
  brandDomain: string,
): string {
  return `Question for the model: "${promptText}"
Model's answer: "${rawResponse}"

Does the model's answer mention or describe "${brandName}" (or its domain ${brandDomain})? Reply ONLY in this JSON format, no prose:
{"visible": true|false, "evidence": "<exact sentence from the answer that mentions the brand, or empty string>"}`;
}

export function parseClassifierResponse(
  raw: string,
): { visible: boolean; evidence: string } | null {
  try {
    const match = raw.match(/\{[\s\S]*?"visible"[\s\S]*?\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.visible !== "boolean") return null;
    return { visible: parsed.visible, evidence: String(parsed.evidence ?? "") };
  } catch {
    return null;
  }
}
