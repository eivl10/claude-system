#!/bin/bash
# prepush-scan.sh <папка-репо>
# Только читает. Печатает файл и тип находки, НИКОГДА само значение секрета.
# Код выхода: 0 чисто, 1 замечания, 2 критично (не пушить), 3 не git-репо.
R="${1:-.}"
g() { git -c safe.directory='*' -c core.quotepath=false -C "$R" "$@"; }
g rev-parse --git-dir >/dev/null 2>&1 || { echo "не git-репозиторий: $R"; exit 3; }
g rev-parse HEAD >/dev/null 2>&1 || { echo "в репозитории ещё нет коммитов: $R"; exit 0; }
crit=0; warn=0
C() { echo "CRIT  $*"; crit=$((crit+1)); }
W() { echo "WARN  $*"; warn=$((warn+1)); }
echo "scan: ${R##*[\\/]} [$(g branch --show-current) @ $(g rev-parse --short=8 HEAD)]"

# 1. логин/токен, зашитый в адрес remote
for r in $(g remote); do
  u=$(g config --get "remote.$r.url")
  if printf '%s' "$u" | grep -qE '^[a-z]+://[^/@]+@' && ! printf '%s' "$u" | grep -qE '^ssh://git@'; then
    C "remote '$r': в адрес зашит логин/токен (значение скрыто); убрать user@ из адреса"
  fi
done

# 2. секреты в закоммиченных текстовых файлах: один проход, потом уточнение по файлам
ALL='gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[0-9A-Z]{16}|(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,}|vcp_[A-Za-z0-9]{20,}|[0-9]{8,10}:[A-Za-z0-9_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
PATS=(
  'github-token=gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}'
  'aws-key=AKIA[0-9A-Z]{16}'
  'api-key-sk=(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}'
  'google-key=AIza[0-9A-Za-z_-]{35}'
  'slack=xox[baprs]-[A-Za-z0-9-]{10,}'
  'vercel=vcp_[A-Za-z0-9]{20,}'
  'telegram-bot=[0-9]{8,10}:[A-Za-z0-9_-]{35}'
  'private-key=-----BEGIN [A-Z ]*PRIVATE KEY-----'
)
cand=$(g grep -Il -E "$ALL" HEAD -- . ':(exclude)*.lock' ':(exclude)package-lock.json' ':(exclude)*.min.js' 2>/dev/null | sed 's/^HEAD://')
while IFS= read -r f; do
  [ -z "$f" ] && continue
  for p in "${PATS[@]}"; do
    n=$(g grep -Ic -E "${p#*=}" HEAD -- ":(literal)$f" 2>/dev/null | sed 's/.*://')
    [ -n "$n" ] && C "секрет [${p%%=*}] в файле: $f ($n)"
  done
done <<< "$cand"

# 3. секретные файлы и мусор в git
files=$(g ls-files)
CRIT_RE='(^|/)[.]env($|[.])|[.](pem|key|pfx|p12)$|(^|/)id_rsa|(^|/)(credentials|token)[.](json|pkl)$'
WARN_RE='(^|/)node_modules/|(^|/)(dist|build)/|[.](db|sqlite|sqlite3)$|[.](exe|dll|zip|7z|rar|iso)$|[.]log$|(^|/)[.]claude/settings[.]local[.]json$'
EX='[.]env[.](example|sample|template)$'
c=$(grep -E "$CRIT_RE" <<< "$files" | grep -vE "$EX")
[ -n "$c" ] && C "в git лежат секретные файлы ($(wc -l <<< "$c" | tr -d ' ')): $(head -3 <<< "$c" | tr '\n' ' ')"
w=$(grep -E "$WARN_RE" <<< "$files")
[ -n "$w" ] && W "в git лежит мусор/тяжёлое ($(wc -l <<< "$w" | tr -d ' ')): $(head -3 <<< "$w" | tr '\n' ' ')"

# 4. файлы больше 50 МБ (GitHub отвергает >100 МБ)
while IFS= read -r l; do
  [ -n "$l" ] && W "файл больше 50 МБ: $l"
done < <(g ls-tree -r -l HEAD | awk -F'\t' '{split($1,a," "); if (a[4]+0>52428800) printf "%d МБ  %s\n", a[4]/1048576, $2}' | head -5)

# 5. секретные файлы, которые когда-то были в истории
h=$(g log --all --name-only --pretty=format: 2>/dev/null | sort -u | grep -E "$CRIT_RE" | grep -vE "$EX")
while IFS= read -r f; do
  [ -z "$f" ] && continue
  grep -qxF -- "$f" <<< "$files" || C "в истории был секретный файл (сейчас удалён, но остаётся в истории): $f"
done <<< "$h"

# 6. что не сохранено и не залито
st=$(g status --porcelain=v1)
m=$(grep -cE '^(.M|M.)' <<< "$st"); d=$(grep -cE '^(.D|D.)' <<< "$st"); u=$(grep -c '^??' <<< "$st")
ab=$(g rev-list --left-right --count '@{u}...HEAD' 2>/dev/null); ahead="${ab#*$'\t'}"
echo "INFO  не в коммитах: M$m D$d ??$u | коммитов не на GitHub: ${ahead:-нет upstream}"

if [ $crit -gt 0 ]; then echo "RESULT: КРИТИЧНО ($crit), не пушить"; exit 2
elif [ $warn -gt 0 ]; then echo "RESULT: есть замечания ($warn)"; exit 1
else echo "RESULT: чисто"; exit 0; fi
