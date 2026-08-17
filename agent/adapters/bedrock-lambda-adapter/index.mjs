import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({});

// Bedrock Agents always send parameter values as strings, typed via `type`.
// Array/object values arrive JSON-stringified.
function coerce(type, value) {
  if (type === 'array' || type === 'object') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (type === 'number' || type === 'integer') return Number(value);
  if (type === 'boolean') return value === 'true' || value === true;
  return value;
}

function extractParams(event) {
  const params = {};
  for (const p of event.parameters ?? []) {
    params[p.name] = coerce(p.type, p.value);
  }
  const bodyProps = event.requestBody?.content?.['application/json']?.properties ?? [];
  for (const p of bodyProps) {
    params[p.name] = coerce(p.type, p.value);
  }
  return params;
}

// Bridges Bedrock Agent action-group invocation (fixed apiPath/parameters/requestBody
// envelope) to a target Lambda's own event shape, and translates its response back into
// the envelope Bedrock expects. Two downstream shapes exist today:
//   WRAP_ACTION=true  -> target expects { action, params } (lambda/pantry)
//   WRAP_ACTION unset -> target expects the params object directly (lambda/recipes,
//                        lambda/shopping-list — each has exactly one operation)
export const handler = async (event) => {
  const params = extractParams(event);
  const action = event.apiPath?.replace(/^\//, '');
  const payload = process.env.WRAP_ACTION === 'true' ? { action, params } : params;

  const invokeRes = await lambda.send(
    new InvokeCommand({
      FunctionName: process.env.TARGET_FUNCTION_ARN,
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  const raw = JSON.parse(Buffer.from(invokeRes.Payload).toString());
  const httpStatusCode = raw.statusCode ?? 200;
  const body = raw.body ?? JSON.stringify(raw);

  return {
    messageVersion: '1.0',
    response: {
      actionGroup: event.actionGroup,
      apiPath: event.apiPath,
      httpMethod: event.httpMethod,
      httpStatusCode,
      responseBody: {
        'application/json': { body },
      },
    },
  };
};
