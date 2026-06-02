export default function HomePage() {
  return (
    <>
      {/* STATUS */}
      <div className="statusbar">
        <div className="left">
          <span><span className="dot" />SYSTEM // ONLINE</span>
          <span>BUILD 0.0.1 — MOCKUP</span>
          <span>BYOM — KEYS LOCAL</span>
        </div>
        <div className="right">
          <span>2026.06.01 / 14:42 UTC</span>
          <span>HELLO@JOHNLACROIX.COM</span>
        </div>
      </div>

      {/* WORDMARK */}
      <div className="wordmark">
        <span className="painted">AI Cinema</span>
        <span className="lockup">by Bloody Finger</span>
      </div>
      <div className="tagline">Cinematic video, made easy. Bring your own model.</div>

      {/* PROJECT HEADER */}
      <div className="project-head">
        <div className="project-meta">
          <h1><span className="slash">//</span> Product Reveal</h1>
          <div className="specs">
            <span>18.0s</span><span>9 : 16</span><span>6 clips</span><span>v3 / draft</span>
          </div>
        </div>
        <div className="project-actions">
          <button type="button" className="btn ghost">Library</button>
          <button type="button" className="btn ghost">Export</button>
          <button type="button" className="btn">Preview</button>
          <button type="button" className="btn primary">▶︎ Render</button>
        </div>
      </div>

      {/* LOOK BAR */}
      <div className="lookbar">
        <div className="slot">
          <div className="label">// BRIEF</div>
          <div className="value">Warm 35mm Hero <span className="caret">▾</span></div>
        </div>
        <div className="slot">
          <div className="label">// GRADE</div>
          <div className="value">Warm Cinematic <span className="caret">▾</span></div>
        </div>
        <div className="slot">
          <div className="label">// MUSIC</div>
          <div className="value">Cinematic Build <span className="caret">▾</span></div>
        </div>
        <div className="slot">
          <div className="label">// TITLE STYLE</div>
          <div className="value">BFS Mono — Bone <span className="caret">▾</span></div>
        </div>
      </div>

      {/* TIMELINE */}
      <div className="timeline-wrap">
        <div className="tl-label">
          <span>// TIMELINE</span>
          <span>Click a clip to open the flow · Click ◇ to set transitions</span>
        </div>

        <div className="ruler">
          <span>0:00</span><span>0:03</span><span>0:06</span><span>0:09</span><span>0:12</span><span>0:15</span>
        </div>

        <div className="clips-row">
          <div className="clip">
            <div className="clip-num">01 // CLIP</div>
            <div className="clip-title">Open</div>
            <div className="clip-meta"><span className="clip-version">v2 ▾</span><span className="clip-dur">3.0s</span></div>
          </div>
          <div className="clip">
            <div className="trans-marker" data-type="fade" title="Crossfade 0.4s">◇</div>
            <div className="clip-num">02 // CLIP</div>
            <div className="clip-title">Reveal</div>
            <div className="clip-meta"><span className="clip-version">v1 ▾</span><span className="clip-dur">3.0s</span></div>
          </div>
          <div className="clip active">
            <div className="trans-marker" title="Cut">◇</div>
            <div className="clip-num">03 // CLIP</div>
            <div className="clip-title">Detail</div>
            <div className="clip-meta"><span className="clip-version">v3 ▾</span><span className="clip-dur">3.0s</span></div>
          </div>
          <div className="clip">
            <div className="trans-marker" data-type="fade" title="Crossfade 0.4s">◇</div>
            <div className="clip-num">04 // CLIP</div>
            <div className="clip-title">B-roll</div>
            <div className="clip-meta"><span className="clip-version">v1 ▾</span><span className="clip-dur">3.0s</span></div>
          </div>
          <div className="clip empty">
            <div className="trans-marker" title="Cut">◇</div>
            <div className="clip-num">05 // TITLE</div>
            <div className="clip-title">Available Now</div>
            <div className="clip-meta"><span className="clip-version">— not yet</span><span className="clip-dur">3.0s</span></div>
          </div>
          <div className="clip empty">
            <div className="trans-marker" data-type="fade" title="Fade to black">◇</div>
            <div className="clip-num">06 // CLIP</div>
            <div className="clip-title">CTA</div>
            <div className="clip-meta"><span className="clip-version">— not yet</span><span className="clip-dur">3.0s</span></div>
          </div>
        </div>

        <div className="audio-row" style={{ marginTop: 14 }}>
          <div className="track-label">VO</div>
          <div className="vo-seg" style={{ gridColumn: "1 / 2" }}>v1 — <span className="vo-text">&ldquo;Meet the new standard.&rdquo;</span></div>
          <div className="vo-seg" style={{ gridColumn: "3 / 5" }}>v2 — <span className="vo-text">&ldquo;Hand-stitched. Considered. Built to outlast you.&rdquo;</span></div>
          <div className="vo-seg" style={{ gridColumn: "5 / 7", opacity: 0.5 }}>— pending</div>
        </div>

        <div className="audio-row" style={{ marginTop: 8 }}>
          <div className="track-label">MUSIC</div>
          <div className="music-bed">
            <span><strong>Cinematic Build</strong> · ElevenLabs Music · v1 · 18.0s · auto-ducks under VO −6dB</span>
            <span>♪ ▾</span>
          </div>
        </div>

        <div className="audio-row" style={{ marginTop: 12 }}>
          <div className="grade-strip">
            <span>Final pass · <strong>Warm Cinematic</strong> · exposure +0.2 · contrast +18 · warm mids · crushed blacks · teal shadow</span>
            <span>⤓ EXPORT LUT</span>
          </div>
        </div>
      </div>

      {/* FLOW PANEL — section 03 open */}
      <div className="flow-panel">
        <div className="flow-head">
          <div className="title"><span className="slash">//</span> 03 — Detail <span className="timecode">0:06 — 0:09</span></div>
          <div className="right">
            <div className="version-dd"><span>v3</span><span>macro orbit</span><span className="caret">▾</span></div>
            <button type="button" className="btn ghost">✕ Close</button>
          </div>
        </div>

        <div className="flow-body">

          {/* STAGE 1 — STILL */}
          <div className="stage">
            <div className="stage-title"><span className="num">01</span>STILL</div>

            <div className="field">
              <div className="field-label">Image prompt</div>
              <div className="field-input tall">macro detail, raw stitching, warm side light, shallow focus</div>
            </div>

            <div className="field-row three">
              <div className="field">
                <div className="field-label">Model</div>
                <div className="field-pill">Flux 1.1 Pro <span className="caret">▾</span></div>
              </div>
              <div className="field">
                <div className="field-label">Input</div>
                <div className="field-pill">02 last frame <span className="caret">▾</span></div>
              </div>
              <div className="field">
                <div className="field-label">Cost</div>
                <div className="field-pill cost">~ $0.04</div>
              </div>
            </div>

            <div className="preview-row">
              <div className="preview-box">
                <span className="vbadge">s2 · active</span>
                <span className="play">▶︎</span>
                <span className="time">still</span>
              </div>
              <div className="versions-list">
                <div className="vrow">
                  <div className="vlabel"><span className="vid">s1</span><span className="vdesc">cool tone, tight crop</span></div>
                  <span className="vmark muted">↻</span>
                </div>
                <div className="vrow active">
                  <div className="vlabel"><span className="vid">s2</span><span className="vdesc">warm side light</span></div>
                  <span className="vmark active">●</span>
                </div>
                <div className="vrow add">+ new still</div>
              </div>
            </div>

            <div className="gen-row">
              <span className="gen-cost">~ $0.04 per still</span>
              <button type="button" className="btn primary">⏵ Generate still</button>
            </div>
          </div>

          {/* STAGE 2 — MOTION */}
          <div className="stage">
            <div className="stage-title"><span className="num">02</span>MOTION</div>

            <div className="field">
              <div className="field-label">Motion prompt</div>
              <div className="field-input tall">slow orbit left to right, breathing focus pull, no whip</div>
            </div>

            <div className="field-row three">
              <div className="field">
                <div className="field-label">Model</div>
                <div className="field-pill">Runway Gen-4 <span className="caret">▾</span></div>
              </div>
              <div className="field">
                <div className="field-label">Duration</div>
                <div className="field-pill">3.0s <span className="caret">▾</span></div>
              </div>
              <div className="field">
                <div className="field-label">Cost</div>
                <div className="field-pill cost">~ $1.20</div>
              </div>
            </div>

            <div className="preview-row">
              <div className="preview-box motion">
                <span className="vbadge">v3 · active</span>
                <span className="play">▶︎</span>
                <span className="time">0:00 / 0:03</span>
              </div>
              <div className="versions-list">
                <div className="vrow">
                  <div className="vlabel"><span className="vid">v1</span><span className="vdesc">static — no motion</span></div>
                  <span className="vmark muted">↻</span>
                </div>
                <div className="vrow">
                  <div className="vlabel"><span className="vid">v2</span><span className="vdesc">orbit — too fast</span></div>
                  <span className="vmark muted">↻</span>
                </div>
                <div className="vrow active">
                  <div className="vlabel"><span className="vid">v3</span><span className="vdesc">slow orbit — keeper</span></div>
                  <span className="vmark active">●</span>
                </div>
                <div className="vrow add">+ new version</div>
              </div>
            </div>

            <div className="gen-row">
              <span className="gen-cost">~ $1.20 per version · project total $4.80 of $20.00 cap</span>
              <button type="button" className="btn primary">⏵ Generate v4</button>
            </div>
          </div>

        </div>
      </div>

      {/* FOOTER */}
      <div className="footstrip">
        <span>// AI CINEMA · BUILT FOR THE LOVE OF THE GAME · MIT</span>
        <span>BLOODY FINGER SOFTWARE — 2026</span>
      </div>
    </>
  );
}
