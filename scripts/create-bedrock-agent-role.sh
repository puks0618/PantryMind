#!/bin/bash
# PantryMind — one-time IAM role for the Bedrock Agent (issue #22)
#
# Must be run by whoever has IAM write access on this account (Prajwal, or the
# account root) — the `pukhraj-pantrymind` IAM user can create/deploy Lambda
# functions and Bedrock Agents themselves (verified: bedrock-agent:CreateAgent
# is allowed), but iam:CreateRole / iam:PutRolePolicy / iam:AttachRolePolicy are
# all denied outright, and iam:PassRole is scoped to a pre-existing allowlist
# that does not include arbitrary new roles. Confirmed by direct probe
# (2026-08-17): `create-agent` with a nonexistent role ARN failed on PassRole,
# not on CreateAgent itself — so this role is the only missing piece.
#
# Run this once. After it completes, scripts/create-bedrock-agent.sh can be run
# by either of you to finish issue #22.
set -euo pipefail

ACCOUNT_ID="361769562408"
REGION="us-east-1"
ROLE_NAME="pantrymind-bedrock-agent-role"

# ---- 1. Trust policy — only Bedrock, only this account's agents ----
TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "bedrock.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": { "aws:SourceAccount": "${ACCOUNT_ID}" },
      "ArnLike": { "aws:SourceArn": "arn:aws:bedrock:${REGION}:${ACCOUNT_ID}:agent/*" }
    }
  }]
}
EOF
)

aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document "$TRUST_POLICY" \
  --description "Execution role for the PantryMind Bedrock Agent (#22)"

# ---- 2. Permissions — invoke the chat model (+ its inference profile) and the
#         three adapter Lambdas (agent/adapters/bedrock-lambda-adapter, already
#         deployed and live-verified against Prajwal's real Lambdas) ----
PERMISSIONS_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeClaudeViaInferenceProfile",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": [
        "arn:aws:bedrock:${REGION}:${ACCOUNT_ID}:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0",
        "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0",
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0"
      ]
    },
    {
      "Sid": "InvokeActionGroupAdapters",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": [
        "arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:pantrymind-pantry-agent-adapter",
        "arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:pantrymind-recipes-agent-adapter",
        "arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:pantrymind-shopping-list-agent-adapter"
      ]
    }
  ]
}
EOF
)

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name pantrymind-bedrock-agent-permissions \
  --policy-document "$PERMISSIONS_POLICY"

echo "Role created: arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
echo "Next: scripts/create-bedrock-agent.sh"
