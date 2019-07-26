#!/bin/sh

# Start SpeechBubble in debug mode
# No daemon fork, and all logs emitted to stdout

DIR=`dirname $0`
PDIR=`dirname $DIR`

node $PDIR/lib/main.js --debug --echo "SpeechBubble Unbase WebServer API Transaction Error" --color "$@"
