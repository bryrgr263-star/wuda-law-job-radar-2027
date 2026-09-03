import { handlePreviewApiRequest } from "@/lib/p2-08-preview/read-only-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handlePreviewApiRequest(request);
}
