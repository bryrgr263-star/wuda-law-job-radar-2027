import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  job_id: z.string().min(1).max(160),
  status: z.enum(["未投递", "准备中", "已投递", "已结束"]),
  favorite: z.boolean(),
  notes: z.string().max(2000),
  applied_at: z.string().datetime().nullable()
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "进度数据格式错误。" }, { status: 400 });

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ message: "数据库尚未连接。" }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ message: "请先登录。" }, { status: 401 });

  const { error } = await supabase.from("applications").upsert({
    user_id: authData.user.id,
    ...parsed.data,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id,job_id" });
  if (error) return NextResponse.json({ message: "保存失败，请稍后重试。" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
