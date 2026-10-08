#!/usr/bin/env bash
# Runs the Manim explainer engine (engines/manim) inside its own uv env.
#   run.sh <setup|doctor|lint|preview|render|frames|say> [args] [--theme theme.json] [--home dir]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$(cd "$HERE/../.." && pwd)"
ENGINE="$PLUGIN/engines/manim"
DATA="${COMPOSITOR_DATA:-$HOME/.claude/plugins/data/compositor}"
VENV="$DATA/manim"
PY="$VENV/bin/python"
export TTS_MODELS_DIR="${TTS_MODELS_DIR:-$DATA/models}"
export PYTHONWARNINGS="ignore::SyntaxWarning"

usage() {
  cat <<'USAGE'
usage: run.sh <command> [args] [--theme theme.json] [--home dir]

  setup                                create the uv env and download the house voice
  doctor                               report python, manim, typst, ffmpeg, sox, voice (exit 1 when required ones are missing)
  lint <episode.py> [--json]           narration lint
  preview <episode.py> --out <dir>     lint, then 480p15 render; mp4, srt and bounds.json go to <dir>
  render <episode.py> --out <dir> [--quality h|k]
                                       lint, then 1080p60 (h, default) or 2160p60 (k)
  frames <video.mp4> --out <dir>       one PNG every 3 s plus contact.png when magick exists
  say "<text>" [--out <dir>]           speak a line with the house voice

  --theme theme.json    manimTheme() JSON (sets COMPOSITOR_THEME; a fonts.conf beside it sets FONTCONFIG_FILE)
  --home <dir>          dir with lexicon.toml, glossary.toml, house-voice.toml (sets COMPOSITOR_EXPLAIN_HOME)
  --skip-lint           preview/render without the lint step
Environment: COMPOSITOR_DATA (env location), TTS_MODELS_DIR (voice models, default $COMPOSITOR_DATA/models)
USAGE
}

die() { printf 'error: %s\n' "$*" >&2; exit "${2:-2}"; }
abspath() { (cd "$(dirname "$1")" && printf '%s/%s' "$PWD" "$(basename "$1")"); }
need_env() { [[ -x "$PY" ]] || die "no Python env at $VENV; run: $0 setup" 1; }

[[ $# -ge 1 ]] || { usage >&2; exit 2; }
CMD="$1"; shift
case "$CMD" in
  -h|--help|help) usage; exit 0 ;;
  setup|doctor|lint|preview|render|frames|say) ;;
  *) usage >&2; die "unknown command: $CMD" ;;
esac

