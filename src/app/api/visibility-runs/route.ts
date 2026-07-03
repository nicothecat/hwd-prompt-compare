import { NextRequest, NextResponse } from "next/server";
import { db, brands, models, visibilityRuns, visibilityResponses, now } from "@/lib/db";
import { eq, asc } from "drizzle-orm";
import { queryModel } from "@/lib/openrouter";
import { buildClassifierPrompt, parseClassifierResponse } from "@/lib/visibility-classifier";

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.API_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    brandName?: string;
    brandDomain?: string;
    prompts?: string[];
    modelIds?: string[];
    classifierModelId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { brandName, brandDomain = "", prompts: promptList, modelIds, classifierModelId } = body;

  if (!brandName) {
    return NextResponse.json({ error: "brandName is required" }, { status: 400 });
  }
  if (!Array.isArray(promptList) || promptList.length < 1 || promptList.length > 100) {
    return NextResponse.json({ error: "prompts must be an array of 1–100 items" }, { status: 400 });
  }
  if (!Array.isArray(modelIds) || modelIds.length < 1 || modelIds.length > 4) {
    return NextResponse.json({ error: "modelIds must be an array of 1–4 items" }, { status: 400 });
  }

  // Find or create brand
  let brand = await db.query.brands.findFirst({ where: eq(brands.name, brandName) });
  if (!brand) {
    const [created] = await db.insert(brands).values({ name: brandName, domain: brandDomain || null }).returning();
    brand = created;
  }

  // Resolve classifier model (default = first active model by display name, cheapest proxy)
  let resolvedClassifierId = classifierModelId;
  if (!resolvedClassifierId) {
    const activeModels = await db.query.models.findMany({
      where: eq(models.isActive, true),
      orderBy: [asc(models.displayName)],
    });
    resolvedClassifierId = activeModels[0]?.id;
  }
  if (!resolvedClassifierId) {
    return NextResponse.json({ error: "No active models available for classification" }, { status: 422 });
  }

  // Validate all requested model IDs exist
  const requestedModels = await Promise.all(
    modelIds.map((id) => db.query.models.findFirst({ where: eq(models.id, id) }))
  );
  const missingModel = requestedModels.find((m) => !m);
  if (missingModel !== undefined) {
    return NextResponse.json({ error: "One or more modelIds not found" }, { status: 400 });
  }

  const classifierModel = await db.query.models.findFirst({ where: eq(models.id, resolvedClassifierId) });
  if (!classifierModel) {
    return NextResponse.json({ error: "classifierModelId not found" }, { status: 400 });
  }

  const expectedResponses = promptList.length * modelIds.length;

  // Create the run
  const [run] = await db
    .insert(visibilityRuns)
    .values({
      brandId: brand.id,
      promptCount: promptList.length,
      modelIds,
      status: "pending",
    })
    .returning();

  // Fire and forget background processing
  (async () => {
    try {
      await db.update(visibilityRuns).set({ status: "running", updatedAt: now() as string }).where(eq(visibilityRuns.id, run.id));

      let errorCount = 0;

      const pairs = promptList.flatMap((promptText, promptIndex) =>
        modelIds.map((modelId) => ({ promptText, promptIndex, modelId }))
      );

      const tasks = pairs.map(({ promptText, promptIndex, modelId }) => async () => {
        const model = requestedModels.find((m) => m!.id === modelId)!;

        try {
          const rawResponse = await queryModel(promptText, { openrouterId: model.openrouterId, displayName: model.displayName }, "web");

          // Call classifier
          const classifierPrompt = buildClassifierPrompt(promptText, rawResponse, brandName, brandDomain);
          let visible: boolean | null = null;
          let evidenceSentence: string | null = null;
          let classifierError: string | null = null;

          try {
            const classifierRaw = await queryModel(
              classifierPrompt,
              { openrouterId: classifierModel.openrouterId, displayName: classifierModel.displayName },
              "training",
            );
            const parsed = parseClassifierResponse(classifierRaw);
            if (parsed) {
              visible = parsed.visible;
              evidenceSentence = parsed.evidence || null;
            } else {
              classifierError = classifierRaw.slice(0, 500);
            }
          } catch (classErr: unknown) {
            classifierError = String(classErr instanceof Error ? classErr.message : classErr).slice(0, 500);
          }

          await db.insert(visibilityResponses).values({
            runId: run.id,
            promptText,
            promptIndex,
            modelId,
            rawResponse,
            visible,
            evidenceSentence,
            sourceUrls: null,
            classifierModelId: resolvedClassifierId,
            error: classifierError,
          });
        } catch (err: unknown) {
          errorCount++;
          await db.insert(visibilityResponses).values({
            runId: run.id,
            promptText,
            promptIndex,
            modelId,
            rawResponse: null,
            visible: null,
            evidenceSentence: null,
            sourceUrls: null,
            classifierModelId: resolvedClassifierId,
            error: String(err instanceof Error ? err.message : err).slice(0, 500),
          });
        }
      });

      await withConcurrency(tasks, 5);

      // Granular status: "completed" (no errors), "partial" (some jobs failed but
      // usable data exists), "failed" (nothing usable at all). A run should never
      // be labeled "failed" while it's still holding readable per-prompt results.
      const successCount = expectedResponses - errorCount;
      const finalStatus =
        successCount <= 0 ? "failed" : errorCount > 0 ? "partial" : "completed";
      await db.update(visibilityRuns).set({ status: finalStatus, updatedAt: now() as string }).where(eq(visibilityRuns.id, run.id));
    } catch (err) {
      console.error("Visibility run failed:", err);
      // Even on an unexpected crash, check whether any usable responses were
      // already persisted before marking the whole run a dead loss.
      let status: "failed" | "partial" = "failed";
      try {
        const existing = await db.query.visibilityResponses.findMany({
          where: eq(visibilityResponses.runId, run.id),
        });
        if (existing.some((r) => r.error === null)) {
          status = "partial";
        }
      } catch {
        // fall through with "failed"
      }
      await db.update(visibilityRuns).set({ status, updatedAt: now() as string }).where(eq(visibilityRuns.id, run.id));
    }
  })();

  return NextResponse.json({ runId: run.id, status: "pending", expectedResponses });
}
