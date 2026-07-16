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
  brandName?: string,
  brandDomain?: string,
  originalResponse?: string,
): { visible: boolean; evidence: string } | null {
  // First: simple text match as a safety net
  if (brandName && originalResponse) {
    const lowerResponse = originalResponse.toLowerCase();
    const lowerBrand = brandName.toLowerCase();
    const lowerDomain = brandDomain?.toLowerCase() || "";

    if (lowerResponse.includes(lowerBrand) || (lowerDomain && lowerResponse.includes(lowerDomain))) {
      // Brand IS in the text — find the sentence containing it
      const sentences = originalResponse.split(/(?<=[.!?])\s+/);
      const matchSentence = sentences.find(
        (s) => s.toLowerCase().includes(lowerBrand) || (lowerDomain && s.toLowerCase().includes(lowerDomain))
      );
      return { visible: true, evidence: matchSentence || brandName };
    }
  }

  // Fall back to LLM classifier response
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
