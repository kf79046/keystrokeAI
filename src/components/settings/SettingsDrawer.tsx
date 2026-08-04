"use client";

import React, { useState } from "react";
import { useSettingsStore, CmdMode, CmdDock, TestMode } from "@/store/settings";
import { WordSetKey } from "@/lib/wordbanks";
import { useTheme } from "next-themes";
import CommandHintsFloating from "@/components/ui/CommandHintsFloating";
import { Card, CardContent } from "@/components/ui/card";

export default function SettingsPanel() {
  const s = useSettingsStore();
  const { setTheme } = useTheme();
  const [importText, setImportText] = useState("");
  return (
        <div className="p-0 space-y-4">
          {/* Appearance */}
          <section className="rounded-xl border border-white/10 bg-black/25 hover:bg-black/30 transition-colors p-4">
            <h3 className="mb-3 text-sm font-semibold tracking-wide text-white/90">Appearance</h3>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
              {(["system","light","dark"] as const).map(v => (
                <label
                  key={v}
                  className={[
                    "flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-0",
                    (s.appearance.theme ?? "system") === v ? "border-white/30 bg-white/10" : "border-white/10 hover:border-white/20"
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={v}
                    checked={(s.appearance.theme ?? "system") === v}
                    onChange={() => { s.setTheme(v); setTheme(v); }}
                    className="sr-only"
                  />
                  {v[0].toUpperCase() + v.slice(1)}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/60">“System” follows your OS setting; changes apply instantly.</p>
          </section>
          {/* Commands */}
          <Card className="bg-black/25 hover:bg-black/30 border border-white/10 transition-colors">
            <CardContent className="p-4 space-y-3">
              <div className="text-white/90 text-sm font-semibold tracking-wide">Commands</div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-white/70 mb-1">Default mode</div>
                  {(["hidden","peek","full"] as CmdMode[]).map(m => (
                    <label key={m} className="flex items-center gap-2 mb-1">
                      <input
                        type="radio"
                        name="cmdMode"
                        checked={s.commands.defaultMode===m}
                        onChange={() => {
                          s.update('commands', { defaultMode: m });
                          try { localStorage.setItem('bk:cmdHints.mode', m); } catch {}
                          try { window.dispatchEvent(new CustomEvent('bk:cmdHints:update')); } catch {}
                        }}
                      />
                      <span className="capitalize">{m === 'peek' ? 'Peek (minimized)' : m === 'full' ? 'Full panel' : 'Hidden'}</span>
                    </label>
                  ))}
                </div>
                <div>
                  <div className="text-white/70 mb-1">Dock corner</div>
                  {(["br","bl","tr","tl"] as CmdDock[]).map(d => (
                    <label key={d} className="flex items-center gap-2 mb-1">
                      <input
                        type="radio"
                        name="cmdDock"
                        checked={s.commands.defaultDock===d}
                        onChange={() => {
                          s.update('commands', { defaultDock: d });
                          try { localStorage.setItem('bk:cmdHints.dock', d); } catch {}
                          try { window.dispatchEvent(new CustomEvent('bk:cmdHints:update')); } catch {}
                        }}
                      />
                      <span className="capitalize">{d === 'br' ? 'Bottom-right' : d === 'bl' ? 'Bottom-left' : d === 'tr' ? 'Top-right' : 'Top-left'}</span>
                    </label>
                  ))}
                </div>
                <div>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={s.commands.autoShowOnResults} onChange={(e)=>s.update('commands',{ autoShowOnResults: e.target.checked })} />Auto-show on results</label>
                </div>
                <div>
                  <label className="block text-white/60 mb-1">Auto peek delay (ms)</label>
                  <input type="number" min={2000} max={20000} step={500} value={s.commands.autoPeekDelayMs}
                    onChange={(e)=>s.update('commands',{ autoPeekDelayMs: Math.min(20000, Math.max(2000, Number(e.target.value)||8000)) })}
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Test defaults */}
          <Card className="bg-black/25 hover:bg-black/30 border border-white/10 transition-colors">
            <CardContent className="p-4 space-y-3 text-sm">
              <div className="text-white/90 text-sm font-semibold tracking-wide">Test defaults</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-white/70 mb-1">Default mode</div>
                  {(["words","time","quote","custom"] as TestMode[]).map(m => (
                    <label key={m} className="flex items-center gap-2 mb-1">
                      <input type="radio" name="testMode" checked={s.test.defaultMode===m} onChange={()=>s.update('test',{ defaultMode: m })} />
                      <span className="capitalize">{m === "quote" ? "<> coder" : m}</span>
                    </label>
                  ))}
                </div>
                <div>
                  <div className="text-white/70 mb-1">Default length</div>
                  {([10,15,20,30,50] as const).map(n => (
                    <label key={n} className="inline-flex items-center gap-2 mr-2 mb-1">
                      <input type="radio" name="testLen" checked={s.test.defaultLength===n} onChange={()=>s.update('test',{ defaultLength: n })} />
                      <span>{n}</span>
                    </label>
                  ))}
                </div>
                <div className="col-span-2">
                  <div className="text-white/70 mb-2">Word set</div>
                  <div role="radiogroup" aria-label="Word set" className="grid grid-cols-3 gap-2">
                    {([
                      { key: "core200", label: "Core-200" },
                      { key: "core1000", label: "Core-1000" },
                      { key: "core5000", label: "Core-5000" }
                    ] as { key: WordSetKey; label: string }[]).map(({ key, label }) => (
                      <label
                        key={key}
                        className={[
                          "flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-0",
                          s.test.wordSet === key ? "border-white/30 bg-white/10" : "border-white/10 hover:border-white/20"
                        ].join(" ")}
                      >
                        <input
                          type="radio"
                          name="wordSet"
                          value={key}
                          checked={s.test.wordSet === key}
                          onChange={() => s.update('test', { wordSet: key })}
                          className="sr-only"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={s.test.include_numbers} onChange={(e)=>s.update('test',{ include_numbers: e.target.checked })} />Include numbers</label>
                </div>
                <div>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={s.test.include_punctuation} onChange={(e)=>s.update('test',{ include_punctuation: e.target.checked })} />Include punctuation</label>
                </div>
              </div>
              <div className="text-white/50 text-xs">Applied on first load and new test when not overridden.</div>
            </CardContent>
          </Card>

          {/* Privacy (stub) */}
          <Card className="bg-black/25 hover:bg-black/30 border border-white/10 transition-colors">
            <CardContent className="p-4 space-y-2 text-sm">
              <div className="text-white/90 text-sm font-semibold tracking-wide">Privacy</div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={s.privacy.publicProfile} onChange={(e)=>s.update('privacy',{ publicProfile: e.target.checked })} />Public profile (coming soon)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={s.privacy.shareRunsByDefault} onChange={(e)=>s.update('privacy',{ shareRunsByDefault: e.target.checked })} />Share runs by default (coming soon)</label>
            </CardContent>
          </Card>

          {/* AI Coach */}
          <Card className="bg-black/25 hover:bg-black/30 border border-white/10 transition-colors">
            <CardContent className="p-4 space-y-3 text-sm">
              <div className="text-white/90 text-sm font-semibold tracking-wide">AI</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={(s as any).ai?.coachEnabled ?? true} onChange={(e)=>s.update('ai',{ coachEnabled: e.target.checked })} />
                  Enable AI Coach
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={(s as any).ai?.includeDigraphs ?? true} onChange={(e)=>s.update('ai',{ includeDigraphs: e.target.checked })} />
                  Include digraphs
                </label>
                <div className="col-span-2">
                  <div className="text-white/70 mb-1">Intensity</div>
                  {(["low","med","high"] as const).map(v => (
                    <label key={v} className="inline-flex items-center gap-2 mr-4">
                      <input type="radio" name="aiIntensity" checked={(s as any).ai?.intensity===v} onChange={()=>s.update('ai',{ intensity: v })} />
                      <span className="capitalize">{v}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="text-white/50 text-xs">Controls how aggressively drills target weak spots (and how much exploration we keep).</div>
            </CardContent>
          </Card>

          {/* Footer */}
          <div className="flex items-center justify-between">
            <button className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30" onClick={()=>s.reset()}>Reset to defaults</button>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30" onClick={()=>{
                try {
                  const data = s.export();
                  const blob = new Blob([data], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = 'blaze_settings.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),0);
                } catch {}
              }}>Export JSON</button>
              <button className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30" onClick={()=>{
                const x = prompt("Paste settings JSON"); if (x) try { s.import(x); } catch {}
              }}>Import JSON</button>
            </div>
          </div>
        </div>
  );
}


