import { db, models, prompts } from "./db";
import { eq } from "drizzle-orm";

function launchDate(dateStr: string) {
  // SQLite stores dates as ISO strings.
  return dateStr;
}

const DEFAULT_MODELS = [
  {
    openrouterId: "openai/gpt-5",
    displayName: "GPT 5 (Fast)",
    provider: "openai",
    launchDate: launchDate("2026-01-15"),
    isActive: true,
  },
  {
    openrouterId: "openai/o3",
    displayName: "GPT 5 (Thinking)",
    provider: "openai",
    launchDate: launchDate("2026-01-15"),
    isActive: true,
  },
  {
    openrouterId: "anthropic/claude-opus-4-7",
    displayName: "Claude Opus 4.7",
    provider: "anthropic",
    launchDate: launchDate("2026-04-01"),
    isActive: true,
  },
  {
    openrouterId: "anthropic/claude-sonnet-4.6",
    displayName: "Claude Sonnet 4.6",
    provider: "anthropic",
    launchDate: launchDate("2026-02-01"),
    isActive: true,
  },
  {
    openrouterId: "google/gemini-3.1-flash-preview",
    displayName: "Gemini 3.1 (Fast)",
    provider: "google",
    launchDate: launchDate("2026-03-01"),
    isActive: true,
  },
  {
    openrouterId: "google/gemini-3.1-pro-preview",
    displayName: "Gemini 3.1 (Thinking)",
    provider: "google",
    launchDate: launchDate("2026-03-01"),
    isActive: true,
  },
];

const STARTER_PROMPTS = [
  {
    name: "Best SEO Agencies",
    templateText: `I'm a marketing manager looking for an SEO agency. What are the best SEO agencies right now? Give me a ranked list with pros and cons for each, what it's like to work with them, and include sources and links.`,
    isTemplate: true,
  },
  {
    name: "Top AI Tools for Marketing",
    templateText: `What are the best AI tools for marketing teams in 2025? Include a comparison of features, pricing, and use cases. Cite your sources with links.`,
    isTemplate: true,
  },
  {
    name: "B2B SaaS CRM Recommendations",
    templateText: `I'm choosing a CRM for a mid-market B2B SaaS company with a 20-person sales team. What are the top options, what are the tradeoffs, and which would you recommend? Back up your answer with sources and links.`,
    isTemplate: true,
  },
  {
    name: "Brand Visibility Audit",
    templateText: `Tell me everything you know about [your brand name]. How visible are they in AI-generated recommendations? Where do they show up strong and where are they missing? Include sources with links.`,
    isTemplate: true,
  },
];

export async function seedDatabase() {
  // Deactivate all models not in the current default list
  const activeIds = DEFAULT_MODELS.map((m) => m.openrouterId);
  const allModels = await db.query.models.findMany();
  for (const m of allModels) {
    if (!activeIds.includes(m.openrouterId)) {
      await db.update(models).set({ isActive: false }).where(eq(models.openrouterId, m.openrouterId));
    }
  }
  // Ensure active models in list are marked active
  for (const m of DEFAULT_MODELS) {
    await db.update(models).set({ isActive: true }).where(eq(models.openrouterId, m.openrouterId));
  }

  // Seed models (skip existing)
  for (const model of DEFAULT_MODELS) {
    await db
      .insert(models)
      .values(model)
      .onConflictDoNothing();
  }

  // Seed prompts (only if no prompts exist)
  const existingPrompts = await db.query.prompts.findMany({ limit: 1 });
  if (existingPrompts.length === 0) {
    await db.insert(prompts).values(STARTER_PROMPTS);
  }

  return {
    models: DEFAULT_MODELS.length,
    prompts: STARTER_PROMPTS.length,
  };
}
