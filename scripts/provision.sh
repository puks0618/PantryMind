#!/bin/bash
# PantryMind — CockroachDB Cloud ccloud CLI evidence (issue #10)
#
# The cluster below was already created by Prajwal (CockroachDB Cloud web console)
# before this script existed. This is NOT a from-scratch provisioning script — it
# documents the real ccloud CLI commands used to authenticate against and connect
# to that existing cluster, which is what's actually being claimed as one of the
# three CockroachDB tools for judging.
set -euo pipefail

# ---- 1. Authenticate ----
# Interactive: opens a browser, requires a login + pasted authorization code.
# Cannot be scripted end-to-end for that reason — run once per machine/session:
#
#   ccloud auth login
#
# Gotcha hit while setting this up: a plain `ccloud auth login` authenticates
# you into whatever your *default* CockroachDB Cloud org is, even if you were
# separately invited to and have accepted membership in a different org. Two
# consecutive logins with this account both landed in an unrelated pre-existing
# org ("San Jose State University", org-3bjz6) with zero visible clusters, purely
# because that happened to be the default org for this identity — nothing wrong
# with the invite itself.
ccloud auth whoami

# ---- 2. Locate the cluster ----
# `ccloud cluster list` scopes to "the current organization" and returned an
# empty result even after landing in the org that actually has access — direct
# lookup by cluster ID works regardless and is what actually confirmed access:
CLUSTER_ID="b79b49e8-71a4-439f-9773-c3842a33679e"
CLUSTER_NAME="joking-swan"   # routing id: joking-swan-30279

ccloud cluster info "$CLUSTER_ID" -o json

# ---- 3. Connect ----
# Prints a connection URL rather than opening an interactive shell — the
# non-interactive form used for verification here and by any script that
# needs DATABASE_URL without a human at a terminal.
ccloud cluster sql "$CLUSTER_NAME" --username Pukhraj --connection-url

# ---- Reference ----
# Cloud provider : AWS, us-east-2
# Plan            : SERVERLESS
# CockroachDB     : v26.2.5
# Vector index    : see scripts/schema.sql — cspann availability confirmed
#                    against this exact cluster version in Phase 2, issue #14.
