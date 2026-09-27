import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.PRESENTATION_WEB_PREPARATION === "ENABLED") {
    const { composeGitReadOnlyPresentationApi } = await import("@/lib/presentation-read-api/git-runtime");
    try {
      return await composeGitReadOnlyPresentationApi(process.cwd(),
        process.env.PRODUCTION_STREAM_ID ?? "initial-production-source-activation").handle(request);
    } catch {
      return NextResponse.json({ error: "presentation_read_model_unavailable" }, { status: 503 });
    }
  }
  const databaseUrl = process.env.TRUSTED_CHAIN_DATABASE_READER_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: "presentation_read_model_unavailable" }, { status: 503 });
  }
  const { composeReadOnlyPresentationApi } = await import("@/lib/presentation-read-api/runtime");
  const runtime = composeReadOnlyPresentationApi(databaseUrl);
  try {
    return await runtime.api.handle(request);
  } finally {
    await runtime.close();
  }
}
