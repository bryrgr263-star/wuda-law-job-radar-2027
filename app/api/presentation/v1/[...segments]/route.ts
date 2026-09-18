import { composeReadOnlyPresentationApi } from "@/lib/presentation-read-api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const databaseUrl = process.env.TRUSTED_CHAIN_DATABASE_READER_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: "presentation_read_model_unavailable" }, { status: 503 });
  }
  const runtime = composeReadOnlyPresentationApi(databaseUrl);
  try {
    return await runtime.api.handle(request);
  } finally {
    await runtime.close();
  }
}
