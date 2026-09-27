"use client";

import React, { useEffect, useState } from "react";
import { JobBoard } from "./job-board";
import { loadPublicPresentationBoard } from "../lib/presentation-web/public-loader";

export function PublicPresentationBoard(props: {
  readonly snapshotUrl: string; readonly authoritativeSha: string; readonly snapshotHash: string;
}) {
  const [board, setBoard] = useState<Awaited<ReturnType<typeof loadPublicPresentationBoard>> | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    loadPublicPresentationBoard({ snapshot_url: props.snapshotUrl, expected_sha: props.authoritativeSha,
      expected_payload_hash: props.snapshotHash }).then(value => { if (active) setBoard(value); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [props.snapshotUrl, props.authoritativeSha, props.snapshotHash, attempt]);
  return <>
    <section role="status" className="presentation-board">
      {error && <p role="alert">公开岗位数据校验失败/暂不可用。{board ? "更新失败，当前仍为下方已验证版本。" : "未加载任何岗位数据。"}</p>}
      {!board && !error && <p>正在校验公开岗位数据…</p>}
      {error && <button onClick={() => setAttempt(value => value + 1)}>重试公开数据读取</button>}
      <details><summary>公开数据版本</summary><p>Authoritative SHA：{board?.authoritative_sha ?? props.authoritativeSha}</p>
        <p>Snapshot SHA-256：{board?.snapshot_hash ?? props.snapshotHash}</p>
        <p>生成时间：{board?.generated_at ?? "尚未校验"}</p><p>SHA-256 为完整性校验，不是数字签名。</p></details>
    </section>
    {board && <JobBoard key={board.snapshot_hash} initialJobs={board.jobs} />}
  </>;
}
