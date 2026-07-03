import { NextRequest, NextResponse } from "next/server";
import {
  db,
  runs,
  runBrands,
  brands,
  responses,
  parsedComparisons,
  sources,
  conceptScores,
  models,
  now,
} from "@/lib/db";
import { eq, desc, inArray } from "drizzle-orm";
import { queryAllModels } from "@/lib/openrouter";
import { extractComparison } from "@/lib/extraction";
import { verifyUrls } from "@/lib/source-verification";
import { aggregateScores } from "@/lib/scoring";

// GET /api/runs - List recent runs
export async function GET() {
  try {
    const allRuns = await db.query.runs.findMany({
      orderBy: [desc(runs.createdAt)],
      limit: 50,
      with: {
        runBrands: {
          with: { brand: true },
          orderBy: (rb: any, { asc }: any) => [asc(rb.position)],
        },
      },
    });
    return NextResponse.json(allRuns);
  } catch (error) {
    console.error("Error fetching runs:", error);
    return NextResponse.json(
      { error: "Failed to fetch runs" },
      { status: 500 }
    );
  }
}

// POST /api/runs - Trigger a new comparison run
export async function POST(request: NextRequest) {
  // Hoisted so the catch block can still update / report on the run if the
  // pipeline fails partway through (previously a mid-pipeline error left the
  // run stuck at status "running" forever with no diagnosable error body).
  let run: typeof runs.$inferSelect | undefined;

  try {
    const body = await request.json();
    const {
      promptText,
      promptId,
      brandNames,
      modelModes,
      selectedConcepts,
    }: {
      promptText: string;
      promptId?: string;
      brandNames: string[];
      modelModes?: Record<string, { training: boolean; web: boolean }>;
      selectedConcepts?: string[];
    } = body;

    if (!promptText || !brandNames || brandNames.length < 2 || brandNames.length > 5) {
      return NextResponse.json(
        { error: "promptText and 2-5 brandNames are required" },
        { status: 400 }
      );
    }

    // 1. Get models - either from modelModes selection or all active
    let activeModels: (typeof models.$inferSelect)[];
    if (modelModes && Object.keys(modelModes).length > 0) {
      const modelIds = Object.entries(modelModes)
        .filter(([, modes]) => modes.training || modes.web)
        .map(([id]) => id);
      if (modelIds.length > 0) {
        activeModels = await db.query.models.findMany({
          where: inArray(models.id, modelIds),
        });
      } else {
        activeModels = [];
      }
    } else {
      activeModels = await db.query.models.findMany({
        where: eq(models.isActive, true),
      });
    }

    if (activeModels.length === 0) {
      return NextResponse.json(
        { error: "No models selected. Pick at least one model." },
        { status: 400 }
      );
    }

    // Determine which modes to run per model
    const runTraining = modelModes
      ? activeModels.filter((m) => modelModes[m.id]?.training)
      : activeModels;
    const runWeb = modelModes
      ? activeModels.filter((m) => modelModes[m.id]?.web)
      : activeModels;

    // 2. Create or find brands
    const brandRecords = await Promise.all(
      brandNames.map(async (name) => {
        const existing = await db.query.brands.findFirst({
          where: eq(brands.name, name),
        });
        if (existing) return existing;
        const [created] = await db
          .insert(brands)
          .values({ name })
          .returning();
        return created;
      })
    );

    // 3. Snapshot models used
    const modelsSnapshot = activeModels.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      provider: m.provider || "unknown",
      launchDate: m.launchDate || null,
    }));

    // 4. Create the run
    [run] = await db
      .insert(runs)
      .values({
        promptText,
        promptId: promptId || null,
        status: "running",
        modelsUsed: modelsSnapshot,
      })
      .returning();

    if (!run) {
      throw new Error("Failed to create run record");
    }
    // Narrow to a non-undefined local for the rest of the pipeline — `run`
    // stays a `let` (mutable, closed over by callbacks below) so TS can't
    // otherwise carry the narrowing across those closures.
    const createdRun = run;

    // 5. Link brands to run
    await db.insert(runBrands).values(
      brandRecords.map((brand, i) => ({
        runId: createdRun.id,
        brandId: brand.id,
        position: i + 1,
      }))
    );

    // 6. Query selected models in their selected modes (parallel)
    const trainingConfigs = runTraining.map((m) => ({
      openrouterId: m.openrouterId,
      displayName: m.displayName,
    }));
    const webConfigs = runWeb.map((m) => ({
      openrouterId: m.openrouterId,
      displayName: m.displayName,
    }));

    const promises: Promise<Awaited<ReturnType<typeof queryAllModels>>>[] = [];
    if (trainingConfigs.length > 0) promises.push(queryAllModels(promptText, trainingConfigs, "training"));
    if (webConfigs.length > 0) promises.push(queryAllModels(promptText, webConfigs, "web"));

    const results = await Promise.all(promises);
    const allModelResults = results.flat();
    const modelFailures = allModelResults.filter((r) => r.error).length;

    // 7. Store responses with mode
    const responseRecords: Array<{ id: string; rawText: string; mode: string; modelId: string }> = [];
    for (const result of allModelResults) {
      if (result.error || !result.text) continue;

      const model = activeModels.find(
        (m) => m.openrouterId === result.model.openrouterId
      );
      if (!model) continue;

      const [responseRecord] = await db
        .insert(responses)
        .values({
          runId: createdRun.id,
          modelId: model.id,
          rawText: result.text,
          mode: result.mode,
        })
        .returning();

      responseRecords.push({ ...responseRecord, modelId: model.id });
    }

    // 8. Extract structured data from each response (parallel).
    // Each extraction call hits an external API and can fail independently
    // (rate limit, timeout, malformed output). Previously this used a bare
    // Promise.all, so a single failed extraction rejected the whole batch and
    // crashed the entire multi-brand run with a bare 500 — even though every
    // other response had already been fetched successfully. Isolate failures
    // per-response instead so one bad call degrades gracefully rather than
    // taking down the run.
    const brandNamesList = brandRecords.map((b) => b.name);
    let extractionFailures = 0;
    const allExtractions = await Promise.all(
      responseRecords.map(async (r) => {
        try {
          return await extractComparison(r.rawText, brandNamesList, selectedConcepts);
        } catch (err) {
          extractionFailures++;
          console.error(`Extraction failed for response ${r.id}:`, err);
          return { brands: [], sources: [], conceptScores: [] };
        }
      })
    );

    // 9. Store parsed comparisons and sources
    const allSourceUrls: string[] = [];

    for (let i = 0; i < allExtractions.length; i++) {
      const extraction = allExtractions[i];
      const responseId = responseRecords[i].id;
      const responseMode = responseRecords[i].mode;

      // Store parsed comparisons with conceptEvidence
      for (const brandData of extraction.brands) {
        const brandRecord = brandRecords.find(
          (b) => b.name.toLowerCase() === brandData.brandName.toLowerCase()
        );
        if (!brandRecord) continue;

        await db.insert(parsedComparisons).values({
          responseId,
          brandId: brandRecord.id,
          pros: brandData.pros,
          cons: brandData.cons,
          strengths: brandData.strengths,
          weaknesses: brandData.weaknesses,
          conceptEvidence: brandData.conceptEvidence || {},
        });
      }

      // Store sources only for web mode responses
      if (responseMode === "web") {
        for (const source of extraction.sources) {
          if (!source.url || !source.url.startsWith("http")) continue;

          const brandRecord = source.brandName
            ? brandRecords.find(
                (b) =>
                  b.name.toLowerCase() === source.brandName!.toLowerCase()
              )
            : null;

          await db.insert(sources).values({
            responseId,
            brandId: brandRecord?.id || null,
            url: source.url,
            title: source.title || null,
            isVerified: null,
          });

          allSourceUrls.push(source.url);
        }
      }
    }

    // 10. Verify source URLs in parallel (web mode only)
    if (allSourceUrls.length > 0) {
      const verifications = await verifyUrls(allSourceUrls);
      const verificationMap = new Map(
        verifications.map((v) => [v.url, v.isVerified])
      );

      for (const responseRecord of responseRecords) {
        if (responseRecord.mode !== "web") continue;
        const responseSources = await db.query.sources.findMany({
          where: eq(sources.responseId, responseRecord.id),
        });
        for (const source of responseSources) {
          const isVerified = verificationMap.get(source.url) ?? false;
          await db
            .update(sources)
            .set({ isVerified, verifiedAt: now() })
            .where(eq(sources.id, source.id));
        }
      }
    }

    // 11. Aggregate and store concept scores per mode
    for (const mode of ["training", "web"] as const) {
      const modeExtractions = allExtractions.filter(
        (_, i) => responseRecords[i].mode === mode
      );
      const modeConceptScores = modeExtractions.map((e) => e.conceptScores);
      const aggregated = aggregateScores(modeConceptScores);

      for (const score of aggregated) {
        const brandRecord = brandRecords.find(
          (b) => b.name.toLowerCase() === score.brandName.toLowerCase()
        );
        if (!brandRecord) continue;

        await db.insert(conceptScores).values({
          runId: createdRun.id,
          brandId: brandRecord.id,
          conceptName: score.conceptName,
          score: score.score,
          mode,
        });
      }
    }

    // 12. Determine final status — granular, not just completed/failed:
    //   - "failed": nothing usable came out of the run (no responses stored)
    //   - "partial": some model calls or extractions failed, but usable
    //     per-prompt data exists for the rest (previously this case was
    //     mislabeled "failed" even when results were fully readable)
    //   - "completed": everything succeeded
    const hasAnyData = responseRecords.length > 0;
    const hasErrors = modelFailures > 0 || extractionFailures > 0;
    const finalStatus: "completed" | "partial" | "failed" = !hasAnyData
      ? "failed"
      : hasErrors
        ? "partial"
        : "completed";

    await db
      .update(runs)
      .set({ status: finalStatus, completedAt: now() })
      .where(eq(runs.id, createdRun.id));

    return NextResponse.json({
      runId: createdRun.id,
      status: finalStatus,
      responsesCount: responseRecords.length,
      brandsCompared: brandNamesList,
      ...(hasErrors ? { errors: { modelFailures, extractionFailures } } : {}),
    });
  } catch (error) {
    console.error("Error running comparison:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    // Stack-safe detail: name + message only, never the raw stack trace to
    // the client. Full stack still goes to the server console above.
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    // A run row may already exist (created in step 4) even though the
    // pipeline crashed later — don't leave it stuck at "running" forever.
    if (run?.id) {
      try {
        await db
          .update(runs)
          .set({ status: "failed", completedAt: now() })
          .where(eq(runs.id, run.id));
      } catch (updateErr) {
        console.error("Failed to mark run as failed after error:", updateErr);
      }
    }

    return NextResponse.json(
      {
        error: "Failed to run comparison",
        message,
        detail,
        runId: run?.id ?? null,
      },
      { status: 500 }
    );
  }
}
