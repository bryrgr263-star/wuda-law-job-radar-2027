import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ email: z.string().email() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "请输入有效邮箱地址。" }, { status: 400 });

  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail || parsed.data.email.trim().toLowerCase() !== ownerEmail) {
    return NextResponse.json({ message: "该邮箱未获得求职进度管理权限。" }, { status: 403 });
  }

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ message: "网站尚未连接登录服务。" }, { status: 503 });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${siteUrl}/auth/callback`, shouldCreateUser: true }
  });
  if (error) return NextResponse.json({ message: "登录邮件发送失败，请稍后重试。" }, { status: 500 });
  return NextResponse.json({ message: "登录链接已发送，请检查邮箱。" });
}
