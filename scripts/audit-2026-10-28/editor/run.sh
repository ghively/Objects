#!/bin/bash
D=/tmp/claude-0/-home-user-Objects/9fe675a5-20db-54bd-960e-e71bfe759230/scratchpad/audit-editor
F=${2:-rt.audit.ts}
cp $D/$F /home/user/Objects/frontend/src/editor/zz_$F
rm -f $D/out.txt
cd /home/user/Objects/frontend && CASES=$D/$1 OUT=$D/out.txt npx vitest run --config $D/vitest.audit.config.mjs src/editor/zz_$F 2>&1 | grep -E "FAIL|Error|✗|×|failed" | head -20
rm -f /home/user/Objects/frontend/src/editor/zz_$F
cat $D/out.txt 2>/dev/null
