import type { DoctorReport } from "./service";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s (${ms} ms)`;
}

export function formatProbeHuman(payload: Record<string, unknown>): string {
  const lines: string[] = [];
  const kind = String(payload.kind);
  lines.push(`Kind:     ${kind}`);
  lines.push(`Path:     ${String(payload.path)}`);

  if (kind === "audio") {
    lines.push(`Format:   ${String(payload.format)}`);
    lines.push(`Duration: ${formatMs(Number(payload.duration_ms))}`);
    if (payload.analysis_truncated) {
      lines.push(`Analyzed: first ${formatMs(Number(payload.analyzed_duration_ms))} (truncated)`);
    }
    lines.push(`Audio:    ${String(payload.sample_rate)} Hz, ${String(payload.channels)} ch`);
    lines.push(`Peak:     ${String(payload.peak_level)}  |  Leading silence: ${formatMs(Number(payload.leading_silence_ms))}`);
    lines.push(`Import:   ${payload.within_import_limit ? "within 3 min limit" : "EXCEEDS 3 min import limit"}`);
    const windows = payload.loudest_window as Record<string, { start_ms: number; end_ms: number }> | undefined;
    if (windows) {
      for (const [label, win] of Object.entries(windows)) {
        lines.push(`Loudest ${label}: ${win.start_ms}..${win.end_ms} ms`);
      }
    }
    return lines.join("\n");
  }

  if (kind === "project") {
    lines.push(`Name:     ${String(payload.name)}`);
    lines.push(`Profile:  ${String(payload.profile)}`);
    const sticker = payload.sticker as Record<string, unknown> | undefined;
    if (sticker) {
      lines.push(
        `Sticker:  ${String(sticker.source_name)} (${String(sticker.format)}, ${String(sticker.width)}x${String(sticker.height)}, crop ${String(sticker.crop_x)},${String(sticker.crop_y)})`
      );
    }
    const audio = payload.audio as Record<string, unknown> | undefined;
    if (audio) {
      const trim = audio.trim as { start_ms: number; end_ms: number } | undefined;
      const trimText = trim ? `, trim ${trim.start_ms}..${trim.end_ms} ms, vol ${String(audio.volume)}` : "";
      lines.push(`Audio:    ${String(audio.source_name)} (${String(audio.format)}, ${formatMs(Number(audio.duration_ms))}${trimText})`);
    }
    return lines.join("\n");
  }

  lines.push(`Format:   ${String(payload.format)}`);
  lines.push(`Size:     ${String(payload.width)}x${String(payload.height)} -> ${String(payload.output_px)} square`);
  lines.push(`Alpha:    ${payload.has_alpha ? "yes" : "no"}  |  Animated: ${payload.animated ? "yes" : "no"}`);
  if (payload.duration_ms !== undefined) {
    lines.push(`Duration: ${formatMs(Number(payload.duration_ms))}`);
  }
  if (payload.has_sound !== undefined) {
    lines.push(`Sound:    ${payload.has_sound ? "yes (embedded track)" : "no"}`);
  }
  lines.push(`WebP:     ${payload.static_webp_supported ? "supported (static)" : "not supported (animated)"}`);
  return lines.join("\n");
}

export function formatExportHuman(payload: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`Output:   ${String(payload.output_path)}`);
  lines.push(`Profile:  ${String(payload.profile)} (${String(payload.mime_type)})`);
  lines.push(`Size:     ${formatBytes(Number(payload.size_bytes))}  |  Frame: ${String(payload.output_px)}`);
  if (payload.duration_ms !== undefined) {
    lines.push(`Duration: ${formatMs(Number(payload.duration_ms))}`);
  }
  const audio = payload.audio as
    | { source: string; source_name: string; trim: { start_ms: number; end_ms: number }; volume: number }
    | undefined;
  if (audio) {
    lines.push(
      `Audio:    ${audio.source_name} [${audio.source}] (${audio.trim.start_ms}..${audio.trim.end_ms} ms, vol ${audio.volume})`
    );
  }
  if (payload.project_path) {
    lines.push(`Project:  ${String(payload.project_path)}`);
  }
  if (payload.copied_to_clipboard !== undefined) {
    lines.push(`Clipboard:${payload.copied_to_clipboard ? " copied" : " failed or unsupported"}`);
  }
  if (payload.note) {
    lines.push(`Note:     ${String(payload.note)}`);
  }
  return lines.join("\n");
}

export function formatSearchHuman(payload: Record<string, unknown>): string {
  const query = String(payload.query ?? "");
  const results = (payload.results as Array<{ title: string; page_url: string; media_url: string | null }>) ?? [];
  if (results.length === 0) {
    return `No MyInstants sounds found for "${query}".`;
  }
  const lines: string[] = [`MyInstants results for "${query}" (${results.length}):`];
  results.forEach((item, index) => {
    lines.push(`  ${index + 1}. ${item.title}`);
    lines.push(`     ${item.page_url}`);
  });
  return lines.join("\n");
}

export function formatDoctorHuman(report: DoctorReport): string {
  const lines: string[] = [];
  const check = (ok: boolean) => (ok ? "[OK]" : "[MISSING]");
  lines.push(`StikSound CLI environment (${report.platform}/${report.arch}, Node ${report.node_version})`);
  lines.push(
    `  ${check(report.ffmpeg.available)} ffmpeg (${report.ffmpeg.binary})${report.ffmpeg.version ? ` v${report.ffmpeg.version}` : ""}`
  );
  if (report.ffmpeg.error) lines.push(`       ${report.ffmpeg.error}`);
  lines.push(`  ${check(report.ffprobe.available)} ffprobe (${report.ffprobe.binary})`);
  if (report.ffprobe.error) lines.push(`       ${report.ffprobe.error}`);
  lines.push(`  ${check(report.webp_wasm.available)} WebP WASM encoder (@jsquash/webp)`);
  if (report.webp_wasm.error) lines.push(`       ${report.webp_wasm.error}`);
  lines.push(`  ${check(report.text_renderer.available)} Text sticker renderer (@resvg/resvg-wasm)`);
  if (report.text_renderer.error) lines.push(`       ${report.text_renderer.error}`);

  if (report.ffmpeg.available) {
    lines.push(
      `  Encoders: H.264=${report.ffmpeg.h264_encoder ?? "none"}, AAC=${report.ffmpeg.aac_encoder ? "aac" : "none"}, VP9=${report.ffmpeg.vp9_encoder ? "libvpx-vp9" : "none"}, Opus=${report.ffmpeg.opus_encoder ?? "none"}`
    );
  }
  lines.push("  Profiles:");
  for (const [profile, supported] of Object.entries(report.profiles)) {
    lines.push(`    ${check(supported)} ${profile}`);
  }
  if (!report.ffmpeg.available || !report.ffprobe.available) {
    lines.push("");
    lines.push(`Install FFmpeg: ${report.install_hint}`);
  }
  return lines.join("\n");
}
