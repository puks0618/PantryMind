#!/bin/bash
# PantryMind — create the Bedrock Agent + register action groups (issue #22)
#
# Prerequisite: scripts/create-bedrock-agent-role.sh has been run (needs IAM
# write access this session's IAM user doesn't have — see that script's header).
# Everything below only needs bedrock-agent:* + lambda:AddPermission, both
# confirmed available to `pukhraj-pantrymind`.
#
# The three action-group Lambdas are adapters (agent/adapters/bedrock-lambda-adapter),
# not Prajwal's Lambdas directly — Bedrock's fixed agent-invocation event shape
# (apiPath/parameters/requestBody) doesn't match his {action,params} contract, so
# each adapter translates in both directions. Deployed and live-verified against
# the real pantrymind-pantry/-recipes/-shopping-list functions on 2026-08-17
# (getExpiringItems returned real seeded rows; buildShoppingList returned []
# for an empty recipe_ids input, as expected).
set -euo pipefail

ACCOUNT_ID="361769562408"
REGION="us-east-1"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/pantrymind-bedrock-agent-role"
MODEL_ID="us.anthropic.claude-sonnet-4-5-20250929-v1:0"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMAS="${REPO_ROOT}/agent/config/action-groups.json"
INSTRUCTION="$(cat "${REPO_ROOT}/agent/config/system-prompt.md")"

# ---- 1. Create the agent ----
AGENT_ID=$(aws bedrock-agent create-agent \
  --agent-name pantrymind-agent \
  --agent-resource-role-arn "$ROLE_ARN" \
  --foundation-model "$MODEL_ID" \
  --instruction "$INSTRUCTION" \
  --region "$REGION" \
  --query 'agent.agentId' --output text)
echo "Agent created: $AGENT_ID"

# ---- 2. Register the three action groups against the adapter Lambdas ----
register_group () {
  local group_name="$1" schema_key="$2" adapter_fn="$3"
  local adapter_arn="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${adapter_fn}"
  local schema
  schema=$(node -e "console.log(JSON.stringify(require('${SCHEMAS}')['${schema_key}']))")

  aws bedrock-agent create-agent-action-group \
    --agent-id "$AGENT_ID" \
    --agent-version DRAFT \
    --action-group-name "$group_name" \
    --action-group-executor "lambda=${adapter_arn}" \
    --api-schema "payload=${schema}" \
    --region "$REGION" > /dev/null

  # Bedrock invokes the adapter directly — needs its own resource-policy grant,
  # same pattern already used for the adapter -> Prajwal's-Lambda hop.
  aws lambda add-permission \
    --function-name "$adapter_fn" \
    --statement-id "bedrock-agent-invoke-${AGENT_ID}" \
    --action lambda:InvokeFunction \
    --principal bedrock.amazonaws.com \
    --source-arn "arn:aws:bedrock:${REGION}:${ACCOUNT_ID}:agent/${AGENT_ID}" \
    --region "$REGION" > /dev/null

  echo "  registered $group_name -> $adapter_fn"
}

register_group "PantryActions" "pantry" "pantrymind-pantry-agent-adapter"
register_group "RecipeActions" "recipes" "pantrymind-recipes-agent-adapter"
register_group "ShoppingListActions" "shopping-list" "pantrymind-shopping-list-agent-adapter"

# ---- 3. Prepare + alias ----
aws bedrock-agent prepare-agent --agent-id "$AGENT_ID" --region "$REGION" > /dev/null
echo "Preparing agent (can take ~30s)..."
sleep 30

ALIAS_ID=$(aws bedrock-agent create-agent-alias \
  --agent-id "$AGENT_ID" \
  --agent-alias-name live \
  --region "$REGION" \
  --query 'agentAlias.agentAliasId' --output text)

echo ""
echo "Done. Add to .env:"
echo "BEDROCK_AGENT_ID=${AGENT_ID}"
echo "BEDROCK_AGENT_ALIAS_ID=${ALIAS_ID}"
echo ""
echo "Test with:"
echo "aws bedrock-agent-runtime invoke-agent --agent-id ${AGENT_ID} --agent-alias-id ${ALIAS_ID} --session-id test1 --input-text \"what's expiring soon for user 00000000-0000-0000-0000-000000000001\" --region ${REGION} /tmp/agent-out.json"
