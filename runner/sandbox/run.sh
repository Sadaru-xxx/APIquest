#!/bin/bash
# Java Silver 実行サンドボックスの入口。
# 標準入力の tar(ソースファイル + .main + .args)を /work/src に展開し、javac → java を実行して、
# 結果を1行の JSON として標準出力に返す。文字列はすべて base64(出力が JSON を壊さないように)。
# このスクリプトは --network none / --read-only / メモリ・CPU・プロセス数の上限付きのコンテナの中で動く。
set -u

LIMIT=65536          # 各出力の上限(バイト)
STEP_TIMEOUT=10      # javac と java それぞれの上限(秒)
SRC=/work/src
OUT=/work/classes
RES=/work/res
mkdir -p "$SRC" "$OUT" "$RES" || exit 1
: >"$RES/javac"; : >"$RES/stdout"; : >"$RES/stderr"

b64() { head -c "$LIMIT" "$1" | base64 -w0; }
over() { if [ "$(stat -c%s "$1")" -gt "$LIMIT" ]; then echo true; else echo false; fi; }
emit_error() { printf '{"error":"%s"}\n' "$1"; exit 0; }

# 入力の展開(所有者・権限は持ち込まない)
tar -x -C "$SRC" --no-same-owner --no-same-permissions -f - 2>/dev/null || emit_error bad_input
MAIN=$(head -c 200 "$SRC/.main" 2>/dev/null || true)
[ -n "$MAIN" ] || MAIN=Main
ARGS=()
if [ -f "$SRC/.args" ]; then mapfile -t ARGS <"$SRC/.args"; fi
rm -f "$SRC/.main" "$SRC/.args"
[[ "$MAIN" =~ ^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$ ]] || [[ "$MAIN" =~ ^[A-Za-z0-9_$/]+\.java$ ]] || emit_error bad_main

JDK=$(java -XX:-UsePerfData -version 2>&1 | sed -n 's/.*version "\([^"]*\)".*/\1/p' | head -1)
JVM_COMMON=(-XX:-UsePerfData -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -XX:ReservedCodeCacheSize=32m -Xss1m)

COMPILE=ok
START=$(date +%s%N)
if [[ "$MAIN" != *.java ]]; then
  mapfile -t FILES < <(cd "$SRC" && find . -type f -name '*.java' | sed 's|^\./||' | sort)
  if [ "${#FILES[@]}" -eq 0 ]; then emit_error no_source; fi
  (cd "$SRC" && exec timeout -s KILL "$STEP_TIMEOUT" javac -J-Xmx128m "${JVM_COMMON[@]/#/-J}" \
      -J-Duser.language=ja -J-Dfile.encoding=UTF-8 -encoding UTF-8 -d "$OUT" "${FILES[@]}") >"$RES/javac" 2>&1
  rc=$?
  if [ "$rc" -eq 137 ]; then COMPILE=timeout; elif [ "$rc" -ne 0 ]; then COMPILE=error; fi
fi

RUN=skipped
EXIT=null
TIMED_OUT=false
if [ "$COMPILE" = ok ]; then
  if [[ "$MAIN" == *.java ]]; then
    # ソースファイルモード(java Test.java)。コンパイルエラーは java コマンドの出力に出る
    (cd "$SRC" && exec timeout -s KILL "$STEP_TIMEOUT" java -Xmx96m "${JVM_COMMON[@]}" -Duser.language=ja \
        -Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 "$MAIN" "${ARGS[@]}") \
        >"$RES/stdout" 2>"$RES/stderr" </dev/null
  else
    (cd "$SRC" && exec timeout -s KILL "$STEP_TIMEOUT" java -Xmx96m "${JVM_COMMON[@]}" \
        -Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 -cp "$OUT" "$MAIN" "${ARGS[@]}") \
        >"$RES/stdout" 2>"$RES/stderr" </dev/null
  fi
  rc=$?
  RUN=done
  EXIT=$rc
  if [ "$rc" -eq 137 ]; then TIMED_OUT=true; fi
fi
END=$(date +%s%N)

printf '{"jdk":"%s","compile":"%s","javac":"%s","run":"%s","exitCode":%s,"timedOut":%s,"stdout":"%s","stderr":"%s","truncated":{"javac":%s,"stdout":%s,"stderr":%s},"durationMs":%s}\n' \
  "$JDK" "$COMPILE" "$(b64 "$RES/javac")" "$RUN" "$EXIT" "$TIMED_OUT" "$(b64 "$RES/stdout")" "$(b64 "$RES/stderr")" \
  "$(over "$RES/javac")" "$(over "$RES/stdout")" "$(over "$RES/stderr")" "$(( (END - START) / 1000000 ))"
