"use client";

import { ArrowLeft, KeyRound, Mail } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const payload = await response.json();
    setMessage(payload.message ?? "请求已处理");
    setLoading(false);
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <Link className="back-link" href="/"><ArrowLeft size={16} /> 返回岗位库</Link>
        <div className="login-icon"><KeyRound size={26} /></div>
        <p className="eyebrow">PRIVATE WORKSPACE</p>
        <h1>求职者登录</h1>
        <p className="login-copy">登录后可跨设备同步收藏、投递状态、投递时间和私人备注。公开访客无法查看这些信息。</p>
        <form onSubmit={submit}>
          <label htmlFor="email">授权邮箱</label>
          <div className="input-with-icon">
            <Mail size={17} />
            <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="name@example.com" />
          </div>
          <button className="primary-button full-width" disabled={loading}>{loading ? "正在发送…" : "发送登录链接"}</button>
        </form>
        {message && <p className="form-message">{message}</p>}
      </section>
    </main>
  );
}