POSITIONAL=() OUT="" QUALITY="h" JSON=0 LINT=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --theme) [[ $# -ge 2 ]] || die "--theme needs a file"; [[ -f "$2" ]] || die "theme not found: $2"
             THEME="$(abspath "$2")"; export COMPOSITOR_THEME="$THEME"
             [[ -f "$(dirname "$THEME")/fonts.conf" ]] && export FONTCONFIG_FILE="$(dirname "$THEME")/fonts.conf"
             shift 2 ;;
    --home) [[ $# -ge 2 ]] || die "--home needs a dir"; [[ -d "$2" ]] || die "home not found: $2"
            export COMPOSITOR_EXPLAIN_HOME="$(cd "$2" && pwd)"; shift 2 ;;
    --out) [[ $# -ge 2 ]] || die "--out needs a dir"; OUT="$2"; shift 2 ;;
    --quality) [[ $# -ge 2 ]] || die "--quality needs h or k"; QUALITY="$2"; shift 2 ;;
    --json) JSON=1; shift ;;
    --skip-lint) LINT=0; shift ;;
    --*) die "unknown option: $1" ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done
[[ "$QUALITY" == h || "$QUALITY" == k ]] || die "--quality must be h or k"

arg1() { [[ ${#POSITIONAL[@]} -ge 1 ]] || die "$CMD needs $1"; printf '%s' "${POSITIONAL[0]}"; }
require_out() { [[ -n "$OUT" ]] || die "$CMD needs --out <dir>"; mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"; }

cmd_setup() {
  command -v uv >/dev/null || die "uv not found; install it from https://docs.astral.sh/uv/" 1
  mkdir -p "$DATA"
  UV_PROJECT_ENVIRONMENT="$VENV" uv sync --project "$ENGINE"
  PYTHONPATH="$ENGINE" "$PY" -c "from explainer.engines import house, download; download(house())"
  echo "ok: env at $VENV, voice models in $TTS_MODELS_DIR"
}

cmd_doctor() {
  local bad=0
  report() { printf '%-8s %s\n' "$1" "$2"; }
  if [[ -x "$PY" ]]; then
    report python "$("$PY" -c 'import sys; print(sys.version.split()[0], "at", sys.executable)')"
    local probe
    probe="$(PYTHONPATH="$ENGINE" "$PY" - <<'PYEOF' 2>&1 || true
import importlib.metadata as md
for pkg in ("manim", "typst", "manim-voiceover", "piper-tts", "kokoro-onnx"):
    try:
        print(pkg, md.version(pkg))
    except md.PackageNotFoundError:
        print(pkg, "MISSING")
from explainer.engines import house, is_downloaded
v = house()
print("voice", v.id, "downloaded" if is_downloaded(v) else "NOT-DOWNLOADED")
PYEOF
)"
    while read -r name rest; do
      [[ -z "$name" ]] && continue
      case "$name" in
        voice) report voice "$rest"; [[ "$rest" == *NOT-DOWNLOADED ]] && { echo "         run: $0 setup" >&2; bad=1; } ;;
        manim|typst) report "$name" "$rest"; [[ "$rest" == MISSING ]] && bad=1 ;;
        *) report "$name" "$rest" ;;
      esac
    done <<<"$probe"
  else
    report python "MISSING: no env at $VENV"; echo "         run: $0 setup" >&2; bad=1
  fi
  if command -v ffmpeg >/dev/null; then report ffmpeg "$(ffmpeg -version | head -1 | cut -d' ' -f3)"; else report ffmpeg "MISSING (install ffmpeg)"; bad=1; fi
  if command -v sox >/dev/null; then report sox "$(sox --version | head -1)"; else report sox "missing (optional: the house voice does not use it; install the sox package if a manim-voiceover service needs it)"; fi
  if command -v magick >/dev/null; then report magick present; else report magick "missing (optional: contact sheets in 'frames')"; fi
  return $bad
}

cmd_lint() {
  need_env
  local ep; ep="$(arg1 '<episode.py>')"
  local flags=(); [[ $JSON -eq 1 ]] && flags+=(--json)
  PYTHONPATH="$ENGINE" "$PY" -m explainer.lint ${flags[@]+"${flags[@]}"} "$ep"
}

# Two-pass loudnorm to the delivery target (-14 LUFS, -1.5 dBTP), video stream copied untouched.
# The house voice comes out of Manim near -25 LUFS, too quiet for any feed.
loudnorm_mp4() {
  local mp4="$1" tmp="${1%.mp4}.loudnorm.mp4" stats
  stats="$(ffmpeg -hide_banner -nostats -i "$mp4" -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')"
  local mi mtp mlra mth off
  mi="$(sed -n 's/.*"input_i" : "\(.*\)".*/\1/p' <<<"$stats")"
  mtp="$(sed -n 's/.*"input_tp" : "\(.*\)".*/\1/p' <<<"$stats")"
  mlra="$(sed -n 's/.*"input_lra" : "\(.*\)".*/\1/p' <<<"$stats")"
  mth="$(sed -n 's/.*"input_thresh" : "\(.*\)".*/\1/p' <<<"$stats")"
  off="$(sed -n 's/.*"target_offset" : "\(.*\)".*/\1/p' <<<"$stats")"
  [[ -n "$mi" ]] || die "loudnorm could not measure $mp4" 1
  ffmpeg -v error -y -i "$mp4" -c:v copy \
    -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$mi:measured_TP=$mtp:measured_LRA=$mlra:measured_thresh=$mth:offset=$off:linear=true" \
    -ar 48000 -c:a aac -b:a 192k "$tmp" && mv "$tmp" "$mp4"
}

build() { # $1 quality letter, $2 resolution dir, $3 suffix
  need_env
  require_out
  local ep stem started
  ep="$(abspath "$(arg1 '<episode.py>')")"; stem="$(basename "${ep%.py}")"
  if [[ $LINT -eq 1 ]]; then
    PYTHONPATH="$ENGINE" "$PY" -m explainer.lint "$ep" || die "narration lint failed; fix the errors above" 1
  fi
  rm -f "$OUT/bounds.json"
  export COMPOSITOR_BOUNDS_OUT="$OUT/bounds.json"
  started=$SECONDS
  local extra=(); [[ "$1" == l ]] && extra+=(--disable_caching)
  # Audio cache lives in the run's media dir so the plugin dir stays clean.
  PYTHONPATH="$ENGINE" "$PY" -m manim -q"$1" -v WARNING --progress_bar none ${extra[@]+"${extra[@]}"} --media_dir "$OUT/media" "$ep" Episode
  local made="$OUT/media/videos/$stem/$2"
  cp "$made/Episode.mp4" "$OUT/$stem$3.mp4"
  [[ -f "$made/Episode.srt" ]] && cp "$made/Episode.srt" "$OUT/$stem$3.srt"
  [[ "$1" == l ]] || loudnorm_mp4 "$OUT/$stem$3.mp4"
  [[ -f "$OUT/bounds.json" ]] || echo "note: no bounds.json; the Episode class does not use BoundsMixin" >&2
  printf 'built %s in %ss\n' "$OUT/$stem$3.mp4" "$((SECONDS - started))"
}

cmd_frames() {
  command -v ffmpeg >/dev/null || die "ffmpeg not found" 1
  local mp4; mp4="$(arg1 '<video.mp4>')"; [[ -f "$mp4" ]] || die "not found: $mp4"
  require_out
  ffmpeg -v error -y -i "$mp4" -vf "fps=1/3" "$OUT/frame-%03d.png"
  if command -v magick >/dev/null; then
    magick montage "$OUT"/frame-*.png -tile 4x -geometry 320x+4+4 -background '#000000' "$OUT/contact.png"
  fi
  ls "$OUT"/frame-*.png "$OUT"/contact.png 2>/dev/null
}

cmd_say() {
  need_env
  local text; text="$(arg1 '"<text>"')"
  local dir="${OUT:-$DATA}"; mkdir -p "$dir"
  PYTHONPATH="$ENGINE" "$PY" -m explainer.say "$text" --out "$dir/say.wav"
}

case "$CMD" in
  setup) cmd_setup ;;
  doctor) cmd_doctor ;;
  lint) cmd_lint ;;
  preview) build l 480p15 -preview ;;
  render) build "$QUALITY" "$([[ $QUALITY == k ]] && echo 2160p60 || echo 1080p60)" "" ;;
  frames) cmd_frames ;;
  say) cmd_say ;;
esac
