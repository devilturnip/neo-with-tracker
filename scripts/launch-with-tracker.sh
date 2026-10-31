#!/usr/bin/env bash
# Opens NEO from the "NEO" Application launcher entry (see
# ~/.local/share/applications/NEO.desktop). The tracker is NEO's own to
# start (tracker-main.js): when the manuscript opens it builds the tracker
# if its code changed, serves that build, and stops it when NEO quits.
# Starting the tracker's dev server here instead would beat NEO to the
# port, and NEO would use that slower dev server rather than the build.
set -u

NEO_DIR="$HOME/Projects/neo"

cd "$NEO_DIR" && exec env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
