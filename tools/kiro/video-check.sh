#!/usr/bin/env bash
# Usage: tools/kiro/video-check.sh trailer|clips|edit
set -e
case "$1" in
  trailer) python3 -m py_compile video/trailer/*.py && echo "trailer scripts OK" ;;
  clips)   for d in video/clips/crew video/clips/workflow; do (cd "$d" && npx --yes hyperframes check && npx --yes hyperframes lint); done; echo "clips OK" ;;
  edit)    python3 -m py_compile video/edit/talk.py video/edit/compose.py && echo "edit scripts OK" ;;
  *) echo "usage: $0 trailer|clips|edit"; exit 1 ;;
esac
